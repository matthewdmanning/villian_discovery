export const SYNC_FIELD_LABELS: Record<string, string> = {
  readingProgress: "Progress",
  checkedOut: "Checked out",
  finished: "Finished!",
  readingStatus: "Status",
};

/** Use this function to display normalized sync values without confusing empty, cleared, zero, or false values. */
export function displaySyncValue(value: unknown, field: string): string {
  if (value === undefined) return "Empty";
  if (value === null) return "Cleared";
  if (field === "readingProgress") return `${value}%`;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value === "currently-reading") return "Currently reading";
  if (value === "finished") return "Finished";
  return Array.isArray(value) ? value.join(", ") || "Empty" : String(value);
}
