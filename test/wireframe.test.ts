import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ConfigSchema } from "../src/config.js";
import type { BookResult } from "../src/runner.js";

/** Guards the design spec in docs/wireframes against drift from the code it describes. */

const Component = z.looseObject({
  type: z.string(),
  label: z.string(),
  binds: z.string().optional(),
  columns: z.array(z.string()).optional(),
  action: z.string().optional(),
});
const Spec = z.object({
  $comment: z.string(),
  version: z.literal(1),
  options: z.object({
    layout: z.enum(["desktop", "mobile"]),
    density: z.enum(["comfortable", "compact"]),
    navigation: z.enum(["sidebar", "tabs", "wizard"]),
    defaultScreen: z.string(),
    showAdvanced: z.boolean(),
  }),
  screens: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      cli: z.string(),
      enabled: z.boolean(),
      regions: z.array(z.looseObject({ id: z.string(), components: z.array(Component) })),
    }),
  ),
});

const spec = Spec.parse(JSON.parse(readFileSync("docs/wireframes/libby-ui.wireframe.json", "utf8")));
const components = spec.screens.flatMap((s) => s.regions.flatMap((r) => r.components));

type JsonSchemaNode = { properties?: Record<string, JsonSchemaNode> };
const configJson = z.toJSONSchema(ConfigSchema, { io: "input" }) as JsonSchemaNode;
const configPathExists = (path: string) =>
  path.split(".").reduce<JsonSchemaNode | undefined>((n, k) => n?.properties?.[k], configJson) !== undefined;

// Typed against BookResult so a renamed field breaks typecheck here.
const BOOK_RESULT_FIELDS = [
  "input",
  "status",
  "message",
  "titleId",
  "title",
  "author",
  "mediaType",
  "library",
  "cardId",
  "cardName",
  "loanDays",
  "estimatedWaitDays",
  "holdsCount",
] as const satisfies readonly (keyof BookResult)[];

describe("libby UI wireframe spec", () => {
  it("has unique screen ids and an enabled default screen", () => {
    const ids = spec.screens.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(spec.screens.find((s) => s.id === spec.options.defaultScreen)?.enabled).toBe(true);
  });

  it("binds only to real config paths", () => {
    const bad = components.map((c) => c.binds).filter((b): b is string => !!b && b !== "cards" && !configPathExists(b));
    expect(bad).toEqual([]);
  });

  it("results columns are BookResult fields", () => {
    const results = spec.screens.find((s) => s.id === "results")!;
    const cols = results.regions.flatMap((r) => r.components.flatMap((c) => c.columns ?? []));
    expect(cols.filter((c) => !(BOOK_RESULT_FIELDS as readonly string[]).includes(c))).toEqual([]);
  });
});
