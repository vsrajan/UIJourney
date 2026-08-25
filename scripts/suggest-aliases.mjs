#!/usr/bin/env node
// Matches the kit's icon exports against the shapes UIJourney can draw, and
// writes the ALIASES map for scripts/icons.mjs.
//
//   node scripts/suggest-aliases.mjs                 # print the block
//   node scripts/suggest-aliases.mjs --write         # patch scripts/icons.mjs
//   node scripts/suggest-aliases.mjs --package @acme/icons
//
// Why a script: the mapping is semantic, not textual — a filter icon is called
// FilterFunnel and a search icon Magnifier — so it needs a synonym table, and
// a synonym table is worth writing once rather than rediscovering per kit.
// Every choice is reported with its alternatives, because a wrong alias is a
// wrong picture that still validates.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ICONS } from "./icons.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const PKG = opt("package", "@uwr/icons");
const WRITE = argv.includes("--write");

// What a kit might call each shape we can draw. First term is the strongest.
const CONCEPTS = {
  filter: ["funnel", "filter"],
  search: ["magnifier", "search", "find", "magnify"],
  check: ["checkmark", "check", "tick", "success", "done", "confirm"],
  x: ["close", "cross", "dismiss", "cancel", "times", "clear"],
  menu: ["menu", "hamburger", "bars", "list"],
  plus: ["plus", "add", "new", "create"],
  minus: ["minus", "subtract", "remove", "dash"],
  calendar: ["calendar", "date", "schedule"],
  user: ["user", "person", "profile", "account", "avatar"],
  alert: ["warning", "alert", "caution", "attention", "exclamation"],
  settings: ["settings", "preferences", "sliders", "gear", "cog", "config"],
  refresh: ["refresh", "reload", "sync", "rotate", "recycle"],
  download: ["download", "import", "arrowdown", "save"],
  upload: ["upload", "export", "arrowup", "publish"],
  sort: ["sort", "updown", "arrowsvertical", "order"],
  "chevron-up": ["chevronup", "caretup", "angleup", "arrowup"],
  "chevron-down": ["chevrondown", "caretdown", "angledown", "arrowdown"],
  "chevron-left": ["chevronleft", "caretleft", "angleleft", "arrowleft", "previous", "back"],
  "chevron-right": ["chevronright", "caretright", "angleright", "arrowright", "next", "forward"],
  "arrow-left": ["arrowleft", "back", "previous"],
  "arrow-right": ["arrowright", "forward", "next"],
  "more-horizontal": ["morehorizontal", "ellipsis", "dots", "overflow", "kebab", "meatball"],
};

// Normalise an export name for comparison: drop an Icon prefix, a trailing
// pixel size, and all punctuation. FilterFunnel24px -> filterfunnel
const norm = (s) =>
  String(s)
    .replace(/^Icon/, "")
    .replace(/[-_ ]?\d{1,3}(px)?$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

// The name split into its component words. Matching has to respect these:
// raw substring matching made "add" hit "Address", and every near-tie it
// reported ("addfilter", "addcomment", "addpillar3") was equally wrong.
const words = (s) =>
  String(s)
    .replace(/^Icon/, "")
    .replace(/[-_ ]?\d{1,3}(px)?$/i, "")
    .split(/(?=[A-Z])|[-_ ]+/)
    .map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, ""))
    .filter(Boolean);

async function kitIcons() {
  let ns;
  try {
    const m = await import(PKG);
    ns = { ...(m.default && typeof m.default === "object" ? m.default : {}), ...m };
  } catch (e) {
    console.error(`ERROR: could not import ${PKG} — ${e.message}`);
    console.error("Pass --package <name>, or fall back to the path scan in docs/icon-checker.md.");
    process.exit(1);
  }
  const names = Object.keys(ns).filter((k) => k !== "default" && /^[A-Z]/.test(k));
  if (!names.length) {
    console.error(`ERROR: ${PKG} exported no capitalised members — is that the right package?`);
    process.exit(1);
  }
  // Collapse the size family: keep one representative per base name.
  const byBase = new Map();
  for (const n of names) {
    const b = norm(n);
    if (!byBase.has(b)) byBase.set(b, []);
    byBase.get(b).push(n);
  }
  return byBase;
}

