# UIJourney

UIJourney is a set of GitHub Copilot custom agents that let UI developers:

1. Describe a user journey in plain English ("a claims screen, then a review
   screen, then a confirmation").
2. Get back an **Excalidraw mockup** that follows the firm's UI standard
   (UDS), built only from approved component shapes.
3. Review and tweak the mockup by hand, approve it,
4. and get back **working React code** for those screens, built only from the
   firm's shadcn-based component kit, that passes the compliance checks.

**Our environment:** the firm's code is hosted on **GitLab**, so the agents
run in **VS Code Copilot agent mode on your own machine**, against your
local clone. (GitHub's cloud flow of "assign an issue to Copilot on
github.com" does not exist for GitLab-hosted repos — everything here is
launched by you, from VS Code.)

This repository is the **template**. The agents must be installed into the
firm's GitLab repo that contains the component kit (the repo with
`src/components/ui/*.tsx`), because everything they produce is extracted
from that source code.

---

## Before anything else: how you actually "give input" to an agent

Read this once and the rest of the document will make sense.

A Copilot custom agent is just a markdown instruction file in
`.github/agents/`. It has no input form. There are exactly **three ways**
an agent receives input, and every input listed in this README is one of
these kinds:

**Kind A — Files already in the repo at a known path.**
The agent instructions tell it to read, for example, `data/tokens.json`.
You "provide" this input simply by making sure that file exists at that
path — in this workflow, that means the earlier agent's merge request was
**merged** and you have **pulled** the latest default branch. The agent
reads it straight from your clone; you never paste file contents anywhere.
If a Kind A input is missing, our agents are written to stop and tell you
which earlier agent should have produced it — that is how the chain
enforces its own ordering.

This also answers "how do I give the agent our component source code?" —
you don't. `src/components/ui/*.tsx` and the CSS are files in the very repo
the agent is running in; it can already read every one of them. That is
exactly why the agent files must be installed in the kit repo and not in a
separate repo.

**Kind B — Text you type (or paste) into the Copilot chat when you launch
the agent.**
This is how every run starts, and how you pass one-off content: a GitLab
story, the raw standards document, a special instruction. Step by step —
identical for every agent in this document:

1. Open the firm repo in VS Code. Make sure you're on the latest default
   branch with no uncommitted changes (`git status` shows clean) — the
   agent will check and refuse otherwise.
2. Open the Copilot Chat panel and switch it to **Agent** mode.
3. In the agent picker, choose the UIJourney agent by name (for example
   `standards-curator`) — they load automatically from `.github/agents/`.
   *If the picker doesn't show them* (extension version differences), use
   the fallback: attach the file `.github/agents/standards-curator.md` to
   the chat and begin your message with "Follow the attached agent
   instructions exactly."
4. Paste the input shown in that agent's "Example chat prompt" section
   below — for journey work this is simply the GitLab story text, copied
   from the story's description field — and send.
5. The agent works in your local clone: it creates a branch, edits files,
   commits, and **raises a draft merge request itself** when it pushes
   (see "How the MR appears" below). You review the diff, paste the MR
   description the agent prepared into GitLab, and mark the MR ready.

Important limitation to internalize: **the agent cannot see GitLab.** It
cannot read a story by its number, cannot read MR comments, cannot see
labels. Anything living in GitLab that the agent needs must be pasted into
chat by you. You are the bridge in both directions.

