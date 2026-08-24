#!/usr/bin/env node
// Validates a journey .excalidraw scene against the scene contract in
// .github/agents/journey-designer.md. No dependencies.
//
//   node scripts/validate-scene.mjs journeys/<name>/journey.excalidraw \
//     [lib/uds.excalidrawlib] [--typography lib/typography.json] [--tokens data/tokens.json]
//
// Pass the library to also check that every component element matches a
// library entry (component+variant exists; fixed-size shapes not resized).
//
// Exits 1 on any ERROR. WARNs list items the developer should eyeball.

import { readFileSync, existsSync } from "node:fs";
import { buildIndex, lookupEntry, axesOf } from "./lib-index.mjs";

const argv = process.argv.slice(2);
const positional = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--")));
const scenePath = positional[0];
const libPath = positional[1];
function optFlag(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}
const typographyPath = optFlag("typography", "lib/typography.json");
const tokensPath = optFlag("tokens", "data/tokens.json");
const allowDerived = argv.includes("--allow-derived");
if (!scenePath) {
  console.error("usage: node scripts/validate-scene.mjs <journey.excalidraw> [uds.excalidrawlib] [--typography p] [--tokens p]");
  process.exit(2);
}

const errors = [];
const warns = [];

function parse(p, required = true) {
  if (!existsSync(p)) {
    if (required) {
      console.error(`ERROR: ${p} not found`);
      if (!p.startsWith("/")) console.error(`(relative paths resolve from your current directory — run this from the repo root)`);

      process.exit(1);
    }
    return null;
  }
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch (e) {
    console.error(`ERROR: ${p} is not valid JSON: ${e.message}`);
    process.exit(1);
  }
}

const scene = parse(scenePath);
const els = scene.elements ?? [];
const byId = Object.fromEntries(els.map((e) => [e.id, e]));

const typography = parse(typographyPath, false);
const tokens = parse(tokensPath, false);
if (!typography) warns.push(`no typography spec at ${typographyPath} — text colors and sizes cannot be checked`);