// Shape and style words that qualify an icon without changing what it means.
// They must not count against a name's coverage: WarningTriangle is still a
// warning, SortArrows is still a sort.
const QUALIFIERS = new Set([
  "triangle", "circle", "square", "round", "rounded", "box", "outline",
  "outlined", "filled", "solid", "line", "alt", "bold", "light", "small",
  "large", "arrows", "arrow", "icon", "symbol", "sign", "mark",
]);

// Higher is better; 0 means no match.
//
// A term must be the whole name or one of its words — never a bare substring,
// which is how "add" reached "Address". And a compound name only counts if the
// concept explains ALL of it: FilterFunnel is filter+funnel, both synonyms of
// the same idea, whereas AddFilter is add+filter, where "filter" belongs to a
// different concept entirely and the icon means "add a filter", not "+".
function score(base, ws, terms) {
  let best = 0;
  const known = new Set(terms);
  for (const [i, t] of terms.entries()) {
    const weight = 1 - i * 0.06;               // earlier synonyms are stronger
    let s = 0;
    if (base === t) s = 100;                   // MoreHorizontal vs "morehorizontal"
    else if (ws.length === 1 && ws[0] === t) s = 95;
    else if (ws.includes(t)) {
      // Every other word must be a synonym of this same concept or a generic
      // qualifier, or the name is about something else.
      const unexplained = ws.filter((w) => w !== t && !known.has(w) && !QUALIFIERS.has(w));
      s = unexplained.length ? 0 : 60 - 8 * (ws.length - 1);
    }
    if (s > 0) best = Math.max(best, s * weight);
  }
  return best;
}

const byBase = await kitIcons();
const chosen = [];
const ambiguous = [];
const missing = [];

for (const shape of Object.keys(ICONS).sort()) {
  const terms = CONCEPTS[shape];
  if (!terms) { missing.push([shape, "no synonyms defined"]); continue; }
  const ranked = [...byBase.entries()]
    .map(([b, exports_]) => [b, score(b, words(exports_[0]), terms)])
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1]);
  if (!ranked.length) { missing.push([shape, "nothing in the kit matched"]); continue; }
  const [base, top] = ranked[0];
  chosen.push([base, shape, byBase.get(base)]);
  const rivals = ranked.slice(1, 4).filter(([, s]) => top - s < 12);
  if (rivals.length) ambiguous.push([shape, base, rivals.map(([b]) => b)]);
}

const block =
  "export const ALIASES = {\n" +
  chosen.map(([base, shape]) => `  ${base}: ${JSON.stringify(shape)},`).join("\n") +
  "\n};";

console.log(block);
console.log(`\n// ${chosen.length} alias(es) from ${byBase.size} kit icon(s) in ${PKG}`);
for (const [base, shape, exports_] of chosen) {
  console.log(`//   ${base} -> ${shape}   (${exports_.slice(0, 3).join(", ")}${exports_.length > 3 ? ", ..." : ""})`);
}
if (ambiguous.length) {
  console.log("\n// CHECK THESE — another export scored nearly as well:");
  for (const [shape, base, rivals] of ambiguous) {
    console.log(`//   ${shape}: chose ${base}, also plausible ${rivals.join(", ")}`);
  }
}
if (missing.length) {
  console.log("\n// No match; these stay as named placeholders until a shape or synonym is added:");
  for (const [shape, why] of missing) console.log(`//   ${shape} — ${why}`);
}

if (WRITE) {
  const p = join(REPO, "scripts", "icons.mjs");
  const src = readFileSync(p, "utf8");
  const re = /export const ALIASES = \{[\s\S]*?\n\};/;
  if (!re.test(src)) {
    console.error("\nERROR: could not find the ALIASES block in scripts/icons.mjs — paste it by hand.");
    process.exit(1);
  }
  writeFileSync(p, src.replace(re, block));
  console.log(`\nwrote ${chosen.length} alias(es) into scripts/icons.mjs`);
  console.log("Recompose and look at the picture — a wrong alias still validates.");
}
