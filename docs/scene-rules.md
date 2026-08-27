# Scene rules

What `scripts/validate-scene.mjs` checks, and why each rule exists.

**You should not need this page.** `compose-scene.mjs` satisfies every rule
below, and it runs the validator itself, so a clean compose means a clean
scene. Read on only when `validate-scene.mjs` reports an ERROR — this is the
list to diagnose it against, and it exists so nobody has to reconstruct the
rules by reading the validator's source.

**Structure** — every screen is a frame named `Screen: <Name>` with
`customData.journeyStep` and `screenName`. Every frame contains exactly one
`PageBackground` rect sized to the frame and filled with `--background`.
Every element inside a frame carries `customData` (component, transition or
annotation) — except bound text, which is described by its container.

**Metadata** — `customData.component` lives on the container only, never on
bound text. Bound text shares its container's `frameId` and must fit inside
it. Components nested in a composite (the `Logo` in `AppHeader`, a toolbar
in `DataTable`) keep their own `customData.component` and are valid library
entries.

**Library conformance** — every component/variant must exist in the
library. Heights must match the library entry unless it is
`resize: "both"`; widths must match unless it is `"horizontal"` or `"both"`.
`PageBackground` is the one scene-only construct, exempt from this and
checked against the `--background` token directly.

**Typography** — every text element uses `fontFamily: 2`. Heading, Text and
Link declare `customData.typography` naming a token in
`lib/typography.json`, and their size, weight and colour must match it.

**Rendering** — borders use `strokeWidth: 2` and no shape is thinner than
2px, because 1px light strokes disappear when Excalidraw fits a journey to
screen. The logo is an `image` element at least 24px tall whose `fileId`
resolves in the scene's `files` map, with `props.src` set to the sanctioned
URL. Free text must not overlap a Separator — an "or" divider is two
segments with a gap.

**Transitions** — arrows carry `customData.transition` with `from`/`to`
referencing real `journeyStep` values.

**`annotation: true`** marks reviewer notes outside the UI only. Screen
copy, titles, table content, headers and layout regions are components; an
annotation inside a frame is a contract violation because codegen drops it.

## `part: true`

A composite's glyph can carry shapes the library never gave an identity — the
AppHeader kit ships an Avatar whose initials text is stamped and whose circle
is not. Those would arrive unmapped, and "no customData at all" is an error no
spec can fix, because a spec cannot reach inside a glyph.

The composer stamps them with their parent and `part: true`. That is the truth
about them: they are that composite's anatomy. Codegen emits the parent and
skips its parts, the same way it skips bound text described by its container.

The composer reports each one. It is not a blocker, but it is worth passing to
`excalidraw-librarian` — an Avatar whose circle is unstamped is a capture bug,
and stamping it properly is better than having the composer infer it.

## Fixing a failure

Fix it **in the spec**, never by editing `journey.excalidraw` — the scene is
regenerated on every compose, so a hand edit is discarded and the developer
watches the problem come back.

If an error cannot be fixed from the spec, it is a composer or library defect.
Report it with the journey, the spec node and what you expected. Never edit
`scripts/` or `lib/` to get past it: those are shared, versioned tooling copied
in from the template, so a local patch is silently reverted on the next update
and the bug returns. That has already happened once, with Card placeholder text
that came back days later.
