#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Command, InvalidArgumentError, Option } from "commander";
import { z } from "zod";
import { loginWithSetupCode, writeTokenFile } from "./auth.js";
import {
  type Config,
  type ConfigInput,
  ConfigSchema,
  configFromEnv,
  loadConfigFile,
  mergeConfig,
  parseConfig,
} from "./config.js";
import { LibbyError } from "./errors.js";
import { createClients } from "./index.js";
import { type BookRequest, type InputFormat, parseBookLine, readBooksFile } from "./input.js";
import { LibbyClient } from "./libby-client.js";
import { createLogger } from "./logger.js";
import { formatTable, summarize } from "./report.js";
import { type BookResult, cardLabel, Runner, selectCards } from "./runner.js";

const DEFAULT_CONFIG = "libby.config.json";

const int = (v: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new InvalidArgumentError("must be a non-negative integer");
  return n;
};
const collect = (v: string, prev: string[] = []) => [
  ...prev,
  ...v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
];

interface CommonOpts {
  config?: string;
  logLevel?: Config["logLevel"];
}

async function buildConfig(opts: CommonOpts, cli: ConfigInput): Promise<Config> {
  const path = opts.config ?? (existsSync(DEFAULT_CONFIG) ? DEFAULT_CONFIG : undefined);
  const file = path ? await loadConfigFile(path) : {};
  return parseConfig(mergeConfig(file, configFromEnv(), cli, opts.logLevel ? { logLevel: opts.logLevel } : {}));
}

const program = new Command()
  .name("libby-shelf")
  .description("Borrow or place holds on Libby titles from a list of books.")
  .version("0.1.0")
  .showHelpAfterError();

const configOpt = () => new Option("-c, --config <path>", `JSON config file (default: ./${DEFAULT_CONFIG} if present)`);
const logOpt = () =>
  new Option("--log-level <level>", "log verbosity").choices(["silent", "error", "warn", "info", "debug"] as const);

program
  .command("run")
  .description("Borrow or hold every book in the given list(s).")
  .argument("[files...]", "book lists (.json, .csv, .tsv, or text; '-' for stdin)")
  .addOption(configOpt())
  .addOption(logOpt())
  .option(
    "-b, --book <line>",
    "add a book inline, e.g. 'Dune by Frank Herbert' (repeatable)",
    (v, p: string[] = []) => [...p, v],
  )
  .addOption(new Option("--input-format <fmt>", "force input format").choices(["json", "csv", "tsv", "text"] as const))
  .addOption(
    new Option("-a, --action <action>", "default action per book").choices(["auto", "borrow", "hold"] as const),
  )
  .option("-l, --library <keys>", "library keys in priority order (repeatable/comma list)", collect)
  .option("--card <ids>", "only use these card ids or names (repeatable/comma list)", collect)
  .option("-m, --media <types>", "media types in preference order: ebook,audiobook,magazine", collect)
  .addOption(new Option("--placement <mode>", "where to place holds").choices(["best", "first", "all"] as const))
  .option("--max-wait <days>", "skip holds with a longer estimated wait", int)
  .option("--max-holds-count <n>", "skip holds with more people waiting", int)
  .option("--suspend <days>", "deliver holds later: suspend N days (0-30, 60, 90)", int)
  .option("--lending <period>", "loan length: preference | max | <days>")
  .option("--max-borrows <n>", "cap loans this run", int)
  .option("--max-new-holds <n>", "cap holds this run", int)
  .option("--min-title-score <x>", "title match threshold 0-1", Number)
  .option("--no-lucky-day", "never borrow Lucky Day copies")
  .option("--no-skip-existing", "act even if already on loan/hold")
  .option("--no-respect-limits", "ignore card loan/hold limits")
  .option("-n, --dry-run", "plan only; change nothing")
  .option("--delay <ms>", "pause between books", int)
  .option("--fail-fast", "stop at the first error")
  .addOption(new Option("-o, --output <fmt>", "stdout format").choices(["table", "json", "ndjson"] as const))
  .option("--report <file>", "also write a JSON report here")
  .action(async (files: string[], o) => {
    const cli: ConfigInput = {
      ...(o.action && { action: o.action }),
      ...(o.library && { libraries: o.library }),
      ...(o.card && { cards: o.card }),
      ...(o.media && { mediaTypes: o.media }),
      ...(o.dryRun && { dryRun: true }),
      ...(o.failFast && { failFast: true }),
      ...(o.delay !== undefined && { delayMs: o.delay }),
      ...(o.skipExisting === false && { skipExisting: false }),
      ...(o.respectLimits === false && { respectCardLimits: false }),
      borrow: {
        ...(o.lending && { lendingPeriod: /^\d+$/.test(o.lending) ? Number(o.lending) : o.lending }),
        ...(o.luckyDay === false && { luckyDay: false }),
        ...(o.maxBorrows !== undefined && { maxPerRun: o.maxBorrows }),
      },
      hold: {
        ...(o.placement && { placement: o.placement }),
        ...(o.maxWait !== undefined && { maxEstimatedWaitDays: o.maxWait }),
        ...(o.maxHoldsCount !== undefined && { maxHoldsCount: o.maxHoldsCount }),
        ...(o.suspend !== undefined && { suspendDays: o.suspend }),
        ...(o.maxNewHolds !== undefined && { maxPerRun: o.maxNewHolds }),
      },
      matching: { ...(o.minTitleScore !== undefined && { minTitleScore: o.minTitleScore }) },
      output: { ...(o.output && { format: o.output }), ...(o.report && { reportFile: o.report }) },
    } as ConfigInput;
    const cfg = await buildConfig(o, cli);

    const books: BookRequest[] = [];
    for (const f of files) books.push(...(await readBooksFile(f, o.inputFormat as InputFormat | undefined)));
    for (const line of (o.book as string[] | undefined) ?? []) books.push(parseBookLine(line));
    if (!books.length) throw new LibbyError("No books given. Pass a file, '-' for stdin, or --book.");

    const deps = await createClients(cfg);
    if (cfg.dryRun) deps.logger.info("Dry run: nothing will be borrowed or held.");
    const fmt = cfg.output.format;
    const results = await new Runner(cfg, deps).run(books, (r) => {
      if (fmt === "ndjson") process.stdout.write(`${JSON.stringify(r)}\n`);
    });
    if (fmt === "json") process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
    if (fmt === "table") process.stdout.write(`${formatTable(results)}\n`);
    deps.logger.info(summarize(results));
    if (cfg.output.reportFile) await writeReport(cfg.output.reportFile, results);
    if (results.some((r) => r.status === "error")) process.exitCode = 1;
  });

