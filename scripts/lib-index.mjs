#!/usr/bin/env node
// Axis-aware index over a .excalidrawlib, shared by compose-scene.mjs and
// validate-scene.mjs so the two can never disagree about which library entry
// a scene element corresponds to.
//
// Also answers "what does my kit actually have?" from the command line:
//
//   node scripts/lib-index.mjs                    # every component
//   node scripts/lib-index.mjs Badge              # Badge's variants and fills
//
// Note for anyone reaching for a one-liner instead: require() only parses
// .json, so require("./lib/uds.excalidrawlib") tries to EXECUTE the library
// as JavaScript and dies on the first colon. Read and JSON.parse it.
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

// Fallback for a library that encodes its axes only in the item name
// ("Button/positive/sm"). The librarian contract requires the values in
// customData.props, but a library that omits them would silently serve the
// default size for every request, so the name is read as unkeyed tags and
// matched by value. Only consulted when the keyed axes cannot answer.
function nameTags(item, component) {
  const name = typeof item?.name === "string" ? item.name : "";
  const parts = name.split("/").map((p) => p.trim()).filter(Boolean);
  if (parts[0] !== component) return [];
  return parts.slice(1);
}

export function buildIndex(lib) {
  const byComponent = new Map(); // component -> [{ axes, tags, item, anchor, source }]
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
      // The anchor is the element the composer positions and resizes, so it
      // must be the glyph's PRIMARY shape. Taking whichever came first meant
      // a decorative accent bar listed ahead of the pill became the anchor,
      // and a Badge rendered as a thin coloured line behind its own label.
      // Largest area wins; a tie keeps the earlier element.
      const key = JSON.stringify(Object.entries(axes).sort());
      const list = byComponent.get(component);
      const area = (e) => Math.abs((e.width ?? 0) * (e.height ?? 0));
      const existing = list.find((c) => JSON.stringify(Object.entries(c.axes).sort()) === key && c.item === item);
      if (existing) {
        if (area(el) > area(existing.anchor)) existing.anchor = el;
      } else {
        list.push({ axes, tags: nameTags(item, component), item, anchor: el, source: el.customData.source });
      }
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
  const want = {};       // axes the library declares as keyed props
  const byValue = [];    // requested values whose axis the library never names
  for (const [k, v] of Object.entries(wanted)) {
    if (typeof v !== "string") continue;
    if (keys.has(k)) want[k] = v;
    else if (k !== "variant" && v !== "default" && candidates.some((c) => c.tags.includes(v))) byValue.push(v);
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
    if (ok) {
      for (const v of byValue) {
        if (cand.tags.includes(v)) score += 2;
        else { ok = false; break; }
      }
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


// ------------------------------------------------------------------ CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync, existsSync } = await import("node:fs");
  const argv = process.argv.slice(2);
  const libPath = argv.find((a) => a.endsWith(".excalidrawlib")) ?? "lib/uds.excalidrawlib";
  const which = argv.find((a) => !a.endsWith(".excalidrawlib"));

  if (!existsSync(libPath)) {
    console.error(`ERROR: ${libPath} not found — run this from the repo root, or pass the path`);
    process.exit(1);
  }
  const lib = JSON.parse(readFileSync(libPath, "utf8"));
  const index = buildIndex(lib);

  if (!which) {
    const rows = [...index.byComponent.entries()]
      .map(([name, c]) => [name, c.length, [...(index.axisKeys.get(name) ?? [])].join(",") || "-"])
      .sort((a, b) => a[0].localeCompare(b[0]));
    const w = Math.max(...rows.map((r) => r[0].length));
    console.log(`${"COMPONENT".padEnd(w)}  ENTRIES  AXES`);
    for (const [name, n, axes] of rows) console.log(`${name.padEnd(w)}  ${String(n).padStart(7)}  ${axes}`);
    console.log(`\n${rows.length} component(s). Name one to see its variants: node scripts/lib-index.mjs Badge`);
    process.exit(0);
  }

  const entries = index.byComponent.get(which);
  if (!entries) {
    const near = [...index.byComponent.keys()].filter((k) => k.toLowerCase().includes(which.toLowerCase()));
    console.error(`"${which}" is not in ${libPath}.${near.length ? ` Did you mean: ${near.join(", ")}?` : ""}`);
    process.exit(1);
  }
  if (argv.includes("--elements")) {
    console.log(`${which} — full element breakdown\n`);
    for (const e of entries) {
      const axes = Object.entries(e.axes).map(([k, v]) => `${k}=${v}`).join(" ") || "(no axes)";
      console.log(`  ${e.item.name ?? e.item.id ?? "(unnamed)"}   [${axes}]`);
      for (const el of e.item.elements) {
        const anchor = el.id === e.anchor.id ? " <-- ANCHOR" : "";
        const txt = el.text ? `  ${JSON.stringify(String(el.text).slice(0, 20))}` : "";
        console.log(
          `      ${String(el.type).padEnd(10)} ${String(Math.round(el.width ?? 0)).padStart(4)}x${String(Math.round(el.height ?? 0)).padEnd(4)}` +
            ` fill ${String(el.backgroundColor ?? "-").padEnd(9)} stroke ${String(el.strokeColor ?? "-").padEnd(9)}` +
            ` ${String(el.customData?.component ?? "")}${txt}${anchor}`
        );
      }
      console.log();
    }
    process.exit(0);
  }

  console.log(`${which} — ${entries.length} entr(ies) in ${libPath}\n`);
  const seen = new Set();
  for (const e of entries) {
    const axes = Object.entries(e.axes).map(([k, v]) => `${k}=${v}`).join(" ") || "(no axes)";
    if (seen.has(axes)) continue;
    seen.add(axes);
    const fill = e.anchor.backgroundColor ?? "-";
    const stroke = e.anchor.strokeColor ?? "-";
    const label = e.item.elements.find((x) => x.type === "text");
    const ink = label?.strokeColor ?? "-";
    console.log(`  ${axes.padEnd(34)} fill ${String(fill).padEnd(9)} border ${String(stroke).padEnd(9)} text ${ink}`);
  }
  console.log("\nUse these axis values verbatim in a spec — they are what the composer matches on.");
}
