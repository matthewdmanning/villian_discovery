# Contributing

## Setup

```sh
nvm use                                  # Node from .nvmrc
npm ci
git config commit.template .gitmessage   # commit message template
```

## Workflow

1. Branch from `main`. Never push to `main` directly.
2. Change code + tests. HTTP is faked in tests; no live Libby calls.
3. `npm run ci` — Biome (format, lint, imports), typecheck, tests, build. Same as CI.
4. Open a PR using the template. Squash-merge.

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

| Workflow      | Runs                         | Jobs                                                                                         |
| ------------- | ---------------------------- | -------------------------------------------------------------------------------------------- |
| `ci.yml`      | PR, push `main`, merge queue | Biome + typecheck · tests Node 22/24 + build + CLI smoke · PR title lint · dependency review |
| `codeql.yml`  | PR, push `main`, weekly      | CodeQL JS/TS + Actions                                                                       |
| `secrets.yml` | PR, push `main`, weekly      | TruffleHog                                                                                   |

Recommended branch protection for `main`: require PR, require status checks (`Format & lint`, `Test (Node 22)`, `Test (Node 24)`, `PR title (Conventional Commits)`, `Dependency review`, `Analyze (javascript-typescript)`, `Analyze (actions)`, `TruffleHog`), squash merge only.

## Secrets

Never commit tokens, setup codes, card numbers, or shelf exports. If one leaks: revoke it (sign out the device in Libby), then rotate — removing it from history is not enough.
