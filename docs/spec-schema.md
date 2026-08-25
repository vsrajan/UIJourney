# Screen spec schema

A journey spec is the compact, semantic description of a set of screens.
`scripts/compose-scene.mjs` expands it into a conforming `.excalidraw` file.

The split is deliberate: **the spec carries meaning, the composer carries
geometry.** Agents write specs; nothing writes Excalidraw JSON by hand. Every
scene defect this pipeline has hit — bound labels at 0,0, missing
PageBackground, hairline borders, hand-transcribed base64 — came from a model
authoring geometry, and none of them are reachable from a spec.

A login screen is about 25 lines here, against ~700 lines of scene JSON.

```json
{
  "journey": "login",
  "screens": [
    {
      "name": "Login",
      "step": 1,
      "contentWidth": 400,
      "frame": { "width": 800, "height": 600 },
      "layout": [
        { "component": "AppHeader", "props": { "title": "Client Portal" } },
        { "component": "Card", "children": [
          { "component": "Heading", "typography": "header-4", "text": "Sign in to your account" },
          { "component": "Text", "typography": "body-2", "text": "Use your user ID or single sign-on" },
          { "field": { "label": "User ID", "component": "Input",
                       "props": { "placeholder": "you@company.com" },
                       "text": "you@company.com" } },
          { "component": "Button", "variant": "default", "text": "Sign in" },
          { "component": "Separator" },
          { "component": "Button", "variant": "secondary", "text": "Sign in with SSO" },
          { "component": "Link", "text": "Forgot password?" }
        ]}
      ]
    }
  ],
  "transitions": [
    { "from": 1, "to": 2, "trigger": "Sign in", "condition": "credentials valid" }
  ]
}
```

## Screens

| Key | Meaning |
|---|---|
| `name` | Screen name; becomes the frame's `Screen: <name>` |
| `step` | Journey order, referenced by transitions. Defaults to position |
| `frame` | `{ width, height }`, default 800×600 |
| `contentWidth` | Width of the centred content column, default 400 |
| `layout` | Ordered list of nodes, stacked top to bottom |

Screens are placed left to right in `step` order. Each gets a
`PageBackground` filled from `--background` automatically — never add one.

## Nodes

| Key | Meaning |
|---|---|
| `component` | Library component name, e.g. `Button`, `Input`, `Card` |
| `variant` | Library variant, default `"default"` |
| `text` | Label/content. For a bound-label component this replaces the label. **`""` removes it** — an empty string is how you say this instance has none |
| `typography` | For `Heading` / `Text` / `Link`: a token from `lib/typography.json` |
| `props` | Concrete props. String values that name a variant axis (`size`, `tone`) select the library entry; `title`/`label`/`placeholder` supply visible copy; table data is rendered (below). Everything else is recorded in `customData.props` for codegen |
| `width` | Override width. Only honoured where the library entry allows resizing |
| `gap` | Space below this node, default 16 |
| `underline` | Draws a 2px rule beneath the node — the active-nav-item and selected-tab affordance. `true` uses `--primary`; a token or hex overrides it |
| `children` | Nodes nested inside a container such as `Card` |

Two sugars:

- `{ "field": { "label": "...", "component": "Input", ... } }` emits a `Label`
  and its control with the tighter 8px gap between them.
- `{ "row": [node, node] }` places nodes side by side. Each node takes its
  **natural width** — the library entry's own width, or the text's width for
  Heading/Text/Link. Give a node an explicit `width` to override, and any node
  whose natural width is unknown shares the leftover space. If the row is
  wider than the content column it falls back to an even split.

## Glyph placeholder copy

Library glyphs carry stand-in text so they read as themselves when browsed —
`Card` ships with "Card Title", "Card Description", "Card content goes here";
`Checkbox` with "Label". The composer drops that scaffolding when the spec
does not replace it, so it never reads as real screen copy, and prints what
it dropped.

Two things are deliberately kept. Placeholder text on an **input-like**
component (Input, Textarea, Select, Combobox, DatePicker) is the affordance
itself, so it survives unless `props.placeholder` replaces it. And anything
the spec supplies always wins — these rules only ever apply to text the spec
said nothing about.

If a dropped line should have been real copy, put it in the spec: `text` on
the node, or a child node of its own.

## Keys that do nothing are reported

The composer prints any layout-node key it did not act on:

