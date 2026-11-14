/** Browser stand-in: the UI never reads files from disk. */
export async function readFile(): Promise<never> {
  throw new Error("readFile is not available in the browser");
}
