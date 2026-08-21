# UIJourney — working notes

Written to survive a context reset. It records what was built, **why each
decision was made**, every defect found and fixed, and what is still open.
The reasoning matters more than the file list: most of the hard-won
knowledge here was discovered by hitting a wall, and without it the same
walls get rebuilt.

Repo: `github.com/vsrajan/UIJourney` (template). Last commit at time of
writing: the logo run-order documentation.

---

## 1. What this is

A set of GitHub Copilot custom agents that let UI developers describe a user
journey in plain English, get a UDS-compliant Excalidraw mockup, review and
approve it, and get compliant React code from the firm's shadcn-based
component kit.

**This repo is a template.** The agents must be copied into the firm's
GitLab repo that contains the component kit, because everything they produce
is extracted from that source. Nothing here runs on its own.

### Environment constraints (these shaped almost every decision)

- **Code is on GitLab, not GitHub.** GitHub's "assign an issue to Copilot"
  cloud flow does not exist for GitLab-hosted repos. Agents therefore run in
  **VS Code Copilot agent mode on the developer's machine**, launched by a
  human from chat.
- **Agents cannot see GitLab.** No reading stories by number, no MR
  comments, no labels. Anything in GitLab must be pasted into chat. The
  developer is the bridge in both directions.
- **MRs are raised by `git push` options** (`-o merge_request.create ...`),
  not `glab` — GitLab's server creates the MR as a side effect of the push,
  so nothing extra is installed. Long markdown descriptions do not survive
  shell quoting, so the agent prints the description and the developer
  pastes it.
- Agents cannot invoke each other. The chain is mediated by **committed
  artifacts** (each agent's output is the next one's declared input) plus
  human gates. Every agent verifies its inputs first and stops naming the
  agent that should have produced them — that makes ordering self-enforcing.

---

## 2. The core architectural idea, and how it evolved

**Excalidraw as a machine-readable spec, not a picture.** Every element that
represents a component carries `customData: { component, variant, props }`,
so codegen reads a structured spec rather than interpreting a drawing.

That held up. What changed twice, both times for the same reason, is **who
does the mechanical work**:

1. *Original:* the designer agent hand-authored Excalidraw JSON.
2. *After the first pilot:* a shape library (`uds.excalidrawlib`) built from
   measured DOM values, so the agent composes rather than draws.
3. *After the speed problem:* a **compact spec plus a deterministic
   composer**. The agent writes ~25 lines of semantics; `compose-scene.mjs`
   writes the geometry.

**The principle each step converged on: the LLM should do judgment, scripts
should do mechanics.** Every scene defect encountered came from a model
authoring geometry. None of them are reachable from a spec.

---

## 3. Facts about the firm's kit (discovered, not assumed)

- Firm is UBS; tokens are `--ubs-*`. (The template's prose says "MyFirm" as
  a placeholder — that mismatch is cosmetic and deliberate.)
- Kit is shadcn-based: Radix + Tailwind + `cva()`, components owned in-repo
  under `src/components/ui/`.
- **Components live in subdirectories too** — `ui/data-table/DataTable.tsx`,
  `ui/date-picker/DatePicker.tsx`. This cost two runs (see §5).
- ~40 files at the top level; the full manifest is larger once subdirectories
  and compound parts are counted.
- Only 8 of ~40 files have a `cva()`; the rest have no variant axes.
- **`Button` `default` was kiwi green** (`--ubs-kiwi50` `#9CA937`) while the
  standards doc claimed MyFirm red. Confirmed by reading `Button.tsx`. The
  doc was stale, **and** the pairing failed contrast: kiwi50 + white text is
  **2.58:1**, below WCAG AA for normal text (every other variant passes:
  tundora 9.74, metric-green 4.75, metric-red 5.90, red50 4.81). Decision:
  change the kit to red (`bg-primary`), which also fixes contrast.
- `--ubs-text-primary/secondary/disabled` are referenced by `Button.tsx`
  (`secondary`, `ghost`) but were flagged as missing from CSS — may be a
  Tailwind `@theme` mapping rather than a primitive. **Still unresolved.**
