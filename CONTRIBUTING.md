# Contributing

## Setup

```sh
nvm use                                  # Node from .nvmrc
npm ci                                   # also installs the husky git hooks
git config commit.template .gitmessage   # commit message template
```

Install [gitleaks](https://github.com/gitleaks/gitleaks#installing). The pre-commit hook runs it on staged changes.

## Workflow

1. Branch from `main` using a [descriptive name](#branch-names). Never push to `main` directly.
2. Keep dependency version changes on their own branch (`build/…`), unless the new work requires them.
3. Change code + tests. HTTP is faked in tests; no live Libby calls.
4. `npm run ci` — Biome (format, lint, imports), typecheck, tests, build. Same as CI.
5. Open a PR using the template. Squash-merge.

## Branch names

`<type>/[<issue>-]<description>` — e.g. `feat/hold-suspend-days`, `fix/42-csv-bom-header`.

- `type`: a Conventional Commit type (`feat fix docs style refactor perf test build ci chore revert`), matching the planned PR title.
- `issue` (optional): issue number.
- `description`: lowercase kebab-case; ≥ 2 meaningful words (3+ letters, not filler like `wip`, `update`, `misc`). Says _what_ changes, not who or when.
- ≤ 60 characters. No uppercase, `_`, `--`, extra `/`, or random IDs.
- Exempt: `dependabot/*`, `gh-readonly-queue/*` (bot-generated).
- Check: `npm run lint:branch` (current branch) or `node scripts/branch-name.ts <name>`. CI enforces on PRs. Rename: `git branch -m <new-name>`.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/): `type(scope)!: summary`.

- Types: `feat fix docs style refactor perf test build ci chore revert`.
- `!` or a `BREAKING CHANGE:` footer marks breaking changes.
- CI enforces the **PR title** (it becomes the squash commit). Check local commits: `npm run lint:commits`.

## Tooling

| Task                                    | Command                           | Tool                      |
| --------------------------------------- | --------------------------------- | ------------------------- |
| format                                  | `npm run format` / `format:check` | Biome                     |
| lint                                    | `npm run lint`                    | Biome (recommended rules) |
| format + lint + organize imports, write | `npm run check`                   | Biome                     |
| types                                   | `npm run typecheck`               | TypeScript 7              |
| tests                                   | `npm test`                        | Vitest                    |

Biome, not ESLint: typescript-eslint supports TypeScript `<6.1`; this repo uses TypeScript 7.
`noNonNullAssertion` is off: `noUncheckedIndexedAccess` makes `!` the explicit, checked-by-review escape hatch.

## CI

| Workflow      | Runs                         | Jobs                                                                                                    |
| ------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------- |
| `ci.yml`      | PR, push `main`, merge queue | Biome + typecheck · tests Node 26 + build + CLI smoke · PR title lint · branch name · dependency review |
| `codeql.yml`  | PR, push `main`, weekly      | CodeQL JS/TS + Actions                                                                                  |
| `secrets.yml` | PR, push `main`, weekly      | TruffleHog                                                                                              |

Recommended branch protection for `main`: require PR, require status checks (`Format & lint`, `Test (Node 26)`, `PR title (Conventional Commits)`, `Branch name`, `Dependency review`, `Analyze (javascript-typescript)`, `Analyze (actions)`, `TruffleHog`), squash merge only.

## Secrets

Never commit tokens, setup codes, card numbers, or shelf exports. If one leaks: revoke it (sign out the device in Libby), then rotate — removing it from history is not enough.
