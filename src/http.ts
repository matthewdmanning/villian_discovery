import { describeErrorBody, HttpError, LibbyError, MutationUncertainError } from "./errors.js";
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
  signal?: AbortSignal | undefined;
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

    const readOnly = method === "GET";
    for (let attempt = 0; ; attempt++) {
      this.opts.logger.debug(`${method} ${url.toString()}${attempt ? ` (retry ${attempt})` : ""}`);
      let res: Response;
      let text: string;
      try {
        res = await this.doFetch(url, {
          method,
          headers,
          ...(body !== undefined ? { body } : {}),
          signal: req.signal
            ? AbortSignal.any([req.signal, AbortSignal.timeout(this.opts.timeoutMs)])
            : AbortSignal.timeout(this.opts.timeoutMs),
        });
        text = await res.text();
      } catch (err) {
        req.signal?.throwIfAborted();
        if (!readOnly) {
          throw new MutationUncertainError(`Outcome unknown for ${method} ${url.pathname}`, { cause: err });
        }
        if (attempt < this.opts.retries) {
          await sleep(backoff(this.opts.retryBaseMs, attempt), req.signal);
          continue;
        }
        throw new LibbyError(`Network error calling ${method} ${url.pathname}: ${String(err)}`, {
          cause: err,
        });
      }

      const parsed = parseBody(text, res.headers.get("content-type"));
      if (res.ok) return parsed as T;

      if (!readOnly && res.status >= 500) {
        throw new MutationUncertainError(`Outcome unknown for ${method} ${url.pathname}: HTTP ${res.status}`);
      }
      if (readOnly && RETRYABLE_STATUS.has(res.status) && attempt < this.opts.retries) {
        await sleep(retryAfterMs(res) ?? backoff(this.opts.retryBaseMs, attempt), req.signal);
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

export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    signal?.throwIfAborted();
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
