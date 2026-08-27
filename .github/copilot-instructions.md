# UIJourney — repository instructions for GitHub Copilot

This repository implements the UIJourney pipeline: plain-text user-journey
stories become UDS-compliant Excalidraw mockups, and approved mockups become
UDS-compliant React code built from the firm's shadcn-based component kit.

## Execution environment — read this first

The repository is hosted on the firm's **GitLab**. Agents run in **VS Code
agent mode on the developer's machine**, against their local clone. There is
no cloud agent, no GitHub issue assignment, and no ability to open anything
in a web UI. Consequences that apply to every agent and every task:

- Your task input is the text the developer pastes into chat (usually a
  GitLab story) plus the files in the clone. If you need something that is
  in neither, ask the developer in chat — they are present.
- Your deliverable is committed work on a branch plus a merge request,
  raised via git push options (see Delivery below). Never claim you
  "opened a PR"; there are no PRs here, only GitLab MRs.
- Continuous integration is **GitLab CI** (`.gitlab-ci.yml`), not GitHub
  Actions. Any CI job you create or extend goes there.

## Delivery — two procedures, by agent

**The journey agents — `journey-sketcher` and `journey-coder` — do not
deliver.** They commit to whatever branch the developer is already on, and
stop. No branch, no push, no merge request, no CI. Branching, review and
merging are done by hand, deliberately: a mockup iteration is a conversation,
not a change request, and the ceremony cost more than the review was worth.

Everything below applies to the **setup agents only** — `standards-curator`,
`design-data-extractor`, `excalidraw-librarian`, `guardrails-engineer` — which
run once, change shared artifacts, and do need review.

1. **Preflight, before changing anything:** run `git status`. If the
   working tree is not clean, stop and ask the developer to commit or
   stash first — never mix agent output with unrelated local edits. Then
   branch off the up-to-date default branch:
   `git fetch origin` and `git checkout -b uijourney/<task-slug>
   origin/<default-branch>` (ask the developer for the default branch name
   if it is not obvious from `git remote show origin`).
2. Do the work. Commit with clear, descriptive messages.
3. Prepare the full MR description (each agent's file says what it must
   contain) and print it in chat for the developer.
4. Raise the MR directly from git using GitLab push options:

   ```
   git push -u origin uijourney/<task-slug> \
     -o merge_request.create \
     -o merge_request.target=<default-branch> \
     -o merge_request.title="[uijourney] <title>" \
     -o merge_request.draft
   ```

   The GitLab server creates the draft MR as a side effect of the push —
   no extra CLI tool is needed. Push options set the title reliably;
   long markdown descriptions do not survive shell quoting well, so ask
   the developer to paste the description you printed in step 3 into the
   MR, and to mark it ready when they have reviewed the diff.
5. If the push is rejected (auth, protected branch, proxy), show the exact
   error and let the developer resolve it — do not retry with force or
   alternative remotes.

## Authoritative sources, in order of precedence

1. `data/tokens.json` and `data/component-manifest.json` — machine-extracted
   from the component kit's source. These are the ONLY authority for color
   values, type scale, control geometry, component names, variants, and props.
   If either file is missing, stop and report that the extraction agents
   (`design-data-extractor`) must run first — never substitute values from
   memory or from prose docs.
2. `lib/uds.excalidrawlib` — the approved shape library. Mockups are composed
   exclusively from its entries. `lib/typography.json` is the authority for
   the type scale (sizes, weights, line heights) unless `data/tokens.json`
   carries real typography variables extracted from CSS, in which case those
   win. `lib/skips.json` records every declared coverage gap.
3. `docs/uds-standards.md` — the narrative standard (brand personality,
   logo rules, do/do-not). Use it for intent and hard rules, never as a
   source of hex values or component APIs.

## Hard rules that apply to every agent and every task

- **Logo**: never render the firm's brand name as plain text or SVG. Always
  the exact `<img>` tag specified in `docs/uds-standards.md`, on white or
  very light neutral backgrounds only, minimum height 24px, original aspect
  ratio, no filters or overlays.
- **Colors**: never emit a raw hex value in generated UI code. Use semantic
  tokens (`--primary`, `--muted`, `--border`, ...) via the kit's Tailwind
  classes. The single brand accent is MyFirm red; never introduce a second
  competing accent.
- **Components**: never hand-roll a UI primitive (button, input, dialog, ...)
  when the kit under `src/components/ui/` provides one. Never invent a
  variant or prop that is not in `data/component-manifest.json`.
- **Excalidraw scenes**: every element that represents a kit component MUST
  carry `customData: { component, variant, props }` matching the manifest.
  Shapes without `customData` are decoration only and must not encode
  interactive UI.
- **Compact rhythm**: controls stay within the standard's documented heights
  (roughly 24–40px); do not enlarge controls or spacing beyond the kit's own
  classes.
- Generated `.tsx` must pass the repo's lint and type-check before a task is
  reported complete. Fix failures; never disable or bypass a rule.
- **Validators are part of delivery**: the library must pass
  `node scripts/validate-lib.mjs lib/uds.excalidrawlib` and every journey
  scene must pass `node scripts/validate-scene.mjs <scene> <lib>` with zero
  errors before the MR is raised. Fix errors — never edit the validators to
  make them pass.
- Every text element in libraries and scenes uses `fontFamily: 2`
  (Helvetica). `customData` component metadata lives on container elements
  only. `annotation: true` marks reviewer notes exclusively — never screen
  content.

## The agent pipeline

Setup (run once, re-run when the kit or standards change):
`standards-curator` → `design-data-extractor` → `excalidraw-librarian` →
`guardrails-engineer`.

Recurring, per user journey — two agents, both committing locally:
`journey-sketcher` (story → spec → composed and validated scene → PNG
preview, seconds per iteration) → developer reviews the preview and, when
satisfied, launches `journey-coder` (launching the coder IS the approval —
the developer is trusted, and no other signal is looked for) → React screens
plus a browser-viewable preview page.

There was once a `journey-designer` between them. It did three things:
ran the validator, opened an MR, and labelled provisional scenes. The
composer now validates its own output, the MR is done by hand, and the
provisional interlock always lived in `journey-coder`'s own refusal check —
so the agent had nothing left of its own to do.

Each agent's outputs are committed files; the next agent must verify its
declared inputs exist and are current before doing anything else. See
`WORKFLOW.md` for the full handoff contract.
