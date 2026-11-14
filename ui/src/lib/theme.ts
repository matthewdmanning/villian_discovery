import { useEffect, useState } from "react";

export type Theme = "shelfie" | "shelfie-night";
const KEY = "libby-shelf.theme";

function initial(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "shelfie" || saved === "shelfie-night") return saved;
  } catch {
    /* fall through to system preference */
  }
  return matchMedia("(prefers-color-scheme: dark)").matches ? "shelfie-night" : "shelfie";
}

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(initial);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* not persisted */
    }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === "shelfie" ? "shelfie-night" : "shelfie"))];
}