**Kind C — The `journey-approved` label on a merge request.**
On GitLab this label is a **team convention for humans, not a machine
gate**: agents can't check it. It records, for teammates and auditors, that
the mockup was reviewed. The actual approval mechanism is simpler — *you
launching the `journey-coder` agent is the approval.* Apply the label when
you approve (create it once under the GitLab project's **Manage → Labels**
if it doesn't exist), then launch the coder.

That's the whole input model: **files at paths, chat text, one
human-convention label.** Each agent section below tags its inputs `[A]`,
`[B]`, or `[C]`.

### How the MR appears (git push options — no extra tools)

Plain `git` can't normally create a merge request — that's a GitLab
feature, not a git feature. But GitLab supports **push options**: extra
flags on an ordinary `git push` that the GitLab *server* acts on. The
agents raise MRs with:

```
git push -u origin <branch> \
  -o merge_request.create \
  -o merge_request.target=<default-branch> \
  -o merge_request.title="[uijourney] ..." \
  -o merge_request.draft
```

The push itself creates the draft MR. Nothing to install, no API tokens —
it works with the same git authentication you already push with. The one
thing push options don't handle well is a long markdown description, so
the agent prints the description in chat and you paste it into the MR in
the GitLab UI.

---

## One-time setup on each developer's machine

- VS Code with the GitHub Copilot extension, signed in with a Copilot
  license, and agent mode available in chat.
- A clone of the firm repo with working `git push` to GitLab (your normal
  SSH key or token — whatever you already use).
- Node (the version the repo's `.nvmrc`/docs specify) and the firm's npm
  registry/proxy configured — the setup agents run extraction scripts and
  Playwright locally on your machine.
- For whoever runs setup agent 3: Playwright needs a local Chromium
  (`npx playwright install chromium`); if the download is blocked by the
  firm proxy, ask your platform team how browser binaries are provisioned.

## One-time installation in the firm repo

1. Copy from this template into the firm's kit repo, keeping paths exactly:
   - `.github/copilot-instructions.md`
   - `.github/agents/` (all eight files)
   - `scripts/` (all of it — the mechanical quality gates and generators:
     `validate-lib.mjs`, `validate-scene.mjs`, `diff-manifest.mjs`,
     `embed-logo.mjs`, `compose-scene.mjs`, `render-scene.mjs`,
     `build-catalog.mjs`, `ensure-parser.mjs`, `validate-manifest.mjs`,
     `tailwind-metrics.mjs`, `lib-index.mjs`, `placeholder-text.mjs`
     (self-testing: `node scripts/placeholder-text.mjs --selftest`).
     Plain Node, no dependencies
     except Playwright, which only the PNG preview needs, and `ts-morph`,
     which `ensure-parser.mjs` installs for the extractor into a gitignored
     `.uijourney-tools/` sandbox — never into your kit's `package.json`)
   - `.gitignore` (merge its two entries into yours; `.uijourney-tools/`
     must stay untracked)
   - `docs/spec-schema.md` (the screen-spec format the agents write)
   - `lib/typography.json` (the UDS type scale — **verify its values against
     your standards doc before the first library build**; it is transcribed
     from prose, not extracted from CSS) and `lib/skips.json` (the declared
     coverage-gap log; edit as your library grows)
   - `WORKFLOW.md` and this `README.md`

   These are **generated into the firm repo by the setup agents**, not
   copied from here: `data/*.json`, `lib/uds.excalidrawlib`,
   `lib/index.json`, `lib/CATALOG.md` (the component list developers skim),
   `docs/component-notes.json`, `lib/logo.json`.

   Yes, the directory is named `.github/` even though the repo lives on
   GitLab — that's where the VS Code Copilot extension looks for its
   instruction files; it's unrelated to hosting.
2. Merge that via a normal MR to the default branch.
3. Create the `journey-approved` label (**Manage → Labels → New label**).
4. Have the raw UDS standards markdown at hand for the first agent —
   preferably commit it as `docs/raw/uds-standards-raw.md` first (large
   documents survive better as committed files than as pasted chat text).

---

## The workflow at a glance

```
SETUP (once, strictly in this order, merge each MR before the next):

  standards-curator  →  design-data-extractor  →  excalidraw-librarian  →  guardrails-engineer
  (clean the docs)      (extract tokens +          (build the approved      (build the lint +
                         component manifest)        Excalidraw shapes)       GitLab CI gate)

JOURNEY LOOP (repeat per user journey):

  copy GitLab story text ──▶ journey-designer ──▶ draft MR with the mockup
       ▲                                              │
       │        you open the .excalidraw file,        │
       └── revisions via chat ◀── review, nudge  ◀────┘
                                      │
              you add `journey-approved` label, and launch:
                                      │
                    journey-coder ──▶ code on the same MR branch
                                      │
                    `uijourney-compliance` CI job passes → review → merge
```

Agents can't call each other; each one's committed outputs are the next
one's inputs, and each one checks its inputs exist before starting. Run
them out of order and they tell you what's missing and who produces it.

---

## Setup agent 1: `standards-curator`

**What it does:** turns your raw, possibly messy UDS standards markdown into
a clean canonical document (`docs/uds-standards.md`), and finds where in the
codebase the design tokens (`--MyFirm-*` CSS variables) are actually
defined, recording that in `docs/token-source.md`.

**Inputs and how to provide each one:**

| Input | Kind | How to provide it — exactly |
|---|---|---|
| The raw UDS standards markdown | **[B]** | Best: commit it first as `docs/raw/uds-standards-raw.md` (any path), then your chat prompt just names the path. Alternative: paste the whole markdown into the chat prompt — acceptable for shorter docs, but chat input can truncate very long text, so committed-file is the recommended route. |
| The component kit source (`src/components/ui/*.tsx`) and global CSS / Tailwind theme files | **[A]** | Nothing to provide — these are files in the repo the agent is running in, readable directly from your clone. If your kit lives at a different path than `src/components/ui/`, say so in the chat prompt: "Our components are under `packages/ui/src/`." |

**Example chat prompt:**

> Run as the standards-curator agent. The raw standards doc is committed at
> `docs/raw/uds-standards-raw.md`. Clean it into `docs/uds-standards.md`
> and locate our token source per your instructions.

**What you get back:** edits in your clone, a draft MR raised on push, and
the MR description printed in chat (paste it into GitLab). Before merging,
read that description — the agent lists every edit it made. Check no rule
you care about was lost and that `docs/token-source.md` names a real CSS
file. **Merge, and pull, before starting agent 2.**

---

## Setup agent 2: `design-data-extractor`

**What it does:** writes and runs scripts that read the kit's real source
code and produce the two machine-readable files every later agent depends
on: `data/tokens.json` (every color/token, resolved to actual values) and
`data/component-manifest.json` (every component, its variants, its props).
It diffs these against the prose standard and reports mismatches, and adds
a GitLab CI job that fails whenever the kit changes without these files
being regenerated.

**Inputs:** all **[A]** — `docs/token-source.md` (merge agent 1 first),
the kit source, and the standards appendix as diff baseline. Nothing to
paste.

**Example chat prompt:**

> Run as the design-data-extractor agent. Phase 0 is merged and I've pulled
> latest. Follow your instructions.

**What you get back:** the scripts, the two `data/*.json` files,
`data/extraction-report.md`, the CI job, as a draft MR. Before merging,
open `data/extraction-report.md` and check: every component file is listed
as parsed (or has an explanation), and read the mismatch list — each
mismatch is a place where the prose doc and the code disagree, and the code
is right. **Merge and pull before agent 3.**

---

## Before setup agent 3: embed the logo (one command, not an agent)

```
node scripts/embed-logo.mjs <sanctioned-logo-url-from-docs/uds-standards.md>
```

Writes `lib/logo.json` — the brand mark as a base64 data URL. **Commit it,
and run it before the librarian**, which embeds the asset into the AppHeader
composite at build time.

Why embedded rather than linked: Excalidraw renders images only from a
scene's own `files` map and never fetches a remote `src`, so a URL-only logo
appears as an empty grey box. The sanctioned URL is still recorded and is
what generated code emits — the embedded copy exists so reviewers can see the
mark in the mockup.

Run it from inside the firm network. If the asset host is awkward to reach,
download the PNG in a browser and pass its local path instead (then set
`src` in the file to the sanctioned URL before committing). Re-run only when
the brand mark changes.

## Setup agent 3: `excalidraw-librarian`

**What it does:** renders every component variant in a real browser on your
machine, measures the actual computed styles, and generates
`lib/uds.excalidrawlib` — the approved shape library, one metadata-tagged
shape per component variant. All mockups are later composed only from
these shapes.

**Inputs:** all **[A]** (the `data/*.json` files from agent 2; Storybook if
the repo has it). Optional **[B]** hint: if you know the repo has no
Storybook, say "No Storybook here; build the Vite harness" to save the
agent a search.

**Example chat prompt:**

> Run as the excalidraw-librarian agent. Phases 0–1 are merged and pulled.
> Follow your instructions.

**Machine note:** this run needs Playwright's Chromium locally — see the
per-machine setup section above.

**What you get back:** the library plus measure/build scripts as a draft
MR. To review: take `lib/uds.excalidrawlib` from your working tree, open
the firm's Excalidraw (or excalidraw.com if permitted), open the library
panel (book icon), import the file, and spot-check a few shapes against the
live product. **Merge and pull before agent 4.**

---

## Setup agent 4: `guardrails-engineer`

**What it does:** builds the enforcement layer — lint rules that make
non-compliant code fail the build (no raw hex colors, no hand-drawn brand
logo, no hand-rolled buttons where a kit component exists, no invented
variants) and a `uijourney-compliance` job in `.gitlab-ci.yml`. After this,
a generated MR cannot merge unless it complies.

**Inputs:** all **[A]**. Nothing to paste.

**Example chat prompt:**

> Run as the guardrails-engineer agent. Phases 0–2 are merged and pulled.
> Follow your instructions.

**What you get back:** the rules, their tests, `docs/compliance.md`, and
the CI job, as a draft MR. After merging, one manual step no agent can do:
in the GitLab project, enable **Settings → Merge requests → "Pipelines
must succeed"** so the compliance job actually blocks merging.

**Setup is complete.** Everything from here is the recurring loop.

---

## Journey agent 5: `journey-designer` — run for every new journey

**What it does:** turns a plain-English journey description into
`journeys/<name>/journey.excalidraw` — one Excalidraw frame per screen,
composed only from library shapes, with arrows describing the transitions —
and raises it as a draft MR.

**Inputs and how to provide each one:**

| Input | Kind | How to provide it — exactly |
|---|---|---|
| The journey description | **[B]** | Open the GitLab story, copy its description text, and paste it into the chat prompt. The agent cannot look a story up by number — the pasted text is the input. Be concrete about: the screens you expect, what the user does on each, and what moves them to the next screen. Plain language is exactly right; no design vocabulary needed. The agent will ask its clarifying questions in chat before building. |
| `lib/uds.excalidrawlib`, `data/component-manifest.json` | **[A]** | From the merged setup MRs; pull latest. Nothing to paste. |

**Example chat prompt:**

> Run as the journey-designer agent. Journey below (from story JIRA-1234 /
> gitlab#87):
>
> An employee submits an expense claim.
> 1. **Claim entry screen** — amount, category (dropdown), date, receipt
>    upload, notes. Primary button "Submit claim"; secondary "Save draft".
> 2. **Review screen** — read-only summary, "Confirm" (primary) and
>    "Back to edit" (secondary).
> 3. **Confirmation screen** — success message with the claim reference
>    number and a "View my claims" link.
>
> Transitions: Submit claim → Review; Confirm → Confirmation;
> Back to edit → Claim entry.

**What you get back:** a draft MR with the `.excalidraw` file. Review it by
opening the file (it's in your working tree already) in the VS Code
Excalidraw extension or the firm's Excalidraw. Move things, edit labels,
delete elements — hand edits are expected and survive into the code step;
commit and push them to the same branch. For bigger changes, ask in the
same chat session ("split screen 1 into two steps") and the agent revises.
Note that comments made on the MR in GitLab never reach the agent — relay
them in chat yourself.

**When satisfied:** add the **`journey-approved`** label to the MR (**[C]**,
team convention), and move to the next agent — launching it is the real
approval.

---

## Journey agent 6: `journey-coder` — run after you approve

**What it does:** reads the approved `.excalidraw` file's embedded metadata
(including your hand edits) and generates the React screens under
`src/screens/<journey-name>/`, using only kit components, plus a
`codegen-report.md` accounting for every element mapped or skipped. It
commits to the **same branch** as the mockup MR so diagram and code merge
together, and iterates until lint and typecheck pass.

**Inputs and how to provide each one:**

| Input | Kind | How to provide it — exactly |
|---|---|---|
| Which journey/branch | **[B]** | Name it in the chat prompt: "the expense-claim journey on branch `uijourney/journey-expense-claim`". The agent checks that branch out and pulls latest, picking up any hand edits you pushed. |
| Your approval | — | Launching this agent IS the approval; there is no separate gate. The agent states this assumption once before starting — object if it's wrong. |
| `data/*.json`, the compliance lint | **[A]** | From setup; pull latest. Nothing to paste. |

**Example chat prompt:**

> Run as the journey-coder agent. Generate code for the expense-claim
> journey on branch `uijourney/journey-expense-claim`. The mockup is
> approved.

**What you get back:** commits on the mockup branch adding the screens and
the codegen report, pushed to the existing MR, plus a summary in chat
(paste it as an MR comment for the record): what was generated, anything
unmapped, and confirmation lint + typecheck pass. The
`uijourney-compliance` pipeline job must be green before merge — if it
fails on the MR, relay the failure into chat and the agent fixes it; don't
hand-patch or disable rules.

If you edit the mockup again while the MR is open, tell the coder in chat
("scene updated, please regenerate") — the diagram is the source of truth
until merge.

---

## When the component kit changes later

The CI freshness job fails whenever someone changes `src/components/ui/`
or the token CSS without regenerating the derived files. Fix by running:

```
npm run uijourney:extract && npm run uijourney:library
```

and committing, or by launching `design-data-extractor` then
`excalidraw-librarian` again. Re-run `standards-curator` only when the
prose standard itself is rewritten.

## Troubleshooting

- **The agent says an input file is missing.** A setup phase wasn't merged,
  or you haven't pulled. The message names the file; the tables above name
  the agent that produces it.
- **No UIJourney agents in the VS Code agent picker.** Update the Copilot
  extension; meanwhile use the fallback: attach the agent's file from
  `.github/agents/` to the chat and start with "Follow the attached agent
  instructions exactly."
- **The push succeeded but no MR appeared.** Push options require the
  GitLab server to act; check the push output — GitLab prints the MR URL
  on success. If your firm's GitLab version/config ignores push options,
  create the MR by hand in the UI from the pushed branch (everything else
  is unaffected).
- **The agent refused to start because the tree wasn't clean.** That's
  deliberate — commit or stash your own work first so agent output doesn't
  mix with it.
- **The compliance job fails on a generated MR.** Paste the job log into
  the coder agent's chat and have it fix its own lint failures. If a *rule*
  is wrong, that's a task for `guardrails-engineer`.
