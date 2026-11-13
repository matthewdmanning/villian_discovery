import { HttpClient, type HttpOptions } from "./http.js";
import type { ThunderMedia, ThunderSearchResponse } from "./types.js";

export const DEFAULT_THUNDER_BASE_URL = "https://thunder.api.overdrive.com/v2/";

export interface LibrarySearch {
  query?: string;
  title?: string;
  creator?: string;
  identifier?: string;
  /** Thunder media types, comma-joined: ebook, audiobook, magazine. */
  mediaTypes?: string[];
  showOnlyAvailable?: boolean;
  perPage?: number;
}

/** Client for OverDrive's public catalog API ("Thunder"). No auth required. */
export class ThunderClient {
  private readonly http: HttpClient;

  constructor(opts: HttpOptions & { baseUrl?: string }) {
    this.http = new HttpClient(opts.baseUrl ?? DEFAULT_THUNDER_BASE_URL, opts);
  }

  async searchLibrary(libraryKey: string, s: LibrarySearch): Promise<ThunderMedia[]> {
    const res = await this.http.request<ThunderSearchResponse>(`libraries/${encodeURIComponent(libraryKey)}/media`, {
      query: {
        "x-client-id": "dewey",
        page: 1,
        perPage: s.perPage ?? 24,
        sortBy: "relevance",
        query: s.query,
        title: s.title,
        creator: s.creator,
        identifier: s.identifier,
        mediaTypes: s.mediaTypes?.length ? s.mediaTypes.join(",") : undefined,
        showOnlyAvailable: s.showOnlyAvailable ? "true" : undefined,
      },
    });
    return res.items ?? [];
  }

  /** One title with availability at the given library. */
  getLibraryMedia(libraryKey: string, titleId: string): Promise<ThunderMedia> {
    return this.http.request<ThunderMedia>(
      `libraries/${encodeURIComponent(libraryKey)}/media/${encodeURIComponent(titleId)}`,
      { query: { "x-client-id": "dewey" } },
    );
  }
}
