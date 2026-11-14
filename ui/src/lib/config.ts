import { z } from "zod";
import { type Config, type ConfigInput, ConfigSchema, parseConfig } from "../../../src/config.ts";

/** ConfigSchema as JSON Schema: the source of choices, defaults and ranges for every bound field. */
type Node = {
  properties?: Record<string, Node>;
  enum?: (string | number)[];
  const?: string | number;
  anyOf?: Node[];
  type?: string;
  minimum?: number;
  maximum?: number;
  default?: unknown;
};
const root = z.toJSONSchema(ConfigSchema, { io: "input", unrepresentable: "any" }) as Node;

export function schemaAt(path: string): Node | undefined {
  return path.split(".").reduce<Node | undefined>((n, k) => n?.properties?.[k], root);
}

/** Enum choices for a path (string enums or `const` members of a union). */
export function choicesOf(path: string): string[] {
  const n = schemaAt(path);
  if (n?.enum) return n.enum.map(String);
  return (n?.anyOf ?? []).flatMap((m) => (m.const !== undefined ? [String(m.const)] : []));
}

export function rangeOf(path: string): { min?: number; max?: number } {
  const n = schemaAt(path);
  return { ...(n?.minimum !== undefined && { min: n.minimum }), ...(n?.maximum !== undefined && { max: n.maximum }) };
}

export const DEFAULTS: Config = parseConfig({});

export function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], obj);
}

/** Immutable set; `undefined` removes the key so the schema default applies. */
export function setPath(obj: ConfigInput, path: string, value: unknown): ConfigInput {
  const [head, ...rest] = path.split(".") as [string, ...string[]];
  const cur = (obj as Record<string, unknown>)[head];
  const next = rest.length ? setPath((cur ?? {}) as ConfigInput, rest.join("."), value) : value;
  const out = { ...(obj as Record<string, unknown>) };
  if (next === undefined) delete out[head];
  else out[head] = next;
  return out as ConfigInput;
}

/** Effective config, or the schema error message when the overrides are invalid. */
export function resolve(overrides: ConfigInput): { config: Config; error?: string } {
  try {
    return { config: parseConfig(overrides) };
  } catch (e) {
    return { config: DEFAULTS, error: (e as Error).message };
  }
}

export type { Config, ConfigInput };
