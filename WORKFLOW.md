# UIJourney agent workflow

How the six custom Copilot agents in `.github/agents/` chain together.
Copilot agents cannot invoke each other, so the chain is mediated by two
things: **committed artifacts** (each agent's outputs are the next agent's
declared inputs) and **human gates** (PR review between phases, plus the
`journey-approved` label). Every agent begins by verifying its inputs exist
and are fresh — if not, it stops and names the agent that must run first,
which makes the ordering self-enforcing rather than relying on people
remembering it.

## Where these files go

This repo is the template. Copy `.github/copilot-instructions.md`,
`.github/agents/`, and this file into the firm repo that contains the
component kit (`src/components/ui/*.tsx`) — the agents must run where the
kit source lives, since everything is extracted from it. Copilot picks up
custom agents from `.github/agents/*.md` automatically; select an agent when
assigning an issue to Copilot (or via `@agent-name` in Copilot Chat /
`copilot --agent <name>` in the CLI, availability depending on the firm's
Copilot plan and policy settings).

## Setup chain — run once, in order

| # | Agent | Consumes | Produces | Gate |
|---|-------|----------|----------|------|
| 1 | `standards-curator` | raw UDS standards markdown, kit CSS | `docs/uds-standards.md`, `docs/token-source.md` | PR review: verify no rule lost in cleanup |
| 2 | `design-data-extractor` | `docs/token-source.md`, `src/components/ui/*.tsx` | `scripts/extract-*.mjs`, `data/tokens.json`, `data/component-manifest.json`, `data/extraction-report.md`, CI freshness job | PR review: check extraction report coverage + standards diff |
| 3 | `excalidraw-librarian` | `data/*.json`, Storybook or a render harness | `data/variant-styles.json`, `lib/uds.excalidrawlib`, `lib/README.md` | PR review: spot-check library shapes in Excalidraw |
| 4 | `guardrails-engineer` | `data/tokens.json`, `docs/uds-standards.md` | UDS lint rules, `uijourney-compliance` CI job (required check), `docs/compliance.md` | PR review + make the check required in branch protection |

Run each by opening an issue (e.g. "Run Phase 1 extraction"), assigning it to
Copilot, and selecting the agent. Merge each PR before starting the next
agent — the freshness checks in CI depend on the previous phase's files
being on the default branch.

**Re-runs:** the CI job from phase 2/3 fails whenever `src/components/ui/**`
or the token CSS changes without regenerated `data/` + `lib/` files. When it
fires, re-run `design-data-extractor` then `excalidraw-librarian` (or just
run `npm run uijourney:extract && npm run uijourney:library` locally and
commit). Re-run `standards-curator` only when the prose standard itself
changes.

## Journey loop — recurring, per user journey

```
developer writes plain-text journey in an issue
        │  assign to Copilot → agent: journey-designer
        ▼
PR with journeys/<name>/journey.excalidraw          ←──┐
        │                                              │ revision comments:
        ▼                                              │ designer updates the
developer opens the file in Excalidraw, nudges,  ──────┘ same file/PR
then applies the `journey-approved` label
        │  assign follow-up task → agent: journey-coder
        ▼
same PR gains src/screens/<name>/*.tsx + codegen-report.md
        │  `uijourney-compliance` CI must pass (lint + typecheck)
        ▼
normal code review → merge
```

Two rules keep the loop honest:

- **The scene is the spec.** `journey-coder` reads only the file's
  `customData` — including any hand-edits the developer made after approval.
  If the developer changes the scene while the PR is open, the coder
  regenerates; the diagram and code merge together, in one PR, always
  consistent.
- **Approval is a label, not a vibe.** `journey-coder` refuses to run
  without `journey-approved` on the PR. Optionally add a tiny workflow that
  auto-assigns the coder task when the label is applied; until then, a human
  assigns it manually after labeling.

## Pilot (Phase 5)

Run one real journey end-to-end and record three numbers before scaling:
1. % of generated screens merged with zero manual code fixes.
2. Whether the developer approved the mockup without redrawing (count
   revision rounds).
3. Unmapped-element count in `codegen-report.md` — each one is either a
   library gap (feed back to `excalidraw-librarian`) or a designer-agent
   prompt gap.

Expand to more component coverage and longer multi-screen journeys only
when those numbers hold up.
