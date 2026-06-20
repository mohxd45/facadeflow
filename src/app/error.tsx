"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCw, LayoutDashboard } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    // Log to console so developers can see it in the browser console
    console.error("[GlobalError]", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <div className="w-full max-w-md rounded-xl border border-red-200 bg-white p-8 shadow-sm text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-100">
          <AlertTriangle className="h-7 w-7 text-red-600" />
        </div>

        <h1 className="text-xl font-semibold text-[var(--foreground)]">
          Something went wrong
        </h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          An unexpected error occurred. You can try reloading the page or return
          to the Dashboard.
        </p>

        {error.message && (
          <details className="mt-4 rounded-md border border-[var(--border)] bg-slate-50 px-4 py-3 text-left">
            <summary className="cursor-pointer text-xs font-medium text-[var(--muted)] select-none">
              Error details
            </summary>
            <p className="mt-2 break-all font-mono text-xs text-red-700">
              {error.message}
            </p>
            {error.digest && (
              <p className="mt-1 font-mono text-xs text-slate-400">
                Digest: {error.digest}
              </p>
            )}
          </details>
        )}

        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button onClick={reset} variant="outline">
            <RefreshCw className="h-4 w-4" />
            Reload
          </Button>
          <Button asChild>
            <Link href="/">
              <LayoutDashboard className="h-4 w-4" />
              Go to Dashboard
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
