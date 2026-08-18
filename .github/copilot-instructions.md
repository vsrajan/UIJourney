# UIJourney — repository instructions for GitHub Copilot

This repository implements the UIJourney pipeline: plain-text user-journey
prompts become UDS-compliant Excalidraw mockups, and approved mockups become
UDS-compliant React code built from the firm's shadcn-based component kit.

## Authoritative sources, in order of precedence

1. `data/tokens.json` and `data/component-manifest.json` — machine-extracted
   from the component kit's source. These are the ONLY authority for color
   values, type scale, control geometry, component names, variants, and props.
   If either file is missing, stop and report that the extraction agents
   (`design-data-extractor`) must run first — never substitute values from
   memory or from prose docs.
2. `lib/uds.excalidrawlib` — the approved shape library. Mockups are composed
   exclusively from its entries.
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

## The agent pipeline

Setup (run once, re-run when the kit or standards change):
`standards-curator` → `design-data-extractor` → `excalidraw-librarian` →
`guardrails-engineer`.

Recurring, per user journey:
`journey-designer` (prompt → mockup PR) → human approval on the PR →
`journey-coder` (approved mockup → code on the same PR).

Each agent's outputs are committed files; the next agent must verify its
declared inputs exist and are current before doing anything else. See
`WORKFLOW.md` for the full handoff contract.
