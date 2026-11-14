/**
 * JSON Schema (2020-12 subset) inference from samples.
 *
 * Output holds types, formats, properties and required keys only — never sample values —
 * so a catalog can be committed without leaking account data.
 */

export type Kind = "null" | "boolean" | "integer" | "number" | "string" | "array" | "object";

export interface JsonSchema {
  type?: Kind;
  format?: string;
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  /** Object used as a map (id-like keys): value schema. */
  additionalProperties?: JsonSchema;
  anyOf?: JsonSchema[];
}

export interface InferOptions {
  /** Max array elements sampled per array. */
  maxItems?: number;
  /** Min keys before an object whose keys are all id-like becomes a map. */
  mapMinKeys?: number;
}

const FORMATS: [string, RegExp][] = [
  ["date-time", /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/],
  ["date", /^\d{4}-\d{2}-\d{2}$/],
  ["uuid", /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i],
  ["uri", /^https?:\/\/\S+$/],
  ["email", /^[^\s@]+@[^\s@]+\.[^\s@]+$/],
];

export const ID_KEY = /^(\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{24,})$/i;

export function stringFormat(s: string): string | undefined {
  return FORMATS.find(([, re]) => re.test(s))?.[0];
}

export function kindOf(v: unknown): Kind {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return "array";
  switch (typeof v) {
    case "boolean":
      return "boolean";
    case "number":
      return Number.isInteger(v) ? "integer" : "number";
    case "string":
      return "string";
    default:
      return "object";
  }
}

export function inferSchema(value: unknown, opts: InferOptions = {}): JsonSchema {
  const maxItems = opts.maxItems ?? 50;
  const mapMinKeys = opts.mapMinKeys ?? 2;
  const kind = kindOf(value);
  switch (kind) {
    case "string": {
      const format = stringFormat(value as string);
      return format ? { type: "string", format } : { type: "string" };
    }
    case "array": {
      const arr = (value as unknown[]).slice(0, maxItems);
      if (arr.length === 0) return { type: "array" };
      const items = arr.map((v) => inferSchema(v, opts)).reduce(mergeSchemas);
      return { type: "array", items };
    }
    case "object": {
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.length >= mapMinKeys && entries.every(([k]) => ID_KEY.test(k))) {
        const values = entries.slice(0, maxItems).map(([, v]) => inferSchema(v, opts));
        return { type: "object", additionalProperties: values.reduce(mergeSchemas) };
      }
      const properties: Record<string, JsonSchema> = {};
      for (const [k, v] of entries) properties[k] = inferSchema(v, opts);
      return { type: "object", properties, required: Object.keys(properties).sort() };
    }
    default:
      return { type: kind };
  }
}

function branches(s: JsonSchema): JsonSchema[] {
  return s.anyOf ?? (s.type ? [s] : []);
}

function sameKind(a: Kind | undefined, b: Kind | undefined): boolean {
  const num = (k: Kind | undefined) => k === "integer" || k === "number";
  return a === b || (num(a) && num(b));
}

/** Least upper bound of two schemas: accepts every sample either accepted. */
export function mergeSchemas(a: JsonSchema, b: JsonSchema): JsonSchema {
  if (!a.type && !a.anyOf) return b;
  if (!b.type && !b.anyOf) return a;
  if (!a.anyOf && !b.anyOf && sameKind(a.type, b.type)) return mergeSame(a, b);

  const out: JsonSchema[] = [];
  for (const s of [...branches(a), ...branches(b)]) {
    const i = out.findIndex((o) => sameKind(o.type, s.type));
    if (i < 0) out.push(s);
    else out[i] = mergeSame(out[i]!, s);
  }
  out.sort((x, y) => (x.type ?? "").localeCompare(y.type ?? ""));
  return out.length === 1 ? out[0]! : { anyOf: out };
}

function mergeSame(a: JsonSchema, b: JsonSchema): JsonSchema {
  switch (a.type) {
    case "integer":
    case "number":
      return { type: a.type === b.type ? a.type : "number" };
    case "string":
      return a.format && a.format === b.format ? { type: "string", format: a.format } : { type: "string" };
    case "array": {
      const items = a.items && b.items ? mergeSchemas(a.items, b.items) : (a.items ?? b.items);
      return items ? { type: "array", items } : { type: "array" };
    }
    case "object":
      return mergeObjects(a, b);
    default:
      return { type: a.type! };
  }
}

function mapValues(s: JsonSchema): JsonSchema | undefined {
  const vals = Object.values(s.properties ?? {});
  if (s.additionalProperties) vals.push(s.additionalProperties);
  return vals.length ? vals.reduce(mergeSchemas) : undefined;
}

function mergeObjects(a: JsonSchema, b: JsonSchema): JsonSchema {
  if (a.additionalProperties || b.additionalProperties) {
    const av = mapValues(a);
    const bv = mapValues(b);
    const v = av && bv ? mergeSchemas(av, bv) : (av ?? bv);
    return v ? { type: "object", additionalProperties: v } : { type: "object" };
  }
  const ap = a.properties ?? {};
  const bp = b.properties ?? {};
  const properties: Record<string, JsonSchema> = {};
  for (const k of [...new Set([...Object.keys(ap), ...Object.keys(bp)])].sort()) {
    const x = ap[k];
    const y = bp[k];
    properties[k] = x && y ? mergeSchemas(x, y) : (x ?? y)!;
  }
  const breq = new Set(b.required ?? []);
  const required = (a.required ?? []).filter((k) => breq.has(k)).sort();
  return { type: "object", properties, required };
}

/** Values of query strings / form bodies arrive as strings: recover number/boolean. */
export function coerceScalar(s: string): unknown {
  if (/^-?\d+$/.test(s) && s.length < 16) return Number(s);
  if (/^-?\d+\.\d+$/.test(s)) return Number(s);
  if (s === "true" || s === "false") return s === "true";
  return s;
}

export function toDocumentSchema(s: JsonSchema): JsonSchema & { $schema: string } {
  return { $schema: "https://json-schema.org/draft/2020-12/schema", ...s };
}
