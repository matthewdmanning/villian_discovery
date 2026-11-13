import { describe, expect, it } from "vitest";
import { discoverApi, type Har, pathTemplate } from "../src/discovery/har.js";

type Entry = Har["log"]["entries"][number];

const entry = (method: string, url: string, status: number, res?: unknown, body?: unknown): Entry => ({
  request: {
    method,
    url,
    ...(body !== undefined ? { postData: { mimeType: "application/json", text: JSON.stringify(body) } } : {}),
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

describe("pathTemplate", () => {
  it("replaces id segments with numbered params", () => {
    expect(pathTemplate("/api/books/123/reviews/0b5c1e9e-2f6a-4d4f-9a1e-1c2d3e4f5a6b")).toEqual({
      path: "/api/books/{id}/reviews/{id2}",
      params: ["id", "id2"],
    });
    expect(pathTemplate("/api/v2/feed")).toEqual({ path: "/api/v2/feed", params: [] });
  });
});

describe("discoverApi", () => {
  const doc = discoverApi(
    har(
      entry("GET", "https://api.fable.co/books/1?page=1&q=dune", 200, { id: 1, title: "Dune" }),
      entry("GET", "https://api.fable.co/books/2?page=2", 200, { id: 2, title: "Emma", isbn: "x" }),
      entry("GET", "https://api.fable.co/books/9", 404, { error: "not found" }),
      entry("POST", "https://fable.co/api/clubs", 201, { id: "c" }, { name: "Secret Club" }),
      entry("GET", "https://fable.co/about", 200),
      entry("GET", "https://tracker.example/collect", 200, { ok: true }),
    ),
    { hosts: ["fable.co"] },
  );

  it("keeps JSON endpoints on allowed hosts only", () => {
    expect(Object.keys(doc.paths)).toEqual(["/api/clubs", "/books/{id}"]);
  });

  it("merges samples per method + template", () => {
    const books = doc.paths["/books/{id}"] as Record<string, unknown>;
    expect(books).toMatchObject({
      servers: [{ url: "https://api.fable.co" }],
      get: {
        "x-sample-count": 3,
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "page", in: "query", required: true, schema: { type: "integer" } },
          { name: "q", in: "query", required: false, schema: { type: "string" } },
        ],
        responses: { "200": { content: { "application/json": { schema: { required: ["id", "title"] } } } } },
      },
    });
    expect(Object.keys((books.get as { responses: object }).responses)).toEqual(["200", "404"]);
  });

  it("infers request bodies without leaking sample values", () => {
    expect(doc.paths["/api/clubs"]).toMatchObject({
      post: {
        requestBody: { content: { "application/json": { schema: { properties: { name: { type: "string" } } } } } },
      },
    });
    expect(JSON.stringify(doc)).not.toMatch(/Secret Club|Dune|Emma|not found/);
  });
});
