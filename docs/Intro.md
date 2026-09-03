# UIJourney — an introduction for UI engineers

## What it is

A set of Copilot agents that turn a plain-English journey description into a
reviewable mockup, and an approved mockup into React code built from our own
component kit.

```
"An employee submits an expense claim: entry screen, review screen,
 confirmation."
        │
        ▼   journey-sketcher
   a spec + an Excalidraw mockup + a PNG, in seconds — iterate here
        │
        ▼   you look at it, change your mind, iterate again
        │
        ▼   journey-coder
   .tsx screens built only from src/components/ui, lint and typecheck green
```

It runs in VS Code Copilot agent mode against your local clone. You launch
every step; nothing runs in the cloud, and nothing touches a branch you did
not put it on.

## The idea worth understanding

**The mockup is not a picture. It is a machine-readable spec that happens to
render.**

Every element that represents a component carries its identity:

```json
"customData": {
  "component": "Button",
  "variant": "secondary",
  "props": { "size": "sm", "icon": "FilterFunnel16px" }
}
```

So codegen never interprets a drawing. It reads a structure you have already
reviewed and translates it — component by component — into the kit's real
API. "Which button is that?" is not a judgement call at code time; it was
settled when you approved the mockup.

The second half of the idea matters just as much: **the model writes meaning,
a script writes geometry.** You describe a screen; `compose-scene.mjs` decides
every coordinate. That split was not a style preference — it was arrived at
after two rebuilds. Every scene defect this project has hit came from a model
authoring geometry: labels stranded at 0,0, hairline borders that vanish at
fit-to-screen zoom, base64 transcribed by hand. None of them are reachable
from a spec, because a spec cannot express a coordinate.

A login screen is about 25 lines of spec against roughly 700 lines of scene
JSON. That ratio is why iteration is measured in seconds.

## What you actually do

**Per journey, two steps.**

Paste the story text into chat and run the sketcher. Look at the PNG. Say
what is wrong — "the table needs a status column", "drop the notes field",
"make that button secondary" — and it edits the spec and recomposes. Rounds
take seconds, so you argue about the shape of the screen while changing it is
still free.

When it looks right, run the coder. You get the screens, a browser-viewable
preview page, and a report accounting for every element in the scene:
what it emitted, and anything it could not map.

**Launching the coder is the approval.** There is no label, no gate, no
ceremony.

## What this gives a team

**You can only draw what the kit actually has.** The shape library is
measured from our real components — rendered in a browser, measured in the
DOM, not guessed from class names. A mockup containing a component the kit
does not ship fails validation. So the design conversation is constrained to
buildable screens from the first round, and "the designer drew something we
can't build" stops being a category of problem.

**Compliance is a build failure, not a review comment.** Raw hex colours,
the firm name as text instead of the sanctioned logo, a raw `<button>` where
the kit exports one, a variant that isn't in the component manifest — these
are lint rules that fail CI, not things a reviewer has to notice at 5pm.

**Codegen imports your components, not invented ones.** Every variant and
prop is checked against a manifest extracted from the kit's own source. A
prop that doesn't exist is an error in the report, not a plausible-looking
line of code that fails at runtime.

**Iteration happens before code exists.** Changing a screen costs a few lines
of spec at sketch time. It costs a pull request after codegen. Most of the
value is in moving those decisions earlier.

**The tooling knows what it doesn't know.** Geometry carries provenance —
`measured` when it came from a real render, `derived` when it was estimated
because the kit would not build. A mockup composed from derived geometry is
stamped provisional, and the coder refuses it outright rather than generating
layout from estimates wearing the kit's name. You are never quietly handed a
guess.

**Nothing is a black box.** The spec is 25 readable lines. The composer is a
plain Node script with no dependencies. The validators state their rules. When
something looks wrong you can read exactly why it happened, and the fix is
usually one line of spec.

## What it does not do

Worth being straight about, because the failure modes are more useful to know
than the features.

**It is not a visual design tool.** The mockup shows anatomy, real copy, and
which components go where. It is a wireframe with semantics — not a
pixel-perfect comp, not a replacement for design work on a genuinely new
pattern. It is very good at assembling known parts into a screen.

**The generated code is a first draft.** It compiles, it lints, it uses the
right components. It still goes through normal review, and you will still
reach for it and change things. The claim is that it starts from the kit and
from a screen you already approved — not that it is finished.

**Hand edits to the scene are terminal.** The `.excalidraw` is regenerated
from the spec on every compose, so nudging elements in the Excalidraw
extension works only as the last step before codegen. Anything you want to
keep goes in the spec. And colour specifically will not carry through — colour
comes from tokens and variants, deliberately, because that is the whole point
of a design system.

**The library needs the kit to build.** Measuring components means rendering
them. When that isn't possible there is a fallback that infers geometry from
Tailwind classes, and everything downstream still works — but it is stamped
provisional and will not produce code until the real measurement happens.

**The agents cannot see GitLab.** No reading a story by number, no MR
comments, no labels. You paste things in. You are the bridge in both
directions.

## What adopting it costs

**One-time, per repo:** four setup agents run once — they read the standards
doc, extract tokens and a component manifest from the kit's source, measure
the components into a shape library, and build the compliance lint rules.
Their output is reviewed and merged like any other change. Budget an
afternoon, most of it reading what they produced rather than waiting.

**Ongoing:** a journey is minutes. The library needs re-measuring when the
kit changes — one agent run.

**The honest overhead:** you are the one launching each step and relaying
anything that lives in GitLab. This is not a fire-and-forget pipeline; it is
a fast loop with you in it.

## Where to go next

- `README.md` — the full walkthrough: what each agent needs, the exact chat
  prompts, and what comes back.
- `docs/spec-schema.md` — the spec format. Read it if you want to hand-edit a
  spec rather than asking the sketcher for a change.
- `WORKFLOW.md` — the handoff contract between agents, and what each one
  refuses to do.
- `docs/icon-checker.md` — finding the kit's real icon names, which is the one
  piece of setup that needs a human decision.

The fastest way to judge it is to run the sketcher on a screen you already
know well and see whether the picture argues back.
