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
import { homedir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

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

// Ask Playwright where its browser is rather than guessing paths. It is the
// thing that will launch it, so its answer is the only authoritative one --
// and when it answers, the harness needs no executablePath at all. Guessing
// missed the common case entirely: a bundled download under
// ~/.cache/ms-playwright/chromium-<rev>/chrome-linux/chrome is invisible to
// `which`, because it was never on PATH.
let browser = null;
let how = "";
let needsExecutablePath = true;

if (process.env.UIJOURNEY_CHROMIUM && existsSync(process.env.UIJOURNEY_CHROMIUM)) {
  browser = process.env.UIJOURNEY_CHROMIUM;
  how = "UIJOURNEY_CHROMIUM";
} else if (pw) {
  for (const mod of ["playwright", "playwright-core"]) {
    try {
      const entry = require.resolve(mod, { paths: [REPO, join(REPO, "node_modules"), sandbox] });
      const { chromium } = await import(pathToFileURL(entry).href);
      const p = chromium?.executablePath?.();
      // playwright-core computes a path without checking it exists.
      if (p && existsSync(p)) {
        browser = p;
        how = `${mod} bundled browser`;
        needsExecutablePath = false;
        break;
      }
    } catch {}
  }
}

if (!browser) {
  // Playwright's own layout, in case the module could not be loaded.
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    join(homedir(), ".cache", "ms-playwright"),
    join(homedir(), "Library", "Caches", "ms-playwright"),
    join(homedir(), "AppData", "Local", "ms-playwright"),
  ].filter((r) => r && existsSync(r));
  const leaves = [
    ["chrome-linux", "chrome"],
    ["chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"],
    ["chrome-win", "chrome.exe"],
  ];
  outer: for (const root of roots) {
    if (existsSync(join(root, "chromium"))) { browser = join(root, "chromium"); how = "PLAYWRIGHT_BROWSERS_PATH"; break; }
    for (const dir of readdirSync(root).filter((d) => d.startsWith("chromium"))) {
      for (const leaf of leaves) {
        const p = join(root, dir, ...leaf);
        if (existsSync(p)) { browser = p; how = `browsers path (${dir})`; break outer; }
      }
    }
  }
}

if (!browser) {
  for (const p of ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"]) {
    if (existsSync(p)) { browser = p; how = "system path"; break; }
  }
}
if (!browser) {
  for (const c of ["chromium", "chrome", "google-chrome", "google-chrome-stable"]) {
    try { browser = execFileSync("which", [c], { encoding: "utf8" }).trim(); how = "PATH"; break; } catch {}
  }
}

add(
  Boolean(browser),
  "chromium executable",
  browser ? `${browser}  [${how}]` : "",
  "install Chromium, or set UIJOURNEY_CHROMIUM to its path — do not run `npx playwright install`, that download is often blocked"
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
  console.log("\nLaunch the browser as:");
  if (needsExecutablePath) {
    console.log(`  chromium.launch({ executablePath: ${JSON.stringify(browser)} })`);
    console.log("  (Playwright's own default did not resolve, so the path must be given explicitly.)");
  } else {
    console.log("  chromium.launch()");
    console.log("  Playwright resolves its own bundled browser — do NOT pass executablePath.");
  }
}
process.exit(failed.length ? 1 : 0);
