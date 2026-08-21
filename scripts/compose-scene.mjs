#!/usr/bin/env node
// Expands a compact screen spec into a conforming .excalidraw scene.
//
//   node scripts/compose-scene.mjs journeys/<name>/spec.json \
//     [--lib lib/uds.excalidrawlib] [--typography lib/typography.json] \
//     [--tokens data/tokens.json] [--logo lib/logo.json] [--out <path>]
//
// The agent writes semantics (which components, what copy, what order); this
// script writes geometry. Everything mechanical lives here — copying library
// elements, laying them out, computing bound-text coordinates, stamping
// customData, the PageBackground, the logo files entry, transition arrows.
//
// That split matters for more than speed. Every scene defect this pipeline
// has hit came from a model hand-authoring Excalidraw JSON: bound labels at
// 0,0, missing PageBackground, 1px borders, base64 transcribed by hand. None
// of them are possible here, because the script emits them correctly by
// construction and never puts the logo's base64 in front of the model.
//
// Spec shape (see docs/spec-schema.md):
//   { journey, screens: [ { name, step, frame?, layout: [node...] } ],
//     transitions: [ { from, to, trigger, label? } ] }
// node: { component, variant?, text?, typography?, props?, width?, gap?,
//         children?: [node...] }  |  { field: { label, ...control } }
//         |  { row: [node...] }

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex, lookupEntry, unmatchedAxes } from "./lib-index.mjs";
import { isScaffoldText, PLACEHOLDER_HOSTS } from "./placeholder-text.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const specPath = argv.find((a) => !a.startsWith("--") && !(argv[argv.indexOf(a) - 1] ?? "").startsWith("--"));
// Paths given explicitly resolve against the caller's directory, as any CLI
// would; only the built-in defaults resolve against the repo, so the script
// works from anywhere without every invocation naming five files.
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1]
    ? (isAbsolute(argv[i + 1]) ? argv[i + 1] : resolve(process.cwd(), argv[i + 1]))
    : resolve(REPO, d);
};
const P = (p) => (isAbsolute(p) ? p : resolve(process.cwd(), p));

if (!specPath) {
  console.error("usage: node scripts/compose-scene.mjs <spec.json> [--lib p] [--typography p] [--tokens p] [--logo p] [--out p]");
  process.exit(2);
}

const die = (m) => { console.error(`ERROR: ${m}`); process.exit(1); };
const readJson = (p, req = true) => {
  const full = P(p);
  if (!existsSync(full)) { if (req) die(`${full} not found`); return null; }
  try { return JSON.parse(readFileSync(full, "utf8")); } catch (e) { die(`${full} is not valid JSON: ${e.message}`); }
};

const spec = readJson(specPath);
const lib = readJson(flag("lib", "lib/uds.excalidrawlib"));
const typography = readJson(flag("typography", "lib/typography.json"));
const tokens = readJson(flag("tokens", "data/tokens.json"), false);
const logo = readJson(flag("logo", "lib/logo.json"), false);
const outPath = P(flag("out", `journeys/${spec.journey ?? "journey"}/journey.excalidraw`));

// ---------------------------------------------------------------- tokens

