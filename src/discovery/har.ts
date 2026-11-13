/**
 * API discovery from a browser HAR capture (DevTools → Network → Save all as HAR).
 *
 * Groups JSON requests by method + path template (`/books/123` → `/books/{id}`) and
 * emits an OpenAPI 3.1 document. Schemas hold types only — no values, headers or cookies —
 * so the output can be committed. The HAR itself holds secrets: never commit it.
 */
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { coerceScalar, ID_KEY, inferSchema, type JsonSchema, mergeSchemas } from "./schema.js";

const HarSchema = z.object({
  log: z.object({
    entries: z.array(
      z.object({
        request: z.object({
          method: z.string(),
          url: z.string(),
          postData: z.object({ mimeType: z.string().optional(), text: z.string().optional() }).optional(),
        }),
        response: z.object({
          status: z.number().int(),
          content: z.object({
            mimeType: z.string().optional(),
            text: z.string().optional(),
            encoding: z.string().optional(),
          }),
        }),
      }),
    ),
  }),
});
export type Har = z.infer<typeof HarSchema>;

export interface DiscoverOptions {
  /** Keep only hosts equal to, or subdomains of, one of these. Empty = all hosts. */
  hosts?: string[];
}

interface Endpoint {
  servers: Set<string>;
  params: string[];
  count: number;
  query?: JsonSchema | undefined;
  body?: JsonSchema | undefined;
  responses: Map<number, JsonSchema | undefined>;
}

export async function loadHar(path: string): Promise<Har> {
  return HarSchema.parse(JSON.parse(await readFile(path, "utf8")));
}

// ponytail: ids are digits/uuids/long hex only; slugs (e.g. /users/jane) stay literal — and so leak into paths.
export function pathTemplate(pathname: string): { path: string; params: string[] } {
  const params: string[] = [];
  const path = pathname
    .split("/")
    .map((seg) => {
      if (!ID_KEY.test(seg)) return seg;
      const name = params.length ? `id${params.length + 1}` : "id";
      params.push(name);
      return `{${name}}`;
    })
    .join("/");
  return { path, params };
}

const isJson = (mime: string | undefined) => /\bjson\b/i.test(mime ?? "");

function parseJson(text: string | undefined, encoding?: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(encoding === "base64" ? Buffer.from(text, "base64").toString("utf8") : text);
  } catch {
    return undefined;
  }
}

const merge = (a: JsonSchema | undefined, b: JsonSchema | undefined) => (a && b ? mergeSchemas(a, b) : (a ?? b));

function hostAllowed(host: string, hosts: string[]): boolean {
  return !hosts.length || hosts.some((h) => host === h || host.endsWith(`.${h}`));
}

/** OpenAPI 3.1 document for the JSON endpoints seen in `har`. */
export function discoverApi(har: Har, opts: DiscoverOptions = {}) {
  const endpoints = new Map<string, Map<string, Endpoint>>();
  for (const { request, response } of har.log.entries) {
    if (!isJson(response.content.mimeType) && !isJson(request.postData?.mimeType)) continue;
    const url = new URL(request.url);
    if (!hostAllowed(url.hostname, opts.hosts ?? [])) continue;

    const { path, params } = pathTemplate(url.pathname);
    const method = request.method.toLowerCase();
    const methods = endpoints.get(path) ?? new Map<string, Endpoint>();
    endpoints.set(path, methods);
    const ep: Endpoint = methods.get(method) ?? { servers: new Set(), params, count: 0, responses: new Map() };
    methods.set(method, ep);

    ep.servers.add(url.origin);
    ep.count++;
    if (url.search) {
      const q = Object.fromEntries([...url.searchParams].map(([k, v]) => [k, coerceScalar(v)]));
      ep.query = merge(ep.query, inferSchema(q));
    }
    const body = parseJson(request.postData?.text);
    if (body !== undefined) ep.body = merge(ep.body, inferSchema(body));
    const res = parseJson(response.content.text, response.content.encoding);
    const resSchema = res === undefined ? undefined : inferSchema(res);
    ep.responses.set(response.status, merge(ep.responses.get(response.status), resSchema));
  }

  const paths: Record<string, unknown> = {};
  for (const [path, methods] of [...endpoints].sort(([a], [b]) => a.localeCompare(b))) {
    const item: Record<string, unknown> = {};
    const servers = new Set<string>();
    for (const [method, ep] of methods) {
      for (const s of ep.servers) servers.add(s);
      item[method] = toOperation(ep);
    }
    paths[path] = { servers: [...servers].sort().map((url) => ({ url })), ...item };
  }
  return { openapi: "3.1.0", info: { title: "Discovered API", version: "0.0.0" }, paths };
}

function toOperation(ep: Endpoint) {
  const parameters = [
    ...ep.params.map((name) => ({ name, in: "path", required: true, schema: { type: "string" } })),
    ...Object.entries(ep.query?.properties ?? {}).map(([name, schema]) => ({
      name,
      in: "query",
      required: ep.query?.required?.includes(name) ?? false,
      schema,
    })),
  ];
  const responses = Object.fromEntries(
    [...ep.responses]
      .sort(([a], [b]) => a - b)
      .map(([status, schema]) => [
        String(status),
        schema ? { description: "", content: { "application/json": { schema } } } : { description: "" },
      ]),
  );
  return {
    "x-sample-count": ep.count,
    ...(parameters.length ? { parameters } : {}),
    ...(ep.body ? { requestBody: { content: { "application/json": { schema: ep.body } } } } : {}),
    responses,
  };
}