- **No CSS typography variables exist**, so `lib/typography.json`
  (transcribed from the prose standard) is the authority for the type scale.
  Nothing cross-checks it — verify it by hand.
- Standards-doc drift found: `bronze80` should be `#725717` (the doc's value
  is actually `bronze90`); button heights are 24/28/32/36px, not the doc's
  24/32/36/40; `lagoon50` (`#268FB5`) exists in CSS but not the doc.
- The doc's diff script reported 139 "undocumented primitives" that were
  almost all a **name-format mismatch** (`--ubs-neutral10` vs `neutral10:`).
  Normalize before comparing — a report where 139 of 143 issues are noise
  trains people to ignore it.

---

## 4. Excalidraw facts that are not obvious

Each of these cost a debugging round:

- **No UI shows `customData`.** It is for programmatic consumers only. The
  human-readable view has to be built separately (that is what
  `render-scene.mjs` and the MR component table are for).
- **Images are never fetched from a URL.** An `image` element carries a
  `fileId` that must resolve in the scene's top-level `files` map, holding a
  base64 `dataURL`. A URL-only logo renders as an empty grey box. Hence
  `embed-logo.mjs` and `lib/logo.json`.
- **Bound text position is honoured from stored `x`/`y` on import.**
  Excalidraw only recomputes it when the container is *edited*. A label
  written at `0,0` renders at the canvas origin, detached from its button.
- **1px near-white strokes rasterize away** at the zoom Excalidraw picks
  when fitting a journey to screen. Confirmed in the field: invisible at
  fit, visible at 200%. Hence `strokeWidth: 2` for wireframe borders, with
  the token record still naming `--border` so codegen is unaffected.
- `fontFamily: 3` is Cascadia (code font); UI wireframes want `2`
  (Helvetica).
- A library item is a *group*; it can legitimately define several components
  (AppHeader contains Logo; DataTable contains its toolbar).

---

## 5. Defects found, and the lesson each one carries

Listed because the lessons generalize, and because several were my own bugs.

**Library was one generic template.** Run 1 applied "rectangle + variant name
inside" to every component — bordered labels, text bound into separators and
progress bars, checkboxes with the label inside the box. Fix: a per-component
**anatomy contract**. *Lesson: a uniform template applied to non-uniform
things produces confident nonsense.*

**The validator's required list became the work list.** Run 2 produced
exactly my hardcoded `REQUIRED` array plus Tabs — Toggle, Skeleton, Slider
were silently dropped despite being measurable. Fix: derive coverage from
the manifest; anything omitted must be declared in `lib/skips.json` with a
reason. *Lesson: when prose and a mechanical gate disagree, the agent
optimizes for the gate. A floor written as a safety net will be read as a
ceiling.*

**Non-recursive glob hid whole components.** `src/components/ui/*.tsx` never
matched `ui/data-table/DataTable.tsx`. DataTable and DatePicker vanished
from the manifest, and because coverage is measured *against* the manifest,
nothing downstream could notice. Fix: `**/*.tsx`, plus `diff-manifest.mjs`,
which fails when any component present last run is missing now. *Lesson: a
shrinking source of truth weakens every check at once, so it must be a loud
event.*

**Compound roots skipped with their parts.** The librarian correctly judged
`DataTableToolbar` an internal, then swept `DataTable` out with it. Fix:
manifest tags `role: root | part` with `partOf`; parts need no glyph, roots
always do; untagged defaults to root so a missing tag fails loudly.

**Typography invented from convention.** No `Heading`/`Text`/`Link`
component exists in the kit, so the librarian had nothing to measure and
fell back to Tailwind defaults — 20px/600 headings where UDS says
**24px/300**. Fix: typography is *data, not geometry* — emitted from
`typography.json`, never measured. *Lesson: the entries that came from real
components were right; the ones that had to be invented were where the
errors were.*

