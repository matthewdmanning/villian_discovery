import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Exercises the built CLI against a local account simulator; never calls Libby.
const directory = await mkdtemp(join(tmpdir(), "libby-cli-smoke-"));
const tokenFile = join(directory, "identity.json");
const configFile = join(directory, "config.json");
const reportFile = join(directory, "report.json");
const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const requests = [];
let approved = false;
let chips = 0;
let runMode = false;
const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const form = new URLSearchParams(Buffer.concat(chunks).toString());
  requests.push([request.method, url.pathname]);
  let body;
  if (url.pathname === "/chip" && request.method === "POST") {
    if (chips) assert.equal(request.headers.authorization, "Bearer anonymous-test");
    body = { identity: ++chips === 1 ? "anonymous-test" : "linked-test" };
  } else if (url.pathname === "/chip/clone/code") {
    assert.equal(url.searchParams.get("role"), "pointer");
    body = approved ? { result: "fulfilled", blessing: "approval-test" } : { code: "12345678" };
  } else if (url.pathname === "/chip/clone") {
    assert.equal(form.get("blessing"), "approval-test");
    body = {};
  } else if (url.pathname === "/chip/sync") {
    assert.equal(request.headers.authorization, "Bearer linked-test");
    body = {
      cards: [{ cardId: "100", advantageKey: "one" }, ...(runMode ? [{ cardId: "200", advantageKey: "two" }] : [])],
      loans: [],
      holds: [],
    };
  } else if (url.pathname.includes("/libraries/")) {
    body = { id: "111", title: "Example", type: { id: "ebook" }, isOwned: true, ownedCopies: 1 };
  } else if (url.pathname === "/card/100/hold/111") {
    body = {};
  } else if (url.pathname === "/card/200/hold/111") {
    response.statusCode = 401;
    body = { message: "simulated expired authentication" };
  } else {
    response.statusCode = 404;
    body = {};
  }
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(body));
});

function execute(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      env: { ...process.env, LIBBY_IDENTITY_TOKEN: "", LIBBY_TOKEN_FILE: tokenFile, LIBBY_DRY_RUN: "false" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("CLI smoke test timed out"));
    }, 15_000);
    child.stdout.on("data", (data) => {
      stdout += data;
    });
    child.stderr.on("data", (data) => {
      stderr += data;
      if (stderr.includes("Setup code: 12345678")) approved = true;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
  });
}

try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/`;
  await writeFile(
    configFile,
    JSON.stringify({
      auth: { tokenFile },
      delayMs: 0,
      logLevel: "silent",
      action: "hold",
      hold: { placement: "all" },
      http: { sentryBaseUrl: baseUrl, thunderBaseUrl: baseUrl, retries: 0 },
      output: { reportFile },
    }),
  );
  const login = await execute(["login", "--device-code", "--config", configFile]);
  assert.equal(login.code, 0, login.stderr);
  assert.match(login.stderr, /existing Libby device/);
  assert.equal(JSON.parse(await readFile(tokenFile, "utf8")).identity, "linked-test");
  if (process.platform !== "win32") assert.equal((await stat(tokenFile)).mode & 0o777, 0o600);
  assert.deepEqual(requests, [
    ["POST", "/chip"],
    ["GET", "/chip/clone/code"],
    ["GET", "/chip/clone/code"],
    ["POST", "/chip/clone"],
    ["POST", "/chip"],
    ["GET", "/chip/sync"],
  ]);
  runMode = true;
  for (const format of ["json", "ndjson", "table"]) {
    const run = await execute(["run", "--book", "id:111", "--config", configFile, "--output", format]);
    assert.equal(run.code, 2, run.stderr);
    const rows = format === "table" ? undefined : JSON.parse(run.stdout);
    if (format === "json") assert.equal(rows[0].status, "held");
    if (format === "ndjson") assert.equal(rows.status, "held");
    if (format === "table") assert.match(run.stdout, /held.*Example/);
    assert.deepEqual(
      JSON.parse(await readFile(reportFile, "utf8")).results.map((row) => row.status),
      ["held"],
    );
  }
  console.log(
    "CLI regression checks passed: device-code pairing, refreshed token, permissions and partial reports in all formats.",
  );
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
