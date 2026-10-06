"use client";

import { useTheme } from "@/lib/use-theme";

/** Sun icon (shown in dark mode → clicking switches to light) */
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

/** Moon icon (shown in light mode → clicking switches to dark) */
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
 * Sun/moon toggle button.
 *
 * Reads live theme state from useTheme() (MutationObserver on html.classList)
 * so the displayed icon is always in sync. Writes to the DOM and localStorage
 * on click. The no-flash inline script in layout.tsx handles the initial paint.
 */
export function ThemeToggle() {
  const { isDark } = useTheme();

  function toggle() {
    const next = !isDark;
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