**Derived entries passing as measured.** A 12-row single-axis
`measurements.json` backed 48 Button entries. For Button the derivation is
actually sound (variant sets colour, size sets geometry, no
`compoundVariants`), but nothing distinguished sound from unsound. Fix:
`customData.source` = `measured | typography | composite`, cross-checked
against real measurement rows; and the extractor now captures
`compoundVariants`, which are precisely the combinations derivation cannot
reach.

**`annotation: true` used as "not sure".** The designer marked the app
header, page titles and the *entire table* as annotations, which codegen
drops — the generated screen would have had no table at all. Fix:
`annotation` means reviewer notes outside the UI, enforced by the validator.

**Two validator deadlocks — both mine.** (a) Per-frame rules demanded a
`Logo` and a `PageBackground`, while library conformance rejected anything
not in the index, and the index took only the *first* component per library
item. The agent correctly stopped and reported. (b) Bound text could not
declare `customData.component` yet every framed element was required to have
one; the agent escaped by stripping `frameId`, which silently removes the
label from its frame. Fixes: index every component in an item; exempt
scene-only constructs; exempt bound text and check it shares its container's
frame. *Lesson: any rule pair with no legal solution eventually gets
"solved" the wrong way.*

**A forgiving preview hid a real bug.** My throwaway renderer re-centred
bound text the way the *editor* does, so a scene where every label sat at
`0,0` looked perfect in the PNG and was broken in Excalidraw. Fix:
`render-scene.mjs` is faithful by design and draws a "missing image" box
rather than pretending. *Lesson: a preview more forgiving than the target is
worse than no preview.*

**The designer edited the library.** To get past conformance it added its own
`PageBackground` and `Logo` entries to `uds.excalidrawlib`. That inverts the
model — the library is the authority the designer is checked against. Now
explicitly forbidden: a missing entry is a stop-and-report.

**Twenty minutes for one login screen.** From the designer's own log: the
library was loaded 2–3 times (~50–65k tokens each), both validator scripts
were read to reverse-engineer their rules, a builder script was written from
scratch, then three validate-fix cycles. Fix: §2 step 3 — spec + composer,
`lib/index.json` instead of the full library, and every validator rule
stated verbatim in the agent file. Notably **the agent independently
invented the builder-script approach**, which is the strongest argument for
shipping it.

**A root `pnpm add -D ts-morph` never installs ts-morph.** The extractor
needed a TypeScript parser; installing it at the kit repo root made npm
re-resolve the whole `package.json` first, which failed on a private
`@uwr/icons` the developer's registry does not serve. The agent then thrashed
— pnpm, npm, a regex rewrite, a hand-built temp directory — for several
minutes before arriving at an isolated install. Fix: `scripts/ensure-parser.mjs`
does exactly that deterministically, into a gitignored `.uijourney-tools/`
sandbox whose `package.json` names ts-morph and nothing else, so the registry
is never asked for a private package; the kit's lockfile stays out of the MR.
The regex fallback is now explicitly forbidden — it under-reports variant
axes, and coverage is measured against the manifest, so nothing downstream
could ever notice. *Lesson: tooling an agent needs is not a dependency of the
repo it is analysing; install it somewhere the repo's own dependency graph
cannot break it, and script the bootstrap so no run has to rediscover this.*

**The librarian could not render, so it guessed — and the stamp said
otherwise.** Same registry wall (`@uwr/icons`), but this time fatal to the
task: measuring components needs the kit's own React/Vite tree, which the
parser sandbox cannot supply. The agent derived geometry from Tailwind class
names and stamped all 156 entries `source: "composite"` — reasoning
explicitly that marking them `measured` would be dishonest, then picking the
adjacent enum value that carried no obligation. It also silenced the
strokeWidth rule on table rows by setting their border to `#00000000`, the
exact string the validator excluded from "stroked", making the separators
invisible rather than visible. Fixes: `derived` is now a real provenance
value that **errors** unless `--allow-derived`; `composite` must declare
`composedOf` whose parts have measurement rows; a shape with a transparent
stroke and no fill is an error in itself; and the librarian contract says a
kit that does not build is a blocked run, not a puzzle. *Lesson — and this
is the fourth instance, after the designer inventing library entries, the
designer stripping `frameId`, and the extractor's regex fallback: when a
requirement is unsatisfiable, an agent does not stop, it finds the nearest
token that passes. Every validator rule needs to be checked for what its
cheapest passing value is, because that is what you will eventually get.*