function resolveColor(alias, fallback) {
  if (!alias) return fallback;
  if (/^#/.test(alias)) return alias.toUpperCase();
  if (!tokens) return fallback;
  const bare = alias.replace(/^--/, "");
  for (const b of [tokens.semantic?.light, tokens.semantic, tokens.aliases, tokens.light, tokens.colors, tokens.primitives, tokens]) {
    if (!b || typeof b !== "object") continue;
    const v = b[alias] ?? b[bare];
    if (typeof v === "string" && /^#/.test(v)) return v.toUpperCase();
    if (v?.value && /^#/.test(v.value)) return v.value.toUpperCase();
  }
  return fallback;
}
const BACKGROUND = resolveColor("--background", "#F4F3EE");

// --------------------------------------------------------------- library

// Index every component-bearing element, and keep the whole item so a
// composite can be cloned as a unit.
const libIndex = buildIndex(lib);

// Components placed from a library entry whose geometry was derived from
// Tailwind classes rather than measured. Tracked so the scene can declare
// itself provisional: heights are exact, widths are estimates, and codegen
// must not read layout off a scene built from estimates.
const derivedUsed = new Set();
// Axis values a node asks for: its variant plus any string-valued prop that
// the library says is an axis for this component (size, tone, ...).
function wantedAxes(node) {
  return { variant: node.variant ?? "default", ...(node.props ?? {}) };
}
function lookup(component, node = {}) {
  return lookupEntry(libIndex, component, wantedAxes(node));
}
const degraded = [];

// ----------------------------------------------------------------- ids

let seq = 0;
const nextId = (p) => `${p}_${(++seq).toString(36).padStart(4, "0")}`;
// Deterministic pseudo-random so re-composing the same spec yields the same
// file — a churning diff hides real changes from review.
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h);
}

const BASE = {
  angle: 0, fillStyle: "solid", strokeStyle: "solid", roughness: 0, opacity: 100,
  groupIds: [], frameId: null, roundness: null, isDeleted: false, boundElements: [],
  link: null, locked: false, updated: 1787000000000, version: 1,
};
const stamp = (el) => ({ ...BASE, ...el, seed: hash(el.id) % 2147483647, versionNonce: hash(el.id + "n") % 2147483647 });

// -------------------------------------------------------------- cloning

// Clone a library item's elements to (x, y), optionally widening it.
//
// Widening rules, in order: the anchor always grows; a child spanning at
// least half the anchor grows with it (table header and row bands, card
// surfaces); a smaller child sitting in the right-hand half shifts right so
// right-aligned chrome stays right-aligned; everything else keeps its offset.
//
// The original rule only grew children within 2px of the anchor's width,
// which left a widened DataTable with a 1000px panel and 560px rows — the
// ragged edge you see when a glyph is stretched but its innards are not.
function instantiate(entry, { x, y, width, frameId, texts = {}, props = {}, hasChildren = false }) {
  const { item, anchor } = entry;
  const dx = x - anchor.x;
  const dy = y - anchor.y;
  const grow = width != null && width !== anchor.width ? width - anchor.width : 0;
  const idMap = new Map();
  for (const el of item.elements) idMap.set(el.id, nextId(el.customData?.component?.toLowerCase() ?? el.type));
  const rootComponent = anchor.customData?.component;
  const freeTextCount = item.elements.filter((e) => e.type === "text" && !e.containerId).length;

  const out = [];
  const dropped = new Set();
  for (const el of item.elements) {
    const isAnchor = el.id === anchor.id;
    const spans = (el.width ?? 0) >= anchor.width * 0.5;
    const inRightHalf = (el.x ?? 0) - anchor.x > anchor.width * 0.5;
    let wasOverridden = false;
    const clone = {
      ...JSON.parse(JSON.stringify(el)),
      id: idMap.get(el.id),
      x: el.x + dx,
      y: el.y + dy,
      frameId,
    };
    if (grow) {
      if (isAnchor || spans) clone.width = (el.width ?? 0) + grow;
      else if (inRightHalf) clone.x += grow;
    }

    if (el.containerId) clone.containerId = idMap.get(el.containerId);
    if (Array.isArray(el.boundElements)) {
      clone.boundElements = el.boundElements.map((b) => ({ ...b, id: idMap.get(b.id) ?? b.id }));
    }
    // Text content. A composite's label reaches us three ways: bound to its
    // container, named for the component itself, or as a free text element
    // the glyph names after its parent (AppHeader -> AppHeaderTitle). The
    // third case is why "Application Title" once survived into a mockup whose
    // spec said "DIF Application".
    const comp = el.customData?.component ?? item.elements.find((e) => e.id === el.containerId)?.customData?.component;
    if (el.type === "text") {
      let t = texts[comp];
      if (t === undefined && el.containerId) t = texts.__label;
      // fallthrough rules below; `wasOverridden` records whether the spec spoke
      if (t === undefined && rootComponent && typeof comp === "string" && comp !== rootComponent && comp.startsWith(rootComponent)) {
        t = texts.__label;
      }
      // A composite with exactly one free text has only one thing that text
      // can be. With two, guessing would clobber a subtitle, so don't.
      if (t === undefined && !el.containerId && freeTextCount === 1) t = texts.__label;
      if (t != null) { clone.text = t; clone.originalText = t; clone.width = textWidth(t, el.fontSize); wasOverridden = true; }
    }
    // An explicit "" means "this component has no label here" — drop the
    // element rather than leaving an empty box. Without a way to say that,
    // a glyph's placeholder copy is unremovable: the Checkbox shipped with
    // the word "Label", and every row of a table inherited it.
    if (clone.type === "text" && clone.text === "") {
      dropped.add(clone.id);
      continue;
    }

    // Un-overridden glyph scaffolding. Only reached when the spec said
    // nothing about this text, so a real label always wins over these rules.
    if (clone.type === "text" && !wasOverridden) {
      const host = el.customData?.component ?? rootComponent;
      const isAffordance = PLACEHOLDER_HOSTS.has(host) || PLACEHOLDER_HOSTS.has(rootComponent);
      // A container given children has real content; its own stand-in copy
      // is what the children replace.
      const supersededByChildren = hasChildren;
      if (!isAffordance && (supersededByChildren || isScaffoldText(clone.text, host, rootComponent))) {
        placeholdersDropped.push(`${rootComponent ?? host}: "${String(clone.text).slice(0, 40)}"`);
        dropped.add(clone.id);
        continue;
      }
    }
    if (isAnchor && Object.keys(props).length) {
      clone.customData = { ...clone.customData, props: { ...(clone.customData?.props ?? {}), ...props } };
    }
    out.push(stamp(clone));
  }

  // Bound labels get real coordinates, centred in their container. Excalidraw
  // honours stored x/y on import, so a label left at the library's offset (or
  // at 0,0) renders detached from its component.
  //
  // Both axes are derived from font metrics rather than from the height the
  // library happened to store. Substituting a label already recomputes its
  // width, so trusting the stored height centred labels horizontally and not
  // vertically — a glyph whose text box was authored the full height of its
  // container put every label hard against the top.
  // Containers must not keep pointing at a label that no longer exists.
  if (dropped.size) {
    for (const el of out) {
      if (!Array.isArray(el.boundElements)) continue;
      el.boundElements = el.boundElements.filter((b) => !dropped.has(b.id));
    }
  }

  const byId = Object.fromEntries(out.map((e) => [e.id, e]));
  for (const el of out) {
    if (el.type !== "text" || !el.containerId) continue;
    const c = byId[el.containerId];
    if (!c) continue;
    el.height = textHeight(el.text, el.fontSize, el.lineHeight);
    el.x = c.x + (c.width - el.width) / 2;
    el.y = c.y + (c.height - el.height) / 2;
  }
  return out;
}

const placeholdersDropped = [];
const textWidth = (t, size) => Math.ceil(String(t).length * size * 0.6);
// The box a run of text actually occupies, one line-height per line.
const textHeight = (t, size = 16, lineHeight = 1.25) =>
  Math.round(size * lineHeight) * Math.max(1, String(t ?? "").split("\n").length);

// Props that carry visible copy, most specific first.
const TEXT_PROPS = ["title", "label", "text", "placeholder", "heading"];
function textFromProps(props = {}) {
  for (const k of TEXT_PROPS) if (typeof props[k] === "string" && props[k]) return props[k];
  return undefined;
}

function typographyEl({ component, typography: token, text, x, y, frameId, width }) {
  const scale = typography?.scale ?? {};
  const roles = typography?.roles ?? {};
  const role = roles[token];
  const spec_ = scale[token] ?? (role?.basedOn ? { ...scale[role.basedOn], ...role } : role);
  if (!spec_) die(`typography token "${token}" is not defined in typography.json`);
  const fontSize = spec_.fontSize;
  const id = nextId(component.toLowerCase());
  return stamp({
    id, type: "text", x, y,
    width: width ?? textWidth(text, fontSize),
    height: Math.round(fontSize * 1.25),
    strokeColor: resolveColor(spec_.color, "#1C1C1C"), backgroundColor: "transparent",
    strokeWidth: 0, text, originalText: text, fontSize, fontFamily: 2,
    textAlign: "left", verticalAlign: "top", containerId: null, lineHeight: 1.25, autoResize: true,
    frameId,
    customData: { component, typography: token, fontWeight: spec_.fontWeight, props: {}, resize: "horizontal" },
  });
}



// Glyph placeholder copy: library glyphs carry stand-in text so they read as
// themselves when browsed. The rules for telling that apart from real content
// live in placeholder-text.mjs, which carries its own self-test
// (node scripts/placeholder-text.mjs --selftest).

// ------------------------------------------------------- table synthesis

// Components the composer draws itself for a synthesized table. They have no
// library entry by design — the library holds one DataTable glyph, and a
// table's real shape is its columns, which only the spec knows.
const TABLE_COMPONENTS = ["DataTable", "Table"];

// Column label -> row key. Specs write human column names ("Short Description")
// and terse row keys ("short"), so exact match, then prefix either way, then
// fall back to position.
function cellValue(row, columnLabel, index) {
  if (Array.isArray(row)) return row[index] ?? "";
  const norm = (t) => String(t).toLowerCase().replace(/[^a-z0-9]/g, "");
  const want = norm(columnLabel);
  const keys = Object.keys(row);
  const exact = keys.find((k) => norm(k) === want);
  if (exact) return row[exact];
  const prefix = keys.find((k) => want.startsWith(norm(k)) || norm(k).startsWith(want));
  if (prefix) return row[prefix];
  return Object.values(row)[index] ?? "";
}

const ACTION_VARIANTS = { approve: "positive", accept: "positive", confirm: "positive",
  reject: "negative", delete: "negative", remove: "negative", decline: "negative" };
function actionSpec(a) {
  if (a && typeof a === "object") return { label: a.label ?? a.text ?? "", variant: a.variant ?? ACTION_VARIANTS[String(a.label ?? "").toLowerCase()] ?? "default" };
  return { label: String(a), variant: ACTION_VARIANTS[String(a).toLowerCase()] ?? "default" };
}

// Builds a table from the spec's own data, using the library glyph only for
// its colours and band heights. Returns { elements, height }.
function synthesizeTable(entry, node, { x, y, width, frameId }) {
  const props = node.props ?? {};
  const rawColumns = (props.columns ?? []).map((c) => String(c));
  const rows = props.rows ?? [];
  const actions = (props.rowActions ?? []).map(actionSpec);
  // A leading empty column header is how specs write the checkbox gutter.
  const selectable = props.selectable === true || rawColumns[0] === "";
  const columns = rawColumns.filter((c) => c !== "" && c.toLowerCase() !== "actions");

  const surface = entry.anchor;
  const kids = entry.item.elements.filter((e) => e.id !== surface.id && e.type === "rectangle");
  const band = kids.find((e) => (e.width ?? 0) >= surface.width * 0.6 && e.height >= 24 && e.height <= 64);
  const border = resolveColor("--border", "#DDDDDD");
  const muted = resolveColor("--muted-foreground", "#6B6B6B");
  const fg = resolveColor("--foreground", "#1C1C1C");
  const surfaceFill = surface.backgroundColor ?? "#FFFFFF";
  const zebra = band?.backgroundColor && band.backgroundColor !== "transparent" ? band.backgroundColor : "#F7F7F7";

  const CHECK_W = selectable ? 40 : 0;
  const checkEntry = selectable ? lookupEntry(libIndex, "Checkbox", {}) : null;
  const actionEntries = actions.map((a) => ({ ...a, entry: lookupEntry(libIndex, "Button", { variant: a.variant, size: "sm" }) }));
  const actionsW = actionEntries.length
    ? actionEntries.reduce((sum, a) => sum + Math.max(a.entry?.anchor?.width ?? 72, textWidth(a.label, 12) + 24), 0) + GAP * (actionEntries.length - 1) + 16
    : 0;

  // Remaining width is split by content weight, so "Description" gets room a
  // even split would give to "ID".
  const weights = columns.map((c, i) => {
    const longest = rows.reduce((m, r) => Math.max(m, String(cellValue(r, c, i)).length), c.length);
    return Math.min(Math.max(longest, 6), 60);
  });
  const weightSum = weights.reduce((a, b) => a + b, 0) || 1;
  const free = Math.max(200, width - CHECK_W - actionsW - 24);
  const colW = weights.map((w) => Math.max(64, Math.round((w / weightSum) * free)));

  const headerH = band?.height ?? 40;
  const rowH = Math.max(band?.height ?? 44, 44);
  const out = [];

  const totalH = headerH + rowH * rows.length;
  out.push(stamp({
    id: nextId("datatable"), type: "rectangle", x, y, width, height: totalH,
    strokeColor: surface.strokeColor ?? border, backgroundColor: surfaceFill,
    strokeWidth: Math.max(surface.strokeWidth ?? 2, 2), fillStyle: "solid", roughness: 0,
    roundness: surface.roundness ?? null, frameId,
    customData: { component: node.component, props, resize: "both", synthesized: true },
  }));

  const cellX = (i) => x + 12 + CHECK_W + colW.slice(0, i).reduce((a, b) => a + b, 0);
  const textEl = (text, cx, cy, w, { size = 13, color = fg, weight } = {}) => stamp({
    id: nextId("cell"), type: "text", x: cx, y: cy, width: Math.max(8, w), height: Math.round(size * 1.25),
    strokeColor: color, backgroundColor: "transparent", strokeWidth: 0,
    text: String(text), originalText: String(text), fontSize: size, fontFamily: 2,
    textAlign: "left", verticalAlign: "top", containerId: null, lineHeight: 1.25, autoResize: false,
    frameId, customData: { component: "TableCell", props: weight ? { weight } : {}, synthesized: true },
  });

  // Header band + labels.
  out.push(stamp({
    id: nextId("tablehead"), type: "rectangle", x, y, width, height: headerH,
    strokeColor: border, backgroundColor: zebra, strokeWidth: 2, fillStyle: "solid",
    roughness: 0, roundness: null, frameId,
    customData: { component: "TableHeader", props: {}, synthesized: true },
  }));
  columns.forEach((c, i) => {
    out.push(textEl(c, cellX(i), y + Math.round((headerH - 16) / 2), colW[i] - 12, { size: 13, color: muted, weight: 600 }));
  });

  // Rows.
  rows.forEach((row, r) => {
    const ry = y + headerH + r * rowH;
    out.push(stamp({
      id: nextId("tablerow"), type: "rectangle", x, y: ry, width, height: rowH,
      strokeColor: border, backgroundColor: r % 2 ? zebra : surfaceFill, strokeWidth: 2,
      fillStyle: "solid", roughness: 0, roundness: null, frameId,
      customData: { component: "TableRow", props: {}, synthesized: true },
    }));
    if (checkEntry) {
      const ch = checkEntry.anchor.height ?? 16;
      out.push(...instantiate(checkEntry, {
        x: x + 12, y: ry + Math.round((rowH - ch) / 2), frameId,
        texts: { __label: "", Checkbox: "" }, // a row selector carries no label
      }));
    }
    columns.forEach((c, i) => {
      out.push(textEl(cellValue(row, c, i), cellX(i), ry + Math.round((rowH - 16) / 2), colW[i] - 12));
    });
    let ax = x + width - actionsW + 8;
    for (const a of actionEntries) {
      if (!a.entry) continue;
      const bw = Math.max(a.entry.anchor.width ?? 72, textWidth(a.label, 12) + 24);
      const bh = a.entry.anchor.height ?? 32;
      out.push(...instantiate(a.entry, {
        x: ax, y: ry + Math.round((rowH - bh) / 2), width: bw, frameId,
        texts: { __label: a.label, Button: a.label },
        props: { variant: a.variant, size: "sm" },
      }));
      ax += bw + GAP;
    }
  });

  return { elements: out, height: totalH };
}

// ---------------------------------------------------------------- layout

const TYPOGRAPHY_COMPONENTS = new Set(["Heading", "Text", "Link"]);
const GAP = 16;
const LABEL_GAP = 8;
const CARD_PAD = 24;

const elements = [];
const files = {};
const frameIds = [];

let cursorX = 0;
const FRAME_GUTTER = 100;

for (const [i, screen] of (spec.screens ?? []).entries()) {
  const fw = screen.frame?.width ?? 800;
  const fh = screen.frame?.height ?? 600;
  const fx = cursorX;
  const fid = nextId("frame");
  frameIds.push({ id: fid, step: screen.step ?? i + 1, x: fx, width: fw });

  elements.push(stamp({
    id: fid, type: "frame", x: fx, y: 0, width: fw, height: fh,
    strokeColor: "#868E96", backgroundColor: "transparent", strokeWidth: 1,
    name: `Screen: ${screen.name}`,
    customData: { journeyStep: screen.step ?? i + 1, screenName: screen.name },
  }));

  // Every screen sits on the standard's ground.
  elements.push(stamp({
    id: nextId("pagebg"), type: "rectangle", x: fx, y: 0, width: fw, height: fh,
    strokeColor: "transparent", backgroundColor: BACKGROUND, strokeWidth: 0,
    frameId: fid, customData: { component: "PageBackground", props: {}, resize: "both" },
  }));

  let y = 0;
  const place = (nodes, originX, availWidth, indent = 0) => {
    for (const node of nodes) {
      if (node.row) { placeRow(node.row, originX, availWidth); continue; }
      if (node.field) {
        const { label, ...control } = node.field;
        place([{ component: "Label", text: label, gap: LABEL_GAP }], originX, availWidth);
        place([control], originX, availWidth);
        continue;
      }
      const comp = node.component;
      if (!comp) die(`layout node without a component: ${JSON.stringify(node)}`);

      if (TYPOGRAPHY_COMPONENTS.has(comp)) {
        const el = typographyEl({
          component: comp, typography: node.typography ?? (comp === "Link" ? "link" : "body-2"),
          text: node.text ?? "", x: originX, y, frameId: fid,
        });
        elements.push(el);
        y += el.height + (node.gap ?? GAP);
        continue;
      }

      const entry = lookup(comp, node);
      if (!entry) die(`component "${comp}/${node.variant ?? "default"}" is not in the library — report the gap, do not substitute`);
      if (entry.source === "derived") derivedUsed.add(comp);
      const missed = unmatchedAxes(entry, wantedAxes(node));
      if (missed.length) degraded.push(`${comp}: asked for ${missed.join(", ")}`);

      // A data table's shape is its columns; the library holds one generic
      // glyph. When the spec supplies columns or rows, build the real thing.
      if (TABLE_COMPONENTS.includes(comp) && ((node.props?.columns?.length) || (node.props?.rows?.length))) {
        const tw = node.width ?? availWidth;
        const built = synthesizeTable(entry, node, { x: originX, y, width: tw, frameId: fid });
        elements.push(...built.elements);
        y += built.height + (node.gap ?? GAP);
        continue;
      }

      const isHeader = comp === "AppHeader";
      const width = node.width ?? (isHeader ? fw : comp === "Card" ? Math.min(400, fw - 2 * CARD_PAD) : availWidth);
      const x = isHeader ? fx : node.center === false ? originX : originX;

      // A composite's own label often arrives as a prop rather than `text`
      // (AppHeader title, Input placeholder). Without this, the glyph's
      // placeholder copy survives into the mockup — "Application Title"
      // where the spec said "DIF Application".
      const label = node.text ?? textFromProps(node.props);
      const created = instantiate(entry, {
        x, y: isHeader ? 0 : y, width, frameId: fid,
        texts: { __label: label, [comp]: label },
        props: node.props ?? {},
        hasChildren: Boolean(node.children?.length),
      });
      elements.push(...created);

      // Logo lives inside AppHeader; give it the embedded asset.
      for (const el of created) {
        if (el.customData?.component === "Logo" && logo) {
          el.type = "image";
          el.fileId = logo.id ?? "logo-uds";
          el.customData.props = { ...(el.customData.props ?? {}), src: logo.src, alt: el.customData.props?.alt ?? "Logo" };
          files[el.fileId] = { id: el.fileId, mimeType: logo.mimeType, dataURL: logo.dataURL, created: 1787000000000 };
        }
      }

      const anchorClone = created.find((e) => e.customData?.component === comp);
      const h = anchorClone?.height ?? 0;

      if (node.children?.length) {
        // Card-like container: stack children inside with padding, then grow
        // the surface to fit them.
        const innerX = (anchorClone?.x ?? x) + CARD_PAD;
        const innerW = (anchorClone?.width ?? width) - 2 * CARD_PAD;
        const top = (anchorClone?.y ?? y) + CARD_PAD;
        const savedY = y;
        y = top;
        place(node.children, innerX, innerW, indent + 1);
        const contentBottom = y;
        if (anchorClone) anchorClone.height = Math.max(h, contentBottom - anchorClone.y + CARD_PAD - GAP);
        y = savedY + (anchorClone?.height ?? h) + (node.gap ?? GAP);
        continue;
      }

      y = (isHeader ? h : y + h) + (node.gap ?? GAP);
    }
  };

  // Nodes in a row take their natural width — the library entry's own width,
  // or the text's width for typography. Splitting the content column evenly
  // is what turned two small buttons into two 490px slabs.
  const naturalWidth = (node) => {
    if (node.width != null) return node.width;
    if (node.row) return null;
    const comp = node.field?.component ?? node.component;
    if (!comp) return null;
    if (TYPOGRAPHY_COMPONENTS.has(comp)) {
      const token = node.typography ?? (comp === "Link" ? "link" : "body-2");
      const size = (typography?.scale ?? {})[token]?.fontSize ?? 14;
      return textWidth(node.text ?? "", size);
    }
    const entry = lookup(comp, node);
    return entry?.anchor?.width ?? null;
  };

  const placeRow = (nodes, originX, availWidth) => {
    const startY = y;
    const widths = nodes.map((n) => naturalWidth(n));
    const known = widths.filter((w) => w != null).reduce((a, b) => a + b, 0);
    const unknownCount = widths.filter((w) => w == null).length;
    const gaps = GAP * Math.max(0, nodes.length - 1);
    // Leftover space goes to nodes with no natural width; if the row is wider
    // than the column, fall back to an even split so nothing runs off-screen.
    let share = unknownCount ? Math.max(80, Math.floor((availWidth - known - gaps) / unknownCount)) : 0;
    let resolved = widths.map((w) => w ?? share);
    if (resolved.reduce((a, b) => a + b, 0) + gaps > availWidth) {
      resolved = nodes.map(() => Math.floor((availWidth - gaps) / nodes.length));
    }
    let x = originX;
    let tallest = 0;
    for (const [i, node] of nodes.entries()) {
      const saved = y;
      y = startY;
      place([{ ...node, gap: 0 }], x, resolved[i]);
      tallest = Math.max(tallest, y - startY);
      x += resolved[i] + GAP;
      y = saved;
    }
    y = startY + tallest + GAP;
  };

  // Content is centred under the header unless the screen says otherwise.
  const contentW = screen.contentWidth ?? 400;
  const contentX = fx + Math.round((fw - contentW) / 2);
  place(screen.layout ?? [], contentX, contentW);

  cursorX += fw + FRAME_GUTTER;
}

// ------------------------------------------------------------ transitions

for (const t of spec.transitions ?? []) {
  const from = frameIds.find((f) => f.step === t.from);
  const to = frameIds.find((f) => f.step === t.to);
  if (!from || !to) die(`transition ${t.from}->${t.to} references a step with no screen`);
  const x1 = from.x + from.width;
  const w = to.x - x1;
  const yy = 260 + (spec.transitions.indexOf(t) % 3) * 100;
  const aid = nextId("arrow");
  const tid = nextId("arrowlabel");
  const label = t.label ?? `on ${t.trigger}`;
  elements.push(stamp({
    id: aid, type: "arrow", x: x1, y: yy, width: w, height: 0,
    strokeColor: "#444444", strokeWidth: 2, points: [[0, 0], [w, 0]],
    roundness: { type: 2 }, endArrowhead: "arrow", startBinding: null, endBinding: null,
    lastCommittedPoint: null, boundElements: [{ id: tid, type: "text" }],
    customData: { transition: { from: t.from, to: t.to, trigger: t.trigger, condition: t.condition } },
  }));
  elements.push(stamp({
    id: tid, type: "text", x: x1 + w / 2 - textWidth(label, 12) / 2, y: yy - 20,
    width: textWidth(label, 12), height: 15, strokeColor: "#444444", strokeWidth: 0,
    text: label, originalText: label, fontSize: 12, fontFamily: 2,
    textAlign: "center", verticalAlign: "middle", containerId: aid, lineHeight: 1.25,
  }));
}

const scene = {
  type: "excalidraw", version: 2, source: "uijourney-compose",
  elements, appState: { gridSize: 8, viewBackgroundColor: "#FFFFFF" }, files,
};
if (derivedUsed.size) {
  // Provenance travels with the artifact. validate-scene.mjs refuses a
  // provisional scene without --allow-derived, and journey-coder refuses it
  // outright, so a draft library can never quietly become the basis for
  // generated code.
  scene.customData = {
    ...(scene.customData ?? {}),
    provisional: true,
    provisionalReason: "composed from library entries whose geometry was derived from Tailwind classes, not measured",
    derivedComponents: [...derivedUsed].sort(),
  };
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(scene, null, 2));
console.log(`wrote ${outPath}`);
console.log(`  ${frameIds.length} screen(s), ${elements.length} element(s), ${Object.keys(files).length} embedded file(s)`);
if (!logo) console.log("  WARN: no lib/logo.json — the logo will not render; run scripts/embed-logo.mjs");
if (placeholdersDropped.length) {
  const shown = [...new Set(placeholdersDropped)];
  console.log(`  dropped ${placeholdersDropped.length} glyph placeholder(s): ${shown.slice(0, 6).join(", ")}${shown.length > 6 ? ", ..." : ""}`);
  console.log("  If any of those should be real screen copy, put it in the spec as `text` or a child node.");
}
if (derivedUsed.size) {
  console.log(`  PROVISIONAL: ${derivedUsed.size} component(s) came from derived library entries (${[...derivedUsed].sort().join(", ")}).`);
  console.log("  Widths are estimates. Fine for mockups; validate with --allow-derived, and journey-coder will refuse this scene.");
}
