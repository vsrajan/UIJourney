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
const entries = new Map(); // "Component/variant" -> { item, anchor }
for (const item of lib.libraryItems ?? []) {
  for (const el of item.elements ?? []) {
    const c = el.customData?.component;
    if (!c) continue;
    if (el.type === "text" && el.containerId) continue;
    const key = `${c}/${el.customData.variant ?? "default"}`;
    if (!entries.has(key)) entries.set(key, { item, anchor: el });
  }
}
function lookup(component, variant = "default") {
  return entries.get(`${component}/${variant}`) ?? entries.get(`${component}/default`) ?? null;
}

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
// Widening stretches the anchor plus any element that was full-bleed in the
// original (within 2px of the anchor's width); everything else keeps its
// relative offset. That covers AppHeader (bar stretches, logo stays left)
// and Card (surface stretches, contents are placed by the caller).
function instantiate(entry, { x, y, width, frameId, texts = {}, props = {} }) {
  const { item, anchor } = entry;
  const dx = x - anchor.x;
  const dy = y - anchor.y;
  const grow = width != null && width !== anchor.width ? width - anchor.width : 0;
  const idMap = new Map();
  for (const el of item.elements) idMap.set(el.id, nextId(el.customData?.component?.toLowerCase() ?? el.type));

  const out = [];
  for (const el of item.elements) {
    const isAnchor = el.id === anchor.id;
    const fullBleed = Math.abs((el.width ?? 0) - anchor.width) <= 2;
    const clone = {
      ...JSON.parse(JSON.stringify(el)),
      id: idMap.get(el.id),
      x: el.x + dx,
      y: el.y + dy,
      frameId,
    };
    if (grow && (isAnchor || fullBleed)) clone.width = (el.width ?? 0) + grow;

    if (el.containerId) clone.containerId = idMap.get(el.containerId);
    if (Array.isArray(el.boundElements)) {
      clone.boundElements = el.boundElements.map((b) => ({ ...b, id: idMap.get(b.id) ?? b.id }));
    }
    // Text content: named override, else the component's own override.
    const comp = el.customData?.component ?? item.elements.find((e) => e.id === el.containerId)?.customData?.component;
    if (el.type === "text") {
      const t = texts[comp] ?? (el.containerId ? texts.__label : undefined);
      if (t != null) { clone.text = t; clone.originalText = t; clone.width = textWidth(t, el.fontSize); }
    }
    if (isAnchor && Object.keys(props).length) {
      clone.customData = { ...clone.customData, props: { ...(clone.customData?.props ?? {}), ...props } };
    }
    out.push(stamp(clone));
  }

  // Bound labels get real coordinates, centred in their container. Excalidraw
  // honours stored x/y on import, so a label left at the library's offset (or
  // at 0,0) renders detached from its component.
  const byId = Object.fromEntries(out.map((e) => [e.id, e]));
  for (const el of out) {
    if (el.type !== "text" || !el.containerId) continue;
    const c = byId[el.containerId];
    if (!c) continue;
    el.x = c.x + (c.width - el.width) / 2;
    el.y = c.y + (c.height - el.height) / 2;
  }
  return out;
}

const textWidth = (t, size) => Math.ceil(String(t).length * size * 0.6);

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

      const entry = lookup(comp, node.variant);
      if (!entry) die(`component "${comp}/${node.variant ?? "default"}" is not in the library — report the gap, do not substitute`);

      const isHeader = comp === "AppHeader";
      const width = node.width ?? (isHeader ? fw : comp === "Card" ? Math.min(400, fw - 2 * CARD_PAD) : availWidth);
      const x = isHeader ? fx : node.center === false ? originX : originX;

      const created = instantiate(entry, {
        x, y: isHeader ? 0 : y, width, frameId: fid,
        texts: { __label: node.text, [comp]: node.text },
        props: node.props ?? {},
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

  const placeRow = (nodes, originX, availWidth) => {
    const startY = y;
    let x = originX;
    let tallest = 0;
    for (const node of nodes) {
      const saved = y;
      y = startY;
      place([{ ...node, gap: 0 }], x, node.width ?? Math.floor(availWidth / nodes.length));
      tallest = Math.max(tallest, y - startY);
      x += (node.width ?? Math.floor(availWidth / nodes.length)) + GAP;
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

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(scene, null, 2));
console.log(`wrote ${outPath}`);
console.log(`  ${frameIds.length} screen(s), ${elements.length} element(s), ${Object.keys(files).length} embedded file(s)`);
if (!logo) console.log("  WARN: no lib/logo.json — the logo will not render; run scripts/embed-logo.mjs");
