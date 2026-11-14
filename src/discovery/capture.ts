/**
 * Live capture: open the user's installed Chrome or Edge, wait for them to log in,
 * then browse the site on its own and collect JSON traffic.
 *
 * The browser profile persists, so later runs start logged in. Exploration only
 * follows links (GET page loads): it never clicks buttons or submits forms.
 * Traffic stays in memory. Cookie values are dropped at capture time. Only the
 * value-free OpenAPI document from `discoverApi` is ever written to disk.
 */
import { setTimeout as sleep } from "node:timers/promises";
import type { Page, Response } from "playwright-core";
import { LOGIN_PROMPT, LOGIN_TIMEOUT_MS, openBrowserSession } from "./browser.js";
import { type Har, hostAllowed, isJson, pathTemplate, securityOf } from "./har.js";

type Entry = Har["log"]["entries"][number];

/** Links the explorer never opens: they could change the account. */
export const UNSAFE_LINK = /log-?out|sign-?out|delete|remove|unsubscribe|deactivate|cancel/i;

export interface CaptureOptions {
  /** Hosts whose links are explored and whose auth marks a login. */
  hosts: string[];
  /** Max pages the explorer opens. */
  maxPages?: number;
  /** Links whose path matches are explored first. */
  focus?: RegExp;
  /** How long to wait for a login before exploring the public site. */
  loginTimeoutMs?: number;
  log?: (message: string) => void;
}

/** One JSON request/response as a HAR entry; undefined for non-JSON traffic. */
export async function toEntry(res: Response): Promise<Entry | undefined> {
  const req = res.request();
  const { cookie, ...headers } = await req.allHeaders();
  const mimeType = (await res.allHeaders())["content-type"];
  const postData = req.postData();
  const requestMime = headers["content-type"];
  if (!isJson(mimeType) && !isJson(requestMime)) return undefined;
  const text = isJson(mimeType) ? await res.text().catch(() => undefined) : undefined;
  return {
    request: {
      method: req.method(),
      url: req.url(),
      headers: Object.entries(headers).map(([name, value]) => ({ name, value })),
      cookies: (cookie ?? "")
        .split(";")
        .map((c) => c.split("=")[0]!.trim())
        .filter(Boolean)
        .map((name) => ({ name, value: "" })),
      ...(postData !== null ? { postData: { mimeType: requestMime, text: postData } } : {}),
    },
    response: { status: res.status(), content: { mimeType, text } },
  };
}

/** Same-site links worth opening: http(s), allowed host, not an account-changing action. */
export function exploreLinks(hrefs: string[], hosts: string[]): string[] {
  return hrefs.flatMap((href) => {
    const u = URL.parse(href);
    if (!u || !/^https?:$/.test(u.protocol) || !hostAllowed(u.hostname, hosts)) return [];
    if (UNSAFE_LINK.test(u.pathname + u.search)) return [];
    u.hash = "";
    return [u.href];
  });
}

// ponytail: one visit per path template; slug paths (/book/dune) each count, so maxPages bounds the crawl.
async function explore(page: Page, startUrl: string, opts: CaptureOptions, isClosed: () => boolean) {
  const maxPages = opts.maxPages ?? 30;
  const seen = new Set<string>();
  const queue = exploreLinks([page.url(), startUrl], opts.hosts);
  let visited = 0;
  while (queue.length && visited < maxPages && !isClosed()) {
    const url = new URL(queue.shift()!);
    const key = url.hostname + pathTemplate(url.pathname).path;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      await page.goto(url.href, { waitUntil: "load", timeout: 30_000 });
      await page.mouse.wheel(0, 20_000); // trigger lazy-loaded lists
      await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
    } catch {
      continue;
    }
    visited++;
    opts.log?.(`Visited ${visited}/${maxPages}: ${url.pathname}`);
    const hrefs = await page
      .locator("a[href]")
      .evaluateAll((els) => els.map((e) => String((e as unknown as { href: string }).href)))
      .catch(() => [] as string[]);
    for (const link of exploreLinks(hrefs, opts.hosts)) {
      if (opts.focus?.test(new URL(link).pathname)) queue.unshift(link);
      else queue.push(link);
    }
  }
}

/** Wait for a login, explore the site, and return the JSON traffic. Closing the window ends it early. */
export async function captureSession(startUrl: string, opts: CaptureOptions): Promise<Har> {
  const { context, page, closed, isClosed } = await openBrowserSession();
  const pending: Promise<Entry | undefined>[] = [];
  let onLogin = () => {};
  const loggedIn = new Promise<void>((resolve) => {
    onLogin = resolve;
  });
  context.on("response", (res) => {
    const entry = toEntry(res).catch(() => undefined);
    pending.push(entry);
    entry.then((e) => {
      if (e && hostAllowed(new URL(e.request.url).hostname, opts.hosts) && securityOf(e.request).size) onLogin();
    });
  });

  await page.goto(startUrl).catch(() => {});
  opts.log?.(`Log in to the site in the browser window. ${LOGIN_PROMPT}`);
  const outcome = await Promise.race([
    loggedIn.then(() => "login" as const),
    closed.then(() => "closed" as const),
    sleep(opts.loginTimeoutMs ?? LOGIN_TIMEOUT_MS).then(() => "timeout" as const),
  ]);

  if (outcome !== "closed") {
    opts.log?.(outcome === "login" ? "Logged in. Exploring the site…" : "No login seen. Exploring the public site…");
    await explore(page, startUrl, opts, isClosed);
  }
  // Long-lived responses (streams, long polls) never finish: give each a short grace period.
  const settled = pending.map((p) => Promise.race([p, sleep(5_000).then(() => undefined)]));
  const entries = (await Promise.all(settled)).filter((e) => e !== undefined);
  await context.close().catch(() => {});
  return { log: { entries } };
}
