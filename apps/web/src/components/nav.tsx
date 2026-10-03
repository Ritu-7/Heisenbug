"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { fetchCurrentUser } from "@/lib/api";

export function Nav() {
  const pathname = usePathname();

  const { data: user } = useQuery({
    queryKey: ["me"],
    queryFn: fetchCurrentUser,
    staleTime: 5 * 60 * 1000,
  });

  const isRecruiter = user?.role === "RECRUITER" || user?.role === "ADMIN";

  const links = [
    { href: "/", label: "Catalogue" },
    { href: "/dashboard", label: "My Progress" },
    ...(isRecruiter ? [{ href: "/recruiter/dashboard", label: "Recruiter" }] : []),
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
              const active = pathname === link.href || (link.href !== "/" && pathname.startsWith(link.href));
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
          {user ? (
            <span className="text-xs text-text-secondary font-mono bg-surface-2 px-2 py-1 rounded border border-border">
              {user.email}
              {user.role !== "CANDIDATE" && (
                <span className="ml-1.5 text-[10px] text-accent font-semibold uppercase">{user.role}</span>
              )}
            </span>
          ) : (
            <span className="text-xs text-text-secondary font-mono bg-surface-2 px-2 py-1 rounded border border-border">
              Not signed in
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