```
2 spec key(s) had no effect: DataTable.elevation, DataTable.props.stickyHeader
```

Either it is a typo, or it is codegen metadata that legitimately does not
affect the picture. This exists because the opposite — silently accepting a
key and doing nothing — is the failure that has cost the most here: table
columns, a `size` axis and a scrollbar were each written in good faith and
quietly ignored, and only the rendered picture disagreed.

## Nothing outside the spec survives

The scene is generated from the spec every time `compose-scene.mjs` runs, so
an edit made anywhere else — in the `.excalidraw` file, in Excalidraw itself
— is discarded on the next compose. If a change should persist it has to be
expressed here, in the library, or in the composer. This is deliberate: it is
what lets a composer fix or a re-measured library upgrade every existing
journey without redesigning anything. The corollary is that "I removed it and
it came back" always means the removal happened somewhere the spec does not
read.

## Icons

`{ "icon": "filter" }` is a layout node in its own right, drawn from
Excalidraw primitives and coloured from a token:

```json
{ "row": [ { "icon": "filter" }, { "component": "Select", "text": "Archived: false" } ] }
```

| Key | Meaning |
|---|---|
| `icon` | Icon name — `node scripts/icons.mjs` lists what is drawn |
| `size` | Box size in px, default 16 |
| `color` | Token, default `--foreground` |

`props.icon` on a **component** draws the icon inside it instead: centred when
the control has no label, at the leading edge with the label shifted clear
when it does, and in white or dark ink depending on the fill. So an icon
button is the component it really is —

```json
{ "component": "Button", "variant": "ghost", "props": { "size": "icon-xs", "icon": "filter" } }
```

— with no `text` at all. A stretchable control also grows to fit its label
and icon, so a long label does not overflow the width the glyph was authored
at.

An unknown name is **not** an error: it becomes a named placeholder box that
reserves the right space and still carries `customData.props.icon`, which is
what codegen imports. The composer reports which names fell back, so adding a
shape to `scripts/icons.mjs` is a deliberate choice rather than something you
discover from the picture.

**Use your kit's icon names, not the drawn set's.** The name in the spec is
what `journey-coder` imports, so it has to be the real one. To get a drawing
as well, map it in `ALIASES` at the top of `scripts/icons.mjs`:

```js
export const ALIASES = {
  iconcheckmark: "check",
  iconmagnifier: "search",
};
```

Keys are matched loosely, so `IconCheckmark`, `icon-checkmark` and
`Icon Checkmark` all hit the same entry, and `props.icon` still records
exactly what the spec asked for.

To draw a glyph that has no equivalent, add it to `ICONS` on a 16x16 grid
using three primitives — `P(...)` for a polyline, `E(x,y,w,h)` for an ellipse,
`R(x,y,w,h)` for a rectangle:

```js
"cloud-upload": [
  P([3, 11], [3, 8], [6, 6], [10, 6], [13, 9], [13, 11]),   // cloud underside
  P([8, 14], [8, 8]), P([5.5, 10.5], [8, 8], [10.5, 10.5]), // arrow
],
```

Coordinates come from the real SVG: divide a 24x24 viewBox by 1.5, a 20x20 by
1.25. Curves have to be approximated as short straight runs — at 16px nobody
can tell. `node scripts/icons.mjs` lists everything drawn and every alias.

**Never use a Unicode symbol as an icon.** A `"▽"` or `"‹"` in a text node
renders as text, may be missing from the font, and gives codegen a string
where it needed a component — `validate-scene.mjs` rejects it. Table cell
values are exempt, so an em dash meaning "no value" is still fine.

## Variant axes

