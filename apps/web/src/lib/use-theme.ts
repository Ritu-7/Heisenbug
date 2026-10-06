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
export function useTheme(): { isDark: boolean; mounted: boolean } {
  const [mounted, setMounted] = useState(false);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setMounted(true);
    setIsDark(document.documentElement.classList.contains("dark"));

    // MutationObserver watching the class list on <html>
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains("dark"));
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, []);

  return { isDark, mounted };
}
