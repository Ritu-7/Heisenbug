"use client";

import { useEffect, useState } from "react";

/**
 * Single source of truth for the current site theme.
 *
 * Reads the `.dark` class on `<html>` (applied by both the no-flash inline
 * script in layout.tsx and the ThemeToggle component) and watches for future
 * changes via a MutationObserver so every consumer re-renders live when the
 * user toggles without needing to re-inspect the DOM themselves.
 *
 * Returns `{ isDark }` — true when `.dark` is present on <html>.
 */
export function useTheme(): { isDark: boolean } {
  const [isDark, setIsDark] = useState(() => {
    // Safe initialiser: read DOM only on client, default false during SSR
    if (typeof document === "undefined") return false;
    return document.documentElement.classList.contains("dark");
  });

  useEffect(() => {
    // MutationObserver watching the class list on <html>
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains("dark"));
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    // Sync once on mount in case the initial useState ran during SSR
    setIsDark(document.documentElement.classList.contains("dark"));

    return () => observer.disconnect();
  }, []);

  return { isDark };
}
