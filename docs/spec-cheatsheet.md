# Spec cheat sheet

Everything a normal screen needs, on one page. The full reference is
`docs/spec-schema.md` — open it only when this page does not cover what you
are trying to say.

**The spec carries meaning; `scripts/compose-scene.mjs` carries geometry.**
Never write Excalidraw JSON, coordinates or seeds. A login screen is ~25 lines
here against ~700 lines of scene.

```json
{
  "journey": "login",
  "screens": [
    {
      "name": "Login", "step": 1,
      "frame": { "width": 800, "height": 600 }, "contentWidth": 400,
      "layout": [
        { "component": "AppHeader", "props": { "title": "Client Portal" } },
        { "component": "Card", "children": [
          { "component": "Heading", "typography": "header-4", "text": "Sign in" },
          { "field": { "label": "User ID", "component": "Input",
                       "props": { "placeholder": "you@company.com" } } },
          { "component": "Button", "variant": "default", "text": "Sign in" }
        ]}
      ]
    }
  ],
  "transitions": [
    { "from": 1, "to": 2, "trigger": "Sign in", "condition": "credentials valid" }
  ]
}
```

## Screen keys

`name` · `step` (journey order, referenced by transitions) · `frame`
(`{width,height}`, default 800×600) · `contentWidth` (centred column, default
400) · `layout` (nodes, stacked top to bottom).

Screens are placed left to right in `step` order. `PageBackground` is added for
you — never write one.

## Node keys

| Key | Meaning |
|---|---|
| `component` | Library component name. Get the list from `node scripts/lib-index.mjs --brief` |
| `variant` | Library variant, default `"default"` |
| `text` | Label/content. **`""` removes the label** |
| `typography` | `Heading`/`Text`/`Link` only: a token from `lib/typography.json` |
| `props` | String values naming an axis (`size`, `tone`) select the library entry; `title`/`label`/`placeholder`/`icon` supply copy; table data is rendered. Everything else is recorded for codegen |
| `width` | Only honoured where the entry's `resize` allows it |
| `gap` | Space below, default 16 |
| `underline` | 2px rule beneath — the active-nav/selected-tab affordance. `true` uses `--primary` |
| `children` | Nodes nested in a container such as `Card` |

Two sugars:

- `{ "field": { "label": "...", "component": "Input", ... } }` — label plus
  control at the tighter 8px gap.
- `{ "row": [node, node] }` — side by side, each at its natural width. Give an
  explicit `width` to override.

## Icons

An icon is its own node — **never a Unicode character.** A `"▽"` renders as
text, may be missing from the font, hands codegen a string where it needed a
component, and the validator rejects it.

```json
{ "row": [ { "icon": "FilterFunnel16px" }, { "component": "Select", "text": "Archived: false" } ] }
```

Write the kit's real export name, from `lib/icon-map.json` (printed by
`node scripts/icons.mjs`). 16px in a toolbar or badge, 24px for a standalone
control; the size in the name sets the drawn size. A name not in the map still
works — it draws a named placeholder and carries the name to codegen — so an
unusual icon is never a blocker. `props.icon` works the same way inside a
component.

## Tables

`DataTable`/`Table` content is its design, so the composer builds them from the
spec rather than cloning the glyph. Write the **real columns and three to five
real rows** — enough to show truncation and column balance.

```json
{ "component": "DataTable", "width": 1000, "props": {
    "columns": ["", "ID", "Name", "Status", "Actions"],
    "rows": [ { "id": "WI-1001", "name": "Access Request", "status": "Running" } ],
    "selectable": true,
    "scroll": "vertical",
    "rowActions": ["Approve", "Reject"],
    "cellComponents": {
      "Status": { "component": "Badge",
                  "variants": { "Running": "info", "Failed": "error" },
                  "default": "default" }
    }
}}
```

`columns` — an empty first entry is the checkbox gutter. `rows` — objects keyed
loosely by column name (`"Short Description"` matches `short`), or arrays in
column order. `selectable` — a real `Checkbox` per row. `scroll` —
`"vertical"`/`"horizontal"`/`"both"`. `rowActions` — strings pick a variant
(Approve→positive, Reject→negative). `cellComponents` — render a column as a
kit component; **check `--brief` for the variants your kit actually has**
before mapping values onto them.

## Three rules worth knowing

**Nothing outside the spec survives.** The scene is regenerated on every
compose, so an edit to `journey.excalidraw` — or in Excalidraw itself — is
discarded next run. "I removed it and it came back" always means the removal
happened somewhere the spec does not read.

**Keys that do nothing are reported.** The composer prints any key it did not
act on. Read that line: table columns, a `size` axis and a scrollbar were each
written in good faith and silently ignored, and only the picture disagreed.

**Glyph scaffolding is dropped.** Library glyphs carry stand-in text ("Card
Title") which the composer removes unless the spec replaces it — except
placeholder text on input-like components, which is the affordance. Anything
the spec supplies always wins.

## Not here

Composite anatomy, provenance and `provisional`, the full transition schema,
and the complete list of rules the composer satisfies on your behalf are in
`docs/spec-schema.md`.