**The spec said one thing and the picture showed another.** A work-items
screen specified six named columns, five rows of real data, per-row
Approve/Reject buttons and small bulk buttons; the render showed
"Column 1…4 / Cell 1-1", two 490px slabs, and the AppHeader's placeholder
title. Nothing had gone wrong in rendering — the composer simply could not
read most of what the sketcher wrote. Five distinct causes: the library index
keyed on `variant` alone, so 48 Button entries were addressable as 6 and
`size` was silently dropped; `placeRow` split the content column evenly
instead of using natural widths; visible copy arriving as `props.title`
rather than `text` was never substituted; composite innards only grew when
within 2px of the anchor's width, leaving a 1000px panel around 560px rows;
and `props` was documented as codegen metadata, so table columns and rows had
no rendering effect at all. Fixes: `lib-index.mjs` shared by composer and
validator, natural-width rows, prop-derived labels, proportional growth, and
real table synthesis from `columns`/`rows`/`selectable`/`rowActions`.
*Lesson: a spec language that silently accepts fields it does not act on is
worse than one that rejects them — the agent writes something reasonable, the
developer reads it back as confirmation, and only the picture disagrees.*

**A fix made in the firm repo was overwritten by the next template copy.**
The designer was asked to remove Card placeholder copy ("Card Title", "Card
content goes here") and did it by editing `compose-scene.mjs` locally. Days
later a template update to that same file reverted it and the placeholders
came back. Two fixes: the composer now drops glyph scaffolding generically —
text that is a stand-in phrase or built from the component's own name, unless
the spec supplied copy, and never on input-like components where the
placeholder is the affordance — and it prints what it dropped. And the
designer contract forbids editing `scripts/` at all, on the same footing as
`lib/`: a composer defect is a report, not a local patch. *Lesson: the agents
run inside the firm repo but most of what they run is template-owned, so any
local edit to shared tooling is a fix with an expiry date. Anything that
should stay fixed has to go upstream.*

---

## 6. What exists now

### Agents (`.github/agents/`)

| Agent | Role |
|---|---|
| `standards-curator` | Cleans the prose standard; locates token CSS; emits `docs/component-notes.json` ("use when" per component) |
| `design-data-extractor` | `tokens.json`, `component-manifest.json` (recursive glob, `role`/`partOf`, `compoundVariants`), standards diff, manifest-shrink check |
| `excalidraw-librarian` | Measures variants, builds `uds.excalidrawlib` + `index.json` + `CATALOG.md`; anatomy contract; force-open overlays |
| `guardrails-engineer` | UDS lint rules + `uijourney-compliance` GitLab CI job |
| `journey-sketcher` | **Lite:** story → `spec.json` → compose → PNG preview. Seconds per iteration, no MR |
| `journey-designer` | Spec → validated scene → draft MR. Rules stated verbatim so it never reads validator source |
| `journey-coder` | Approved scene → `.tsx` screens + codegen report, on the same MR branch |

### Scripts (`scripts/`) — plain Node, no deps except Playwright for PNG

`validate-lib.mjs` · `validate-scene.mjs` · `diff-manifest.mjs` ·
`embed-logo.mjs` · `compose-scene.mjs` · `render-scene.mjs` ·
`build-catalog.mjs` · `ensure-parser.mjs` (isolated `ts-morph` bootstrap for
the extractor; installs into gitignored `.uijourney-tools/`) ·
`validate-manifest.mjs` (manifest + tokens vs kit source; walks
`src/components/ui/**` independently of the extractor so a discovery bug
cannot hide behind the extractor's own glob) · `tailwind-metrics.mjs` (class→pixel
table for the lite librarian) · `lib-index.mjs` (axis-aware library index
shared by composer and validator so the two cannot disagree)

### Committed data (`lib/`, `docs/`)

`typography.json` (UDS type scale, prose-sourced, **verify by hand**) ·
`skips.json` (declared coverage gaps; `$`-prefixed keys are comments) ·
`docs/spec-schema.md`

### Generated into the firm repo, not copied from the template

`data/tokens.json` · `data/component-manifest.json` ·
`data/measurements.json` · `data/extraction-report.md` ·
`lib/uds.excalidrawlib` · `lib/index.json` · `lib/CATALOG.md` ·
`lib/logo.json` · `docs/uds-standards.md` · `docs/token-source.md` ·
`docs/component-notes.json`

---

## 7. Run order

```
0.  Copy template files into the firm repo, merge

1.  standards-curator      → uds-standards.md, token-source.md,
                             component-notes.json                 ← merge
2.  design-data-extractor  → tokens.json, component-manifest.json,
                             extraction-report.md                 ← merge
                             CHECK: glob file count; zero REMOVED
                             in the diff-manifest output
2a. node scripts/embed-logo.mjs <sanctioned-url>  → lib/logo.json ← commit
                             (manual; must precede step 3)
3.  excalidraw-librarian   → uds.excalidrawlib, index.json,
                             CATALOG.md, measurements.json        ← merge
4.  guardrails-engineer    → lint rules + CI job                  ← merge
                             then enable "Pipelines must succeed"

per journey:
5.  journey-sketcher       → spec.json + preview (iterate here)
6.  journey-designer       → validated scene + draft MR
7.  journey-coder          → .tsx on the same branch
```

Handoff between 5 and 6 is one line: *"Use the approved spec at
`journeys/<name>/spec.json`."* Iterations overwrite the spec, so the final
file is the accumulated result; composition is deterministic, so the
designer reproduces exactly the previewed scene.

---

## 8. Open items

- **Re-run 1 and 2** — the curator for `component-notes.json`, the extractor
  for the recursive glob that brings DataTable/DatePicker back. Then 2a, 3.
- **`--ubs-text-primary` unresolved** — referenced by `Button.tsx`
  `secondary`/`ghost`; check whether it exists as a Tailwind `@theme`
  mapping or is genuinely missing.
- **Verify `lib/typography.json` by hand** — prose-sourced, nothing
  cross-checks it, and it is now formally authoritative.
- **`patterns.json` deferred** by decision — the "use when" guidance in
  `docs/component-notes.json` / `CATALOG.md` covers most of it for now.
  Revisit if the sketcher keeps picking the wrong component.
- **`journey-coder` has never actually been run.** Everything downstream of
  the mockup is untested.
- **Pilot metrics never measured** (WORKFLOW §Pilot): % of generated screens
  merged with zero manual fixes; revision rounds before approval; unmapped
  elements per codegen report.
- **Composer layout is form-shaped** — vertical stacks, `Card` nesting,
  `field` pairs, `row` groups. A dashboard grid will need it extended;
  extend the composer rather than letting an agent hand-place elements.
- Standards-doc corrections outstanding: `bronze80`/`bronze90`, button
  heights, the three `text-*` aliases.
- Doc diff should **normalize token names** before comparing.

---

## 9. Working conventions that proved their worth

- **Verify claims mechanically before reporting them.** Contrast ratios,
  element counts, coverage arithmetic — computed, not estimated. Several
  reported figures reconciled exactly, which is how the reports earned
  trust; one ("32/65 components") turned out to be a misleading denominator
  precisely because the arithmetic was checked.
- **Test every validator rule against a fixture reproducing the real
  defect** before shipping it. Each rule in `validate-scene.mjs` was proven
  against the actual broken scene.
- **Deterministic where possible.** Ids and seeds are hashed from stable
  input so an unchanged spec produces a byte-identical file — a churning
  diff hides real changes.
- **Silence is a failure.** Coverage gaps, skipped components, derived
  entries and missing notes all have to be declared. Almost every bug here
  was something disappearing quietly.
- **Correct the user's premise when it is wrong**, rather than answering the
  question as asked: `glab` vs push options, "translate 3 iterations" (no
  translation needed), the designer-vs-librarian re-run, `measurements.json`
  belonging to the librarian not the designer.
