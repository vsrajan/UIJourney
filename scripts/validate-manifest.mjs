#!/usr/bin/env node
// Validates the extractor's output — data/component-manifest.json and
// data/tokens.json — against the kit source they claim to describe.
// No dependencies.
//
//   node scripts/validate-manifest.mjs [--src src/components/ui]
//     [--manifest data/component-manifest.json] [--tokens data/tokens.json]
//     [--extractor scripts/extract-manifest.mjs] [--expect-primary #RRGGBB]
//
// Why this exists: the manifest is the work list for every later phase, and
// coverage is measured against it. Anything it fails to mention is invisible
// — a non-recursive glob once hid DataTable and DatePicker along with their
// 22 parts, and nothing downstream could tell. So this checks the manifest
// against the filesystem rather than against itself.
//
// Exits 1 on any ERROR. WARNs need a human eye but do not block.

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative, basename } from "node:path";

const argv = process.argv.slice(2);
function opt(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}
const SRC = opt("src", "src/components/ui");
const MANIFEST = opt("manifest", "data/component-manifest.json");
const TOKENS = opt("tokens", "data/tokens.json");
const EXTRACTOR = opt("extractor", "scripts/extract-manifest.mjs");
const EXPECT_PRIMARY = opt("expect-primary", null);

const errors = [];
const warns = [];
const notes = [];

