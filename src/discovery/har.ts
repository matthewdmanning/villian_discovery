/**
 * API discovery from a browser HAR capture (DevTools → Network → Save all as HAR).
 *
 * Groups JSON requests by method + path template (`/books/123` → `/books/{id}`) and
 * emits an OpenAPI 3.1 document. Schemas hold types only, and auth holds header/cookie
 * names and the scheme word only — never values — so the output can be committed.
 * The HAR itself holds secrets: never commit it.
 */
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { coerceScalar, ID_KEY, inferSchema, type JsonSchema, mergeSchemas } from "./schema.js";

const NameValues = z.array(z.object({ name: z.string(), value: z.string() })).optional();

const HarSchema = z.object({
  log: z.object({
    entries: z.array(
      z.object({
        request: z.object({
          method: z.string(),
          url: z.string(),
          headers: NameValues,
          cookies: NameValues,
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
type HarRequest = Har["log"]["entries"][number]["request"];

export interface DiscoverOptions {
  /** Keep only hosts equal to, or subdomains of, one of these. Empty = all hosts. */
  hosts?: string[];
}

type SecurityScheme = Record<string, string>;

interface Endpoint {
  servers: Set<string>;
  params: string[];
  paramSchemas: (JsonSchema | undefined)[];
  count: number;
  query?: JsonSchema | undefined;
  /** Request body schema per media type. */
  bodies: Map<string, JsonSchema>;
  responses: Map<number, JsonSchema | undefined>;
  /** Scheme names seen together on one request, space-joined; "" = no auth. */
  security: Set<string>;
}

export async function loadHar(path: string): Promise<Har> {
  return HarSchema.parse(JSON.parse(await readFile(path, "utf8")));
}

/** Slug ending in a long numeric id, e.g. `jane-doe-123456789012`. */
const SLUG_ID = /^[\w-]+-\d{6,}$/;

// ponytail: ids are digits/uuids/long hex/slug-with-id only; bare slugs (e.g. /users/jane) stay literal — and so leak into paths.
export function pathTemplate(pathname: string): { path: string; params: string[]; values: string[] } {
  const params: string[] = [];
  const values: string[] = [];
  const path = pathname
    .split("/")
    .map((seg) => {
      if (!ID_KEY.test(seg) && !SLUG_ID.test(seg)) return seg;
      const name = params.length ? `id${params.length + 1}` : "id";
      params.push(name);
      values.push(seg);
      return `{${name}}`;
    })
    .join("/");
  return { path, params, values };
}

const isJson = (mime: string | undefined) => /\bjson\b/i.test(mime ?? "");
const FORM = "application/x-www-form-urlencoded";

function parseJson(text: string | undefined, encoding?: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(encoding === "base64" ? Buffer.from(text, "base64").toString("utf8") : text);
  } catch {
    return undefined;
  }
}

const coerceParams = (p: URLSearchParams) => Object.fromEntries([...p].map(([k, v]) => [k, coerceScalar(v)]));

/** Request body as [media type, sample], for JSON and form bodies. */
function parseBody(postData: HarRequest["postData"]): [string, unknown] | undefined {
  const mime = postData?.mimeType?.split(";")[0]?.trim().toLowerCase();
  if (!mime || !postData?.text) return undefined;
  if (isJson(mime)) {
    const body = parseJson(postData.text);
    return body === undefined ? undefined : [mime, body];
  }
  if (mime === FORM) return [mime, coerceParams(new URLSearchParams(postData.text))];
  return undefined;
}

const API_KEY_HEADER = /^(x-[\w-]*(token|key|auth)[\w-]*|api-?key)$/i;
// ponytail: name heuristic; add a --session-cookie option if fable.co's session cookie is missed.
const SESSION_COOKIE = /sess|auth|token|jwt|sid/i;
const AUTH_SCHEME = /^([A-Za-z][\w-]{0,19}) \S/;

/** Auth schemes on one request, keyed by OpenAPI scheme name. Reads names and scheme words only. */
export function securityOf(request: HarRequest): Map<string, SecurityScheme> {
  const out = new Map<string, SecurityScheme>();
  for (const { name, value } of request.headers ?? []) {
    const h = name.toLowerCase();
    if (h === "authorization") {
      const scheme = AUTH_SCHEME.exec(value)?.[1]?.toLowerCase();
      if (scheme) out.set(scheme, { type: "http", scheme });
      else out.set(h, { type: "apiKey", in: "header", name: h });
    } else if (API_KEY_HEADER.test(h)) out.set(h, { type: "apiKey", in: "header", name: h });
  }
  for (const { name } of request.cookies ?? []) {
    if (SESSION_COOKIE.test(name))
      out.set(`cookie.${name}`.replace(/[^\w.-]/g, "_"), { type: "apiKey", in: "cookie", name });
  }
  return out;
}

const merge = (a: JsonSchema | undefined, b: JsonSchema | undefined) => (a && b ? mergeSchemas(a, b) : (a ?? b));

export function hostAllowed(host: string, hosts: string[]): boolean {
  return !hosts.length || hosts.some((h) => host === h || host.endsWith(`.${h}`));
}

/** OpenAPI 3.1 document for the JSON endpoints seen in `har`. */
export function discoverApi(har: Har, opts: DiscoverOptions = {}) {
  const endpoints = new Map<string, Map<string, Endpoint>>();
  const schemes = new Map<string, SecurityScheme>();
  for (const { request, response } of har.log.entries) {
    if (!isJson(response.content.mimeType) && !isJson(request.postData?.mimeType)) continue;
    const url = new URL(request.url);
    if (!hostAllowed(url.hostname, opts.hosts ?? [])) continue;

    const { path, params, values } = pathTemplate(url.pathname);
    const method = request.method.toLowerCase();
    const methods = endpoints.get(path) ?? new Map<string, Endpoint>();
    endpoints.set(path, methods);
    const ep: Endpoint = methods.get(method) ?? {
      servers: new Set(),
      params,
      paramSchemas: [],
      count: 0,
      bodies: new Map(),
      responses: new Map(),
      security: new Set(),
    };
    methods.set(method, ep);

    ep.servers.add(url.origin);
    ep.count++;
    values.forEach((v, i) => {
      ep.paramSchemas[i] = merge(ep.paramSchemas[i], inferSchema(coerceScalar(v)));
    });
    if (url.search) ep.query = merge(ep.query, inferSchema(coerceParams(url.searchParams)));
    const body = parseBody(request.postData);
    if (body) ep.bodies.set(body[0], merge(ep.bodies.get(body[0]), inferSchema(body[1]))!);
    const res = parseJson(response.content.text, response.content.encoding);
    const resSchema = res === undefined ? undefined : inferSchema(res);
    ep.responses.set(response.status, merge(ep.responses.get(response.status), resSchema));

    const seen = securityOf(request);
    for (const [name, scheme] of seen) schemes.set(name, scheme);
    ep.security.add([...seen.keys()].sort().join(" "));
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
  const securitySchemes = Object.fromEntries([...schemes].sort(([a], [b]) => a.localeCompare(b)));
  return {
    openapi: "3.1.0",
    info: { title: "Discovered API", version: "0.0.0" },
    paths,
    ...(schemes.size ? { components: { securitySchemes } } : {}),
  };
}

function toOperation(ep: Endpoint) {
  const parameters = [
    ...ep.params.map((name, i) => ({
      name,
      in: "path",
      required: true,
      schema: ep.paramSchemas[i] ?? { type: "string" },
    })),
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
  const content = Object.fromEntries([...ep.bodies].map(([mime, schema]) => [mime, { schema }]));
  // One requirement per auth combination seen; {} = some samples had no auth.
  const security = [...ep.security]
    .sort()
    .map((names) => Object.fromEntries(names ? names.split(" ").map((n) => [n, []]) : []));
  return {
    "x-sample-count": ep.count,
    ...(parameters.length ? { parameters } : {}),
    ...(ep.bodies.size ? { requestBody: { content } } : {}),
    responses,
    ...(security.some((r) => Object.keys(r).length) ? { security } : {}),
  };
}
