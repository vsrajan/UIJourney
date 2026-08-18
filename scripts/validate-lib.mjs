#!/usr/bin/env node
// Validates a UIJourney .excalidrawlib against the anatomy contract in
// .github/agents/excalidraw-librarian.md. No dependencies.
//
//   node scripts/validate-lib.mjs lib/uds.excalidrawlib
//
// Exits 1 on any ERROR. WARNs don't fail the run but must be explained in
// the MR description.

import { readFileSync } from "node:fs";

const path = process.argv[2];
if (!path) {
  console.error("usage: node scripts/validate-lib.mjs <file.excalidrawlib>");
  process.exit(2);
}

const errors = [];
const warns = [];

let lib;
try {
  // JSON.parse catches the classic unquoted-URL bug ("source": https://...)
  lib = JSON.parse(readFileSync(path, "utf8"));
} catch (e) {
  console.error(`ERROR: ${path} is not valid JSON: ${e.message}`);
  process.exit(1);
}

if (lib.type !== "excalidrawlib" || !Array.isArray(lib.libraryItems)) {
  errors.push(`not an excalidrawlib (type=${lib.type})`);
}

// Components that must exist so journey mockups never need freehand drawing.
const REQUIRED = [
  "Button", "Input", "Textarea", "Select", "Checkbox", "RadioGroupItem",
  "Switch", "Label", "Separator", "Progress", "Badge", "Alert",
  "Table", "Card", "AppHeader", "Heading", "Text", "Link",
];

// Components whose glyph must NOT be the rect-with-bound-text template.
const NO_BOUND_TEXT = new Set(["Checkbox", "Switch", "Separator", "Progress", "RadioGroupItem", "Slider"]);

const seenComponents = new Set();

for (const item of lib.libraryItems ?? []) {
  const name = item.name ?? item.id;
  const els = item.elements ?? [];
  const byId = Object.fromEntries(els.map((e) => [e.id, e]));
  const container = els.find((e) => e.type !== "text" && e.customData?.component);
  const component =
    container?.customData?.component ??
    els.find((e) => e.customData?.component)?.customData?.component;
  if (component) seenComponents.add(component);

  for (const el of els) {
    if (el.type === "text") {
      if (el.fontFamily !== 2) {
        errors.push(`${name}: text "${el.text}" has fontFamily ${el.fontFamily}; UI wireframes require 2 (Helvetica), never 3 (code font)`);
      }
      // Metadata lives on the container only.
      if (el.containerId && el.customData?.component) {
        errors.push(`${name}: bound text re-declares customData.component — metadata belongs on the container only (bound label may carry {role:"label"} at most)`);
      }
      // Bound text must fit its container.
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
  }

  // Anatomy spot-checks.
  if (component === "Label" && els.some((e) => e.type === "rectangle")) {
    errors.push(`${name}: Label must be a bare text element — no rectangle, no border`);
  }
  if (component === "Separator" && els.some((e) => e.type === "rectangle" && e.height > 4)) {
    errors.push(`${name}: Separator must be a thin line (<=4px tall), not a filled block`);
  }
  if (component === "Progress") {
    const rects = els.filter((e) => e.type === "rectangle");
    if (rects.length < 2) {
      errors.push(`${name}: Progress needs a track rect AND a fill rect (showing a partial value)`);
    }
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
  if (container && !container.customData?.resize) {
    warns.push(`${name}: container has no customData.resize hint ("horizontal" | "both" | "none") — designers won't know what they may stretch`);
  }
}

for (const req of REQUIRED) {
  if (!seenComponents.has(req)) {
    errors.push(`missing required component entry: ${req} — coverage gaps force the designer agent to freehand-draw, which is forbidden`);
  }
}

for (const w of warns) console.log(`WARN:  ${w}`);
for (const e of errors) console.log(`ERROR: ${e}`);
console.log(`\n${errors.length} error(s), ${warns.length} warning(s), ${lib.libraryItems?.length ?? 0} library item(s), components: ${[...seenComponents].sort().join(", ")}`);
process.exit(errors.length ? 1 : 0);