A node's `variant` plus any string-valued `props` are matched against the
library's axes for that component. `{ "component": "Button", "variant":
"positive", "props": { "size": "sm" } }` selects `Button/positive/sm`. The
axes are whatever the kit's `cva` declares — the composer learns them from the
library rather than assuming `variant` is the only one. An axis value with no
matching entry degrades to the closest match and is reported at the end of the
run, rather than failing.

## Tables

`DataTable` and `Table` are the one place where a component's content is its
design, so the composer builds them from the spec instead of cloning the
library glyph:

```json
{ "component": "DataTable", "width": 1000, "props": {
    "columns": ["", "ID", "Name", "Short Description", "Description", "Actions"],
    "rows": [
      { "id": "WI-1001", "name": "Access Request", "short": "New user access provisioning",
        "description": "Request to provision access for a new joiner..." }
    ],
    "selectable": true,
    "rowActions": ["Approve", "Reject"]
}}
```

| Key | Effect |
|---|---|
| `columns` | Header labels, left to right. An empty first entry means the checkbox gutter; a trailing `"Actions"` is implied by `rowActions` |
| `rows` | Objects keyed loosely by column name (`"Short Description"` matches `short`), or plain arrays in column order |
| `selectable` | Adds a real `Checkbox` from the library to every row |
| `scroll` | `"vertical"` / `"horizontal"` / `"both"` — draws the rails on those axes. Also spelled `scrollbar` or `scrollable`, at node level or in `props`; `true` means vertical |
| `cellComponents` | Render a column with a real kit component instead of text (below) |
| `rowActions` | Per-row buttons. Strings pick a sensible variant (Approve→positive, Reject/Delete→negative); use `{ "label": ..., "variant": ... }` to choose |

Columns take the width their content needs; when the total exceeds the table,
the surplus comes only from columns that are over-wide, so a description
column narrows while an ID keeps its size. Cell text longer than its column is
ellipsized rather than drawn over the next column. Colours and band heights come
from the library glyph; the structure comes from the spec. Table chrome the
glyph may carry — a search box, pagination — is **not** synthesized: add it to
the spec as its own node if the screen needs it.

### Colour-coded columns

A status column reads far better as the kit's own Badge than as plain text,
and the variant carries the semantics through to codegen:

```json
"cellComponents": {
  "Status": {
    "component": "Badge",
    "variants": { "Running": "positive", "Completed": "secondary",
                  "Failed": "negative", "Queued": "warning" },
    "default": "default"
  }
}
```

Add `icons` to give each value a glyph as well:

```json
"Status": {
  "component": "Badge",
  "props": { "size": "lg" },
  "variants": { "Running": "info", "Completed": "success", "Failed": "error" },
  "icons":    { "Running": "refresh", "Completed": "check", "Failed": "x" },
  "default": "default"
}
```

A single `"icon": "..."` applies one glyph to every value. Icons are worth
reaching for when a kit's badges use soft tints: the fill may be too faint to
read at wireframe zoom, and the glyph is a second channel that does not depend
on saturation. The column widens to fit the badge's padding and icon, so the
label stays inside the pill.

The value becomes the component's label and the mapped variant selects the
library entry, so the colours are your kit's, not invented. A value with no
mapping uses `default`.

**`default` goes inside the column entry, beside `variants` — not beside
`Status`.** A sibling `default` is read as a column of that name and reported
as malformed.

**Check what your kit's Badge actually has before mapping onto it.**
`positive` and `warning` are common but far from universal; shadcn ships
`default` / `secondary` / `destructive` / `outline`. Ask the library:

```
node scripts/lib-index.mjs Badge
```

which prints each variant with the fill, border and text colour it really
uses — so you can see at a glance whether the kit has semantic colours to
select at all.

A variant the library cannot provide is named in the composer's output along
with what it substituted, e.g. `Badge/positive (library gave Badge/default)`.
That report matters: library lookup deliberately degrades rather than failing,
so without it every status would quietly collapse onto the same badge and the
column would look styled while carrying no information.

Synthesized elements carry `customData.synthesized: true`, which exempts them
from library size conformance (their geometry is the composer's, not the
glyph's) while still requiring the component to exist in the library.

## Transitions

`{ from, to, trigger, condition?, label? }` — becomes an arrow between the two
frames carrying `customData.transition`, which is what `journey-coder` reads
to wire navigation. `label` defaults to `on <trigger>`.

## Rules the composer handles for you

Do not encode these in the spec; they are applied automatically and are the
reason a composed scene passes validation on the first attempt:

- `PageBackground` per frame, at the `--background` token.
- Bound label coordinates, centred in their container, sharing its `frameId`.
- The logo: an `image` element with a `fileId` plus the matching `files` entry
  spliced from `lib/logo.json`, with `props.src` kept as the sanctioned URL.
- `customData` on containers only, never on bound text.
- Geometry, colours, borders and fonts copied from the library entry.
- Deterministic ids and seeds, so re-composing an unchanged spec produces an
  identical file rather than a churning diff.