// Resolve a semantic alias (--primary) to a hex value via tokens.json.
// tokens.json shape varies by extractor, so try the plausible layouts and
// degrade to a warning rather than a false error when nothing resolves.
let tokenResolutionFailed = false;
function resolveColor(alias) {
  if (!alias) return null;
  if (/^#/.test(alias)) return alias.toUpperCase();
  if (!tokens) return null;
  const bare = alias.replace(/^--/, "");
  const buckets = [
    tokens.semantic?.light, tokens.semantic, tokens.aliases, tokens.light,
    tokens.colors, tokens.primitives, tokens,
  ];
  for (const b of buckets) {
    if (!b || typeof b !== "object") continue;
    const v = b[alias] ?? b[bare];
    if (typeof v === "string" && /^#/.test(v)) return v.toUpperCase();
    if (v && typeof v === "object" && typeof v.value === "string" && /^#/.test(v.value)) return v.value.toUpperCase();
  }
  tokenResolutionFailed = true;
  return null;
}
function typographySpec(tokenName) {
  if (!typography || !tokenName) return null;
  const scale = typography.scale ?? {};
  const roles = typography.roles ?? {};
  if (scale[tokenName]) return { ...scale[tokenName] };
  const role = roles[tokenName];
  if (role) {
    const base = role.basedOn ? scale[role.basedOn] : null;
    return base ? { ...base, ...role } : { ...role };
  }
  return null;
}

// Minimum stroke width for a visible border. A 1px near-white hairline
// rasterizes away at the zoom Excalidraw picks when fitting a full journey
// to screen — confirmed in the field: borders invisible at fit, visible at
// 200%. The token record stays --border; this is a legibility affordance of
// the wireframe, not a claim about the real component's CSS.
const MIN_BORDER_STROKE_WIDTH = 2;

const frames = els.filter((e) => e.type === "frame");
if (frames.length === 0) errors.push("no frames — each screen must be a frame named 'Screen: <Name>'");
const steps = new Set();
for (const f of frames) {
  const cd = f.customData ?? {};
  if (typeof cd.journeyStep !== "number" || !cd.screenName) {
    errors.push(`frame "${f.name}" missing customData.journeyStep/screenName`);
  } else {
    steps.add(cd.journeyStep);
  }
}

// Index the library (if given): component/variant -> element geometry + resize hint.
//
// Every component-bearing element in an item is indexed, not just the first.
// A composite is a group that legitimately defines more than one component —
// AppHeader contains the Logo image, DataTable contains its toolbar and
// pagination — and indexing only the first left those nested components
// unregistered, so a scene that used them failed library conformance while
// the per-frame rules simultaneously demanded them. That deadlock had no
// escape that did not involve falsifying metadata.
// Axis-aware, and shared with compose-scene.mjs so the two agree on which
// entry an element came from. Keying on variant alone made every size look
// like a size mismatch against the default-size entry.
let libIndex = null;
if (libPath) libIndex = buildIndex(parse(libPath));
function libEntryFor(cd) {
  if (!libIndex) return null;
  return lookupEntry(libIndex, cd.component, axesOf(cd));
}

// Constructs the designer creates per screen that are deliberately not kit
// components, so they have no library entry and are exempt from library
// conformance. They are still checked by their own rules below.
// Constructs the composer draws itself, which therefore have no library
// entry: the page ground, and the parts of a table synthesized from spec data
// (the library holds one generic DataTable glyph; a real table's shape is its
// columns, which only the spec knows).
const SCENE_ONLY_COMPONENTS = new Set([
  "PageBackground", "TableHeader", "TableRow", "TableCell", "Icon",
  "ScrollbarTrack", "ScrollbarThumb", "Underline",
]);

// A lone symbol character standing in for an icon. It renders as text, may be
// missing from the font, and tells codegen nothing — a "▽" becomes a text node
// rather than <FilterIcon />. Cell values are exempt: an em dash meaning "no
// value" is data the spec supplied, not a disguised icon.
const SYMBOL_AS_ICON = /^[\u2190-\u21FF\u2200-\u22FF\u2300-\u23FF\u25A0-\u25FF\u2600-\u27BF\u2039\u203A\u00AB\u00BB\u2022\u00D7\u2713\u2714\u2717]$/u;

const PLACEHOLDER_HOSTS = new Set(["Input", "Textarea", "Select", "Combobox"]);

for (const el of els) {
  const cd = el.customData ?? {};
  const label = el.text ? `"${el.text.slice(0, 32)}"` : `${el.type} ${el.width}x${el.height}`;

  if (el.type === "text" && el.fontFamily !== 2) {
    errors.push(`text ${label}: fontFamily ${el.fontFamily} — must be 2 (Helvetica)`);
  }

  // Metadata on containers only.
  if (el.type === "text" && el.containerId && cd.component) {
    errors.push(`bound text ${label} re-declares customData.component — metadata belongs on the container only`);
  }

  if (el.type === "text" && el.containerId && byId[el.containerId]) {
    const c = byId[el.containerId];
    if (c.type !== "arrow" && (el.width > c.width || el.height > c.height)) {
      errors.push(`bound text ${label} ${el.width}x${el.height} exceeds container ${c.width}x${c.height}`);
    }

    // Bound text must carry real coordinates. Excalidraw honours the stored
    // x/y on import and only recomputes them when the container is edited —
    // so a bound label written at 0,0 renders at the canvas origin, not on
    // its button. This silently wrecked a pilot login screen.
    if (c.type !== "arrow") {
      const cx = el.x + (el.width ?? 0) / 2;
      const cy = el.y + (el.height ?? 0) / 2;
      const inside = cx >= c.x - 2 && cx <= c.x + c.width + 2 && cy >= c.y - 2 && cy <= c.y + c.height + 2;
      if (!inside) {
        errors.push(
          `bound text ${label} sits at (${el.x}, ${el.y}), outside its container at (${c.x}, ${c.y}) ${c.width}x${c.height} — ` +
            `Excalidraw renders bound text at its stored coordinates on import, so this label will appear detached from its component`
        );
      }
    }
  }

  // Placeholders read as typed values unless they are left-aligned.
  if (el.type === "text" && el.containerId && byId[el.containerId]) {
    const host = byId[el.containerId].customData?.component;
    if (PLACEHOLDER_HOSTS.has(host) && el.textAlign !== "left") {
      errors.push(`${host} placeholder ${label} has textAlign "${el.textAlign}" — placeholders are left-aligned; centred text reads as an entered value`);
    }
  }

  // Borders must survive rasterisation at fit-to-screen zoom.
  if (el.type !== "text" && el.type !== "frame" && el.type !== "arrow" && cd.component) {
    const thin = Math.min(el.width ?? 0, el.height ?? 0) <= 4;
    const stroked = el.strokeColor && el.strokeColor !== "transparent" && el.strokeColor !== "#00000000";
    if (thin) {
      // A hairline rule (Separator, Progress track) is drawn by its fill, not
      // its stroke — thickening the stroke is meaningless. It has the same
      // vanishing problem though, so it needs real thickness instead.
      if (Math.min(el.width ?? 0, el.height ?? 0) < 2) {
        warns.push(`${cd.component} ${label} is under 2px thick — hairlines disappear when Excalidraw fits the journey to screen; give it 2px`);
      }
    } else if (stroked && (el.strokeWidth ?? 1) < MIN_BORDER_STROKE_WIDTH) {
      errors.push(`${cd.component} ${label} has a visible border at strokeWidth ${el.strokeWidth ?? 1} — use ${MIN_BORDER_STROKE_WIDTH}; 1px light strokes vanish when Excalidraw fits the journey to screen`);
    }
  }

  // annotation is for reviewer notes only — never for screen copy or layout.
  if (cd.annotation && el.frameId) {
    if (el.type === "text") {
      errors.push(`text ${label} inside a frame is marked annotation:true — visible screen copy must be a component (Text/Heading/Label/...) or codegen silently drops it`);
    } else if (el.type === "rectangle") {
      errors.push(`rectangle ${label} inside a frame is marked annotation:true — structural regions must be components (Card/Table/AppHeader/...) or codegen silently drops them`);
    }
  }

  // Bound text is described by its container, which carries the metadata, so
  // it must NOT declare customData.component (checked above) and must not be
  // required to either. Demanding both created a deadlock whose only escape
  // was dropping frameId — which silently removes the label from its frame,
  // so it stops moving with the screen.
  const isBoundText = el.type === "text" && !!el.containerId;
  if (el.frameId && !isBoundText && !cd.annotation && !cd.component && !cd.transition && el.type !== "frame") {
    errors.push(`${label} inside a frame has no customData at all — codegen cannot map it`);
  }
  // Bound text belongs to the same frame as its container.
  if (isBoundText && byId[el.containerId]) {
    const c = byId[el.containerId];
    if (c.frameId && el.frameId !== c.frameId) {
      errors.push(`bound text ${label} has frameId ${el.frameId ?? "null"} but its container is in frame ${c.frameId} — the label will not move with the screen`);
    }
  }

  // Typography conformance: size, weight and colour.
  if (el.type === "text" && cd.typography) {
    const spec = typographySpec(cd.typography);
    if (!spec) {
      errors.push(`text ${label}: customData.typography "${cd.typography}" is not defined in ${typographyPath}`);
    } else {
      if (spec.fontSize != null && Math.abs(el.fontSize - spec.fontSize) > 0.5) {
        errors.push(`text ${label}: ${cd.typography} fontSize ${el.fontSize} does not match the type scale (${spec.fontSize})`);
      }
      if (spec.fontWeight != null && Number(cd.fontWeight) !== Number(spec.fontWeight)) {
        errors.push(`text ${label}: ${cd.typography} fontWeight ${cd.fontWeight} does not match the type scale (${spec.fontWeight})`);
      }
      const expected = resolveColor(spec.color);
      if (expected && (el.strokeColor ?? "").toUpperCase() !== expected) {
        errors.push(`text ${label}: ${cd.typography} colour ${el.strokeColor} does not match ${spec.color} (${expected}) — a Link rendered in body colour does not read as a link`);
      }
    }
  }

  // Library conformance.
  if (libIndex && cd.component && el.type !== "text" && !SCENE_ONLY_COMPONENTS.has(cd.component)) {
    const key = `${cd.component}/${cd.variant ?? "default"}`;
    const entry = libEntryFor(cd);
    const libEl = entry?.anchor;
    if (libEl && cd.synthesized) {
      // Geometry composed from spec data rather than cloned from the glyph.
      // The component must still exist in the library; its size is the
      // composer's to decide.
    } else if (!libEl) {
      errors.push(`${key} (${label}) does not exist in the library — compose only from library entries`);
    } else {
      const resize = libEl.customData?.resize ?? "none";
      const wChanged = Math.abs(el.width - libEl.width) > 1;
      const hChanged = Math.abs(el.height - libEl.height) > 1;
      if (hChanged && resize !== "both") {
        errors.push(`${key} (${label}): height ${el.height} differs from library ${libEl.height} — control heights are fixed by the standard`);
      }
      if (wChanged && resize === "none") {
        errors.push(`${key} (${label}): width ${el.width} differs from library ${libEl.width} and entry is resize:"none"`);
      }
    }
  }
}

// ------------------------------------------------------------ transitions

const arrows = els.filter((e) => e.type === "arrow");
if (frames.length > 1 && arrows.length === 0) warns.push("multiple screens but no transition arrows");
for (const a of arrows) {
  const t = a.customData?.transition;
  if (!t) {
    warns.push("arrow without customData.transition — codegen ignores it");
  } else if (!steps.has(t.from) || !steps.has(t.to)) {
    errors.push(`transition ${t.from}->${t.to} references a journeyStep that has no frame`);
  }
}

// ------------------------------------------------------------- per-frame

function overlaps(a, b) {
  return (
    a.x < b.x + (b.width ?? 0) &&
    a.x + (a.width ?? 0) > b.x &&
    a.y < b.y + (b.height ?? 0) &&
    a.y + (a.height ?? 0) > b.y
  );
}

for (const f of frames) {
  const inFrame = els.filter((e) => e.frameId === f.id);

  // The logo is the standard's one CRITICAL rule. A boolean prop is not a
  // logo — the scene must contain a real Logo element carrying the
  // sanctioned image URL, or the screen ships without the brand mark.
  const header = inFrame.find((e) => e.customData?.component === "AppHeader");
  const logo = inFrame.find((e) => e.customData?.component === "Logo");
  if (header && !logo) {
    errors.push(`frame "${f.name}" has an AppHeader but no element with customData.component "Logo" — props.logo:true is a flag, not a brand mark`);
  }
  if (logo) {
    const src = logo.customData?.props?.src;
    if (!src) {
      errors.push(`frame "${f.name}": Logo element carries no props.src — it must reference the sanctioned image URL from docs/uds-standards.md, which is what codegen emits`);
    }
    // Excalidraw renders images only from the scene's files map. A rectangle
    // placeholder, or an image element whose fileId is not in files, shows as
    // an empty grey box — the brand mark is simply absent from the review.
    if (logo.type !== "image") {
      errors.push(`frame "${f.name}": Logo is a ${logo.type}, not an Excalidraw image element — a placeholder rectangle renders as a grey box; embed the asset (see scripts/embed-logo.mjs)`);
    } else if (!logo.fileId) {
      errors.push(`frame "${f.name}": Logo image element has no fileId`);
    } else if (!scene.files?.[logo.fileId]?.dataURL) {
      errors.push(`frame "${f.name}": Logo fileId "${logo.fileId}" is not in the scene's files map — Excalidraw never fetches a remote src, so the logo will not render`);
    }
    if (logo.height != null && logo.height < 24) {
      errors.push(`frame "${f.name}": Logo is ${logo.height}px tall — the standard sets a 24px minimum`);
    }
    if (header && logo.x > header.x + header.width / 2) {
      warns.push(`frame "${f.name}": Logo sits in the right half of the header — the standard places it on the left`);
    }
  }

  // Every screen needs the standard's ground.
  const bg = inFrame.find((e) => e.customData?.component === "PageBackground");
  if (!bg) {
    errors.push(`frame "${f.name}" has no PageBackground element — screens must sit on the standard's --background, not bare canvas`);
  } else {
    if (Math.abs(bg.width - f.width) > 2 || Math.abs(bg.height - f.height) > 2) {
      warns.push(`frame "${f.name}": PageBackground is ${bg.width}x${bg.height} but the frame is ${f.width}x${f.height}`);
    }
    // PageBackground has no library entry to copy a colour from, so check the
    // token directly rather than letting the designer pick a hex.
    const expected = resolveColor("--background");
    if (expected && (bg.backgroundColor ?? "").toUpperCase() !== expected) {
      errors.push(`frame "${f.name}": PageBackground fill ${bg.backgroundColor} is not --background (${expected})`);
    }
  }

  // Free text must not collide with separators or other free text.
  const freeText = inFrame.filter((e) => e.type === "text" && !e.containerId);
  const separators = inFrame.filter((e) => e.customData?.component === "Separator");
  for (const t of freeText) {
    for (const s of separators) {
      if (overlaps(t, s)) {
        errors.push(`text "${t.text}" overlaps a Separator — an "or" divider is two separator segments with a gap for the label, not one line with text laid over it`);
      }
    }
    for (const other of freeText) {
      if (other.id <= t.id) continue;
      if (overlaps(t, other)) {
        warns.push(`text "${t.text}" and "${other.text}" overlap`);
      }
    }
  }
}

if (tokenResolutionFailed) {
  warns.push(`could not resolve some semantic colours via ${tokensPath} — colour conformance was skipped for those tokens`);
}

// A scene composed from derived library entries carries its own provenance.
// Heights are exact, widths are estimates — good enough to design against,
// not good enough to generate layout code from.
// Re-derived from the library rather than trusted from the scene's own stamp.
// Deleting customData.provisional would otherwise be the cheapest way to make
// this error stop firing — and this pipeline has four recorded cases of an
// agent taking exactly that kind of shortcut. The library is the authority.
const derivedInScene = new Set();
if (libIndex) {
  for (const el of els) {
    const comp = el.customData?.component;
    if (!comp) continue;
    const entry = libEntryFor(el.customData);
    if (entry?.source === "derived") derivedInScene.add(comp);
  }
}
const stamped = scene.customData?.provisional === true;
if (derivedInScene.size || stamped) {
  const which = derivedInScene.size
    ? [...derivedInScene].sort().join(", ")
    : (scene.customData?.derivedComponents ?? []).join(", ") || "unknown components";
  const msg = `scene is PROVISIONAL — ${which} came from library entries whose geometry was derived from Tailwind classes, not measured`;
  if (allowDerived) warns.push(`${msg}; widths are estimates and journey-coder will refuse this scene`);
  else errors.push(`${msg}. Re-run the librarian to measure for real, or pass --allow-derived to accept a mockup-only scene`);

  if (derivedInScene.size && !stamped) {
    errors.push(
      `scene uses derived library entries (${[...derivedInScene].sort().join(", ")}) but is not stamped customData.provisional — ` +
        `recompose with scripts/compose-scene.mjs rather than editing the scene. Never remove the flag to get past validation: ` +
        `it is the only thing stopping journey-coder generating layout from estimated widths`
    );
  }
}

for (const el of els) {
  if (el.type !== "text") continue;
  const cd = el.customData ?? {};
  if (cd.component === "TableCell" || cd.synthesized) continue;
  const t = String(el.text ?? "").trim();
  if (SYMBOL_AS_ICON.test(t)) {
    errors.push(
      `text "${t}" is a symbol character standing in for an icon — use a spec icon node ` +
        `({ "icon": "filter" }) so it is drawn from primitives and carries customData.props.icon, ` +
        `which is what codegen imports`
    );
  }
}

for (const w of warns) console.log(`WARN:  ${w}`);
for (const e of errors) console.log(`ERROR: ${e}`);
console.log(`\n${errors.length} error(s), ${warns.length} warning(s), ${frames.length} frame(s), ${els.length} element(s)`);
process.exit(errors.length ? 1 : 0);
