# Finding your kit's icon names

Icons reach a mockup by **name**. The name in a spec is what `journey-coder`
imports from the kit's icon package, so it has to be a real export — the glyph
the composer draws is only a preview. This page is how to find those names.

A firm icon package is large: the one this was written against exports **1053**
icons, of which the kit imports three. So do not start by listing them.

All commands run from the repo root. Substitute your own package name if it is
not `@uwr/icons`.

## 1. What the kit already imports

Start here. These are names already proven to exist and to be the ones the
team reaches for.

```bash
grep -rhoE "import[^;]*from\s*['\"]@uwr/icons['\"]" src/ \
  | grep -oE "\{[^}]*\}" | tr -d '{}' | tr ',' '\n' | sed 's/ *as .*//' | tr -d ' ' \
  | grep -v '^$' | sort -u
```

## 2. Search the catalogue for what a screen needs

The one you will actually use. A mockup wants icons the kit source does not
import yet — a filter control, pagination chevrons, a sort affordance — and at
a thousand exports you search rather than browse.

```bash
node --input-type=module -e '
const m = await import("@uwr/icons");
const ns = { ...(m.default && typeof m.default === "object" ? m.default : {}), ...m };
const re = new RegExp(process.argv[1] ?? "", "i");
const hits = Object.keys(ns).filter((k) => /^[A-Z]/.test(k) && re.test(k)).sort();
console.log(hits.length ? hits.join("\n") : "(no match)");
' funnel
```

The last word is the search term, and it is a regular expression, so
`'funnel|filter'` works. Search by **concept, not by my names** — a filter icon
may be `IconFunnel`, a search icon `IconMagnifier`. Try two or three synonyms
before concluding something is missing.

The spread over `m.default` is not decoration. These packages are usually
CommonJS and expose their members through getters, which `cjs-module-lexer`
cannot see — so a dynamic import leaves the named exports undefined and only
`default` holds the real object. The same interop caught out `doctor.mjs` when
it asked Playwright where its browser was.

## 3. If the runtime import fails

Some packages are ESM-only or need a build step. Fall back to the files — but
**enumerate by path, not by declaration**. These packages usually ship one
module per icon, and every one of those modules declares the same anonymous
symbol:

```
declare const svg: React.FC<React.SVGProps<React.ReactSVGElement>>;
export default svg;
```

Grepping declarations therefore returns `svg` a thousand times. The identity is
in the directory name. Scan the whole scope, since the modules commonly live in
a sibling package at a nested path (`@uwr/rt/react/icon/`, not `@uwr/icons/`):

```bash
find node_modules/@uwr -path '*react/icon/*' -name '*.d.ts' \
  | sed -E 's#.*/react/icon/##; s#/index\.d\.ts$##; s#\.d\.ts$##' \
  | sort -u | grep -iE "funnel|filter"
```

Drop the final `grep` to get everything — but see the note about 1053.

## Sizes baked into the name

Many kits publish one export per icon **per size**:

```
FilterFunnel12px
FilterFunnel16px
FilterFunnel24px
```

Two things follow, both handled for you.

One `ALIASES` entry covers the whole family — the trailing size is stripped
before lookup, so `filterfunnel` matches all three.

And the composer takes the size from the name: `FilterFunnel24px` is drawn at
24px without restating it. An explicit `size` on the node still wins, which is
what you want inside a badge or a dense toolbar where the kit's nominal size is
too big for the slot.

## Two naming conventions, and which one to write

The per-icon modules are usually **kebab-case** (`funnel`, `chevron-left`)
while the barrel re-exports them **PascalCase** (`IconFunnel`,
`IconChevronLeft`). Both name the same icon, and a spec must use whichever form
the kit's own code imports, because `journey-coder` reproduces it.

Settle it by reading a real import rather than guessing:

```bash
grep -rhE "^import .*(icon|Icon)" src/components/ui/ | sort -u | head
```

A named import from a barrel (`import { IconFunnel } from "@uwr/icons"`) means
write `IconFunnel`. A default deep import
(`import Funnel from "@uwr/rt/react/icon/funnel"`) means write `funnel`, and
codegen has to emit the deep path — a barrel import it invented would not
resolve.

## What the list does not tell you

**Names, not shapes.** These are React components; you cannot see what they
look like without rendering. If the kit has Storybook, that is the fastest way
to eyeball them. Otherwise judge by name and check the rendered mockup.

## Turning names into drawings

`node scripts/icons.mjs` lists what UIJourney draws and every alias configured.

Write **the kit's name** in the spec — that is the contract — and map it to a
drawn shape in `ALIASES` at the top of `scripts/icons.mjs`:

```js
export const ALIASES = {
  filterfunnel: "filter",
  magnifier: "search",
  checkmark: "check",
};
```

Keys are matched loosely — case, separators and any trailing size are all
ignored, so `FilterFunnel16px`, `filter-funnel-24px` and `Filter Funnel` reach
the same entry — and `customData.props.icon` still records exactly what the
spec asked for.

Do not expect a script to build this map. `IconFunnel` → `filter` and
`IconMagnifier` → `search` are semantic matches, not textual ones, so it is a
manual pass — and a short one, because it only needs the icons your screens
actually use.

A name with no alias and no drawn shape is **not an error**. It becomes a
named placeholder box that reserves the right space and keeps the name for
codegen, and the composer says so:

```
1 icon(s) drawn as named placeholders: IconCloudUpload
```

Add a real shape only when a placeholder shows up somewhere it matters — see
the Icons section of `docs/spec-schema.md` for the 16x16 grid format.
