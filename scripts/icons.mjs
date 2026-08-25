#!/usr/bin/env node
// Draws UI icons as Excalidraw primitives. No dependencies.
//
//   node scripts/icons.mjs --list
//
// Why this exists: the spec had no way to say "a filter icon", so a request
// for one degraded into the Unicode character "▽" in a text element — which
// renders as text, may be missing from the font, and tells codegen nothing.
// An icon is line art; Excalidraw draws line art natively. Shapes are defined
// on a 16x16 grid and scaled, so one definition serves every size, and the
// stroke colour comes from the caller's token rather than being baked in.
//
// The set below covers what enterprise screens actually use. An unknown name
// is NOT an error: it becomes a named placeholder box, because an icon that
// silently disappears changes the width of whatever contained it.

const P = (...pts) => ({ t: "poly", pts });
const E = (x, y, w, h) => ({ t: "ellipse", x, y, w, h });
const R = (x, y, w, h) => ({ t: "rect", x, y, w, h });

export const ICONS = {
  filter:          [P([2, 3], [14, 3], [9.5, 8.5], [9.5, 13], [6.5, 11.5], [6.5, 8.5], [2, 3])],
  "chevron-down":  [P([4, 6], [8, 10], [12, 6])],
  "chevron-up":    [P([4, 10], [8, 6], [12, 10])],
  "chevron-left":  [P([10, 4], [6, 8], [10, 12])],
  "chevron-right": [P([6, 4], [10, 8], [6, 12])],
  search:          [E(2, 2, 9, 9), P([10.5, 10.5], [14, 14])],
  check:           [P([3, 8.5], [6.5, 12], [13, 4])],
  x:               [P([4, 4], [12, 12]), P([12, 4], [4, 12])],
  menu:            [P([2, 4], [14, 4]), P([2, 8], [14, 8]), P([2, 12], [14, 12])],
  plus:            [P([8, 3], [8, 13]), P([3, 8], [13, 8])],
  minus:           [P([3, 8], [13, 8])],
  calendar:        [R(2, 4, 12, 10), P([2, 7.5], [14, 7.5]), P([5, 2], [5, 5]), P([11, 2], [11, 5])],
  user:            [E(5.5, 2, 5, 5), P([2.5, 14], [3.5, 10], [12.5, 10], [13.5, 14])],
  "more-horizontal": [E(2.6, 7.2, 1.8, 1.8), E(7.1, 7.2, 1.8, 1.8), E(11.6, 7.2, 1.8, 1.8)],
  "arrow-left":    [P([13, 8], [3, 8]), P([7, 4], [3, 8], [7, 12])],
  "arrow-right":   [P([3, 8], [13, 8]), P([9, 4], [13, 8], [9, 12])],
  // Column sort affordance — the thing a table header actually shows.
  sort:            [P([8, 3], [8, 13]), P([5, 6], [8, 3], [11, 6]), P([5, 10], [8, 13], [11, 10])],
  download:        [P([8, 2], [8, 10]), P([4.5, 7], [8, 10.5], [11.5, 7]), P([3, 14], [13, 14])],
  upload:          [P([8, 10.5], [8, 2.5]), P([4.5, 6], [8, 2.5], [11.5, 6]), P([3, 14], [13, 14])],
  refresh:         [P([13, 5], [13, 9], [9, 9]), P([3, 11], [3, 7], [7, 7])],
  // Sliders rather than a gear: a gear needs teeth that read as noise at 16px,
  // while three tracks with knobs is unmistakable and holds up when scaled.
  settings:        [P([2, 4], [14, 4]), P([2, 8], [14, 8]), P([2, 12], [14, 12]),
                    E(4.2, 2.2, 3.6, 3.6), E(9.2, 6.2, 3.6, 3.6), E(5.2, 10.2, 3.6, 3.6)],
  alert:           [P([8, 2], [15, 14], [1, 14], [8, 2]), P([8, 6.5], [8, 10]), P([8, 11.8], [8, 12.2])],
};

// Your kit's icon names are the ones codegen must import, and they will not
// match the generic names above. Map them here and a spec can use the kit's
// real name while still getting a drawn glyph instead of a placeholder box.
// Keys are normalised (lowercased, punctuation stripped), so "IconCheckmark",
// "icon-checkmark" and "Icon Checkmark" all match the same entry.
export const ALIASES = {
  // "iconcheckmark": "check",
  // "iconmagnifier": "search",
  // "iconfunnel": "filter",
};

