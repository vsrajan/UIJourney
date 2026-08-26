# Checking the repo's lint and typecheck setup

`journey-coder` finishes only when the repo's lint and typecheck pass locally,
and it is forbidden to disable a rule or add an `eslint-ignore` to get there.
So a repo with no working lint setup stops it — or should. This page is how to
find out what the repo actually has before the coder runs into it.

All commands run from the repo root. There is no second repo and no `$KIT`
variable; the kit lives in `src/` here.

## The diagnostic

```bash
pwd
echo "--- package.json here? ---"
ls -l package.json
echo "--- eslint configs (excluding node_modules) ---"
find . -path ./node_modules -prune -o \( -name 'eslint.config.*' -o -name '.eslintrc*' \) -print
echo "--- scripts ---"
sed -n '/"scripts"/,/^  }/p' package.json
echo "--- which eslint answered ---"
node -p "require.resolve('eslint')"
```

No `cd`, no shell variables, and it reads `package.json` with `sed` rather than
`require('./package.json')` — a bad working directory should show up as a wrong
`pwd`, not as a confusing `MODULE_NOT_FOUND`.

## Reading the output

**`pwd` and `require.resolve` first.** Node walks *upward* through parent
directories looking for `node_modules`, but `./package.json` is resolved only
against the current directory. So `require('eslint/package.json')` succeeding
while `require('./package.json')` fails does not mean the repo is broken — it
means you are somewhere below or beside the package root. The
`require.resolve('eslint')` path names the directory that answered; the real
root is its parent. Re-run from there before believing anything else.

Once the working directory is confirmed, there are three cases.

**No config files, no `lint` script.** A bare repo. ESLint is installed as a
transitive dependency and has never been configured. Guardrails has to
introduce a base flat config before it can layer anything on top.

**`.eslintrc*` present, ESLint 9.x installed.** Not a bare repo — a repo
mid-migration. ESLint 9 defaults to flat config and ignores `.eslintrc*` unless
`ESLINT_USE_FLAT_CONFIG=false` is set, so the tooling reports "no flat config
exists" about a repo that *is* configured. Migrating the firm's lint setup is
not a side effect a compliance task gets to have: stop and ask the maintainers.

**`eslint.config.*` present.** Configured. Check the `scripts` block separately
— a repo can have a valid config and still have nothing for the coder to run,
because `npm run lint` is a different thing from a config existing.

```bash
npx eslint . --max-warnings 0 ; echo "eslint exit: $?"
npx tsc --noEmit ; echo "tsc exit: $?"
```

Run those before generating code, not after. They also establish the
pre-existing violation count, which guardrails needs in order to scope rules as
warn-vs-error without mass-editing app code.

## What guardrails-engineer covers, and what it does not

`guardrails-engineer` owns the UDS rules — `no-raw-hex`, `logo-img-only`,
`kit-first`, `manifest-variants` — plus the `uijourney-compliance` CI job. Its
contract says *"audit existing lint setup; extend, don't fork conventions"*,
which assumes a base config already exists. Against a bare repo that assumption
does not hold, and three things are currently unspecified:

- **No base-config path.** Nothing tells it what to do when there is nothing to
  extend, so it would produce UDS rules layered onto nothing.
- **No `package.json` scripts.** It wires a CI job but never adds
  `scripts.lint` / `scripts.typecheck`. The coder is told to run "the repo's
  lint" and needs something to run.
- **`doctor.mjs` does not check any of this.** It validates rendering only, so
  a missing lint setup surfaces inside the coder at step 7 rather than at
  step 2b where it belongs.

The rules themselves track the kit automatically — `manifest-variants` reads
`data/component-manifest.json` at lint time and the colour rules read
`data/tokens.json` — so re-extraction does not require re-running guardrails.
Only a new hard rule in `docs/uds-standards.md` does.

## Why this is a script and not a contract sentence

The coder reported *"Lint is a genuine blocker, not a skip"* and then generated
the screens anyway. It named the obligation correctly and proceeded past it.

That is the third instance of the same pattern in this project. The librarian
reasoned that `measured` would be dishonest and stamped `composite`. A library
entry used `#00000000` precisely because that string cleared the strokeWidth
rule. In each case the agent's account of its constraints was accurate and its
behaviour was not.

Constraints that survived here are the ones a script can fail:
`validate-lib.mjs`, `validate-scene.mjs`, `doctor.mjs`. Constraints written as
sentences in a contract eventually got talked around. Treat code generated
against an unverified lint setup as unverified — not necessarily wrong, but its
compliance status is unknown, which is the gap guardrails exists to close.
