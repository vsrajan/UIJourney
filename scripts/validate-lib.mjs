#!/usr/bin/env node
// Validates a UIJourney .excalidrawlib against the anatomy contract in
// .github/agents/excalidraw-librarian.md. No dependencies.
//
//   node scripts/validate-lib.mjs lib/uds.excalidrawlib
//     [--manifest data/component-manifest.json]
//     [--typography lib/typography.json]
//     [--skips lib/skips.json]
//
// Coverage is derived from the component manifest — NOT from a list baked
// into this file. Anything deliberately left out must be declared in
// skips.json, so silence is a failure and deferral is a written decision.
//
// Exits 1 on any ERROR. WARNs don't fail the run but must be explained in
// the MR description.

import { readFileSync, existsSync } from "node:fs";

const argv = process.argv.slice(2);
const libPath = argv.find((a) => !a.startsWith("--"));
function flag(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}
const manifestPath = flag("manifest", "data/component-manifest.json");
const typographyPath = flag("typography", "lib/typography.json");
const skipsPath = flag("skips", "lib/skips.json");

if (!libPath) {
  console.error("usage: node scripts/validate-lib.mjs <file.excalidrawlib> [--manifest p] [--typography p] [--skips p]");
  process.exit(2);
}

const errors = [];
const warns = [];

function readJson(p, label) {
  try {
    // JSON.parse also catches the classic unquoted-URL bug ("source": https://...)
    return JSON.parse(readFileSync(p, "utf8"));
  } catch (e) {
    console.error(`ERROR: ${label} (${p}) is not valid JSON: ${e.message}`);
    process.exit(1);
  }
}

const lib = readJson(libPath, "library");
if (lib.type !== "excalidrawlib" || !Array.isArray(lib.libraryItems)) {
  errors.push(`not an excalidrawlib (type=${lib.type})`);
}

// ---------------------------------------------------------------- skips

const skips = existsSync(skipsPath) ? readJson(skipsPath, "skips") : {};
const skipComponents = skips.components ?? {};
const skipCombinations = skips.combinations ?? {};
const skipTypography = skips.typography ?? {};
for (const [k, v] of Object.entries({ ...skipComponents, ...skipCombinations, ...skipTypography })) {
  if (k.startsWith("$")) continue; // $comment / $note keys document the file
  if (!v || !v.reason) errors.push(`skips.json entry "${k}" has no reason — every deferral must be justified in writing`);
}

// ------------------------------------------------------------- manifest

// Canonical manifest shape (see .github/agents/design-data-extractor.md):
//   { "components": { "Button": { "variants": { "variant": [...], "size": [...] },
//                                 "defaultVariants": { "variant": "default" } } } }
// A bare top-level object of components, or an array of entries carrying a
// name/component key, is also accepted.
function loadManifest(p) {
  if (!existsSync(p)) return null;
  const raw = readJson(p, "component manifest");
  let root = raw.components ?? raw;
  if (Array.isArray(root)) {
    root = Object.fromEntries(root.map((e) => [e.name ?? e.component ?? e.export, e]));
  }
  const out = new Map();
  for (const [name, def] of Object.entries(root)) {
    if (!def || typeof def !== "object" || !name) continue;
    const rawAxes = def.variants ?? def.variantAxes ?? def.cva?.variants ?? null;
    const axes = {};
    if (rawAxes && typeof rawAxes === "object" && !Array.isArray(rawAxes)) {
      for (const [axis, vals] of Object.entries(rawAxes)) {
        if (Array.isArray(vals)) axes[axis] = vals.map(String);
        else if (vals && typeof vals === "object") axes[axis] = Object.keys(vals);
      }
    }
    out.set(name, {
      axes,
      defaults: def.defaultVariants ?? def.defaults ?? {},
      // Untagged entries are treated as roots: a missing tag must fail loudly
      // (as a coverage error) rather than silently excuse a component.
      role: def.role === "part" ? "part" : "root",
      partOf: def.partOf ?? null,
    });
  }
  return out;
}

const manifest = loadManifest(manifestPath);
if (!manifest) {
  warns.push(`no component manifest at ${manifestPath} — coverage cannot be checked; run design-data-extractor first`);
} else if (manifest.size === 0) {
  errors.push(`component manifest at ${manifestPath} parsed but contained no components — check its shape against design-data-extractor.md`);
}

