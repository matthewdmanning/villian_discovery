import { BookCopy, ChevronDown, Clock, Search, Users } from "lucide-react";
import { type FormEvent, type ReactNode, useCallback, useMemo, useState } from "react";
import type { BookRequest } from "../../../src/input.ts";
import { mediaNarrators } from "../../../src/matcher.ts";
import { TagFilters, TaggedResults } from "../components/TagSearch.tsx";
import { dash, Empty, Panel, Screen } from "../components/ui.tsx";
import type { Match } from "../lib/api.ts";
import { matchesIsbnBook, matchesListSearch, parseSearchQuery } from "../lib/search-query.ts";
import { filterSearchGroups, groupSearchResults, type SearchFilters } from "../lib/search-results.ts";
import { screen } from "../lib/spec.ts";
import { useStore } from "../lib/store.tsx";
import { useLists } from "../lib/use-lists.ts";
import { errorMessage, useResource } from "../lib/use-resource.ts";
import { Results } from "./Results.tsx";

const queryLabel = screen("search")
  ?.regions.flatMap((r) => r.components)
  .find((c) => c.type === "field")?.label;

const copies = (m: Match) => `${dash(m.media.availableCopies)} / ${dash(m.media.ownedCopies)}`;
const waitD = (m: Match) => (m.media.estimatedWaitDays ? `${m.media.estimatedWaitDays}d` : "—");

function Metric({ label, value, children }: { label: string; value: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span className={`tooltip ${open ? "tooltip-open" : ""}`} data-tip={label}>
      <button
        type="button"
        className="inline-flex min-h-11 items-center gap-1 rounded-field px-1 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        aria-label={`${label}: ${value}`}
        aria-pressed={open}
        onClick={() => setOpen((current) => !current)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
            event.currentTarget.blur();
          }
        }}
      >
        {children}
        <span>{value}</span>
      </button>
    </span>
  );
}

function Avail({ m }: { m: Match }) {
  return m.media.isAvailable === true ? (
    <span className="badge badge-success badge-sm font-semibold">Available</span>
  ) : (
    <span className="badge badge-ghost badge-sm">{m.media.isAvailable === false ? "Waitlist" : "Unknown"}</span>
  );
}

export function SearchScreen() {
  const { api, config, results } = useStore();
  const lists = useLists();
  const [q, setQ] = useState("");
  const [error, setError] = useState<string>();
  const [submitted, setSubmitted] = useState<BookRequest>();
  const hasTagFilters =
    (lists.multiquery && lists.saved.length > 0) ||
    [...lists.draft.includes, ...lists.draft.excludes].some((group) => group.length > 0);
  const showTagged = !submitted || hasTagFilters;
  const catalogQuery = showTagged ? undefined : submitted;
  const isbn = showTagged ? submitted?.isbn : undefined;
  const request = catalogQuery || isbn ? submitted : undefined;
  const lookup = useResource(
    useCallback(async () => {
      if (isbn) return { query: request, book: await api.lookupIsbn(isbn) };
      if (catalogQuery) return { query: request, matches: await api.search(catalogQuery, config) };
      return undefined;
    }, [api, catalogQuery, config, isbn, request]),
  );
  const response = request && lookup.data?.query === request ? lookup.data : undefined;
  const matches = response?.matches;
  const isbnBook = response?.book;
  const lookupError = request ? lookup.error : undefined;
  const searching = Boolean(request && !response && !lookupError);
  const isbnMessage = isbn
    ? isbnBook === null
      ? "No book metadata found for this ISBN."
      : isbnBook && !isbnBook.authors.length
        ? "The ISBN lookup returned no author to match against tagged books."
        : isbnBook
          ? `ISBN ${isbn} is ${isbnBook.title}${isbnBook.subtitle ? `: ${isbnBook.subtitle}` : ""} by ${isbnBook.authors.join(", ")} (${isbnBook.source === "google-books" ? "Google Books" : "Open Library"}).`
          : undefined
    : undefined;
  const items = useMemo(() => {
    if (!submitted) return lists.items;
    if (isbnBook) return lists.items.filter((item) => matchesIsbnBook(item, isbnBook));
    return lists.items.filter((item) => matchesListSearch(item, submitted));
  }, [lists.items, submitted, isbnBook]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!q.trim() || searching) return;
    setError(undefined);
    try {
      setSubmitted(parseSearchQuery(q));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Screen id="search">
      {results && <Results />}
      <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row">
        <label className={`input input-lg w-full grow border-2 border-pop shadow-pop-sm ${error ? "input-error" : ""}`}>
          <Search aria-hidden className="size-5 opacity-60" />
          <input
            type="search"
            aria-label={queryLabel ?? "Search books"}
            aria-describedby="search-query-help"
            placeholder="Project Hail Mary by Andy Weir"
            value={q}
            onChange={(event) => {
              const value = event.target.value;
              setQ(value);
              setError(undefined);
              if (!value.trim()) setSubmitted(undefined);
            }}
          />
        </label>
        <button type="submit" className="btn btn-primary btn-pop btn-lg" disabled={!q.trim() || searching}>
          {searching && <span className="loading loading-spinner" />}
          Search
        </button>
      </form>
      <p id="search-query-help" className="text-sm text-base-content/75">
        Search by title, author, or ISBN. For a specific field, use <code>title:</code> or <code>author:</code>.
      </p>
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
      <TagFilters lists={lists} />
      {lookupError && (
        <p role="alert" className="text-sm text-error">
          {lookupError}
        </p>
      )}
      {isbnMessage && <p role="status">{isbnMessage}</p>}
      {searching && <p role="status">Searching…</p>}
      {showTagged && !searching && !lookupError && <TaggedResults lists={lists} items={items} />}
      {!showTagged && matches && <CatalogResults key={submitted.raw} matches={matches} />}
    </Screen>
  );
}

