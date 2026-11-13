import { describe, expect, it } from "vitest";
import { coerceScalar, inferSchema, mergeSchemas } from "../src/discovery/schema.js";
import { validateSchema } from "../src/discovery/validate.js";

describe("inferSchema", () => {
  it("infers primitives and string formats", () => {
    expect(inferSchema(1)).toEqual({ type: "integer" });
    expect(inferSchema(1.5)).toEqual({ type: "number" });
    expect(inferSchema(null)).toEqual({ type: "null" });
    expect(inferSchema("2026-11-13T10:00:00Z")).toEqual({ type: "string", format: "date-time" });
    expect(inferSchema("https://fable.co/x")).toEqual({ type: "string", format: "uri" });
    expect(inferSchema("plain")).toEqual({ type: "string" });
  });

  it("infers objects with required keys and merged array items", () => {
    const s = inferSchema({ items: [{ a: 1, b: "x" }, { a: 2 }] });
    expect(s).toEqual({
      type: "object",
      properties: {
        items: {
          type: "array",
          items: { type: "object", properties: { a: { type: "integer" }, b: { type: "string" } }, required: ["a"] },
        },
      },
      required: ["items"],
    });
  });

  it("treats id-keyed objects as maps", () => {
    expect(inferSchema({ "1": { n: 1 }, "2": { n: 2 } })).toEqual({
      type: "object",
      additionalProperties: { type: "object", properties: { n: { type: "integer" } }, required: ["n"] },
    });
  });

  it("never stores sample values", () => {
    expect(JSON.stringify(inferSchema({ email: "secret@example.com", name: "Jane" }))).not.toMatch(/secret|Jane/);
  });
});

describe("mergeSchemas", () => {
  it("widens integer to number and unions other kinds", () => {
    expect(mergeSchemas({ type: "integer" }, { type: "number" })).toEqual({ type: "number" });
    expect(mergeSchemas({ type: "string" }, { type: "null" })).toEqual({
      anyOf: [{ type: "null" }, { type: "string" }],
    });
  });

  it("drops a format the samples disagree on", () => {
    expect(mergeSchemas({ type: "string", format: "uri" }, { type: "string" })).toEqual({ type: "string" });
  });
});

describe("coerceScalar", () => {
  it("recovers numbers and booleans from strings", () => {
    expect(coerceScalar("12")).toBe(12);
    expect(coerceScalar("1.5")).toBe(1.5);
    expect(coerceScalar("true")).toBe(true);
    expect(coerceScalar("abc")).toBe("abc");
    expect(coerceScalar("12345678901234567")).toBe("12345678901234567");
  });
});

describe("validateSchema", () => {
  const schema = inferSchema({ id: 1, tags: ["a"], when: "2026-01-01" });

  it("accepts the sample it was inferred from", () => {
    expect(validateSchema(schema, { id: 7, tags: [], when: "2026-02-02" })).toEqual([]);
  });

  it("reports missing, mistyped and misformatted values with pointers", () => {
    expect(validateSchema(schema, { id: "x", tags: [1], when: "soon" })).toEqual([
      { path: "/id", message: "expected integer, got string" },
      { path: "/tags/0", message: "expected string, got integer" },
      { path: "/when", message: "expected format date" },
    ]);
    expect(validateSchema(schema, {})).toHaveLength(3);
  });

  it("handles anyOf", () => {
    const s = mergeSchemas({ type: "string" }, { type: "null" });
    expect(validateSchema(s, null)).toEqual([]);
    expect(validateSchema(s, 1)).toEqual([{ path: "", message: "expected null | string, got integer" }]);
  });
});
