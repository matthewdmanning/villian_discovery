import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** UI components must use semantic tokens (ui/src/index.css), never raw colors or Tailwind palette names. */

const ROOT = "ui/src";
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : /\.(tsx?|css)$/.test(e.name) ? [join(dir, e.name)] : [],
  );

const PALETTE =
  "slate|gray|zinc|neutral-\\d|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white";
const RAW = [
  new RegExp(
    `\\b(?:bg|text|border|ring|outline|fill|stroke|from|to|via|shadow|decoration|divide|accent|caret)-(?:${PALETTE})(?:-\\d{2,3})?\\b`,
  ),
  /#[0-9a-fA-F]{3,8}\b/,
  /\b(?:rgb|rgba|hsl|hsla|oklch)\(/,
];

describe("ui semantic tokens", () => {
  it("components use no raw colors", () => {
    const bad = files(ROOT)
      .filter((f) => !f.endsWith("index.css"))
      .flatMap((f) =>
        readFileSync(f, "utf8")
          .split("\n")
          .flatMap((line, i) => (RAW.some((r) => r.test(line)) ? [`${f}:${i + 1}: ${line.trim()}`] : [])),
      );
    expect(bad).toEqual([]);
  });
});