function CatalogResults({ matches }: { matches: Match[] }) {
  const { config } = useStore();
  const [filters, setFilters] = useState<SearchFilters>({
    availability: "all",
    format: "",
    library: "",
    sort: "",
  });
  const groups = groupSearchResults(matches, config.libraries, config.mediaTypes);
  const visibleGroups = filterSearchGroups(groups, filters);
  const libraries = [
    ...new Map(
      matches.map((m) => [m.card.advantageKey.toLowerCase(), m.card.library?.name ?? m.card.advantageKey]),
    ).entries(),
  ];
  const formats = [
    ...new Set(matches.map((m) => m.media.type?.id?.toLowerCase()).filter((type): type is string => Boolean(type))),
  ];
  const formatLabel = (type: string) =>
    type === "ebook" ? "Ebook" : type === "audiobook" ? "Audiobook" : type === "magazine" ? "Magazine" : type;
  const updateFilter = (patch: Partial<SearchFilters>) => setFilters((current) => ({ ...current, ...patch }));

  return matches.length ? (
    <Panel>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm font-semibold">
          <span className="sr-only">Sort books</span>
          <select
            className="select select-sm"
            value={filters.sort}
            onChange={(e) => updateFilter({ sort: e.target.value as SearchFilters["sort"] })}
          >
            <option value="">Sort</option>
            <option value="relevance">Best match</option>
            <option value="available">Available first</option>
            <option value="title">Title A–Z</option>
            <option value="author">Author A–Z</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Availability
          <select
            className="select select-sm"
            value={filters.availability}
            onChange={(e) => updateFilter({ availability: e.target.value as SearchFilters["availability"] })}
          >
            <option value="all">Any availability</option>
            <option value="available">Available now</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Format
          <select
            className="select select-sm"
            value={filters.format}
            onChange={(e) => updateFilter({ format: e.target.value })}
          >
            <option value="">All formats</option>
            {formats.map((type) => (
              <option key={type} value={type}>
                {formatLabel(type)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Library
          <select
            className="select select-sm"
            value={filters.library}
            onChange={(e) => updateFilter({ library: e.target.value })}
          >
            <option value="">All libraries</option>
            {libraries.map(([key, name]) => (
              <option key={key} value={key}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="mb-2 text-sm" role="status">
        Showing {visibleGroups.length} of {groups.length} {groups.length === 1 ? "book" : "books"}
      </p>
      {visibleGroups.length === 0 && <p className="py-4">No books match these filters.</p>}
      <ul className="divide-y divide-base-300">
        {visibleGroups.map((group) => (
          <li key={group.key}>
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center gap-3 rounded-field py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-lg font-semibold">{group.title}</span>
                  <span className="block text-sm opacity-75">{group.author ?? "Unknown author"}</span>
                </span>
                <span className="text-sm">
                  {group.matches.length} {group.matches.length === 1 ? "option" : "options"}
                </span>
                <ChevronDown
                  aria-hidden="true"
                  className="size-5 shrink-0 transition-transform group-open:rotate-180"
                />
              </summary>
              <ul className="space-y-2 pb-4">
                {group.matches.map((m) => {
                  const type = m.media.type?.id?.toLowerCase();
                  const narrators = type === "audiobook" ? mediaNarrators(m.media) : [];
                  const format =
                    type === "ebook"
                      ? "Ebook"
                      : type === "audiobook"
                        ? "Audiobook"
                        : (m.media.type?.name ?? m.media.type?.id ?? "Unknown format");
                  const color =
                    type === "ebook"
                      ? "border-format-ebook bg-format-ebook/15"
                      : type === "audiobook"
                        ? "border-format-audiobook bg-format-audiobook/15"
                        : "border-base-300 bg-base-200";
                  return (
                    <li key={`${m.card.cardId}-${m.media.id}`} className={`rounded-field border-s-4 p-3 ${color}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold">
                          {format} · {m.card.cardName ?? m.card.library?.name ?? m.card.advantageKey}
                        </p>
                        <Avail m={m} />
                      </div>
                      {narrators.length > 0 && <p className="text-sm opacity-75">Narrated by {narrators.join(", ")}</p>}
                      <div className="flex flex-wrap items-center gap-x-3">
                        <Metric label="Available / total copies" value={copies(m)}>
                          <BookCopy aria-hidden="true" className="size-4" />
                        </Metric>
                        <Metric label="Holds" value={String(dash(m.media.holdsCount))}>
                          <Users aria-hidden="true" className="size-4" />
                        </Metric>
                        <Metric label="Estimated wait" value={waitD(m)}>
                          <Clock aria-hidden="true" className="size-4" />
                        </Metric>
                      </div>
                      {m.card.cardName && (
                        <p className="text-sm opacity-70">{m.card.library?.name ?? m.card.advantageKey}</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </details>
          </li>
        ))}
      </ul>
    </Panel>
  ) : (
    <Empty icon={<Search className="size-7" />} title="No match" />
  );
}
