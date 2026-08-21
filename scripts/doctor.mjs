#!/usr/bin/env node
// Checks whether this machine can actually run excalidraw-librarian — that is,
// whether the kit's components can be rendered and measured. No dependencies.
//
//   node scripts/doctor.mjs [--src src/components/ui]
//
// Why it exists: a librarian run that discovers a missing dependency twenty
// minutes in does not stop, it improvises — a pilot run derived geometry from
// Tailwind class names and stamped it as measured. Ten seconds here replaces
// that. Exits non-zero if anything would block a measured build.

import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const SRC = (() => {
  const i = argv.indexOf("--src");
  return i >= 0 && argv[i + 1] ? argv[i + 1] : "src/components/ui";
})();

const require = createRequire(join(REPO, "package.json"));
const rows = [];
const add = (ok, name, detail, fix) => rows.push({ ok, name, detail, fix });

function resolves(spec) {
  try {
    require.resolve(spec, { paths: [REPO, join(REPO, "node_modules")] });
    return true;
  } catch {
    try {
      require.resolve(`${spec}/package.json`, { paths: [REPO, join(REPO, "node_modules")] });
      return true;
    } catch {
      return false;
    }
  }
}

// ------------------------------------------------------------- node_modules
const nm = join(REPO, "node_modules");
const nmCount = existsSync(nm) ? readdirSync(nm).filter((d) => !d.startsWith(".")).length : 0;
add(
  nmCount > 50,
  "node_modules populated",
  `${nmCount} entries`,
  nmCount === 0 ? "pnpm install --frozen-lockfile" : "only a stub is present — rm -rf node_modules && pnpm install --frozen-lockfile"
);

// -------------------------------------------------------------- render stack
for (const pkg of ["react", "react-dom"]) {
  add(resolves(pkg), `${pkg} resolvable`, "", `pnpm install --frozen-lockfile (${pkg} is what renders the kit)`);
}
const hasVite = resolves("vite");
const hasStorybook = existsSync(join(REPO, ".storybook"));
add(
  hasVite || hasStorybook,
  "render harness possible",
  hasStorybook ? "using the repo's .storybook" : hasVite ? "vite available" : "",
  "install vite, or add a .storybook config — the librarian needs somewhere to render one variant per route"
);

// ----------------------------------------------- every import the kit makes
// The decisive check: a component that cannot resolve its own imports cannot
// be rendered, whatever else is installed.
const IGNORE = /\.(test|spec|stories)\.tsx$/;
function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (n.endsWith(".tsx") || n.endsWith(".ts")) { if (!IGNORE.test(n)) out.push(p); }
  }
  return out;
}
// Path aliases are a bundler concern, not a package — never report them missing.
let aliasPrefixes = ["@/", "~/", "#"];
try {
  const tsconfig = JSON.parse(readFileSync(join(REPO, "tsconfig.json"), "utf8").replace(/\/\/.*$/gm, ""));
  for (const k of Object.keys(tsconfig?.compilerOptions?.paths ?? {})) aliasPrefixes.push(k.replace(/\*$/, ""));
} catch {}

const files = walk(join(REPO, SRC));
const specs = new Set();
for (const f of files) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/(?:from|import)\s+["']([^"']+)["']/g)) {
    const spec = m[1];
    if (spec.startsWith(".") || aliasPrefixes.some((a) => spec.startsWith(a))) continue;
    const parts = spec.split("/");
    specs.add(spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]);
  }
}
const missing = [...specs].filter((s) => !resolves(s)).sort();
add(
  files.length > 0 && missing.length === 0,
  `kit imports resolvable (${specs.size} package(s) across ${files.length} file(s))`,
  missing.length ? `missing: ${missing.join(", ")}` : "",
  missing.length
    ? `these are what the components import — map their scope in .npmrc and reinstall: ${missing.join(", ")}`
    : `no component files found under ${SRC} — is --src right?`
);

// ------------------------------------------------------------- playwright
const sandbox = join(REPO, ".uijourney-tools", "node_modules");
function resolvesAnywhere(spec) {
  try { require.resolve(spec, { paths: [REPO, join(REPO, "node_modules"), sandbox] }); return true; }
  catch { return false; }
}
const pw = resolvesAnywhere("playwright") || resolvesAnywhere("playwright-core");
add(pw, "playwright available", "", "npm install playwright-core --prefix .uijourney-tools");

const candidates = [
  process.env.UIJOURNEY_CHROMIUM,
  "/opt/pw-browsers/chromium", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable",
].filter(Boolean);
let browser = candidates.find((p) => existsSync(p));
if (!browser) {
  for (const c of ["chromium", "chrome", "google-chrome", "google-chrome-stable"]) {
    try { browser = execFileSync("which", [c], { encoding: "utf8" }).trim(); break; } catch {}
  }
}
add(
  Boolean(browser),
  "chromium executable",
  browser ?? "",
  "install Chromium, or set UIJOURNEY_CHROMIUM to its path — do not run `npx playwright install`, that download is usually blocked"
);

// ---------------------------------------------------------------- report
const width = Math.max(...rows.map((r) => r.name.length));
for (const r of rows) {
  const mark = r.ok ? "PASS" : "FAIL";
  console.log(`${mark}  ${r.name.padEnd(width)}  ${r.detail}`);
}
const failed = rows.filter((r) => !r.ok);
if (failed.length) {
  console.log("\nBlocking:");
  for (const r of failed) console.log(`  ${r.name}\n    -> ${r.fix}`);
  console.log(
    "\nDo not run excalidraw-librarian until these pass. Use excalidraw-librarian-lite\n" +
      "for a provisional library in the meantime."
  );
} else {
  console.log("\nAll checks pass — excalidraw-librarian can measure for real.");
}
process.exit(failed.length ? 1 : 0);
