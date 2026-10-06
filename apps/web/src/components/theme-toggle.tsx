"use client";

import { useEffect, useState } from "react";

/** Sun icon (light mode) */
function SunIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2" x2="12" y2="6" />
      <line x1="12" y1="18" x2="12" y2="22" />
      <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
      <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
      <line x1="2" y1="12" x2="6" y2="12" />
      <line x1="18" y1="12" x2="22" y2="12" />
      <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
      <line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
    </svg>
  );
}

/** Moon icon (dark mode) */
function MoonIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

/**
 * Sun/moon toggle button. Reads/writes localStorage("heisenbug-theme") and
 * adds/removes the `.dark` class on <html>.
 *
 * The *initial* class application happens via the inline script in layout.tsx
 * so there is no flash; this component only handles subsequent user toggles.
 */
export function ThemeToggle() {
  // Start as `undefined` so we don't render until we've read the real DOM state
  const [isDark, setIsDark] = useState<boolean | undefined>(undefined);

  // Sync from DOM on mount (the inline script already applied the class)
  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !isDark;
    setIsDark(next);

    if (next) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }

    try {
      localStorage.setItem("heisenbug-theme", next ? "dark" : "light");
    } catch {
      // localStorage may be unavailable (private browsing, storage quota) — silently ignore
    }
  }

  // Don't render until we know the real state (avoids a flicker between icons)
  if (isDark === undefined) return null;

  return (
    <button
      onClick={toggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Light mode" : "Dark mode"}
      className={
        "inline-flex items-center justify-center w-8 h-8 rounded-md border border-border " +
        "text-text-secondary hover:text-text hover:bg-surface-2 transition-colors focus-visible:outline-none " +
        "focus-visible:ring-2 focus-visible:ring-accent"
      }
    >
      {isDark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
