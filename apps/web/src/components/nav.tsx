"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useUser, UserButton } from "@clerk/nextjs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchCurrentUser, removeAuthToken } from "@/lib/api";
import { ThemeToggle } from "@/components/theme-toggle";

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { isSignedIn, user: clerkUser, isLoaded } = useUser();

  // Fallback for legacy demo/seeded token in localStorage until Prompt 2 migrates recruiter/demo flows
  const { data: legacyUser } = useQuery({
    queryKey: ["me"],
    queryFn: fetchCurrentUser,
    enabled: isLoaded && !isSignedIn,
    staleTime: 5 * 60 * 1000,
  });

  const currentUser = isSignedIn && clerkUser
    ? {
        email: clerkUser.primaryEmailAddress?.emailAddress ?? "",
        role: (clerkUser.publicMetadata?.role as string) || "CANDIDATE",
        isClerk: true,
      }
    : legacyUser
    ? {
        email: legacyUser.email,
        role: legacyUser.role,
        isClerk: false,
      }
    : null;

  const isRecruiter = currentUser?.role === "RECRUITER" || currentUser?.role === "ADMIN";
  const isAdmin = currentUser?.role === "ADMIN";

  const handleLogout = async () => {
    removeAuthToken();
    await queryClient.invalidateQueries({ queryKey: ["me"] });
    await queryClient.invalidateQueries({ queryKey: ["sessions"] });
    await queryClient.invalidateQueries({ queryKey: ["assessments"] });
    router.push("/login");
  };

  const links = [
    { href: "/problems", label: "Catalogue" },
    { href: "/dashboard", label: "My Progress" },
    ...(isRecruiter ? [{ href: "/recruiter/dashboard", label: "Recruiter" }] : []),
    ...(isAdmin ? [{ href: "/admin/problems", label: "Admin" }] : []),
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
          {/* Theme toggle — visible on every page */}
          <ThemeToggle />

          {currentUser ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-secondary font-mono bg-surface-2 px-2.5 py-1 rounded border border-border">
                {currentUser.email}
                {currentUser.role !== "CANDIDATE" && (
                  <span className="ml-1.5 text-[10px] text-accent font-semibold uppercase">{currentUser.role}</span>
                )}
              </span>
              {currentUser.isClerk ? (
                <UserButton afterSignOutUrl="/login" />
              ) : (
                <button
                  onClick={handleLogout}
                  className="text-xs font-mono text-text-secondary hover:text-fail px-2 py-1 rounded border border-border hover:border-fail/40 transition-colors"
                  title="Sign out"
                >
                  Sign out
                </button>
              )}
            </div>
          ) : (
            <Link
              href="/login"
              className="text-xs font-mono text-accent bg-accent-soft px-3 py-1 rounded border border-accent/30 hover:bg-accent hover:text-white transition-colors"
            >
              Sign In
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
