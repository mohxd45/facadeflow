"use client";

import Link from "next/link";
import { FlaskConical } from "lucide-react";

const isDev = process.env.NODE_ENV === "development";

const navItems = [
  { href: "/", label: "Dashboard", exact: true },
  { href: "/projects", label: "Projects" },
  { href: "/settings", label: "Settings" },
];

interface TopNavProps {
  currentPath: string;
}

function isActive(currentPath: string, href: string, exact?: boolean) {
  if (exact) return currentPath === href;
  return currentPath === href || currentPath.startsWith(`${href}/`);
}

export default function TopNav({ currentPath }: TopNavProps) {
  return (
    <header className="sticky top-0 z-50 border-b border-[var(--border)] bg-white">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-8 px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-600 text-xs font-bold text-white">
            FT
          </div>
          <span className="text-base font-semibold tracking-tight text-[var(--foreground)]">
            Facade Takeoff
          </span>
        </Link>

        <nav className="flex items-center gap-1">
          {navItems.map((item) => {
            const active = isActive(currentPath, item.href, item.exact);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-blue-50 text-blue-700"
                    : "text-[var(--muted)] hover:bg-slate-50 hover:text-[var(--foreground)]"
                }`}
              >
                {item.label}
              </Link>
            );
          })}

          {isDev && (
            <Link
              href="/qa"
              title="QA Checklist (dev only)"
              className={`flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                isActive(currentPath, "/qa")
                  ? "bg-violet-50 text-violet-700"
                  : "text-violet-500 hover:bg-violet-50 hover:text-violet-700"
              }`}
            >
              <FlaskConical className="h-3.5 w-3.5" />
              QA
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
