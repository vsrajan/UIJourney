#!/usr/bin/env node
// Renders a .excalidraw scene to PNG so a mockup can be reviewed without
// opening Excalidraw.
//
//   node scripts/render-scene.mjs journeys/<name>/journey.excalidraw [--out preview.png] [--scale 2]
//
// FAITHFUL BY DESIGN. It honours stored coordinates exactly — including bound
// text, which Excalidraw also positions from stored x/y on import. An earlier
// throwaway renderer re-centred bound labels the way the *editor* does, which
// hid a scene where every label sat at 0,0: the preview looked perfect and the
// real file was broken. A preview more forgiving than the target is worse than
// no preview, so this one never "helpfully" fixes anything.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, isAbsolute, dirname } from "node:path";
import { createRequire } from "node:module";

const argv = process.argv.slice(2);
const scenePath = argv.find((a) => !a.startsWith("--") && !(argv[argv.indexOf(a) - 1] ?? "").startsWith("--"));
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
if (!scenePath) {
  console.error("usage: node scripts/render-scene.mjs <scene.excalidraw> [--out preview.png] [--scale 2]");
  process.exit(2);
}
const P = (p) => (isAbsolute(p) ? p : resolve(process.cwd(), p));
const outPath = P(flag("out", scenePath.replace(/\.excalidraw$/, "") + ".png"));
const scale = Number(flag("scale", "2"));

const scene = JSON.parse(readFileSync(P(scenePath), "utf8"));
const els = (scene.elements ?? []).filter((e) => !e.isDeleted);
const files = scene.files ?? {};
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Bounds across everything, with room for frame name labels.
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
for (const e of els) {
  minX = Math.min(minX, e.x ?? 0);
  minY = Math.min(minY, (e.y ?? 0) - (e.type === "frame" ? 24 : 0));
  maxX = Math.max(maxX, (e.x ?? 0) + (e.width ?? 0));
  maxY = Math.max(maxY, (e.y ?? 0) + (e.height ?? 0));
}
const PAD = 32;
const vbX = minX - PAD, vbY = minY - PAD, vbW = maxX - minX + PAD * 2, vbH = maxY - minY + PAD * 2;

const parts = [];
for (const el of els) {
  const stroke = !el.strokeColor || el.strokeColor === "transparent" || el.strokeColor === "#00000000" ? "none" : el.strokeColor;
  const fill = !el.backgroundColor || el.backgroundColor === "transparent" || el.backgroundColor === "#00000000" ? "none" : el.backgroundColor;
  const op = (el.opacity ?? 100) / 100;
  const sw = el.strokeWidth ?? 1;

  if (el.type === "frame") {
    parts.push(`<rect x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" fill="none" stroke="#999" stroke-width="1" stroke-dasharray="6 6"/>`);
    parts.push(`<text x="${el.x}" y="${el.y - 8}" font-size="13" fill="#666" font-family="ui-monospace,monospace">${esc(el.name ?? "")}</text>`);
  } else if (el.type === "rectangle") {
    const r = el.roundness?.value ?? 0;
    parts.push(`<rect x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" rx="${r}" ry="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" opacity="${op}"/>`);
  } else if (el.type === "ellipse") {
    parts.push(`<ellipse cx="${el.x + el.width / 2}" cy="${el.y + el.height / 2}" rx="${el.width / 2}" ry="${el.height / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" opacity="${op}"/>`);
  } else if (el.type === "image") {
    const f = files[el.fileId];
    if (f?.dataURL) {
      parts.push(`<image x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" href="${f.dataURL}" preserveAspectRatio="xMidYMid meet"/>`);
    } else {
      // Show exactly what Excalidraw shows for an unresolvable image.
      parts.push(`<rect x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" fill="#E6E6E6" stroke="#BEBEBE" stroke-width="1"/>`);
      parts.push(`<text x="${el.x + el.width / 2}" y="${el.y + el.height / 2 + 4}" font-size="10" fill="#646464" text-anchor="middle" font-family="sans-serif">missing image</text>`);
    }
  } else if (el.type === "line" || el.type === "arrow") {
    const pts = (el.points ?? [[0, 0]]).map(([px, py]) => `${el.x + px},${el.y + py}`).join(" ");
    parts.push(`<polyline points="${pts}" fill="none" stroke="${stroke === "none" ? "#1C1C1C" : stroke}" stroke-width="${sw}"/>`);
    if (el.endArrowhead === "arrow") {
      const [ax, ay] = el.points[el.points.length - 1];
      const ex = el.x + ax, ey = el.y + ay;
      parts.push(`<polygon points="${ex},${ey} ${ex - 10},${ey - 5} ${ex - 10},${ey + 5}" fill="${stroke === "none" ? "#1C1C1C" : stroke}"/>`);
    }
  } else if (el.type === "text") {
    // Stored coordinates, verbatim. No re-centring, no wrapping heuristics.
    const anchor = el.textAlign === "center" ? "middle" : el.textAlign === "right" ? "end" : "start";
    const tx = anchor === "middle" ? el.x + (el.width ?? 0) / 2 : anchor === "end" ? el.x + (el.width ?? 0) : el.x;
    const weight = el.customData?.fontWeight ?? 400;
    const lines = String(el.text ?? "").split("\n");
    const lh = (el.fontSize ?? 16) * (el.lineHeight ?? 1.25);
    lines.forEach((ln, i) => {
      parts.push(`<text x="${tx}" y="${el.y + (el.fontSize ?? 16) * 0.92 + i * lh}" font-size="${el.fontSize}" font-weight="${weight}" text-anchor="${anchor}" fill="${el.strokeColor ?? "#1C1C1C"}" font-family="Helvetica,Arial,sans-serif" opacity="${op}">${esc(ln)}</text>`);
    });
  }
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(vbW)}" height="${Math.round(vbH)}" viewBox="${vbX} ${vbY} ${vbW} ${vbH}"><rect x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}" fill="${scene.appState?.viewBackgroundColor ?? "#FFFFFF"}"/>${parts.join("")}</svg>`;

const svgPath = outPath.replace(/\.png$/, ".svg");
writeFileSync(svgPath, svg);

// PNG needs a browser; the SVG alone is often enough, so a missing Playwright
// is a note rather than a failure.
let chromium = null;
try {
  chromium = createRequire(import.meta.url)("playwright").chromium;
} catch {
  try { chromium = createRequire("/usr/lib/node_modules/").chromium; } catch { /* ignore */ }
}
if (!chromium) {
  console.log(`wrote ${svgPath}`);
  console.log("  (playwright not resolvable — open the SVG, or `npm i -D playwright` for PNG output)");
  process.exit(0);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Math.min(2000, Math.round(vbW)), height: Math.min(2000, Math.round(vbH)) }, deviceScaleFactor: scale });
await page.setContent(`<!doctype html><meta charset="utf-8"><body style="margin:0">${svg}</body>`);
await page.locator("svg").screenshot({ path: outPath });
await browser.close();
console.log(`wrote ${outPath} (and ${svgPath})`);
console.log(`  ${els.length} elements, ${Object.keys(files).length} embedded file(s), ${Math.round(vbW)}x${Math.round(vbH)} at ${scale}x`);