program
  .command("login")
  .description("Link this tool to your Libby account with a setup code and save the token.")
  .requiredOption("--code <code>", "8-digit code from Libby: Menu > Copy To Another Device")
  .option("--token-file <path>", "where to save the identity token")
  .addOption(configOpt())
  .addOption(logOpt())
  .action(async (o) => {
    const cfg = await buildConfig(o, o.tokenFile ? { auth: { tokenFile: o.tokenFile } } : {});
    const logger = createLogger(cfg.logLevel);
    const client = new LibbyClient({
      ...cfg.http,
      logger,
      ...(cfg.http.sentryBaseUrl ? { baseUrl: cfg.http.sentryBaseUrl } : {}),
    });
    const identity = await loginWithSetupCode(client, String(o.code).trim());
    await writeTokenFile(cfg.auth.tokenFile, identity);
    logger.info(`Logged in. Token saved to ${cfg.auth.tokenFile} (mode 600).`);
  });

program
  .command("cards")
  .description("List library cards with loan/hold usage.")
  .addOption(configOpt())
  .addOption(logOpt())
  .option("--json", "print raw JSON")
  .action(async (o) => {
    const cfg = await buildConfig(o, {});
    const { libby } = await createClients(cfg);
    const sync = await libby.sync();
    const cards = sync.cards ?? [];
    if (o.json) return void process.stdout.write(`${JSON.stringify(cards, null, 2)}\n`);
    for (const c of cards) {
      const u = (k: "loan" | "hold") => `${c.counts?.[k] ?? "?"}/${c.limits?.[k] ?? "?"}`;
      process.stdout.write(`${c.cardId}\t${cardLabel(c)}\tloans ${u("loan")}\tholds ${u("hold")}\n`);
    }
  });

program
  .command("search")
  .description("Show what each library would match for one book. Changes nothing.")
  .argument("<book...>", "book line, e.g. Project Hail Mary by Andy Weir")
  .addOption(configOpt())
  .addOption(logOpt())
  .option("-l, --library <keys>", "library keys to search", collect)
  .option("-m, --media <types>", "media types", collect)
  .action(async (words: string[], o) => {
    const cfg = await buildConfig(o, {
      ...(o.library && { libraries: o.library }),
      ...(o.media && { mediaTypes: o.media }),
    } as ConfigInput);
    const deps = await createClients(cfg);
    const runner = new Runner(cfg, deps);
    const cards = selectCards((await deps.libby.sync()).cards ?? [], cfg);
    const cands = await runner.findCandidates(parseBookLine(words.join(" ")), cards);
    if (!cands.length) return void process.stdout.write("No match.\n");
    for (const { card, match: m } of cands) {
      const md = m.media;
      process.stdout.write(
        `${[
          `${cardLabel(card)}: ${md.title} — ${md.firstCreatorName ?? "?"} [${md.type?.id}] id=${md.id}`,
          `  score title=${m.titleScore.toFixed(2)} author=${m.authorScore?.toFixed(2) ?? "-"}${m.isbnMatch ? " isbn" : ""}`,
          `  available=${md.isAvailable ?? false} copies=${md.availableCopies ?? "?"}/${md.ownedCopies ?? "?"} holds=${md.holdsCount ?? "?"} wait≈${md.estimatedWaitDays ?? "?"}d`,
        ].join("\n")}\n`,
      );
    }
  });

program
  .command("config")
  .description("Print the effective configuration (token redacted).")
  .addOption(configOpt())
  .addOption(logOpt())
  .action(async (o) => {
    const cfg = await buildConfig(o, {});
    const shown = { ...cfg, auth: { ...cfg.auth, ...(cfg.auth.identityToken && { identityToken: "***" }) } };
    process.stdout.write(`${JSON.stringify(shown, null, 2)}\n`);
  });

program
  .command("schema")
  .description("Print the config file JSON Schema (for editor autocompletion).")
  .action(() => {
    const schema = z.toJSONSchema(ConfigSchema, { io: "input", unrepresentable: "any" });
    process.stdout.write(`${JSON.stringify(schema, null, 2)}\n`);
  });

async function writeReport(path: string, results: BookResult[]) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)}\n`);
}

program.parseAsync(process.argv).catch((e: unknown) => {
  process.stderr.write(`error: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 2;
});
