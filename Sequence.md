# UIJourney — Implementation Sequence

A GitHub Copilot agent that lets UI developers model user journeys in Excalidraw
from plain-text prompts, grounded in the firm's UI standards, and — once a
developer approves the mockup — generates compliant React/shadcn code.

This document is the build sequence: five phases, in dependency order. Phases
1–3 are deterministic tooling with no LLM involved; the agent only enters at
Phase 4, once the data it needs already exists and has been validated.

## Phase 0 — Clean up the inputs

1. **Fix the standards doc.** Remove duplicated sections (e.g. the Logo
   section appearing twice) and any broken structure (an orphaned numbered
   list item separated from its list by an unrelated section). This becomes
   the *narrative* half of the standard — brand personality, hard rules like
   the logo requirement, do/don't guidance — and stays as prose fed to the
   agent as context.
2. **Find the real token source.** Locate the actual CSS file where
   `--MyFirm-*` primitives and semantic aliases (`--primary`, `--background`,
   etc.) are defined — a `globals.css` or Tailwind v4 `@theme` block. This
   file, not the markdown doc, is the ground truth from here on.

## Phase 1 — Extract machine-readable data from `src/components/ui/*.tsx`

3. **Token extractor script** (Node — the repo already requires Node to build
   the React app, so this isn't a new dependency): walks the CSS
   custom-properties file, outputs `tokens.json` — every primitive, every
   semantic alias resolved to a hex, for both light and `.dark` themes.
4. **Diff `tokens.json` against the markdown doc**, programmatically, so any
   value the doc claims but the code doesn't define (or vice versa) is
   caught automatically rather than discovered by accident.
5. **Component manifest extractor**: walk `src/components/ui/*.tsx` with the
   TypeScript compiler API (or `ts-morph`), pull each `cva()` call's variant
   names/values and each component's prop types. Output
   `component-manifest.json` — one entry per component, with its literal
   prop keys, not a hand-summarized description.
6. **Sanity check**: flag any exported component the parser didn't manage to
   extract variants for, so nothing silently falls out of the manifest.

## Phase 2 — Generate the `.excalidrawlib`

7. **Render harness**: reuse Storybook if the repo has it — it already
   enumerates every variant as a story. Otherwise, a small Vite page
   rendering one variant per route is enough.
8. **Playwright script** renders each `component-manifest.json` entry in the
   harness and reads back the *computed* styles (resolved background/border/
   radius/font values) from the real DOM — not values re-typed by hand.
9. **Generate the `.excalidrawlib`** from that: one vector shape (rectangle +
   text) per variant, each stamped with
   `customData: { component, variant, props }`.
10. **Commit `tokens.json`, `component-manifest.json`, and the
    `.excalidrawlib`** into the repo, regenerated in CI whenever
    `src/components/ui/*.tsx` or the token CSS changes. These artifacts are
    always regenerated, never hand-maintained twice.

## Phase 3 — Guardrails, built before any generated code is trusted

11. **Lint rules**: forbid raw hex colors, forbid a raw `<svg>` or plain-text
    brand name outside the sanctioned `<img>` tag, forbid importing
    non-kit primitives where a kit component exists.
12. **Prop validity**: run generated `.tsx` through the existing `tsc`
    type-check — since the kit components are already typed, this catches
    most "invented a prop that doesn't exist" failures for free.
13. Wire both into the repo's existing CI so a generated PR can't merge
    without passing them.

## Phase 4 — The Copilot agent

14. **Author `.github/copilot-instructions.md`**: the brand-personality/
    do-not-do narrative from Phase 0, the hard rule "compose only from the
    committed `.excalidrawlib`, never freehand-draw a shape," and pointers to
    `tokens.json` / `component-manifest.json` as the authoritative data.
15. **Journey → mockup task**: agent takes a plain-text journey description,
    writes/updates a `.excalidraw` scene using only library-sourced shapes
    with `customData` stamped per element, opens a PR.
16. **Human review loop**: developer opens the file (VS Code Excalidraw
    extension or excalidraw.com), can nudge layout since every shape is a
    real library reference, approves via a PR label or review.
17. **Mockup → code task**: on approval, agent re-reads the (possibly
    hand-edited) file's `customData`, maps each element to its real
    `src/components/ui` import and prop values, emits the screen as `.tsx`,
    pushes to the same PR — iterating against Phase 3's lint/typecheck
    failures itself.
18. Only build an MCP server exposing the manifest/tokens to *multiple*
    repos once a second repo actually needs this. For one repo, committed
    JSON files the agent reads directly from context are simpler.

## Phase 5 — Pilot

19. Run one real (non-trivial) journey through all of the above, orchestrating
    each phase manually first.
20. Measure: % of generated code merged with zero manual fixes, whether
    developers approve the Excalidraw layout without redrawing it, and how
    much of the Phase 0 markdown doc turned out to be unnecessary once
    `tokens.json` / `component-manifest.json` existed.
21. Expand component coverage and multi-screen journeys (frames + arrows
    carrying a `journeyStep` in `customData`) only after the pilot numbers
    look good.
