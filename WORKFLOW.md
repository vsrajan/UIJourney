# UIJourney agent workflow

How the seven custom Copilot agents in `.github/agents/` chain together in
the firm's environment: code hosted on **GitLab**, agents run in **VS Code
Copilot agent mode** on the developer's machine, output delivered as
**GitLab merge requests** raised by the agent via git push options.

Agents cannot invoke each other, and on GitLab there is no "assign an issue
to Copilot" — a human launches every run from VS Code chat. The chain is
therefore mediated by three things: **committed artifacts** (each agent's
outputs are the next agent's declared inputs), **human gates** (MR review
between phases; the developer's decision to launch `journey-coder` is
itself the mockup approval), and **GitLab CI** (freshness and compliance
jobs in `.gitlab-ci.yml`). Every agent begins by verifying its inputs exist
and are fresh — if not, it stops and names the agent that must run first,
which makes the ordering self-enforcing.

## Where these files go

This repo is the template. Copy `.github/copilot-instructions.md`,
`.github/agents/`, this file, and `README.md` into the firm's GitLab repo
that contains the component kit (`src/components/ui/*.tsx`) — the agents
must run where the kit source lives. The `.github/` directory name is kept
even on GitLab because that is where the VS Code Copilot extension looks
for `copilot-instructions.md` and custom agents; it has nothing to do with
where the repo is hosted.

## How a run starts (same for every agent)

1. Developer opens the firm repo clone in VS Code, with the GitHub Copilot
   extension signed in and **agent mode** available in the chat panel.
2. Developer selects the custom agent in the chat's agent picker (they load
   from `.github/agents/`). If the picker doesn't offer them, fallback:
   attach the agent file to the chat and start the prompt with "Follow the
   attached agent instructions exactly."
3. Developer pastes the task input (for journeys: the GitLab story text)
   and sends.
4. The agent verifies a clean tree, branches, works, commits, and raises a
   draft MR by pushing with GitLab push options
   (`-o merge_request.create ...`). The developer pastes the prepared MR
   description, reviews the diff, and marks the MR ready.

## Setup chain — run once, in order

| # | Agent | Consumes | Produces | Gate |
|---|-------|----------|----------|------|
| 1 | `standards-curator` | raw UDS standards markdown (committed file or pasted), kit CSS | `docs/uds-standards.md`, `docs/token-source.md`, `docs/component-notes.json` | MR review: verify no rule lost in cleanup |
| 2 | `design-data-extractor` | `docs/token-source.md`, `src/components/ui/*.tsx` | `scripts/extract-*.mjs`, `data/tokens.json`, `data/component-manifest.json`, `data/extraction-report.md`, GitLab CI freshness job | MR review: check extraction report coverage + standards diff |
| 3 | `excalidraw-librarian` | `data/*.json`, Storybook or a render harness | `data/measurements.json`, `lib/uds.excalidrawlib`, `lib/index.json`, `lib/CATALOG.md` | MR review: spot-check library shapes in Excalidraw |
| 4 | `guardrails-engineer` | `data/tokens.json`, `docs/uds-standards.md` | UDS lint rules, `uijourney-compliance` job in `.gitlab-ci.yml`, `docs/compliance.md` | MR review + maintainer enables **Settings → Merge requests → "Pipelines must succeed"** |

Merge each MR before launching the next agent — the CI freshness checks
depend on the previous phase's files being on the default branch.

**Re-runs:** the CI job from phase 2/3 fails whenever `src/components/ui/**`
or the token CSS changes without regenerated `data/` + `lib/` files. When it
fires, run `npm run uijourney:extract && npm run uijourney:library` locally
and commit (or launch `design-data-extractor` then `excalidraw-librarian`
again). Re-run `standards-curator` only when the prose standard itself
changes.

## Journey loop — recurring, per user journey

```
developer copies the GitLab story text
        │  VS Code chat → agent: journey-sketcher → paste story
        ▼
spec.json + PNG preview in seconds  ──▶ iterate on the spec, not the scene
        │  when the shape is right:
        │  VS Code chat → agent: journey-designer → "use the approved spec"
        ▼
draft MR with journeys/<name>/journey.excalidraw    ←──┐
        │                                              │ revision requests in
        ▼                                              │ chat: designer updates
developer opens the file in Excalidraw, nudges,  ──────┘ the same branch
adds the `journey-approved` label to the MR (team
convention), and — this IS the approval —
        │  VS Code chat → agent: journey-coder → names the journey/branch
        ▼
same MR branch gains src/screens/<name>/*.tsx + codegen-report.md
        │  `uijourney-compliance` job must pass on the MR pipeline
        ▼
normal MR review → merge
```

Three rules keep the loop honest:

- **The scene is the spec.** `journey-coder` reads only the file's
  `customData` — including any hand-edits the developer made after the
  designer last wrote it. If the developer changes the scene while the MR
  is open, they ask the coder to regenerate; the diagram and code merge
  together, in one MR, always consistent.
- **Approval is the developer's launch decision.** There is no machine gate
  between designer and coder: the developer launching `journey-coder` is
  trusted to have reviewed the mockup. The `journey-approved` label on the
  MR records that decision for teammates and auditors; agents neither set
  nor check it.
- **MR comments don't reach agents.** Review feedback on the MR must be
  relayed by the developer into the VS Code chat session — agents cannot
  read GitLab. Budget for this: the developer is the bridge in every
  revision round.

## Pilot (Phase 5)

Run one real journey end-to-end and record three numbers before scaling:
1. % of generated screens merged with zero manual code fixes.
2. Whether the developer approved the mockup without redrawing (count
   revision rounds).
3. Unmapped-element count in `codegen-report.md` — each one is either a
   library gap (feed back to `excalidraw-librarian`) or a designer-agent
   prompt gap.

Expand to more component coverage and longer multi-screen journeys only
when those numbers hold up. If the manual relay of MR feedback becomes the
pilot's bottleneck, that is the signal to invest in the GitLab CI bridge
(running Copilot CLI in a pipeline triggered from stories) — see the
"Option 2" discussion in the project history.
