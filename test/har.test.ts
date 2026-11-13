import { describe, expect, it } from "vitest";
import { discoverApi, type Har, pathTemplate, securityOf } from "../src/discovery/har.js";

type Entry = Har["log"]["entries"][number];
type Request = Entry["request"];

const entry = (
  method: string,
  url: string,
  status: number,
  res?: unknown,
  body?: unknown,
  request: Partial<Request> = {},
): Entry => ({
  request: {
    method,
    url,
    ...(body !== undefined ? { postData: { mimeType: "application/json", text: JSON.stringify(body) } } : {}),
    ...request,
  },
  response: {
    status,
    content:
      res === undefined
        ? { mimeType: "text/html", text: "<p>" }
        : { mimeType: "application/json", text: JSON.stringify(res) },
  },
});

const har = (...entries: Entry[]): Har => ({ log: { entries } });
const bearer = { headers: [{ name: "Authorization", value: "Bearer SECRET-TOKEN" }] };

describe("pathTemplate", () => {
  it("replaces id segments with numbered params", () => {
    expect(pathTemplate("/api/books/123/reviews/0b5c1e9e-2f6a-4d4f-9a1e-1c2d3e4f5a6b")).toEqual({
      path: "/api/books/{id}/reviews/{id2}",
      params: ["id", "id2"],
      values: ["123", "0b5c1e9e-2f6a-4d4f-9a1e-1c2d3e4f5a6b"],
    });
    expect(pathTemplate("/api/v2/feed")).toEqual({ path: "/api/v2/feed", params: [], values: [] });
    expect(pathTemplate("/api/usernames/jane-doe-123456789012").path).toBe("/api/usernames/{id}");
  });
});

describe("securityOf", () => {
  const schemes = (request: Partial<Request>) =>
    Object.fromEntries(securityOf({ method: "GET", url: "x", ...request }));

  it("keeps the scheme word, never the credential", () => {
    expect(schemes(bearer)).toEqual({ bearer: { type: "http", scheme: "bearer" } });
    expect(schemes({ headers: [{ name: "authorization", value: "SECRET-TOKEN" }] })).toEqual({
      authorization: { type: "apiKey", in: "header", name: "authorization" },
    });
  });

  it("finds api-key headers and session cookies by name", () => {
    expect(
      schemes({
        headers: [
          { name: "X-Api-Key", value: "k" },
          { name: "accept", value: "*/*" },
        ],
        cookies: [
          { name: "sessionid", value: "s" },
          { name: "_ga", value: "g" },
        ],
      }),
    ).toEqual({
      "x-api-key": { type: "apiKey", in: "header", name: "x-api-key" },
      "cookie.sessionid": { type: "apiKey", in: "cookie", name: "sessionid" },
    });
  });
});

describe("discoverApi", () => {
  const doc = discoverApi(
    har(
      entry("GET", "https://api.fable.co/books/1?page=1&q=dune", 200, { id: 1, title: "Dune" }, undefined, bearer),
      entry("GET", "https://api.fable.co/books/2?page=2", 200, { id: 2, title: "Emma", isbn: "x" }, undefined, bearer),
      entry("GET", "https://api.fable.co/books/9", 404, { error: "not found" }),
      entry("POST", "https://fable.co/api/clubs", 201, { id: "c" }, { name: "Secret Club" }),
      entry("POST", "https://fable.co/api/login", 200, { ok: true }, undefined, {
        postData: { mimeType: "application/x-www-form-urlencoded; charset=UTF-8", text: "user=jane&remember=true" },
      }),
      entry("GET", "https://fable.co/about", 200),
      entry("GET", "https://tracker.example/collect", 200, { ok: true }),
    ),
    { hosts: ["fable.co"] },
  );

  it("keeps JSON endpoints on allowed hosts only", () => {
    expect(Object.keys(doc.paths)).toEqual(["/api/clubs", "/api/login", "/books/{id}"]);
  });

  it("merges samples per method + template", () => {
    const books = doc.paths["/books/{id}"] as Record<string, unknown>;
    expect(books).toMatchObject({
      servers: [{ url: "https://api.fable.co" }],
      get: {
        "x-sample-count": 3,
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "integer" } },
          { name: "page", in: "query", required: true, schema: { type: "integer" } },
          { name: "q", in: "query", required: false, schema: { type: "string" } },
        ],
        responses: { "200": { content: { "application/json": { schema: { required: ["id", "title"] } } } } },
      },
    });
    expect(Object.keys((books.get as { responses: object }).responses)).toEqual(["200", "404"]);
  });

  it("infers JSON and form request bodies", () => {
    expect(doc.paths["/api/clubs"]).toMatchObject({
      post: {
        requestBody: { content: { "application/json": { schema: { properties: { name: { type: "string" } } } } } },
      },
    });
    expect(doc.paths["/api/login"]).toMatchObject({
      post: {
        requestBody: {
          content: {
            "application/x-www-form-urlencoded": {
              schema: { properties: { user: { type: "string" }, remember: { type: "boolean" } } },
            },
          },
        },
      },
    });
  });

  it("records auth per operation; {} marks samples without auth", () => {
    expect(doc.components?.securitySchemes).toEqual({ bearer: { type: "http", scheme: "bearer" } });
    expect(doc.paths["/books/{id}"]).toMatchObject({ get: { security: [{}, { bearer: [] }] } });
    expect(doc.paths["/api/clubs"]).not.toHaveProperty("post.security");
  });

  it("never leaks sample values or credentials", () => {
    expect(JSON.stringify(doc)).not.toMatch(/Secret Club|Dune|Emma|not found|jane|SECRET-TOKEN/);
  });
});
