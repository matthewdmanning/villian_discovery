import { useId, useState } from "react";

/** How a review reached Fable: typed into its review box, copied for the user to paste, or neither. */
export type ReviewDelivery = "pasted" | "copied" | "manual";
/** Open a Fable book page and hand it the review text. */
export type PostReview = (pageUrl: string, text: string) => Promise<ReviewDelivery>;

/** Use this function outside the extension: copy the review and open the book's Fable page in a new tab. */
export async function copyAndOpen(pageUrl: string, text: string): Promise<ReviewDelivery> {
  const copied = navigator.clipboard
    ? await navigator.clipboard.writeText(text).then(
        () => true,
        () => false,
      )
    : false;
  window.open(pageUrl, "_blank", "noopener,noreferrer");
  return copied ? "copied" : "manual";
}

const DELIVERED: Record<ReviewDelivery, string> = {
  pasted: "Pasted into Fable's review box. Check it, then post it on Fable.",
  copied: "Copied. Paste it into Fable's review box.",
  manual: "Could not copy. Copy your review by hand, then paste it into Fable's review box.",
};

/**
 * Use this component in a book's pulldown: a one-row review box that grows as you type, and a button that takes it to Fable.
 * The parent keeps the draft, so it survives the Shelf unmounting during Sync and Apply.
 */
export function FableReview({
  title,
  pageUrl,
  post,
  draft,
  onDraft,
}: {
  title: string;
  pageUrl: string;
  post: PostReview;
  draft: string;
  onDraft(text: string): void;
}) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  return (
    <li className="flex flex-col gap-1.5 py-1.5">
      <label htmlFor={id} className="font-semibold">
        Review
      </label>
      <textarea
        id={id}
        rows={1}
        className="textarea textarea-sm w-full min-h-0 resize-y [field-sizing:content]"
        aria-label={`Review of ${title}`}
        value={draft}
        onChange={(event) => onDraft(event.target.value)}
      />
      <span className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn-sm btn-outline"
          disabled={busy || !draft.trim()}
          onClick={async () => {
            setBusy(true);
            setMessage(undefined);
            try {
              setMessage(DELIVERED[await post(pageUrl, draft.trim())]);
            } catch (failure) {
              setMessage(`Could not open Fable: ${failure instanceof Error ? failure.message : String(failure)}`);
            } finally {
              setBusy(false);
            }
          }}
        >
          Post to Fable<span className="sr-only">: {title}</span>
        </button>
        <span role="status" className="text-xs opacity-75">
          {message}
        </span>
      </span>
    </li>
  );
}
