"use client";

import { useState } from "react";
import type { ConnectionTestResult } from "@/services/supabase/connection-test";
import type { MigrationResult } from "@/services/supabase/local-to-supabase-migration";
import { isSupabaseConfigured } from "@/lib/env";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  RefreshCw,
  DatabaseZap,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Connection test panel
// ---------------------------------------------------------------------------

function TableRow({ table, ok, error }: { table: string; ok: boolean; error?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-[var(--border)] last:border-0 text-sm">
      <code className="font-mono text-xs">{table}</code>
      <span className={cn("flex items-center gap-1.5 font-medium", ok ? "text-emerald-600" : "text-red-600")}>
        {ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
        {ok ? "Ready" : (error?.includes("does not exist") ? "Missing" : "Error")}
      </span>
    </div>
  );
}

function ConnectionTestPanel() {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ConnectionTestResult | null>(null);

  const handleTest = async () => {
    setTesting(true);
    try {
      const { testSupabaseConnection } = await import("@/services/supabase/connection-test");
      const r = await testSupabaseConnection();
      setResult(r);
    } finally {
      setTesting(false);
    }
  };

  const allTablesOk = result?.tables.every((t) => t.ok) ?? false;

  return (
    <div className="space-y-3">
      <Button
        variant="outline"
        size="sm"
        onClick={handleTest}
        disabled={testing || !isSupabaseConfigured()}
        title={!isSupabaseConfigured() ? "Supabase env vars not set" : undefined}
      >
        {testing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <RefreshCw className="h-4 w-4" />
        )}
        {testing ? "Testing…" : "Test Supabase connection"}
      </Button>

      {result && (
        <div className="rounded-lg border border-[var(--border)] bg-white shadow-sm">
          {/* Header */}
          <div
            className={cn(
              "flex items-center gap-2 px-4 py-3 border-b border-[var(--border)] rounded-t-lg",
              result.connected && allTablesOk
                ? "bg-emerald-50"
                : result.connected
                  ? "bg-amber-50"
                  : "bg-red-50"
            )}
          >
            {result.connected && allTablesOk ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            ) : result.connected ? (
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
            ) : (
              <XCircle className="h-4 w-4 text-red-600 shrink-0" />
            )}
            <span className="text-sm font-medium">
              {result.connected && allTablesOk
                ? "Connected — all tables ready"
                : result.connected
                  ? "Connected — some tables missing"
                  : "Connection failed"}
            </span>
          </div>

          {result.error && (
            <p className="px-4 py-3 text-sm text-red-700">{result.error}</p>
          )}

          {result.tables.length > 0 && (
            <div className="px-4 py-1">
              {result.tables.map((t) => (
                <TableRow key={t.table} {...t} />
              ))}
            </div>
          )}

          <p className="px-4 py-2 text-xs text-[var(--muted)]">
            Tested at {new Date(result.testedAt).toLocaleTimeString()}
          </p>
        </div>
      )}

      {result && !allTablesOk && result.connected && (
        <p className="text-xs text-[var(--muted)]">
          Run the SQL in{" "}
          <code className="font-mono text-[11px] rounded bg-slate-100 px-1 py-0.5">
            docs/supabase-schema.md
          </code>{" "}
          to create missing tables, then test again.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Migration panel
// ---------------------------------------------------------------------------

function MigrationResultRow({ r }: { r: MigrationResult["results"][number] }) {
  const hasErrors = r.errors.length > 0;
  return (
    <div className={cn(
      "px-4 py-2 border-b border-[var(--border)] last:border-0 text-sm",
      hasErrors ? "bg-red-50/40" : ""
    )}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{r.entity}</span>
        <span className="text-xs text-[var(--muted)]">
          {r.migrated} migrated · {r.skipped} skipped · {r.total} total
        </span>
      </div>
      {hasErrors && (
        <ul className="mt-1 space-y-0.5 text-xs text-red-600">
          {r.errors.slice(0, 3).map((e, i) => (
            <li key={i} className="truncate">↳ {e}</li>
          ))}
          {r.errors.length > 3 && (
            <li className="text-[var(--muted)]">…and {r.errors.length - 3} more</li>
          )}
        </ul>
      )}
    </div>
  );
}

function MigrationPanel() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<MigrationResult | null>(null);

  const handleMigrate = async () => {
    if (
      !window.confirm(
        "This will copy all local data to Supabase.\n" +
          "Existing Supabase records with the same ID will be updated.\n\n" +
          "Local data will NOT be deleted.\n\nContinue?"
      )
    ) {
      return;
    }

    setRunning(true);
    setResult(null);
    try {
      const { migrateLocalDataToSupabase } = await import(
        "@/services/supabase/local-to-supabase-migration"
      );
      const r = await migrateLocalDataToSupabase();
      setResult(r);
    } catch (err) {
      alert(
        `Migration failed: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setRunning(false);
    }
  };

  const totalMigrated = result?.results.reduce((s, r) => s + r.migrated, 0) ?? 0;
  const totalErrors = result?.results.reduce((s, r) => s + r.errors.length, 0) ?? 0;

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
        <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
        <div>
          <p className="font-medium">Copy local data to Supabase</p>
          <p className="mt-0.5 text-[var(--muted)]">
            Reads all localStorage data and upserts it into Supabase tables.
            Local data is not deleted. Requires all tables to exist.
          </p>
        </div>
      </div>

      <Button
        variant="outline"
        size="sm"
        onClick={handleMigrate}
        disabled={running || !isSupabaseConfigured()}
        title={!isSupabaseConfigured() ? "Supabase env vars not set" : undefined}
      >
        {running ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <DatabaseZap className="h-4 w-4" />
        )}
        {running ? "Migrating…" : "Copy local data to Supabase"}
      </Button>

      {result && (
        <div className="rounded-lg border border-[var(--border)] bg-white shadow-sm">
          <div className={cn(
            "px-4 py-3 border-b border-[var(--border)] rounded-t-lg text-sm font-medium flex items-center gap-2",
            totalErrors > 0 ? "bg-amber-50" : "bg-emerald-50"
          )}>
            {totalErrors > 0 ? (
              <AlertTriangle className="h-4 w-4 text-amber-600" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            )}
            {totalMigrated} records migrated
            {totalErrors > 0 && ` · ${totalErrors} errors`}
          </div>
          {result.results.map((r) => (
            <MigrationResultRow key={r.entity} r={r} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exported combined section
// ---------------------------------------------------------------------------

export default function SupabaseSettingsSection() {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold mb-3">Connection Test</h3>
        <ConnectionTestPanel />
      </div>
      <div>
        <h3 className="text-sm font-semibold mb-3">Data Migration</h3>
        <MigrationPanel />
      </div>
    </div>
  );
}
