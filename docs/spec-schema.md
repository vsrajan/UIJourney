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
| `text` | Label/content. For a bound-label component this replaces the label |
| `typography` | For `Heading` / `Text` / `Link`: a token from `lib/typography.json` |
| `props` | Concrete props recorded in `customData.props` for codegen |
| `width` | Override width. Only honoured where the library entry allows resizing |
| `gap` | Space below this node, default 16 |
| `children` | Nodes nested inside a container such as `Card` |

Two sugars:

- `{ "field": { "label": "...", "component": "Input", ... } }` emits a `Label`
  and its control with the tighter 8px gap between them.
- `{ "row": [node, node] }` places nodes side by side.

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
