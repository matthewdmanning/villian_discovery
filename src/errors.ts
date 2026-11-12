/** Base error for all failures raised by this package. */
export class LibbyError extends Error {
  override name = "LibbyError";
}

/** HTTP-level failure from a Libby/OverDrive endpoint. */
export class HttpError extends LibbyError {
  override name = "HttpError";
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
    /** Parsed JSON body when available, otherwise raw text. */
    readonly body: unknown,
    /** `upstream.errorCode` from Libby error payloads, when present. */
    readonly errorCode?: string,
  ) {
    super(message);
  }

  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

export class ConfigError extends LibbyError {
  override name = "ConfigError";
}

export class AuthError extends LibbyError {
  override name = "AuthError";
}

export class InputError extends LibbyError {
  override name = "InputError";
}

/** Builds a readable message from a Libby error body (`upstream.userExplanation`). */
export function describeErrorBody(body: unknown): { message?: string; errorCode?: string } {
  if (!body || typeof body !== "object") return {};
  const b = body as Record<string, unknown>;
  const upstream = (b.upstream ?? {}) as Record<string, unknown>;
  const message = str(upstream.userExplanation) ?? str(b.message) ?? str(b.error) ?? str(b.result);
  const errorCode = str(upstream.errorCode) ?? str(b.errorCode);
  return { ...(message ? { message } : {}), ...(errorCode ? { errorCode } : {}) };
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
