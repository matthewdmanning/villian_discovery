import { HttpClient, type HttpOptions } from "./http.js";
import type { ChipResponse, MediaType, SyncResponse } from "./types.js";

export const DEFAULT_SENTRY_BASE_URL = "https://sentry-read.svc.overdrive.com/";

/**
 * Client for Libby's private "Sentry" API (the backend of libbyapp.com).
 * Unofficial; endpoints mirror the Libby web app and may change without notice.
 */
export class LibbyClient {
  private readonly http: HttpClient;
  identityToken: string | undefined;

  constructor(opts: HttpOptions & { baseUrl?: string; identityToken?: string }) {
    this.identityToken = opts.identityToken;
    this.http = new HttpClient(opts.baseUrl ?? DEFAULT_SENTRY_BASE_URL, opts, () =>
      this.identityToken ? { Authorization: `Bearer ${this.identityToken}` } : {},
    );
  }

  /** Creates an anonymous identity ("chip"). Stores and returns its token. */
  async createChip(): Promise<string> {
    const saved = this.identityToken;
    this.identityToken = undefined;
    try {
      const res = await this.http.request<ChipResponse>("chip", {
        method: "POST",
        query: { client: "dewey" },
      });
      if (!res.identity) throw new Error("Libby chip response had no identity token");
      this.identityToken = res.identity;
      return res.identity;
    } catch (e) {
      this.identityToken = saved;
      throw e;
    }
  }

  /** Links the current chip to an account using an 8-digit Libby setup code. */
  async cloneByCode(code: string): Promise<unknown> {
    if (!/^\d{8}$/.test(code)) throw new Error("Libby setup code must be 8 digits");
    return this.http.request("chip/clone/code", { form: { code } });
  }

  /** Full account state: cards, loans, holds. */
  sync(): Promise<SyncResponse> {
    return this.http.request<SyncResponse>("chip/sync");
  }

  borrow(args: {
    cardId: string;
    titleId: string;
    mediaType: MediaType | string;
    days: number;
    luckyDay?: boolean;
  }): Promise<unknown> {
    return this.http.request(`card/${enc(args.cardId)}/loan/${enc(args.titleId)}`, {
      method: "POST",
      json: {
        period: args.days,
        units: "days",
        lucky_day: args.luckyDay ? 1 : null,
        title_format: args.mediaType,
      },
    });
  }

  placeHold(args: { cardId: string; titleId: string; emailAddress?: string }): Promise<unknown> {
    return this.http.request(`card/${enc(args.cardId)}/hold/${enc(args.titleId)}`, {
      method: "POST",
      json: { days_to_suspend: 0, email_address: args.emailAddress ?? "" },
    });
  }

  /**
   * Suspends ("deliver later") a hold. Libby accepts 0-30, 60 or 90 days; 0 unsuspends.
   */
  suspendHold(args: { cardId: string; titleId: string; days: number }): Promise<unknown> {
    if (!isValidSuspendDays(args.days)) {
      throw new Error(`Invalid hold suspension: ${args.days} (allowed 0-30, 60, 90)`);
    }
    return this.http.request(`card/${enc(args.cardId)}/hold/${enc(args.titleId)}`, {
      method: "PUT",
      json: { days_to_suspend: args.days },
    });
  }
}

export function isValidSuspendDays(d: number): boolean {
  return Number.isInteger(d) && ((d >= 0 && d <= 30) || d === 60 || d === 90);
}

const enc = encodeURIComponent;
