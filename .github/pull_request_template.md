<!-- PR title must follow Conventional Commits: type(scope): summary. It becomes the squash commit. -->

## Summary

<!-- What changes and why. Link issues: Closes #123 -->

## Type

- [ ] feat — new capability
- [ ] fix — bug fix
- [ ] docs / refactor / test / build / ci / chore
- [ ] Breaking change (title has `!`; migration noted below)

## Libby / OverDrive API impact

- [ ] None
- [ ] Changes request shape, endpoint, or response handling — evidence (source, captured traffic, or reference implementation):

## Testing

- [ ] `npm run ci` passes locally (Biome, typecheck, tests, build)
- [ ] New/changed behavior has tests (HTTP faked; no live calls)
- [ ] Manually verified with `--dry-run` against a real account (optional; describe)

## Checklist

- [ ] No tokens, setup codes, card numbers, or personal shelf data in code, tests, logs, or screenshots
- [ ] README/config docs updated for user-visible changes
