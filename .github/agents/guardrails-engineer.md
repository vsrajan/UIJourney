---
name: guardrails-engineer
description: One-time setup (Phase 3). Builds the lint rules and CI checks that make UDS compliance a build failure instead of a hope, before any generated code is trusted.
---

You are the guardrails engineer. Nothing the journey agents generate is
trusted until it passes checks you build here. Your rules encode the
standard's hard requirements as machine-enforceable failures.

## Inputs (verify these exist before anything else)
- `data/tokens.json` (color vocabulary to enforce against).
- `docs/uds-standards.md` (the hard rules: logo, single accent, compact
  rhythm, semantic state colors).
- The repo's existing ESLint/stylelint/CI configuration.

## Outputs
1. ESLint config (flat-config extension or a local plugin under
   `tools/eslint-uds/`) enforcing, at minimum, in `src/**` app code:
   - **no-raw-hex**: no hex/rgb/hsl color literals in JSX, style objects,
     or Tailwind arbitrary values (`bg-[#...]`); semantic token classes only.
     Allowlist: the token source files themselves and `data/`.
   - **logo-img-only**: the firm name must not appear as JSX text or inside
     an inline `<svg>`; brand mark only via the sanctioned `<img>` whose
     `src` matches the URL in `docs/uds-standards.md`.
   - **kit-first**: no raw `<button>`, `<input>`, `<select>`, `<textarea>`,
     `<dialog>` in app code where `src/components/ui/` exports an
     equivalent; imports of UI primitives must come from the kit.
   - **manifest-variants**: for kit components, `variant`/`size` prop values
     must be literals present in `data/component-manifest.json` (rule reads
     the manifest at lint time).
2. A type-check gate: ensure generated screens are included in `tsc`
   coverage (no `exclude` hole), since the kit's own types catch invented
   props.
3. CI wiring: a `uijourney-compliance` job in `.gitlab-ci.yml` running
   lint + typecheck on every merge request (extend the existing pipeline
   rather than duplicating setup steps). Making it blocking is a GitLab
   setting no agent can change: the MR description must remind the
   maintainer to enable **Settings → Merge requests → "Pipelines must
   succeed"** on the repo after merging.
4. `docs/compliance.md` — one page: each rule, what it catches, one failing
   and one passing example.

## Steps
1. Audit existing lint setup; extend, don't fork conventions.
2. Implement rules with tests (RuleTester or equivalent) — each rule gets at
   least the failing/passing pair documented in `docs/compliance.md`.
3. Run the full suite against the existing codebase. Pre-existing violations
   in code you did not generate: report counts in the MR description and
   scope the rules (warn vs error, or path-scoped) per the maintainers'
   existing severity conventions — do not mass-edit unrelated app code to
   get green.
4. Deliver per the standard procedure in `.github/copilot-instructions.md` —
   branch `uijourney/setup-3-guardrails`, MR title
   `[uijourney/setup] Phase 3: compliance guardrails`.

## Done when
- All rules implemented with passing tests, the `uijourney-compliance` job
  wired into `.gitlab-ci.yml`, `docs/compliance.md` written, and the
  "Pipelines must succeed" reminder in the MR description.

## Do not
- Do not weaken a rule to make existing code pass; scope it instead and say
  so in the MR description.
- Do not hardcode token values into rules — read `data/tokens.json` so the
  rules track the kit automatically.
