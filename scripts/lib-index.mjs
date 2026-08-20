#!/usr/bin/env node
// Axis-aware index over a .excalidrawlib, shared by compose-scene.mjs and
// validate-scene.mjs so the two can never disagree about which library entry
// a scene element corresponds to.
//
// Why it exists: the original index keyed on `component/variant` alone. A kit
// Button has two axes (variant and size), so the librarian emits 48 entries
// and the composer could address 6 of them — a spec asking for
// size: "sm" silently got the default size, and the validator compared it
// against the wrong entry. Variant axes are whatever the kit's cva declares,
// so the index learns them from the library rather than hardcoding a list.

// Axis values a library entry or scene element declares. Only string-valued
// props count: `columns: [...]` and `selectable: true` are content, not axes.
export function axesOf(customData = {}) {
  const axes = {};
  if (typeof customData.variant === "string") axes.variant = customData.variant;
  for (const [k, v] of Object.entries(customData.props ?? {})) {
    if (typeof v === "string") axes[k] = v;
  }
  return axes;
}

export function buildIndex(lib) {
  const byComponent = new Map(); // component -> [{ axes, item, anchor, source }]
  const axisKeys = new Map();    // component -> Set of axis names seen
  for (const item of lib.libraryItems ?? []) {
    for (const el of item.elements ?? []) {
      const component = el.customData?.component;
      if (!component) continue;
      if (el.type === "text" && el.containerId) continue; // bound labels are not components
      const axes = axesOf(el.customData);
      if (!byComponent.has(component)) {
        byComponent.set(component, []);
        axisKeys.set(component, new Set());
      }
      byComponent.get(component).push({ axes, item, anchor: el, source: el.customData.source });
      for (const k of Object.keys(axes)) axisKeys.get(component).add(k);
    }
  }
  return { byComponent, axisKeys };
}

// Best entry for a component given the axis values the caller wants.
// A candidate conflicting on any requested axis is unusable; among the rest,
// the one matching the most axes wins, with fewer stray axes as a tiebreak.
export function lookupEntry(index, component, wanted = {}) {
  const candidates = index.byComponent.get(component);
  if (!candidates?.length) return null;

  const keys = index.axisKeys.get(component) ?? new Set();
  const want = {};
  for (const [k, v] of Object.entries(wanted)) {
    if (typeof v === "string" && keys.has(k)) want[k] = v;
  }

  let best = null;
  let bestScore = -Infinity;
  for (const cand of candidates) {
    let score = 0;
    let ok = true;
    for (const [k, v] of Object.entries(want)) {
      const cv = cand.axes[k] ?? "default";
      if (cv === v) score += 2;
      else { ok = false; break; }
    }
    if (!ok) continue;
    score -= Object.keys(cand.axes).length * 0.01;
    if (score > bestScore) { bestScore = score; best = cand; }
  }
  if (best) return best;

  // Nothing satisfied every requested axis. Fall back to variant alone, then
  // to the all-default entry, so an unknown size degrades instead of dying.
  if (want.variant) {
    const byVariant = candidates.find((c) => (c.axes.variant ?? "default") === want.variant);
    if (byVariant) return byVariant;
  }
  return candidates.find((c) => Object.values(c.axes).every((v) => v === "default")) ?? candidates[0];
}

// How closely an entry matched — lets a caller report a silent degradation.
export function unmatchedAxes(entry, wanted = {}) {
  const out = [];
  for (const [k, v] of Object.entries(wanted)) {
    if (typeof v !== "string") continue;
    const cv = entry?.axes?.[k];
    if (cv !== undefined && cv !== v) out.push(`${k}=${v} (got ${cv})`);
  }
  return out;
}
