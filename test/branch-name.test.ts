import { describe, expect, it } from "vitest";
import { checkBranchName, MAX_LENGTH } from "../scripts/branch-name.js";

describe("checkBranchName", () => {
  it.each([
    "feat/hold-suspend-days",
    "fix/42-csv-bom-header",
    "build/require-node-26",
    "docs/branch-naming-rule",
    "ci/cache-npm-install",
    "revert/libby-token-refresh",
  ])("accepts %s", (name) => {
    expect(checkBranchName(name)).toEqual([]);
  });

  it.each(["dependabot/npm_and_yarn/types/node-26.6.6", "gh-readonly-queue/main/pr-12-abc123"])(
    "exempts bot branch %s",
    (name) => {
      expect(checkBranchName(name)).toEqual([]);
    },
  );

  it.each([
    ["no type", "hold-suspend-days"],
    ["unknown type", "feature/hold-suspend-days"],
    ["uppercase", "feat/Hold-Suspend"],
    ["underscore", "feat/hold_suspend_days"],
    ["double hyphen", "feat/hold--suspend"],
    ["trailing hyphen", "feat/hold-suspend-"],
    ["nested path", "feat/libby/hold-suspend"],
    ["random id", "ccr-859c816f-8ygura"],
    ["empty description", "feat/"],
  ])("rejects %s: %s", (_why, name) => {
    expect(checkBranchName(name)).toHaveLength(1);
  });

  it.each(["fix/wip", "chore/misc-updates", "feat/123", "fix/42-bug", "feat/ui-v2"])(
    "rejects non-descriptive %s",
    (name) => {
      expect(checkBranchName(name).join()).toMatch(/meaningful words/);
    },
  );

  it("rejects names over the length limit", () => {
    const name = `feat/${"long-name-".repeat(7)}end`;
    expect(name.length).toBeGreaterThan(MAX_LENGTH);
    expect(checkBranchName(name).join()).toMatch(/longer than/);
  });
});
