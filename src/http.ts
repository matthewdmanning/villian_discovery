import { describeErrorBody, HttpError, LibbyError } from "./errors.js";
import type { Logger } from "./logger.js";

export interface HttpOptions {
  timeoutMs: number;
  retries: number;
  retryBaseMs: number;
  userAgent: string;
  fetch?: typeof fetch;
  logger: Logger;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  query?: Record<string, string | number | boolean | undefined>;
  json?: unknown;
  form?: Record<string, string>;
  headers?: Record<string, string>;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/** Minimal JSON HTTP client with timeouts, retries and Libby-aware errors. */
export class HttpClient {
  private readonly doFetch: typeof fetch;

  constructor(
    private readonly baseUrl: string,
    private readonly opts: HttpOptions,
    private readonly defaultHeaders: () => Record<string, string> = () => ({}),
  ) {
    this.doFetch = opts.fetch ?? globalThis.fetch;
  }

  async request<T = unknown>(path: string, req: RequestOptions = {}): Promise<T> {
    const url = new URL(path, this.baseUrl);
    for (const [k, v] of Object.entries(req.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const headers: Record<string, string> = {
      "User-Agent": this.opts.userAgent,
      Accept: "application/json",
      Referer: "https://libbyapp.com/",
      Origin: "https://libbyapp.com",
      ...this.defaultHeaders(),
      ...req.headers,
    };
    let body: string | undefined;
    if (req.json !== undefined) {
      headers["Content-Type"] = "application/json; charset=UTF-8";
      body = JSON.stringify(req.json);
    } else if (req.form) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(req.form).toString();
    }
    const method = req.method ?? (body === undefined ? "GET" : "POST");

    for (let attempt = 0; ; attempt++) {
      this.opts.logger.debug(`${method} ${url.toString()}${attempt ? ` (retry ${attempt})` : ""}`);
      let res: Response;
      try {
        res = await this.doFetch(url, {
          method,
          headers,
          ...(body !== undefined ? { body } : {}),
          signal: AbortSignal.timeout(this.opts.timeoutMs),
        });
      } catch (err) {
        if (attempt < this.opts.retries) {
          await sleep(backoff(this.opts.retryBaseMs, attempt));
          continue;
        }
        throw new LibbyError(`Network error calling ${method} ${url.pathname}: ${String(err)}`, {
          cause: err,
        });
      }

      const text = await res.text();
      const parsed = parseBody(text, res.headers.get("content-type"));
      if (res.ok) return parsed as T;

      if (RETRYABLE_STATUS.has(res.status) && attempt < this.opts.retries) {
        await sleep(retryAfterMs(res) ?? backoff(this.opts.retryBaseMs, attempt));
        continue;
      }
      const { message, errorCode } = describeErrorBody(parsed);
      throw new HttpError(
        `${method} ${url.pathname} failed: HTTP ${res.status}${message ? ` - ${message}` : ""}${
          errorCode ? ` [${errorCode}]` : ""
        }`,
        res.status,
        url.toString(),
        parsed,
        errorCode,
      );
    }
  }
}

function parseBody(text: string, contentType: string | null): unknown {
  if (!text.trim()) return {};
  if (contentType?.includes("json") || /^[[{]/.test(text.trim())) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

function backoff(baseMs: number, attempt: number): number {
  return baseMs * 2 ** attempt + Math.floor(Math.random() * baseMs);
}

function retryAfterMs(res: Response): number | undefined {
  const h = res.headers.get("retry-after");
  if (!h) return undefined;
  const secs = Number(h);
  if (Number.isFinite(secs)) return Math.min(secs * 1000, 60_000);
  const date = Date.parse(h);
  return Number.isNaN(date) ? undefined : Math.max(0, Math.min(date - Date.now(), 60_000));
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