// Kits commonly bake the pixel size into the export name — FilterFunnel12px,
// FilterFunnel16px, FilterFunnel24px are one icon at three sizes. Strip it for
// alias lookup so a single entry covers the family.
const SIZE_SUFFIX = /[-_ ]?(\d{1,3})(px)?$/i;
const norm = (t) => String(t ?? "").toLowerCase().replace(SIZE_SUFFIX, "").replace(/[\s_-]+/g, "");

// The size the name itself declares, if any.
export function sizeFromName(name) {
  const m = SIZE_SUFFIX.exec(String(name ?? ""));
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n >= 8 && n <= 64 ? n : null;
}

export const iconNames = () => Object.keys(ICONS).sort();

// Returns Excalidraw elements for one icon. `stamp` and `nextId` come from the
// caller so ids and seeds stay deterministic with the rest of the scene.
export function drawIcon(name, { x, y, size, color = "#1C1C1C", frameId = null, stamp, nextId }) {
  const raw = String(name ?? "");
  const kebab = raw.toLowerCase().replace(/[\s_]+/g, "-");
  const key = ICONS[kebab] ? kebab : (ALIASES[norm(raw)] ?? ALIASES[kebab] ?? kebab);
  const shapes = ICONS[key];
  // An explicit size wins; otherwise honour what the name declares, so
  // FilterFunnel24px is drawn at 24 without anyone restating it.
  const drawn = size ?? sizeFromName(raw) ?? 16;
  const k = drawn / 16;
  const common = {
    strokeColor: color, backgroundColor: "transparent", fillStyle: "solid",
    strokeWidth: 2, strokeStyle: "solid", roughness: 0, opacity: 100, angle: 0,
    groupIds: [], frameId, roundness: null, boundElements: [], link: null, locked: false,
    customData: { component: "Icon", props: { icon: name }, synthesized: true },
  };

  if (!shapes) {
    // Named placeholder: reserves the right space and keeps the icon's real
    // name for codegen, which is the part that has to be exact.
    return [stamp({
      ...common, id: nextId("icon"), type: "rectangle",
      x, y, width: drawn, height: drawn, roundness: { type: 3 },
      strokeColor: color, backgroundColor: "transparent",
    })];
  }

  const out = [];
  for (const s of shapes) {
    if (s.t === "ellipse" || s.t === "rect") {
      out.push(stamp({
        ...common, id: nextId("icon"), type: s.t === "rect" ? "rectangle" : "ellipse",
        x: x + s.x * k, y: y + s.y * k, width: s.w * k, height: s.h * k,
      }));
    } else {
      const xs = s.pts.map((p) => p[0]), ys = s.pts.map((p) => p[1]);
      const minX = Math.min(...xs), minY = Math.min(...ys);
      out.push(stamp({
        ...common, id: nextId("icon"), type: "line",
        x: x + minX * k, y: y + minY * k,
        width: (Math.max(...xs) - minX) * k, height: (Math.max(...ys) - minY) * k,
        points: s.pts.map((p) => [(p[0] - minX) * k, (p[1] - minY) * k]),
        lastCommittedPoint: null, startBinding: null, endBinding: null,
        startArrowhead: null, endArrowhead: null,
      }));
    }
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // If the kit has been mapped, show the real export names — those are what a
  // spec must contain, since codegen imports them verbatim.
  const { existsSync, readFileSync } = await import("node:fs");
  const { join, dirname, resolve } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const mapPath = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "lib", "icon-map.json");
  if (existsSync(mapPath)) {
    const { package: pkg, icons } = JSON.parse(readFileSync(mapPath, "utf8"));
    const rows = Object.entries(icons).sort(([a], [b]) => a.localeCompare(b));
    const w = Math.max(...rows.map(([k]) => k.length));
    console.log(`Icons available from ${pkg} — write one of these names in a spec:\n`);
    console.log(`${"MEANING".padEnd(w)}  KIT EXPORT NAMES`);
    for (const [shape, { exports }] of rows) console.log(`${shape.padEnd(w)}  ${exports.join(", ")}`);
    console.log(
      `\n${rows.length} mapped. Any other export of ${pkg} also works — it draws a named\n` +
        "placeholder box and still carries the name through to codegen."
    );
    process.exit(0);
  }

  const aliases = Object.entries(ALIASES);
  console.log(`${iconNames().length} drawn icon(s):\n`);
  console.log("  " + iconNames().join("\n  "));
  if (aliases.length) {
    console.log(`\n${aliases.length} kit alias(es):\n`);
    for (const [from, to] of aliases) console.log(`  ${from} -> ${to}`);
  }
  console.log(
    "\nAny other name still works: it becomes a named placeholder box that keeps\n" +
      "customData.props.icon for codegen. Add a shape to ICONS to draw it, or an\n" +
      "entry to ALIASES to point your kit's name at a shape that already exists."
  );
}
