"use client";

import type { AccuracySummary } from "@/types/validation";
import { cn } from "@/lib/utils";

interface AccuracySummaryProps {
  summary: AccuracySummary;
}

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  highlight?: "green" | "red" | "amber" | "blue" | "slate";
}

function StatCard({ label, value, sub, highlight = "slate" }: StatCardProps) {
  const color = {
    green: "text-emerald-700",
    red: "text-red-600",
    amber: "text-amber-600",
    blue: "text-blue-700",
    slate: "text-slate-800",
  }[highlight];

  return (
    <div className="rounded-lg border border-[var(--border)] bg-white px-5 py-4 shadow-sm">
      <p className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide">
        {label}
      </p>
      <p className={cn("mt-1 text-2xl font-bold tabular-nums", color)}>
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-[var(--muted)]">{sub}</p>}
    </div>
  );
}

// Score colour: green ≥ 90, amber 70-90, red < 70
function scoreHighlight(score: number): "green" | "amber" | "red" {
  if (score >= 90) return "green";
  if (score >= 70) return "amber";
  return "red";
}

function ScoreBar({ score }: { score: number }) {
  const colour =
    score >= 90
      ? "bg-emerald-500"
      : score >= 70
        ? "bg-amber-400"
        : "bg-red-500";

  return (
    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <div
        className={cn("h-full rounded-full transition-all", colour)}
        style={{ width: `${score}%` }}
      />
    </div>
  );
}

export default function AccuracySummaryPanel({
  summary,
}: AccuracySummaryProps) {
  const {
    totalManual,
    matched,
    missingInSystem,
    extraInSystem,
    unitMismatches,
    averageAbsDiffPercent,
    accuracyScore,
  } = summary;

  return (
    <div className="space-y-3">
      {/* Score banner */}
      <div className="rounded-lg border border-[var(--border)] bg-white px-5 py-4 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide">
              Overall Accuracy Score
            </p>
            <p
              className={cn(
                "mt-1 text-3xl font-bold tabular-nums",
                scoreHighlight(accuracyScore) === "green" && "text-emerald-700",
                scoreHighlight(accuracyScore) === "amber" && "text-amber-600",
                scoreHighlight(accuracyScore) === "red" && "text-red-600"
              )}
            >
              {accuracyScore.toFixed(1)}
              <span className="text-lg font-semibold text-[var(--muted)]">
                /100
              </span>
            </p>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              Avg absolute difference:{" "}
              <strong>{averageAbsDiffPercent.toFixed(1)}%</strong>
            </p>
          </div>
          <div className="flex-1 max-w-64">
            <ScoreBar score={accuracyScore} />
            <p className="mt-1 text-right text-[10px] text-[var(--muted)]">
              {accuracyScore >= 90
                ? "Excellent accuracy"
                : accuracyScore >= 70
                  ? "Acceptable — review flagged items"
                  : "Low accuracy — check system rules"}
            </p>
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard
          label="Manual items"
          value={totalManual}
          sub="reference total"
          highlight="slate"
        />
        <StatCard
          label="Matched"
          value={matched}
          sub={
            totalManual > 0
              ? `${((matched / totalManual) * 100).toFixed(0)}% of manual`
              : "—"
          }
          highlight="green"
        />
        <StatCard
          label="Missing in system"
          value={missingInSystem}
          sub="not extracted"
          highlight={missingInSystem > 0 ? "red" : "slate"}
        />
        <StatCard
          label="Extra in system"
          value={extraInSystem}
          sub="no manual ref"
          highlight={extraInSystem > 0 ? "amber" : "slate"}
        />
        <StatCard
          label="Unit mismatches"
          value={unitMismatches}
          sub="check units"
          highlight={unitMismatches > 0 ? "amber" : "slate"}
        />
      </div>
    </div>
  );
}
