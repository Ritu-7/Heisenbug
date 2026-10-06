import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Nav } from "@/components/nav";

export const metadata: Metadata = {
  title: "Heisenbug",
  description: "Practice and get assessed on fixing realistic engineering tickets.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/*
          Inline theme-init script — runs synchronously before first paint so
          there is no flash of wrong theme. Reads localStorage("heisenbug-theme");
          falls back to prefers-color-scheme; defaults to light if both absent.
          Wrapped in try/catch because localStorage can throw in private browsing.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
(function() {
  try {
    var stored = localStorage.getItem('heisenbug-theme');
    if (stored === 'dark') {
      document.documentElement.classList.add('dark');
    } else if (stored === 'light') {
      // explicit light — do nothing (class absent = light)
    } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      document.documentElement.classList.add('dark');
    }
  } catch (e) {}
})();
            `.trim(),
          }}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-background text-text font-sans flex flex-col">
        <Providers>
          <Nav />
          <main className="flex-1">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
