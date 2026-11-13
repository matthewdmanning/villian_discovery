# Security policy

## Reporting

Report privately via [GitHub security advisories](https://github.com/matthewdmanning/villian_discovery/security/advisories/new). No public issues for vulnerabilities.

Include: affected version/commit, impact, reproduction. Never include real tokens or personal data.

## Scope

- Credential handling: identity token storage (`auth.ts`, mode `600`), logging, error messages.
- Request construction against Libby/OverDrive endpoints.
- Supply chain: dependencies, GitHub Actions.

Out of scope: Libby/OverDrive service vulnerabilities — report to OverDrive.

## Safeguards in this repo

| Control                  | Where                                                                           |
| ------------------------ | ------------------------------------------------------------------------------- |
| Code scanning            | CodeQL (`security-extended`), JS/TS + Actions; PRs, `main`, weekly              |
| Secret scanning (CI)     | TruffleHog: new commits on PR/push, full history weekly                         |
| Secret scanning (GitHub) | Settings → Code security: enable secret scanning + push protection              |
| Dependency review        | PRs fail on new deps with ≥ moderate advisories                                 |
| Updates                  | Dependabot: npm + Actions, weekly, grouped, 7-day cooldown                      |
| Actions hardening        | SHA-pinned actions, least-privilege `permissions`, `persist-credentials: false` |
