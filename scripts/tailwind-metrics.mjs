#!/usr/bin/env node
// The Tailwind class -> pixel mapping used by excalidraw-librarian-lite when
// the kit cannot be rendered. No dependencies.
//
//   import { parseGeometry, estimateTextWidth } from "./tailwind-metrics.mjs";
//   node scripts/tailwind-metrics.mjs "h-8 px-3 text-sm rounded-md" --text "Sign in"
//
// Why this is a checked-in table rather than agent judgement: a pilot run
// derived these numbers inline and differently each time, which made the
// library irreproducible on top of being unmeasured. The scale is mechanical,
// so it belongs in a script — the same split as everywhere else in this
// pipeline.
//
// HONESTY NOTE. Heights, padding and radii read off classes are exact.
// Intrinsic text width is an ESTIMATE (see estimateTextWidth) and is the
// reason every entry built from this file must be stamped
// customData.source: "derived". It is typically within ~8% for UI sans
// faces, which is fine for a wireframe and not fine for codegen.

const UNIT = 4; // Tailwind's default spacing step: 0.25rem at a 16px root.

export const FONT_SIZE = {
  xs: [12, 16], sm: [14, 20], base: [16, 24], lg: [18, 28], xl: [20, 28],
  "2xl": [24, 32], "3xl": [30, 36], "4xl": [36, 40], "5xl": [48, 48],
};

export const RADIUS = {
  none: 0, sm: 2, DEFAULT: 4, md: 6, lg: 8, xl: 12, "2xl": 16, "3xl": 24, full: 9999,
};

// "4" -> 16, "2.5" -> 10, "px" -> 1, "[42px]" -> 42, "full" -> null (relative)
export function spacing(token) {
  if (token == null) return null;
  const t = String(token);
  if (t === "px") return 1;
  const arb = t.match(/^\[(-?[\d.]+)(px|rem)?\]$/);
  if (arb) return arb[2] === "rem" ? parseFloat(arb[1]) * 16 : parseFloat(arb[1]);
  if (!/^\d+(\.\d+)?$/.test(t)) return null; // full, screen, auto, fit, ...
  return parseFloat(t) * UNIT;
}

// Per-character advance as a fraction of font size. Crude by design: a real
// measurement needs a font, and pretending otherwise is what got us here.
const NARROW = new Set([..."ijltfIr.,:;'|!`()[]{}/\\-"]);
const WIDE = new Set([..."mwMW@%"]);
const UPPER = /[A-Z]/;
const DIGIT = /[0-9]/;

export function estimateTextWidth(text, fontSize, weight = 400) {
  if (!text) return 0;
  let em = 0;
  for (const ch of String(text)) {
    if (ch === " ") em += 0.26;
    else if (NARROW.has(ch)) em += 0.30;
    else if (WIDE.has(ch)) em += 0.88;
    else if (UPPER.test(ch)) em += 0.63;
    else if (DIGIT.test(ch)) em += 0.55;
    else em += 0.52;
  }
  // Heavier weights set slightly wider.
  const weightFactor = weight >= 700 ? 1.04 : weight >= 600 ? 1.02 : 1;
  return Math.round(em * fontSize * weightFactor);
}

// Pulls geometry out of a Tailwind class string. Returns only what the
// classes actually state — absent keys mean "the class list did not say",
// which the caller must handle rather than defaulting silently.
export function parseGeometry(classes) {
  const list = String(classes ?? "").split(/\s+/).filter(Boolean);
  const out = { padding: {} };
  for (const raw of list) {
    const cls = raw.replace(/^(hover|focus|active|disabled|dark|sm|md|lg|xl):/g, "");
    let m;
    if ((m = cls.match(/^h-(.+)$/))) { const v = spacing(m[1]); if (v != null) out.height = v; }
    else if ((m = cls.match(/^w-(.+)$/))) { const v = spacing(m[1]); if (v != null) out.width = v; }
    else if ((m = cls.match(/^size-(.+)$/))) { const v = spacing(m[1]); if (v != null) { out.height = v; out.width = v; } }
    else if ((m = cls.match(/^min-h-(.+)$/))) { const v = spacing(m[1]); if (v != null) out.minHeight = v; }
    else if ((m = cls.match(/^min-w-(.+)$/))) { const v = spacing(m[1]); if (v != null) out.minWidth = v; }
    else if ((m = cls.match(/^p-(.+)$/))) { const v = spacing(m[1]); if (v != null) out.padding = { top: v, right: v, bottom: v, left: v }; }
    else if ((m = cls.match(/^px-(.+)$/))) { const v = spacing(m[1]); if (v != null) { out.padding.left = v; out.padding.right = v; } }
    else if ((m = cls.match(/^py-(.+)$/))) { const v = spacing(m[1]); if (v != null) { out.padding.top = v; out.padding.bottom = v; } }
    else if ((m = cls.match(/^pt-(.+)$/))) { const v = spacing(m[1]); if (v != null) out.padding.top = v; }
    else if ((m = cls.match(/^pr-(.+)$/))) { const v = spacing(m[1]); if (v != null) out.padding.right = v; }
    else if ((m = cls.match(/^pb-(.+)$/))) { const v = spacing(m[1]); if (v != null) out.padding.bottom = v; }
    else if ((m = cls.match(/^pl-(.+)$/))) { const v = spacing(m[1]); if (v != null) out.padding.left = v; }
    else if ((m = cls.match(/^gap-(.+)$/))) { const v = spacing(m[1]); if (v != null) out.gap = v; }
    else if ((m = cls.match(/^text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl)$/))) {
      [out.fontSize, out.lineHeight] = FONT_SIZE[m[1]];
    } else if ((m = cls.match(/^text-\[(\d+(?:\.\d+)?)px\]$/))) {
      out.fontSize = parseFloat(m[1]);
    } else if ((m = cls.match(/^rounded(?:-(none|sm|md|lg|xl|2xl|3xl|full))?$/))) {
      out.radius = RADIUS[m[1] ?? "DEFAULT"];
    } else if ((m = cls.match(/^font-(thin|light|normal|medium|semibold|bold|extrabold)$/))) {
      out.fontWeight = { thin: 100, light: 300, normal: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800 }[m[1]];
    } else if (cls === "rounded-full") out.radius = RADIUS.full;
  }
  return out;
}

// Width of a component whose size comes from its content: padding plus the
// estimated label, floored by any min-w. Returns null when the classes give
// an explicit width — then there is nothing to estimate.
export function intrinsicWidth(classes, label) {
  const g = parseGeometry(classes);
  if (g.width != null) return { width: g.width, estimated: false };
  const fontSize = g.fontSize ?? 14;
  const text = estimateTextWidth(label, fontSize, g.fontWeight ?? 400);
  const pad = (g.padding.left ?? 0) + (g.padding.right ?? 0);
  return { width: Math.max(text + pad, g.minWidth ?? 0), estimated: true };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const classes = argv.find((a) => !a.startsWith("--")) ?? "";
  const i = argv.indexOf("--text");
  const label = i >= 0 ? argv[i + 1] : null;
  console.log(JSON.stringify(parseGeometry(classes), null, 2));
  if (label) console.log("intrinsicWidth:", JSON.stringify(intrinsicWidth(classes, label)));
}
