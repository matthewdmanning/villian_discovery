#!/usr/bin/env node
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { Command, Option } from "commander";
import { z } from "zod";
import { captureSession } from "./capture.js";
import { exportLists } from "./export-lists.js";
import { discoverApi, loadHar } from "./har.js";
import { formatResults, loadSiteTestConfig, runSiteChecks, SiteTestConfigSchema } from "./site-check.js";

const DEFAULT_CONFIG = "site-tests.json";

const program = new Command()
  .name("site-check")
  .description("Run configurable website / endpoint checks. Exit 1 if any check fails.")
  .version("0.1.0")
  .showHelpAfterError();

program
  .command("run", { isDefault: true })
  .description("run checks from a config file")
  .argument("[config]", `config file (default: ./${DEFAULT_CONFIG})`)
  .option("--only <names...>", "only sites matching name, url or tag")
  .addOption(new Option("-o, --output <format>", "output format").choices(["table", "json"]).default("table"))
  .action(async (path: string | undefined, opts: { only?: string[]; output: "table" | "json" }) => {
    const file = path ?? DEFAULT_CONFIG;
    if (!existsSync(file)) throw new Error(`config not found: ${file}`);
    const { config, baseDir } = await loadSiteTestConfig(file);
    const results = await runSiteChecks(config, { baseDir, ...(opts.only ? { only: opts.only } : {}) });
    process.stdout.write(`${opts.output === "json" ? JSON.stringify(results, null, 2) : formatResults(results)}\n`);
    if (results.some((r) => !r.ok)) process.exitCode = 1;
  });

program
  .command("discover")
  .description("infer an OpenAPI document from a browser HAR capture (the HAR holds secrets; never commit it)")
  .argument("<har>", "HAR file (DevTools → Network → Save all as HAR)")
  .option("--host <hosts...>", "keep only these hosts and their subdomains", ["fable.co"])
  .option("--all-hosts", "keep every host")
  .option("--out <file>", "write to this file instead of stdout")
  .action(async (har: string, opts: { host: string[]; allHosts?: boolean; out?: string }) => {
    const doc = discoverApi(await loadHar(har), { hosts: opts.allHosts ? [] : opts.host });
    const text = `${JSON.stringify(doc, null, 2)}\n`;
    if (opts.out) await writeFile(opts.out, text);
    else process.stdout.write(text);
  });

program
  .command("capture")
  .description("open a browser, wait for you to log in, explore the site, and save an OpenAPI document")
  .argument("[url]", "start page", "https://fable.co/")
  .option("--host <hosts...>", "keep only these hosts and their subdomains", ["fable.co"])
  .option("--out <file>", "output file", "fable-openapi.json")
  .option("--max-pages <n>", "max pages to explore", (v) => Number.parseInt(v, 10), 30)
  .option("--focus <regex>", "explore links whose path matches first", "^/(library|book-list|books?)(/|$)")
  .action(async (url: string, opts: { host: string[]; out: string; maxPages: number; focus: string }) => {
    const log = (m: string) => process.stdout.write(`${m}\n`);
    log("A browser window will open. You only need to log in.");
    const focus = new RegExp(opts.focus, "i");
    const har = await captureSession(url, { hosts: opts.host, maxPages: opts.maxPages, focus, log });
    const doc = discoverApi(har, { hosts: opts.host });
    await writeFile(opts.out, `${JSON.stringify(doc, null, 2)}\n`);
    const auth = Object.keys(doc.components?.securitySchemes ?? {}).join(", ") || "none";
    log(`Done. Found ${Object.keys(doc.paths).length} API paths (auth: ${auth}). Saved to ${opts.out}`);
  });

program
  .command("export-lists")
  .description("open a browser, wait for you to log in, and save each fable.co book list as a book file")
  .option("--out <dir>", "output folder", "fable-lists")
  .action(async (opts: { out: string }) => {
    const log = (m: string) => process.stdout.write(`${m}\n`);
    log("A browser window will open. You only need to log in.");
    const count = await exportLists({ outDir: opts.out, log });
    log(`Done. Saved ${count} lists to ${opts.out}`);
  });

program
  .command("schema")
  .description("print JSON Schema for the config file")
  .action(() => {
    process.stdout.write(`${JSON.stringify(z.toJSONSchema(SiteTestConfigSchema), null, 2)}\n`);
  });

program.parseAsync().catch((e: unknown) => {
  process.stderr.write(`site-check: ${e instanceof z.ZodError ? z.prettifyError(e) : (e as Error).message}\n`);
  process.exitCode = 2;
});