// Composites the contract requires even though no kit component exists for them.
const REQUIRED_COMPOSITES = ["AppHeader", "Heading", "Text", "Link"];

// How an entry came to exist. Recorded on the container as customData.source
// so derived entries can never masquerade as measured ones.
//
//   measured   — geometry read back from a real DOM render
//   composite  — assembled from parts that were themselves measured; must
//                declare customData.composedOf naming them
//   typography — geometry comes from lib/typography.json, not a render
//   derived    — inferred from Tailwind classes without rendering. Blocked
//                unless --allow-derived. A pilot run could not install the
//                kit's deps, computed geometry from class names, and stamped
//                it "composite" — which passed, because "composite" carried
//                no obligation. Class analysis gets h-8 = 32px right and
//                intrinsic text width, font metrics and color-mix() results
//                wrong, so those entries are guesses wearing a measurement's
//                label.
const SOURCES = new Set(["measured", "typography", "composite", "derived"]);
const allowDerived = argv.includes("--allow-derived");

// Measured geometry, keyed by component -> array of rows carrying the axis
// values plus the measured values. Optional; when present, every "measured"
// entry must have a matching row.
const measurementsPath = flag("measurements", "data/measurements.json");
const measurements = existsSync(measurementsPath) ? readJson(measurementsPath, "measurements") : null;
if (!measurements) {
  warns.push(`no measurements at ${measurementsPath} — cannot verify that "measured" entries were actually measured rather than derived`);
}
function measuredRowExists(component, axes, props) {
  if (!measurements) return true;
  const rows = Array.isArray(measurements) ? measurements.filter((r) => (r.component ?? r.name) === component) : measurements[component];
  if (!Array.isArray(rows)) return false;
  if (Object.keys(axes).length === 0) return rows.length > 0;
  return rows.some((row) => Object.keys(axes).every((axis) => String(row[axis] ?? "default") === String(props[axis] ?? "default")));
}

function componentHasMeasurements(component) {
  if (!measurements) return true;
  const rows = Array.isArray(measurements)
    ? measurements.filter((r) => (r.component ?? r.name) === component)
    : measurements[component];
  return Array.isArray(rows) && rows.length > 0;
}

