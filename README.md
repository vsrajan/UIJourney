# UIJourney

UIJourney is a set of GitHub Copilot custom agents that let UI developers:

1. Describe a user journey in plain English ("a claims screen, then a review
   screen, then a confirmation").
2. Get back an **Excalidraw mockup** that follows the firm's UI standard
   (UDS), built only from approved component shapes.
3. Review and tweak the mockup by hand, approve it,
4. and get back **working React code** for those screens, built only from the
   firm's shadcn-based component kit, that passes the compliance checks.

This repository is the **template**. The agents themselves must run inside
the firm repo that contains the component kit (the repo with
`src/components/ui/*.tsx`), because everything they produce is extracted
from that source code. Installation is covered below.

---

## Before anything else: how you actually "give input" to a Copilot agent

This is the part that confuses everyone the first time, so read it once and
the rest of this document will make sense.

A Copilot custom agent is just a markdown instruction file in
`.github/agents/`. You do not run it from a command line and it has no
input form to fill in. There are exactly **three ways** an agent receives
input, and every input listed in this README is one of these three kinds:

**Kind A — Files already in the repo at a known path.**
The agent instructions tell it to read, for example,
`data/tokens.json`. You "provide" this input simply by making sure that
file exists at that path on the default branch *before* you start the
agent. If a Kind A input is missing, our agents are written to stop and
tell you which earlier agent should have produced it — that is how the
chain enforces its own ordering. You never paste file contents anywhere for
a Kind A input.

**Kind B — Text you type into the GitHub issue that you assign to Copilot.**
To start any agent, you create a GitHub issue, write the input into the
issue body, and assign the issue to Copilot, choosing the agent by name.
Everything in the issue title and body becomes the agent's task input.
This is how you pass one-off content: the raw standards document, a journey
description, a special instruction.

Step-by-step (identical for every agent in this document):

1. In the firm repo on github.com, go to **Issues → New issue**.
2. Set the **title** and **body** as shown in that agent's "Example issue"
   section below.
3. In the right-hand sidebar, under **Assignees**, assign the issue to
   **Copilot**.
4. When prompted for which agent to use, pick the agent name (for example
   `standards-curator`). If your Copilot setup does not show an agent
   picker, add a first line to the issue body instead:
   `Use the agent defined in .github/agents/standards-curator.md and follow it exactly.`
5. Copilot starts working and will open a **pull request** when done. All
   agent output arrives as a PR — nothing is ever pushed straight to main.

**Kind C — A label on a pull request.**
Used once in this workflow: applying the label `journey-approved` to a
mockup PR is the signal that unlocks the code-generation agent. You add a
label from the **Labels** section of the PR's right-hand sidebar. (Create
the label once under **Issues → Labels → New label** if it doesn't exist.)

That's the whole input model: **files at paths, issue text, one label.**
Each agent section below lists its inputs tagged `[A]`, `[B]`, or `[C]` so
you always know the mechanism.

---

## One-time installation (before running any agent)

Do this once, in the firm repo that contains `src/components/ui/*.tsx`:

1. Copy these from this template repo into the firm repo, keeping paths:
   - `.github/copilot-instructions.md`
   - `.github/agents/` (all six files)
   - `WORKFLOW.md` and this `README.md`
   Commit them to the default branch (via a normal PR if the repo requires
   one).
2. Confirm **Copilot coding agent** is enabled for the repo (repo
   **Settings → Copilot**, or ask whoever administers Copilot at the firm).
   You need to be able to assign an issue to Copilot.
3. Create the label `journey-approved` (**Issues → Labels → New label**,
   any color).
4. Have the raw UDS standards markdown file at hand — you will paste or
   attach it in the very first issue.

---

## The workflow at a glance

Two chains. Setup runs once; the journey loop runs for every journey.

```
SETUP (once, strictly in this order, merge each PR before the next):

  standards-curator  →  design-data-extractor  →  excalidraw-librarian  →  guardrails-engineer
  (clean the docs)      (extract tokens +          (build the approved      (build the lint +
                         component manifest)        Excalidraw shapes)       CI compliance gate)

JOURNEY LOOP (repeat per user journey):

  issue with journey text ──▶ journey-designer ──▶ mockup PR
       ▲                                              │
       │            developer opens the .excalidraw   │
       └── revision comments ◀── file, reviews it ◀───┘
                                      │
                          adds label `journey-approved`
                                      │
                          new issue ──▶ journey-coder ──▶ code on the same PR
                                      │
                          CI compliance check passes → normal review → merge
```

Agents cannot call each other. The chain works because each agent's
**outputs are committed files**, and the next agent **checks those files
exist before doing anything**. If you run them out of order, the agent
tells you what's missing and which agent produces it.

---

## Setup agent 1: `standards-curator`

**What it does:** turns your raw, possibly messy UDS standards markdown into
a clean canonical document (`docs/uds-standards.md`), and finds where in the
codebase the design tokens (`--MyFirm-*` CSS variables) are actually
defined, recording that in `docs/token-source.md`.

**Inputs and how to provide each one:**

| Input | Kind | How to provide it — exactly |
|---|---|---|
| The raw UDS standards markdown | **[B]** | Paste the full markdown text into the issue body, underneath the request line. If it is too long to paste comfortably, commit it to the repo first as `docs/raw/uds-standards-raw.md` (any path works) and write in the issue body: "The raw standards doc is at `docs/raw/uds-standards-raw.md`." Either way works; committing it is better for very large docs because nothing gets truncated. |
| The component kit source (`src/components/ui/*.tsx`) and global CSS / Tailwind theme files | **[A]** | You provide nothing. These are the firm repo's own source files, and because the agent runs *inside* that repo, it can already read every file in it. This is precisely why the agent files must be installed in the kit repo and not somewhere else. If your kit lives at a different path than `src/components/ui/`, say so in the issue body: "Our components are under `packages/ui/src/`." |

**Example issue:**

> **Title:** UIJourney setup 1: curate the UDS standards doc
>
> **Body:**
> Run as the `standards-curator` agent.
>
> Below is our raw UDS standards markdown. Clean it into
> `docs/uds-standards.md` and locate our token source per your
> instructions.
>
> \<paste the entire raw standards markdown here\>

**What you get back:** a PR. Before merging, read the PR description — the
agent lists every edit it made (duplicates removed, sections moved). Check
that no rule you care about was lost, and that `docs/token-source.md` names
a real CSS file. **Merge the PR before starting agent 2.**

---

## Setup agent 2: `design-data-extractor`

**What it does:** writes and runs scripts that read the kit's real source
code and produce two machine-readable files every later agent depends on:
`data/tokens.json` (every color/token, resolved to actual values) and
`data/component-manifest.json` (every component, its variants, its props).
It also diffs these against the prose standard and reports mismatches.

**Inputs and how to provide each one:**

| Input | Kind | How to provide it — exactly |
|---|---|---|
| `docs/token-source.md` | **[A]** | Produced by agent 1. You provide it by having merged agent 1's PR. Nothing to paste. |
| `src/components/ui/*.tsx` | **[A]** | The repo's own source; nothing to provide. |
| Standards appendix tables (diff baseline) | **[A]** | Inside `docs/uds-standards.md` from agent 1's merged PR. Nothing to provide. |

**Example issue:**

> **Title:** UIJourney setup 2: extract tokens and component manifest
>
> **Body:**
> Run as the `design-data-extractor` agent. All inputs are in the repo
> (Phase 0 is merged). Follow your instructions.

**What you get back:** a PR with the scripts, the two `data/*.json` files,
`data/extraction-report.md`, and a CI job that keeps the data fresh. Before
merging, open `data/extraction-report.md` in the PR's "Files changed" tab
and check two things: every component file is listed as parsed (or has an
explanation), and read the mismatch list — each mismatch is a place where
your prose doc and your code disagree, and the code is right. **Merge
before agent 3.**

---

## Setup agent 3: `excalidraw-librarian`

**What it does:** renders every component variant in a real browser, measures
the actual computed styles from the DOM, and generates
`lib/uds.excalidrawlib` — the approved shape library. One shape per
component variant, correctly sized and colored, each tagged with metadata
(`customData`) naming the component/variant/props it represents. All
mockups are later composed only from these shapes.

**Inputs and how to provide each one:**

| Input | Kind | How to provide it — exactly |
|---|---|---|
| `data/tokens.json`, `data/component-manifest.json` | **[A]** | Produced by agent 2; provided by having merged its PR. |
| A way to render components (Storybook, or a harness the agent builds) | **[A]** | Nothing to provide if the repo has Storybook — the agent detects it. If you know the repo has no Storybook, you can save the agent a search by saying so in the issue body: "No Storybook in this repo; build the Vite harness." Optional. |

**Example issue:**

> **Title:** UIJourney setup 3: build the UDS Excalidraw shape library
>
> **Body:**
> Run as the `excalidraw-librarian` agent. Phases 0–1 are merged. Follow
> your instructions.

**What you get back:** a PR containing `lib/uds.excalidrawlib` plus the
measure/build scripts. To review it, download `lib/uds.excalidrawlib` from
the PR, open excalidraw.com, open the **library panel** (the book icon), and
import the file — you should see one named shape per component variant, in
the firm's real colors and sizes. Spot-check a few against the live product.
**Merge before agent 4.**

---

## Setup agent 4: `guardrails-engineer`

**What it does:** builds the enforcement layer — lint rules that make
non-compliant code fail the build (no raw hex colors, no hand-drawn brand
logo, no hand-rolled buttons where a kit component exists, no invented
variants) and a required CI check (`uijourney-compliance`). After this, a
generated PR *cannot merge* unless it complies; you no longer rely on the
model behaving.

**Inputs and how to provide each one:**

| Input | Kind | How to provide it — exactly |
|---|---|---|
| `data/tokens.json` | **[A]** | From agent 2's merged PR. Nothing to provide. |
| `docs/uds-standards.md` (the hard rules) | **[A]** | From agent 1's merged PR. Nothing to provide. |
| Existing ESLint/CI config | **[A]** | The repo's own config files; nothing to provide. |

**Example issue:**

> **Title:** UIJourney setup 4: build the compliance guardrails
>
> **Body:**
> Run as the `guardrails-engineer` agent. Phases 0–2 are merged. Follow
> your instructions.

**What you get back:** a PR with the rules, their tests, `docs/compliance.md`,
and the CI job. After merging, do one manual step the agent cannot do:
in repo **Settings → Branches → branch protection rule** for the default
branch, add `uijourney-compliance` to the **required status checks**. That's
what makes the gate mandatory.

**Setup is now complete.** Everything from here on is the recurring loop.

---

## Journey agent 5: `journey-designer` — run for every new journey

**What it does:** turns your plain-English journey description into
`journeys/<name>/journey.excalidraw` — one Excalidraw frame per screen,
composed only from library shapes, with arrows describing the transitions —
and opens it as a PR.

**Inputs and how to provide each one:**

| Input | Kind | How to provide it — exactly |
|---|---|---|
| The journey description | **[B]** | Write it in the issue body, in plain English. Be concrete about: the screens you expect, what the user does on each, and what moves them to the next screen. You do not need design vocabulary — "a page where they enter the claim amount and hit submit" is exactly right. The more you specify, the fewer clarifying questions come back. |
| `lib/uds.excalidrawlib`, `data/component-manifest.json` | **[A]** | From the merged setup PRs. Nothing to provide. |

**Example issue:**

> **Title:** Journey mockup: submit an expense claim
>
> **Body:**
> Run as the `journey-designer` agent.
>
> Journey: an employee submits an expense claim.
> 1. **Claim entry screen** — amount, category (dropdown), date, receipt
>    upload, notes. Primary button "Submit claim"; secondary "Save draft".
> 2. **Review screen** — read-only summary of what they entered, with
>    "Confirm" (primary) and "Back to edit" (secondary).
> 3. **Confirmation screen** — success message with the claim reference
>    number and a "View my claims" link.
>
> Transitions: Submit claim → Review; Confirm → Confirmation;
> Back to edit → Claim entry.

**What you get back:** a PR with the `.excalidraw` file. To review it:
open the PR's "Files changed" tab, download the file, and open it at
excalidraw.com (**Open** in the menu) or in VS Code with the Excalidraw
extension. You can move things, edit labels, delete elements — hand edits
are expected and survive into the code step. To request bigger changes,
comment on the PR ("split screen 1 into two steps") and the agent revises
the same file.

**When you're satisfied:** add the **`journey-approved`** label to the PR
(**[C]** — right-hand sidebar → Labels). Do not merge yet.

---

## Journey agent 6: `journey-coder` — run after approval

**What it does:** reads the approved `.excalidraw` file's embedded metadata
(including your hand edits), and generates the React screens under
`src/screens/<journey-name>/`, using only kit components, plus a
`codegen-report.md` accounting for every element it mapped or skipped. It
pushes to the **same PR** so mockup and code are reviewed and merged
together. It refuses to run if the `journey-approved` label is missing.

**Inputs and how to provide each one:**

| Input | Kind | How to provide it — exactly |
|---|---|---|
| The approved mockup PR | **[B]** | In the new issue body, paste the PR number or URL: "Generate code for the approved mockup in PR #42." That reference is the whole input — the agent finds the file from the PR. |
| The `journey-approved` label on that PR | **[C]** | You added it at the end of the previous step. If you forgot, the agent stops and tells you. |
| `data/*.json`, the compliance lint | **[A]** | From setup. Nothing to provide. |

**Example issue:**

> **Title:** Generate code: submit an expense claim
>
> **Body:**
> Run as the `journey-coder` agent. The approved mockup is PR #42.

**What you get back:** commits on the mockup PR adding the screens and the
codegen report, and a single comment summarizing what was generated, what
(if anything) could not be mapped, and confirming lint + typecheck pass.
Review it like any code PR. The `uijourney-compliance` check must be green
before merge — if it isn't, the agent is expected to fix it, not you.

If you edit the mockup again while the PR is open, tell the coder in a PR
comment ("scene updated, please regenerate") — the diagram remains the
source of truth until the PR merges.

---

## When the component kit changes later

The CI freshness job from setup fails whenever someone changes
`src/components/ui/` or the token CSS without regenerating the derived
files. When that happens, either run locally:

```
npm run uijourney:extract && npm run uijourney:library
```

and commit the result, or open an issue for `design-data-extractor` and then
`excalidraw-librarian` to do the same. Re-run `standards-curator` only when
the prose standard itself is rewritten.

## Troubleshooting

- **The agent says an input file is missing.** You skipped a setup phase or
  didn't merge its PR. The message names the file; the tables above name
  which agent produces it. Run that agent first.
- **There's no agent picker when assigning to Copilot.** Your Copilot plan
  or firm policy may not expose custom agent selection. Fallback: put
  `Use the agent defined in .github/agents/<name>.md and follow it exactly.`
  as the first line of the issue body — the instructions still govern the
  run.
- **`journey-coder` refuses to run.** Check the mockup PR has the
  `journey-approved` label — that refusal is deliberate.
- **The compliance check fails on a generated PR.** Comment on the PR asking
  the coder agent to fix its lint failures; do not hand-patch or disable
  rules. If a *rule* is wrong, that's an issue for `guardrails-engineer`.
