"use client";

import dynamic from "next/dynamic";
import CompanyProfileForm from "@/components/settings/CompanyProfileForm";
import DebugInfoPanel from "@/components/settings/DebugInfoPanel";
import CodeRulesTable from "@/components/settings/CodeRulesTable";
import { storageModeStatus, isSupabaseConfigured, env } from "@/lib/env";

const SupabaseSettingsSection = dynamic(
  () => import("@/components/settings/SupabaseSettingsSection"),
  { ssr: false }
);
import { cn } from "@/lib/utils";
import {
  HardDrive,
  Database,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Info,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Small layout helpers
// ---------------------------------------------------------------------------

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-[var(--foreground)] uppercase tracking-wide">
        {title}
      </h2>
      {children}
    </section>
  );
}

function InfoCard({
  icon: Icon,
  title,
  description,
  accent,
}: {
  icon: React.ElementType;
  title: string;
  description: React.ReactNode;
  accent?: "blue" | "green" | "amber" | "red" | "slate";
}) {
  const border = {
    blue: "border-blue-200",
    green: "border-emerald-200",
    amber: "border-amber-200",
    red: "border-red-200",
    slate: "border-[var(--border)]",
  }[accent ?? "slate"];

  const iconColor = {
    blue: "text-blue-500",
    green: "text-emerald-500",
    amber: "text-amber-500",
    red: "text-red-500",
    slate: "text-slate-400",
  }[accent ?? "slate"];

  return (
    <div
      className={cn(
        "flex gap-4 rounded-lg border bg-white px-5 py-4 shadow-sm",
        border
      )}
    >
      <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", iconColor)} />
      <div>
        <p className="text-sm font-medium">{title}</p>
        <div className="mt-0.5 text-sm text-[var(--muted)]">{description}</div>
      </div>
    </div>
  );
}

