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
| 2 | `design-data-extractor` | `docs/token-source.md`, `src/components/ui/*.tsx` | `scripts/extract-*.mjs`, `data/tokens.json`, `data/component-manifest.json`, `data/extraction-report.md`, GitLab CI freshness job | `node scripts/validate-manifest.mjs` exits zero; MR review: check extraction report coverage + standards diff |
| 2a | **(manual, not an agent)** `node scripts/embed-logo.mjs <sanctioned-logo-url>` | the logo URL from `docs/uds-standards.md` | `lib/logo.json` | commit it; check the reported dimensions match the real mark |
| 3 | `excalidraw-librarian` | `data/*.json`, Storybook or a render harness | `data/measurements.json`, `lib/uds.excalidrawlib`, `lib/index.json`, `lib/CATALOG.md` | MR review: spot-check library shapes in Excalidraw |
| 3-lite | `excalidraw-librarian-lite` *(only when the kit will not build)* | `data/*.json`, `scripts/tailwind-metrics.mjs` | same files, every entry stamped `derived`; **no** `data/measurements.json` | `validate-lib.mjs --allow-derived` clean; MR marked provisional |
| 4 | `guardrails-engineer` | `data/tokens.json`, `docs/uds-standards.md` | UDS lint rules, `uijourney-compliance` job in `.gitlab-ci.yml`, `docs/compliance.md` | MR review + maintainer enables **Settings → Merge requests → "Pipelines must succeed"** |

Merge each MR before launching the next agent — the CI freshness checks
depend on the previous phase's files being on the default branch.

**Step 2a must precede step 3.** The librarian embeds the logo into the
AppHeader composite at build time, so `lib/logo.json` has to exist first.
Excalidraw renders images only from a scene's `files` map and never fetches
a remote `src`, which is why the asset is committed as a base64 data URL
rather than referenced. Run it from inside the firm network, or download the
PNG and pass its local path. Re-run it only when the brand mark changes.

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
spec.json → composed AND validated scene → PNG preview, in seconds
        │                                          ▲
        │  iterate on the SPEC, never the scene ───┘  revisions in chat
        │  when the shape is right, the sketcher commits locally
        ▼
developer looks at the PNG. Launching the coder IS the approval —
there is no label and no gate.
        │  VS Code chat → agent: journey-coder → names the journey
        ▼
src/screens/<name>/*.tsx + preview.html + codegen-report.md,
lint and typecheck green, committed on the same local branch
        ▼
developer branches, reviews and merges BY HAND
```

Neither journey agent branches, pushes, or opens a merge request. That is
deliberate: a mockup iteration is a conversation, not a change request, and
the delivery ceremony cost more than the review was worth. The setup agents
still deliver by MR — they change shared artifacts and do need review.

### The provisional track

When the kit cannot be installed, step 3-lite substitutes a **derived**
library: heights, padding, radii and every colour are exact — those come
from class strings and `data/tokens.json`, neither of which needs a browser
— while widths of content-sized components are estimates.

Provenance travels with the artifact. `compose-scene.mjs` stamps any scene
built from derived entries `customData.provisional: true`;
`validate-scene.mjs` refuses it without `--allow-derived`; `journey-coder`
refuses it outright. So the sketcher/designer loop runs normally and codegen
stays closed until the library is real.

Because both librarians write the same filenames, fixing the environment and
re-running `excalidraw-librarian` overwrites the derived library in place.
Recompose the same `spec.json` and the mockup upgrades to measured geometry
with no redesign — which is why it is worth designing against a provisional
library rather than waiting.

Three rules keep the loop honest:

- **The scene is the spec.** `journey-coder` reads only the file's
  `customData`. But the scene is regenerated from `spec.json` on every
  compose, so a hand-edit to the `.excalidraw` is discarded the next time
  anyone runs the sketcher — revisions belong in the spec. If the scene does
  change, ask the coder to regenerate.
- **Approval is the developer's launch decision.** There is no machine gate:
  the developer launching `journey-coder` is trusted to have reviewed the
  mockup, and no agent looks for any other signal. A written record of review
  is a human convention to run alongside if the team wants one.
- **Nothing in GitLab reaches an agent.** Story text, review comments, labels
  — all of it must be pasted into the VS Code chat by the developer. Budget
  for this: the developer is the bridge in every revision round.

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