function load(p, label, required = true) {
  if (!existsSync(p)) {
    if (required) {
      console.error(`ERROR: ${label} (${p}) not found — run the design-data-extractor agent first`);
      process.exit(1);
    }
    return null;
  }
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch (e) {
    console.error(`ERROR: ${label} (${p}) is not valid JSON: ${e.message}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------- discovery
// Deliberately reimplemented here rather than imported from the extractor:
// a check that shares its subject's file discovery cannot detect a discovery
// bug, which is the failure this whole script exists to catch.
const IGNORE = /\.(test|spec|stories)\.tsx$/;
function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".tsx") && !IGNORE.test(name)) out.push(p.split("\\").join("/"));
  }
  return out;
}

const diskFiles = walk(SRC);
if (!diskFiles.length) {
  console.error(`ERROR: no component .tsx files found under ${SRC} — is --src right?`);
  process.exit(1);
}

// ------------------------------------------------------------- manifest shape
const raw = load(MANIFEST, "component manifest");
const components = raw.components ?? raw;
if (!components || typeof components !== "object" || Array.isArray(components)) {
  console.error(`ERROR: ${MANIFEST} has no "components" object`);
  process.exit(1);
}
const entries = Object.entries(components);

for (const [name, def] of entries) {
  if (!def || typeof def !== "object") {
    errors.push(`${name}: entry is not an object`);
    continue;
  }
  if (typeof def.file !== "string" || !def.file) {
    errors.push(`${name}: missing "file"`);
  }
  if (def.role !== "root" && def.role !== "part") {
    errors.push(`${name}: role must be "root" or "part", got ${JSON.stringify(def.role)} — the librarian draws roots and skips parts, so an untagged entry is silently dropped from coverage`);
  }
  if (def.role === "part") {
    const parent = components[def.partOf];
    if (!def.partOf) errors.push(`${name}: role "part" without "partOf"`);
    else if (!parent) errors.push(`${name}: partOf "${def.partOf}" is not in the manifest`);
    else if (parent.role !== "root") errors.push(`${name}: partOf "${def.partOf}" is itself a part — parts nest one level under a root`);
  }
  const variants = def.variants ?? {};
  if (typeof variants !== "object" || Array.isArray(variants)) {
    errors.push(`${name}: "variants" must be an object of axis -> values`);
    continue;
  }
  for (const [axis, values] of Object.entries(variants)) {
    if (!Array.isArray(values) || values.some((v) => typeof v !== "string")) {
      errors.push(`${name}.${axis}: variant values must be an array of strings`);
    } else if (!values.length) {
      warns.push(`${name}.${axis}: declared with no values`);
    }
  }
  for (const [axis, value] of Object.entries(def.defaultVariants ?? {})) {
    if (!variants[axis]) errors.push(`${name}: defaultVariants.${axis} is not a declared variant axis`);
    else if (!variants[axis].includes(value)) errors.push(`${name}: defaultVariants.${axis} = "${value}" is not one of ${variants[axis].join(", ")}`);
  }
  if (def.compoundVariants !== undefined) {
    if (!Array.isArray(def.compoundVariants)) errors.push(`${name}: "compoundVariants" must be an array`);
    else
      for (const [i, cv] of def.compoundVariants.entries()) {
        if (!cv || typeof cv !== "object") { errors.push(`${name}.compoundVariants[${i}]: not an object`); continue; }
        for (const axis of Object.keys(cv)) {
          if (["class", "className"].includes(axis)) continue;
          if (!variants[axis]) warns.push(`${name}.compoundVariants[${i}]: condition on "${axis}", which is not a declared variant axis`);
        }
      }
  }
}

// ------------------------------------------------------------------ coverage
const manifestFiles = new Set(entries.map(([, d]) => d.file).filter(Boolean));
const missing = diskFiles.filter((f) => !manifestFiles.has(f));
const phantom = [...manifestFiles].filter((f) => !existsSync(f));

for (const f of missing) {
  errors.push(`${f} exists on disk but no manifest entry names it — invisible to every later phase`);
}
for (const f of phantom) {
  errors.push(`manifest names ${f}, which does not exist — stale entry or wrong path root`);
}

// ---------------------------------------------------- cva cross-check (heuristic)
// Independent of the extractor's parser, so it catches the failure mode where
// a regex-based extractor silently under-reports variant axes. Conservative:
// it only speaks when it can brace-match a variants block cleanly.
function variantsBlockKeys(source) {
  const at = source.search(/\bvariants\s*:\s*\{/);
  if (at < 0) return null;
  const open = source.indexOf("{", at);
  let depth = 0, i = open;
  for (; i < source.length; i++) {
    const c = source[i];
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) break; }
  }
  if (depth !== 0) return null;
  const body = source.slice(open + 1, i);
  const keys = [];
  let d = 0;
  for (let j = 0; j < body.length; j++) {
    const c = body[j];
    if (c === "{" || c === "[" || c === "(") d++;
    else if (c === "}" || c === "]" || c === ")") d--;
    else if (d === 0 && c === ":") {
      const before = body.slice(0, j);
      const m = before.match(/([A-Za-z_$][\w$]*|"[^"]+"|'[^']+')\s*$/);
      if (m) keys.push(m[1].replace(/^['"]|['"]$/g, ""));
    }
  }
  return keys.length ? keys : null;
}

const byFile = new Map();
for (const [name, def] of entries) {
  if (!def?.file) continue;
  if (!byFile.has(def.file)) byFile.set(def.file, []);
  byFile.get(def.file).push([name, def]);
}

let crossChecked = 0;
for (const file of diskFiles) {
  const defs = byFile.get(file) ?? [];
  if (!defs.length) continue;
  let source;
  try { source = readFileSync(file, "utf8"); } catch { continue; }
  const hasCva = /\bcva\s*\(/.test(source);
  const declared = defs.filter(([, d]) => Object.keys(d.variants ?? {}).length);

  if (hasCva && !declared.length) {
    errors.push(`${file} calls cva() but every manifest entry for it has empty variants — the parser did not read the variant axes`);
    continue;
  }
  if (!hasCva && declared.length) {
    warns.push(`${file} has no cva() call yet the manifest declares variants for ${declared.map(([n]) => n).join(", ")} — check where those came from`);
    continue;
  }
  if (!hasCva) continue;

  const sourceKeys = variantsBlockKeys(source);
  if (!sourceKeys) continue;
  crossChecked++;
  const manifestKeys = new Set(declared.flatMap(([, d]) => Object.keys(d.variants)));
  const absent = sourceKeys.filter((k) => !manifestKeys.has(k));
  const extra = [...manifestKeys].filter((k) => !sourceKeys.includes(k));
  // WARN, not ERROR: this scan is a heuristic and the AST is authoritative.
  // But every hit is worth opening the file for — an axis the manifest misses
  // is a set of variants the library will never draw.
  if (absent.length) warns.push(`${file}: cva() appears to declare axis ${absent.map((k) => `"${k}"`).join(", ")} that the manifest does not — open the file and confirm`);
  if (extra.length) warns.push(`${file}: manifest declares axis ${extra.map((k) => `"${k}"`).join(", ")} not visible in the cva() block — confirm it is real`);
}

// -------------------------------------------------------------------- tokens
const tokens = load(TOKENS, "tokens", false);
if (!tokens) {
  warns.push(`${TOKENS} not found — token checks skipped`);
} else {
  const text = JSON.stringify(tokens);
  const unresolved = [...new Set([...text.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)].map((m) => m[1]))];
  if (unresolved.length) {
    errors.push(`${TOKENS} still contains unresolved var() references: ${unresolved.join(", ")} — aliases must be resolved to concrete values`);
  }
  // Shape-tolerant lookup, matching validate-scene.mjs.
  const buckets = [tokens.semantic?.light, tokens.semantic, tokens.aliases, tokens.light, tokens.colors, tokens.primitives, tokens];
  const resolve = (alias) => {
    const bare = alias.replace(/^--/, "");
    for (const b of buckets) {
      if (!b || typeof b !== "object") continue;
      const v = b[alias] ?? b[bare];
      if (typeof v === "string") return v;
      if (v && typeof v === "object" && typeof v.value === "string") return v.value;
    }
    return null;
  };
  for (const alias of ["--primary", "--background", "--foreground", "--border", "--ring"]) {
    const v = resolve(alias);
    if (!v) warns.push(`${alias} does not resolve in ${TOKENS} — acceptable only if data/extraction-report.md names it as a real gap in the kit CSS`);
    else notes.push(`${alias} = ${v}`);
  }
  const primary = resolve("--primary");
  if (EXPECT_PRIMARY && primary && primary.toUpperCase() !== EXPECT_PRIMARY.toUpperCase()) {
    errors.push(`--primary is ${primary}, expected ${EXPECT_PRIMARY}`);
  }
}

// --------------------------------------------------------- extractor hygiene
if (existsSync(EXTRACTOR)) {
  const src = readFileSync(EXTRACTOR, "utf8");
  if (!/ensure-parser|loadTsMorph/.test(src)) {
    errors.push(`${EXTRACTOR} does not use loadTsMorph() from scripts/ensure-parser.mjs — it will not run on another machine or in CI`);
  }
} else {
  warns.push(`${EXTRACTOR} not found — extractor hygiene checks skipped`);
}

function git(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}
if (git(["rev-parse", "--is-inside-work-tree"]) === "true") {
  const dirty = git(["status", "--porcelain"]) ?? "";
  const touchedKit = dirty
    .split("\n")
    .map((l) => l.slice(3).trim())
    .filter((f) => /^(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(basename(f)) && !f.startsWith(".uijourney-tools"));
  if (touchedKit.length) {
    errors.push(`the kit's dependency files are modified (${touchedKit.join(", ")}) — the parser belongs in .uijourney-tools/, never in the kit; see scripts/ensure-parser.mjs`);
  }
  const tracked = git(["ls-files", ".uijourney-tools"]);
  if (tracked) errors.push(`.uijourney-tools/ is tracked by git — add it to .gitignore, it is a local tool sandbox`);
}

// -------------------------------------------------------------------- report
const roots = entries.filter(([, d]) => d.role === "root").length;
const parts = entries.filter(([, d]) => d.role === "part").length;
const withCva = entries.filter(([, d]) => Object.keys(d.variants ?? {}).length).length;

if (notes.length) {
  console.log("tokens:");
  for (const n of notes) console.log(`  ${n}`);
  console.log();
}
for (const w of warns) console.log(`WARN:  ${w}`);
for (const e of errors) console.log(`ERROR: ${e}`);

console.log(
  `\n${diskFiles.length} file(s) under ${SRC}, ${entries.length} manifest entr(ies) ` +
    `(${roots} root, ${parts} part, ${withCva} with variants), ${crossChecked} cva cross-checked`
);
console.log(`${errors.length} error(s), ${warns.length} warning(s)`);
if (!errors.length) {
  console.log(
    "\nStill do by hand: confirm data/ regenerates identically from cold\n" +
      "  (rm -rf .uijourney-tools && npm run uijourney:extract && git diff --exit-code data/)\n" +
      "and eyeball one cva() against its manifest entry."
  );
}
process.exit(errors.length ? 1 : 0);
