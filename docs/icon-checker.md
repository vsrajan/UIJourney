# Checking which icons your kit has

Icons reach a mockup by **name**. The name in a spec is what `journey-coder`
imports from the kit's icon package, so it has to be a real export — the glyph
the composer draws is only a preview. This page is how to find those names,
and how to give them drawings.

All commands run from the repo root.

## 1. Every icon the package exports

```bash
node --input-type=module -e '
const m = await import("@uwr/icons");
const ns = { ...(m.default && typeof m.default === "object" ? m.default : {}), ...m };
const names = Object.keys(ns).filter((k) => k !== "default" && /^[A-Z]/.test(k)).sort();
console.log(`${names.length} exported icon(s)\n` + names.join("\n"));
'
```

```
8 exported icon(s)

IconCheckmark
IconChevronLeft
IconChevronRight
IconClose
IconFunnel
IconMagnifier
IconRefresh
IconWarning
```

The spread over `m.default` is not decoration. These packages are usually
CommonJS and expose their members through getters, which `cjs-module-lexer`
cannot see — so a dynamic import leaves the named exports undefined and only
`default` holds the real object. The same interop caught out `doctor.mjs`
when it asked Playwright where its browser was.

Substitute your own package name if it is not `@uwr/icons`.

## 2. The icons your kit actually uses

Usually more useful: it tells you which names appear in real component code,
so effort goes on glyphs that will actually be imported.

```bash
grep -rhoE "import[^;]*from\s*['\"]@uwr/icons['\"]" src/ \
  | grep -oE "\{[^}]*\}" | tr -d '{}' | tr ',' '\n' | sed 's/ *as .*//' | tr -d ' ' \
  | grep -v '^$' | sort -u
```

## 3. If the runtime import fails

Some packages are ESM-only, or need a build step before they resolve. Read the
type declarations instead:

```bash
grep -oE "export (declare )?const [A-Za-z0-9_]+" node_modules/@uwr/icons/*.d.ts \
  | awk '{print $NF}' | sort -u
```

## What the list does and does not tell you

It gives **names, not shapes**. These are React components; you cannot see what
they look like without rendering them. If the kit has Storybook, that is the
fastest way to eyeball them. Otherwise judge by name, and check the rendered
mockup afterwards.

## Turning the names into drawings

`node scripts/icons.mjs` lists what UIJourney draws and every alias configured.

Write **the kit's name** in the spec — that is the contract — and map it to a
drawn shape in `ALIASES` at the top of `scripts/icons.mjs`:

```js
export const ALIASES = {
  iconcheckmark: "check",
  iconmagnifier: "search",
  iconfunnel: "filter",
};
```

Keys are matched loosely, so `IconCheckmark`, `icon-checkmark` and
`Icon Checkmark` all resolve to the same entry, and `customData.props.icon`
still records exactly what the spec asked for.

Do not expect a script to build this map: `IconFunnel` → `filter` and
`IconMagnifier` → `search` are semantic matches, not textual ones. It is a
manual pass, and a short one.

A name with no alias and no drawn shape is **not an error**. It becomes a
named placeholder box that reserves the right space and keeps the name for
codegen, and the composer says so:

```
1 icon(s) drawn as named placeholders: CloudUpload
```

Add a real shape only when a placeholder shows up somewhere it matters — see
the Icons section of `docs/spec-schema.md` for the 16x16 grid format.