// Treats 8-digit hex with a zero alpha the same as the word "transparent".
// The literal "#00000000" was the string a pilot run reached for to make the
// stroke-width rule stop firing on table rows: it satisfied the check and
// made the separators invisible, which is the opposite of what the rule is
// for. Anything that renders nothing is now its own error.
function isTransparent(color) {
  if (!color) return true;
  const c = String(color).trim().toLowerCase();
  if (c === "transparent" || c === "none") return true;
  if (/^#[0-9a-f]{6}00$/.test(c)) return true;
  if (/^#[0-9a-f]{3}0$/.test(c)) return true;
  return /^rgba\([^)]*,\s*0?(\.0+)?\s*\)$/.test(c);
}

// Components whose glyph must NOT be the rect-with-bound-text template.
const NO_BOUND_TEXT = new Set(["Checkbox", "Switch", "Separator", "Progress", "RadioGroupItem", "Slider"]);
// Components rendered as bare text (no container rectangle).
const BARE_TEXT = new Set(["Label", "Heading", "Text", "Link"]);

// ----------------------------------------------------------- typography

const typography = existsSync(typographyPath) ? readJson(typographyPath, "typography") : null;
if (!typography) {
  warns.push(`no typography spec at ${typographyPath} — text entries cannot be checked against the UDS type scale`);
}
const scale = typography?.scale ?? {};
const roles = typography?.roles ?? {};

function resolveToken(name) {
  if (scale[name]) return { token: name, ...scale[name] };
  const role = roles[name];
  if (role) {
    const base = role.basedOn ? scale[role.basedOn] : null;
    if (base) return { token: name, ...base, ...role };
    return { token: name, ...role };
  }
  return null;
}

// ------------------------------------------------------- per-item checks

const seenComponents = new Set();
const seenCombos = new Set();
const seenTypography = new Set();

for (const item of lib.libraryItems ?? []) {
  const name = item.name ?? item.id ?? "(unnamed)";
  const els = item.elements ?? [];
  const byId = Object.fromEntries(els.map((e) => [e.id, e]));

  // The element that represents the component: a non-text container, or for
  // bare-text components the text element itself.
  const container =
    els.find((e) => e.type !== "text" && e.customData?.component) ??
    els.find((e) => e.type === "text" && !e.containerId && e.customData?.component);
  const component = container?.customData?.component;
  if (component) seenComponents.add(component);

  for (const el of els) {
    if (el.type !== "text") continue;

    if (el.fontFamily !== 2) {
      errors.push(`${name}: text "${el.text}" has fontFamily ${el.fontFamily}; UI wireframes require 2 (Helvetica), never 3 (code font)`);
    }
    // Metadata lives on the container only (bare text is its own container).
    if (el.containerId && el.customData?.component) {
      errors.push(`${name}: bound text re-declares customData.component — metadata belongs on the container only (bound label may carry {role:"label"} at most)`);
    }
    if (el.containerId && byId[el.containerId]) {
      const c = byId[el.containerId];
      if (el.width > c.width || el.height > c.height) {
        errors.push(`${name}: bound text ${el.width}x${el.height} exceeds container ${c.width}x${c.height} — Excalidraw will wrap or grow it unpredictably`);
      }
    }
    if (el.containerId && component && NO_BOUND_TEXT.has(component)) {
      errors.push(`${name}: ${component} must not have text bound into its shape (checkbox/switch/radio labels sit BESIDE the control; separators/progress carry no label)`);
    }
  }

  // ------- anatomy spot-checks
  if (BARE_TEXT.has(component) && els.some((e) => e.type === "rectangle")) {
    errors.push(`${name}: ${component} must be a bare text element — no rectangle, no border`);
  }
  if (component === "Separator" && els.some((e) => e.type === "rectangle" && e.height > 4)) {
    errors.push(`${name}: Separator must be a thin line (<=4px tall), not a filled block`);
  }
  if (component === "Progress" && els.filter((e) => e.type === "rectangle").length < 2) {
    errors.push(`${name}: Progress needs a track rect AND a fill rect (showing a partial value)`);
  }
  if (component === "Checkbox") {
    const box = els.find((e) => e.type === "rectangle");
    if (box && box.width > 20) {
      errors.push(`${name}: Checkbox control must be ~16x16 (got ${box.width}x${box.height}); its label is a separate unbound text beside it`);
    }
  }
  if (component === "Switch" && !els.some((e) => e.type === "ellipse")) {
    warns.push(`${name}: Switch should show a pill track + circle thumb (no ellipse found)`);
  }

  // Borders must survive rasterisation. A 1px near-white hairline disappears
  // at the zoom Excalidraw picks when fitting a journey to screen (confirmed
  // in the field: invisible at fit, visible at 200%). Keep the token record
  // as --border; the stroke width is a wireframe legibility affordance.
  for (const el of els) {
    if (el.type === "text" || el.type === "frame") continue;
    const thin = Math.min(el.width ?? 0, el.height ?? 0) <= 4;
    const stroked = !isTransparent(el.strokeColor);
    const filled = !isTransparent(el.backgroundColor);
    if (!stroked && !filled && el.type !== "image") {
      errors.push(`${name}: a ${el.type} with a transparent stroke and no fill renders nothing — if it is there to show a border, give it the real --border colour at strokeWidth 2; if it is not needed, remove it`);
      continue;
    }
    if (thin) {
      // Hairline rules (Separator, Progress track) are drawn by their fill,
      // so they need real thickness rather than a thicker stroke.
      if (Math.min(el.width ?? 0, el.height ?? 0) < 2) {
        warns.push(`${name}: shape is under 2px thick — hairlines disappear at fit-to-screen zoom; give it 2px`);
      }
    } else if (stroked && (el.strokeWidth ?? 1) < 2) {
      errors.push(`${name}: bordered shape has strokeWidth ${el.strokeWidth ?? 1} — use 2; 1px light strokes vanish when Excalidraw fits a journey to screen`);
    }
  }
  // A text box taller than its own line height makes any consumer that
  // vertically centres it place the glyphs too high. The composer normalises
  // this now, but an inflated box is still a builder bug worth naming.
  for (const el of els) {
    if (el.type !== "text") continue;
    const lines = Math.max(1, String(el.text ?? "").split("\n").length);
    const natural = Math.round((el.fontSize ?? 16) * (el.lineHeight ?? 1.25)) * lines;
    if ((el.height ?? 0) > natural * 1.5) {
      warns.push(`${name}: text "${String(el.text ?? "").slice(0, 24)}" has height ${el.height} for ${lines} line(s) at ${el.fontSize}px (natural ${natural}) — an inflated text box mis-centres the label vertically`);
    }
  }

  if (container && container.type !== "text" && !container.customData?.resize) {
    warns.push(`${name}: container has no customData.resize hint ("horizontal" | "both" | "none") — designers won't know what they may stretch`);
  }

  // ------- overlay glyphs must show a panel, not just a scrim
  if (container?.customData?.overlay) {
    const solid = els.filter((e) => e.type === "rectangle" && e.backgroundColor && e.backgroundColor !== "transparent" && (e.opacity ?? 100) > 60);
    if (solid.length === 0) {
      errors.push(`${name}: overlay entry has no opaque content panel — a dimmed scrim alone is not a usable glyph`);
    }
  }

  // ------- typography conformance
  if (BARE_TEXT.has(component) && component !== "Label") {
    const tokenName = container?.customData?.typography;
    if (!tokenName) {
      errors.push(`${name}: ${component} entry must declare customData.typography naming its type-scale token (e.g. "header-4", "body-2")`);
    } else if (typography) {
      seenTypography.add(tokenName);
      const spec = resolveToken(tokenName);
      if (!spec) {
        errors.push(`${name}: customData.typography "${tokenName}" is not defined in ${typographyPath}`);
      } else {
        const textEl = container.type === "text" ? container : els.find((e) => e.type === "text");
        if (textEl) {
          if (spec.fontSize != null && Math.abs(textEl.fontSize - spec.fontSize) > 0.5) {
            errors.push(`${name}: ${tokenName} fontSize ${textEl.fontSize} does not match the UDS type scale (${spec.fontSize})`);
          }
          const weight = textEl.customData?.fontWeight;
          if (spec.fontWeight != null && weight == null) {
            errors.push(`${name}: text element must record customData.fontWeight (Excalidraw has no fontWeight field; ${tokenName} requires ${spec.fontWeight})`);
          } else if (spec.fontWeight != null && Number(weight) !== Number(spec.fontWeight)) {
            errors.push(`${name}: ${tokenName} fontWeight ${weight} does not match the UDS type scale (${spec.fontWeight})`);
          }
        }
      }
    }
  }

  // ------- provenance
  const source = container?.customData?.source;
  if (component && !SOURCES.has(source)) {
    errors.push(`${name}: container must declare customData.source ("measured" | "composite" | "typography" | "derived") — provenance is what stops derived entries from passing as measured ones`);
  }
  if (source === "derived") {
    const msg = `${name}: source "derived" — geometry inferred from Tailwind classes, not rendered`;
    if (allowDerived) warns.push(`${msg}; the library is provisional until it is re-measured`);
    else errors.push(`${msg}. Fix the render harness and measure, or re-run with --allow-derived to accept a provisional library for prototyping only — it must not feed codegen`);
  }
  // "composite" means assembled from measured parts. Without naming those
  // parts it is an unfalsifiable claim, and became the escape hatch a pilot
  // run used to ship unmeasured geometry.
  if (source === "composite") {
    const composedOf = container?.customData?.composedOf;
    if (!Array.isArray(composedOf) || !composedOf.length) {
      errors.push(`${name}: source "composite" must declare customData.composedOf naming the measured components it is built from`);
    } else if (measurements) {
      const unmeasured = composedOf.filter((c) => !BARE_TEXT.has(c) && !componentHasMeasurements(c));
      if (unmeasured.length) {
        const verb = unmeasured.length === 1 ? "has" : "have";
        errors.push(`${name}: composed of ${unmeasured.join(", ")}, which ${verb} no rows in ${measurementsPath} — a composite of unmeasured parts is a derived entry, stamp it "derived"`);
      }
    }
  }

  // ------- record variant x size combination
  if (component && manifest?.has(component)) {
    const { axes, defaults } = manifest.get(component);
    const props = container?.customData?.props ?? {};
    const parts = Object.keys(axes)
      .sort()
      .map((axis) => `${axis}=${props[axis] ?? container?.customData?.variant ?? defaults[axis] ?? "default"}`);
    seenCombos.add(`${component}|${parts.join("|")}`);

    if (source === "measured" && !measuredRowExists(component, axes, props)) {
      errors.push(`${name}: declared source "measured" but no matching row exists in ${measurementsPath} — either measure this combination or stamp it honestly`);
    }
  }
}

// ------------------------------------------------------ coverage checks

function comboKey(component, axes, combo) {
  const parts = Object.keys(axes).sort().map((a) => `${a}=${combo[a]}`);
  return `${component}|${parts.join("|")}`;
}
function crossProduct(axes) {
  let combos = [{}];
  for (const axis of Object.keys(axes).sort()) {
    const next = [];
    for (const c of combos) for (const v of axes[axis]) next.push({ ...c, [axis]: v });
    combos = next;
  }
  return combos;
}

if (manifest) {
  let missingComponents = 0;
  let missingCombos = 0;
  for (const [component, { axes, role, partOf }] of manifest) {
    // Parts are drawn inside their root's composite glyph and never need
    // an entry of their own. A root is never excused this way.
    if (role === "part") {
      if (partOf && !manifest.has(partOf)) {
        warns.push(`${component} is tagged partOf "${partOf}" but no such component is in the manifest`);
      }
      continue;
    }
    if (skipComponents[component]) continue;
    if (!seenComponents.has(component)) {
      errors.push(`missing component: ${component} has no library entry and no skips.json entry — coverage gaps force the designer agent to freehand-draw, which is forbidden`);
      missingComponents++;
      continue;
    }
    const combos = crossProduct(axes);
    if (combos.length > 200) {
      warns.push(`${component} declares ${combos.length} variant combinations — consider narrowing the axes in skips.json`);
      continue;
    }
    for (const combo of combos) {
      const key = comboKey(component, axes, combo);
      const readable = `${component}/${Object.keys(axes).sort().map((a) => combo[a]).join("/")}`;
      if (skipCombinations[readable] || skipCombinations[key]) continue;
      if (!seenCombos.has(key)) {
        errors.push(`missing combination: ${readable} — every variant x size the manifest declares needs an entry or a skips.json entry`);
        missingCombos++;
      }
    }
  }
  if (missingComponents || missingCombos) {
    errors.push(`coverage summary: ${missingComponents} component(s) and ${missingCombos} combination(s) undeclared`);
  }
}

for (const composite of REQUIRED_COMPOSITES) {
  if (skipComponents[composite]) continue;
  if (!seenComponents.has(composite)) {
    errors.push(`missing required composite: ${composite} — journeys need it and no kit component provides it`);
  }
}

if (typography) {
  for (const token of Object.keys(scale)) {
    if (skipTypography[token]) continue;
    if (!seenTypography.has(token)) {
      errors.push(`type scale token "${token}" has no library entry and no skips.json entry`);
    }
  }
}

// ---------------------------------------------------------------- report

for (const w of warns) console.log(`WARN:  ${w}`);
for (const e of errors) console.log(`ERROR: ${e}`);
let summary = `\n${errors.length} error(s), ${warns.length} warning(s), ${lib.libraryItems?.length ?? 0} library item(s)`;
if (manifest) {
  const roots = [...manifest.entries()].filter(([, m]) => m.role === "root").map(([c]) => c);
  const parts = manifest.size - roots.length;
  const covered = roots.filter((c) => seenComponents.has(c)).length;
  const skipped = roots.filter((c) => skipComponents[c]).length;
  summary +=
    `\nroot coverage: ${covered}/${roots.length} roots with entries, ${skipped} declared in skips.json` +
    `\n(${parts} part(s) excluded — drawn inside their root's composite)`;
}
summary += `\ncomponents in library: ${[...seenComponents].sort().join(", ")}`;
console.log(summary);
process.exit(errors.length ? 1 : 0);
