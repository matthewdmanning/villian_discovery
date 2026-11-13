/**
 * Branch naming rule. See CONTRIBUTING.md "Branch names".
 *
 *   <type>/[<issue>-]<description>     e.g. feat/hold-suspend-days, fix/42-csv-bom-header
 *
 * Run: node scripts/branch-name.ts [name]   (default: current branch)
 */
import { execFileSync } from "node:child_process";

/** Same types as Conventional Commits (commitlint config-conventional). */
export const BRANCH_TYPES = [
  "feat",
  "fix",
  "docs",
  "style",
  "refactor",
  "perf",
  "test",
  "build",
  "ci",
  "chore",
  "revert",
] as const;

/** Bot- and GitHub-generated branches are not ours to name. */
export const EXEMPT_PREFIXES = ["dependabot/", "gh-readonly-queue/"] as const;

export const MAX_LENGTH = 60;
export const MIN_DESCRIPTIVE_WORDS = 2;

/** Words that add no meaning on their own. */
const FILLER = new Set([
  "branch",
  "change",
  "changes",
  "fix",
  "fixes",
  "misc",
  "new",
  "stuff",
  "temp",
  "test",
  "tmp",
  "update",
  "updates",
  "various",
  "wip",
  "work",
]);

const PATTERN = new RegExp(`^(${BRANCH_TYPES.join("|")})/(?:(\\d+)-)?([a-z0-9]+(?:-[a-z0-9]+)*)$`);

export const EXAMPLE = "feat/hold-suspend-days or fix/42-csv-bom-header";

/** Returns problems with `name`; empty means valid. */
export function checkBranchName(name: string): string[] {
  if (EXEMPT_PREFIXES.some((p) => name.startsWith(p))) return [];
  const problems: string[] = [];
  if (name.length > MAX_LENGTH) problems.push(`longer than ${MAX_LENGTH} characters (${name.length})`);
  const m = PATTERN.exec(name);
  if (!m) {
    problems.push(
      `must match <type>/[<issue>-]<kebab-description>; type is one of: ${BRANCH_TYPES.join(", ")}; ` +
        "lowercase letters, digits and single hyphens only",
    );
    return problems;
  }
  const words = m[3]!.split("-").filter((w) => /^[a-z]{3,}$/.test(w) && !FILLER.has(w));
  if (words.length < MIN_DESCRIPTIVE_WORDS) {
    problems.push(
      `description needs at least ${MIN_DESCRIPTIVE_WORDS} meaningful words ` +
        `(3+ letters, not filler like wip/update/misc); got "${m[3]}"`,
    );
  }
  return problems;
}

if (import.meta.main) {
  const name = process.argv[2] ?? execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim();
  const problems = checkBranchName(name);
  if (problems.length > 0) {
    console.error(`✖ Branch name "${name}" is invalid:`);
    for (const p of problems) console.error(`  - ${p}`);
    console.error(`  Example: ${EXAMPLE}. Rename: git branch -m <new-name>`);
    process.exit(1);
  }
  console.log(`✔ Branch name "${name}" is valid.`);
}
