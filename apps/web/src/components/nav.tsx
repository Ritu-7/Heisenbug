"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function Nav() {
  const pathname = usePathname();

  const links = [
    { href: "/", label: "Catalogue" },
    { href: "/dashboard", label: "Candidate Dashboard" },
  ];

  return (
    <header className="border-b border-border bg-surface sticky top-0 z-50">
      <div className="mx-auto max-w-5xl px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <Link href="/" className="font-serif text-xl font-bold tracking-tight text-accent flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-accent inline-block" />
            Heisenbug
          </Link>
          <nav className="flex items-center gap-1">
            {links.map((link) => {
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                    active
                      ? "bg-accent-soft text-accent font-semibold"
                      : "text-text-secondary hover:text-text hover:bg-surface-2",
                  )}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-text-secondary font-mono bg-surface-2 px-2 py-1 rounded border border-border">
            alice@heisenbug.dev
          </span>
        </div>
      </div>
    </header>
  );
}