function StatusRow({
  label,
  ok,
  okText,
  failText,
}: {
  label: string;
  ok: boolean;
  okText: string;
  failText: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 border-b border-[var(--border)] last:border-0">
      <span className="text-sm text-[var(--muted)]">{label}</span>
      <span
        className={cn(
          "flex items-center gap-1.5 text-sm font-medium",
          ok ? "text-emerald-600" : "text-red-600"
        )}
      >
        {ok ? (
          <CheckCircle2 className="h-4 w-4" />
        ) : (
          <XCircle className="h-4 w-4" />
        )}
        {ok ? okText : failText}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function SettingsView() {
  const status = storageModeStatus();
  const supabaseConfigured = isSupabaseConfigured();
  const isLocal = status.mode === "local";

  return (
    <div className="mx-auto max-w-3xl space-y-10 px-6 py-10">
      {/* Page title */}
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Company profile, storage configuration, and backend readiness.
        </p>
      </div>

      {/* ── Company profile ───────────────────────────────────────── */}
      <Section title="Company Profile">
        <div className="rounded-lg border border-[var(--border)] bg-white px-5 py-5 shadow-sm">
          <p className="mb-4 text-sm text-[var(--muted)]">
            Company details appear on exported Excel quantity reports — name,
            logo, contact information, and prepared-by fields.
          </p>
          <CompanyProfileForm />
        </div>
      </Section>

      {/* ── Current storage mode ─────────────────────────────────── */}
      <Section title="Storage Mode">
        <div className="rounded-lg border border-[var(--border)] bg-white shadow-sm divide-y divide-[var(--border)]">
          <div className="flex items-center justify-between gap-4 px-5 py-4">
            <span className="text-sm font-medium">Active mode</span>
            <span
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold",
                isLocal
                  ? "bg-slate-100 text-slate-700"
                  : "bg-blue-100 text-blue-700"
              )}
            >
              {isLocal ? (
                <HardDrive className="h-3.5 w-3.5" />
              ) : (
                <Database className="h-3.5 w-3.5" />
              )}
              {isLocal ? "Local (localStorage)" : "Supabase"}
            </span>
          </div>
          <div className="px-5 py-3">
            <p className="text-xs text-[var(--muted)]">
              Set via{" "}
              <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px]">
                NEXT_PUBLIC_STORAGE_MODE
              </code>{" "}
              in{" "}
              <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px]">
                .env.local
              </code>
              . Restart the dev server after changing this value.
            </p>
          </div>
        </div>
      </Section>

      {/* ── Mode explanations ─────────────────────────────────────── */}
      <Section title="Storage Modes Explained">
        <InfoCard
          icon={HardDrive}
          accent={isLocal ? "blue" : "slate"}
          title={`Local mode${isLocal ? " — currently active" : ""}`}
          description={
            <>
              All project data is stored in the browser&apos;s{" "}
              <strong>localStorage</strong> and drawing blobs in{" "}
              <strong>IndexedDB</strong>. No internet connection or backend is
              required. Data is private to this browser and device. Maximum
              single-file size is <strong>250 MB</strong> (IndexedDB limit).
              Files up to 1 GB can be registered as metadata-only with status{" "}
              <em>queued</em>.
            </>
          }
        />
        <InfoCard
          icon={Database}
          accent={!isLocal ? "blue" : "slate"}
          title={`Supabase mode${!isLocal ? " — currently active" : ""}`}
          description={
            <>
              Projects, drawings, and takeoff items are stored in{" "}
              <strong>Supabase Postgres</strong>. Drawing files are uploaded to
              <strong>Supabase Storage</strong> (bucket:{" "}
              <code className="font-mono text-xs">drawing-files</code>). Files
              up to <strong>250 MB</strong> upload via the standard JS client.
              Files larger than 250 MB require the TUS resumable upload
              endpoint (backend worker — TODO). See{" "}
              <code className="font-mono text-xs">docs/supabase-schema.md</code>{" "}
              for the full DDL.
            </>
          }
        />
      </Section>

      {/* ── Supabase configuration check ──────────────────────────── */}
      <Section title="Supabase Configuration">
        <div className="rounded-lg border border-[var(--border)] bg-white shadow-sm px-5 py-1">
          <StatusRow
            label="NEXT_PUBLIC_SUPABASE_URL"
            ok={Boolean(env.supabaseUrl)}
            okText="Set"
            failText="Not set"
          />
          <StatusRow
            label="NEXT_PUBLIC_SUPABASE_ANON_KEY"
            ok={Boolean(env.supabaseAnonKey)}
            okText="Set"
            failText="Not set"
          />
          <StatusRow
            label="Supabase fully configured"
            ok={supabaseConfigured}
            okText="Yes"
            failText="No"
          />
        </div>

        {!isLocal && !supabaseConfigured && (
          <InfoCard
            icon={AlertTriangle}
            accent="red"
            title="Supabase not configured"
            description={
              <>
                Storage mode is set to <strong>supabase</strong> but the
                required environment variables are missing. Copy{" "}
                <code className="font-mono text-xs">.env.local.example</code>{" "}
                to{" "}
                <code className="font-mono text-xs">.env.local</code>, fill in
                your project URL and anon key, then restart the dev server.
              </>
            }
          />
        )}

        {isLocal && (
          <InfoCard
            icon={Info}
            accent="blue"
            title="Running in local mode"
            description="Supabase environment variables are not required in local mode. Add them and switch NEXT_PUBLIC_STORAGE_MODE=supabase when you are ready to use a real backend."
          />
        )}
      </Section>

      {/* ── Supabase connection test + migration ──────────────────── */}
      <Section title="Supabase Tools">
        <div className="rounded-lg border border-[var(--border)] bg-white px-5 py-5 shadow-sm">
          <SupabaseSettingsSection />
        </div>
      </Section>

      {/* ── Migration warning ─────────────────────────────────────── */}
      <Section title="Switching Storage Mode">
        <InfoCard
          icon={AlertTriangle}
          accent="amber"
          title="Create Supabase tables before switching"
          description={
            <>
              If you switch to <strong>supabase</strong> mode before running
              the SQL in{" "}
              <code className="font-mono text-xs">docs/supabase-schema.md</code>
              , the app will display an error on every data operation. Always
              create and verify the tables first.
            </>
          }
        />
        <InfoCard
          icon={Info}
          accent="slate"
          title="Local data is not migrated automatically"
          description={
            <>
              Use the <strong>Copy local data to Supabase</strong> tool above
              to migrate existing localStorage records to your Supabase database
              before switching storage mode.
            </>
          }
        />
      </Section>

      {/* ── Company item code rules ────────────────────────────── */}
      <Section title="Company Item Code Rules">
        <p className="text-xs text-[var(--muted)] -mt-1 mb-3">
          Rules map item codes (e.g. W-01, SD-03, BL-R) to measurement categories and
          calculation methods. These are used by the Code-Based Takeoff workflow.
        </p>
        <CodeRulesTable />
      </Section>

      {/* ── Debug info ────────────────────────────────────────────── */}
      <Section title="Debug Information">
        <p className="text-xs text-[var(--muted)] -mt-1 mb-2">
          Live counts from the active store. Useful for verifying data loaded correctly.
        </p>
        <DebugInfoPanel />
      </Section>
    </div>
  );
}
