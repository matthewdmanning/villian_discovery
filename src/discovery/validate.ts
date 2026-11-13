import { type JsonSchema, kindOf, stringFormat } from "./schema.js";

export interface SchemaViolation {
  /** JSON Pointer to the offending value ("" = root). */
  path: string;
  message: string;
}

const esc = (k: string) => k.replace(/~/g, "~0").replace(/\//g, "~1");

/** Validate a value against the JsonSchema subset produced by `inferSchema`. */
export function validateSchema(schema: JsonSchema, value: unknown, path = ""): SchemaViolation[] {
  if (schema.anyOf) {
    const results = schema.anyOf.map((s) => validateSchema(s, value, path));
    if (results.some((r) => r.length === 0)) return [];
    const kinds = schema.anyOf.map((s) => s.type ?? "?").join(" | ");
    return [{ path, message: `expected ${kinds}, got ${kindOf(value)}` }];
  }
  if (!schema.type) return [];

  const kind = kindOf(value);
  const typeOk = schema.type === kind || (schema.type === "number" && kind === "integer");
  if (!typeOk) return [{ path, message: `expected ${schema.type}, got ${kind}` }];

  const out: SchemaViolation[] = [];
  if (schema.type === "string" && schema.format && stringFormat(value as string) !== schema.format) {
    out.push({ path, message: `expected format ${schema.format}` });
  }
  if (schema.type === "array" && schema.items) {
    (value as unknown[]).forEach((v, i) => {
      out.push(...validateSchema(schema.items!, v, `${path}/${i}`));
    });
  }
  if (schema.type === "object") {
    const obj = value as Record<string, unknown>;
    for (const k of schema.required ?? []) {
      if (!(k in obj)) out.push({ path: `${path}/${esc(k)}`, message: "required property missing" });
    }
    for (const [k, v] of Object.entries(obj)) {
      const sub = schema.properties?.[k] ?? schema.additionalProperties;
      if (sub) out.push(...validateSchema(sub, v, `${path}/${esc(k)}`));
    }
  }
  return out;
}
