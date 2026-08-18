#!/usr/bin/env node
// Validates a journey .excalidraw scene against the scene contract in
// .github/agents/journey-designer.md. No dependencies.
//
//   node scripts/validate-scene.mjs journeys/<name>/journey.excalidraw [lib/uds.excalidrawlib]
//
// Pass the library as the second argument to also check that every component
// element matches a library entry (component+variant exists; fixed-size
// shapes not resized).
//
// Exits 1 on any ERROR. WARNs list items the developer should eyeball.

import { readFileSync } from "node:fs";

const scenePath = process.argv[2];
const libPath = process.argv[3];
if (!scenePath) {
  console.error("usage: node scripts/validate-scene.mjs <journey.excalidraw> [uds.excalidrawlib]");
  process.exit(2);
}

const errors = [];
const warns = [];

function parse(p) {
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

// Index the library (if given): component/variant -> container geometry + resize hint.
let libIndex = null;
if (libPath) {
  libIndex = new Map();
  for (const item of parse(libPath).libraryItems ?? []) {
    const c = (item.elements ?? []).find((e) => e.type !== "text" && e.customData?.component);
    if (!c) continue;
    const key = `${c.customData.component}/${c.customData.variant ?? "default"}`;
    if (!libIndex.has(key)) libIndex.set(key, c);
  }
}

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

  // Bound text must fit.
  if (el.type === "text" && el.containerId && byId[el.containerId]) {
    const c = byId[el.containerId];
    if (c.type !== "arrow" && (el.width > c.width || el.height > c.height)) {
      errors.push(`bound text ${label} ${el.width}x${el.height} exceeds container ${c.width}x${c.height}`);
    }
  }

  // annotation is for reviewer notes only — never for screen copy or layout.
  if (cd.annotation) {
    if (el.frameId && el.type === "text") {
      errors.push(`text ${label} inside a frame is marked annotation:true — visible screen copy must be a component (Text/Heading/Label/...) or codegen silently drops it`);
    } else if (el.frameId && el.type === "rectangle") {
      errors.push(`rectangle ${label} inside a frame is marked annotation:true — structural regions must be components (Card/Table/AppHeader/...) or codegen silently drops them`);
    }
  }

  // Everything visible inside a frame needs a classification.
  if (el.frameId && !cd.annotation && !cd.component && !cd.transition && el.type !== "frame") {
    errors.push(`${label} inside a frame has no customData at all — codegen cannot map it`);
  }

  // Library conformance.
  if (libIndex && cd.component && el.type !== "text") {
    const key = `${cd.component}/${cd.variant ?? "default"}`;
    const libEl = libIndex.get(key);
    if (!libEl) {
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

// Transition arrows.
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

// Logo: any frame with an AppHeader must contain a Logo/AppHeader logo element.
for (const f of frames) {
  const inFrame = els.filter((e) => e.frameId === f.id);
  const hasHeader = inFrame.some((e) => e.customData?.component === "AppHeader");
  const hasLogo = inFrame.some((e) => ["Logo", "AppHeader"].includes(e.customData?.component) && (e.customData?.props?.logo || e.customData?.component === "Logo"));
  if (hasHeader && !hasLogo) {
    warns.push(`frame "${f.name}" has an AppHeader but no Logo element — the standard requires the logo on the left of app headers`);
  }
}

for (const w of warns) console.log(`WARN:  ${w}`);
for (const e of errors) console.log(`ERROR: ${e}`);
console.log(`\n${errors.length} error(s), ${warns.length} warning(s), ${frames.length} frame(s), ${els.length} element(s)`);
process.exit(errors.length ? 1 : 0);
