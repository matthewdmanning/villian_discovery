#!/usr/bin/env node
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { Command, Option } from "commander";
import { z } from "zod";
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
  .command("schema")
  .description("print JSON Schema for the config file")
  .action(() => {
    process.stdout.write(`${JSON.stringify(z.toJSONSchema(SiteTestConfigSchema), null, 2)}\n`);
  });

program.parseAsync().catch((e: unknown) => {
  process.stderr.write(`site-check: ${e instanceof z.ZodError ? z.prettifyError(e) : (e as Error).message}\n`);
  process.exitCode = 2;
});
