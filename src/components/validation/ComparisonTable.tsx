"use client";

import type { QuantityComparisonResult, ComparisonStatus } from "@/types/validation";
import { TAKEOFF_CATEGORY_LABELS } from "@/lib/constants";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<
  ComparisonStatus,
  { label: string; variant: "success" | "destructive" | "warning" | "secondary" | "default" }
> = {
  matched: { label: "Matched", variant: "success" },
  missing_in_system: { label: "Missing in system", variant: "destructive" },
  extra_in_system: { label: "Extra in system", variant: "warning" },
  unit_mismatch: { label: "Unit mismatch", variant: "warning" },
  needs_review: { label: "Needs review", variant: "secondary" },
};

function StatusBadge({ status }: { status: ComparisonStatus }) {
  const { label, variant } = STATUS_CONFIG[status];
  return <Badge variant={variant}>{label}</Badge>;
}

// ---------------------------------------------------------------------------
// Difference cell
// ---------------------------------------------------------------------------

function DiffCell({ pct }: { pct?: number }) {
  if (pct === undefined) return <span className="text-[var(--muted)]">—</span>;
  const abs = Math.abs(pct);
  const positive = pct > 0;
  const colour =
    abs < 5
      ? "text-emerald-700"
      : abs < 15
        ? "text-amber-600"
        : "text-red-600";
  return (
    <span className={cn("tabular-nums font-medium", colour)}>
      {positive ? "+" : ""}
      {pct.toFixed(1)}%
    </span>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ComparisonTableProps {
  results: QuantityComparisonResult[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ComparisonTable({ results }: ComparisonTableProps) {
  if (results.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--border)] py-12 text-center text-sm text-[var(--muted)]">
        No comparison results yet. Add manual items and click{" "}
        <strong>Run comparison</strong>.
      </div>
    );
  }

  // Sort: missing → unit_mismatch → needs_review → extra → matched
  const ORDER: Record<ComparisonStatus, number> = {
    missing_in_system: 0,
    unit_mismatch: 1,
    needs_review: 2,
    extra_in_system: 3,
    matched: 4,
  };

  const sorted = [...results].sort(
    (a, b) => ORDER[a.status] - ORDER[b.status]
  );

  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-white">
      <Table>
        <TableHeader>
          <TableRow className="bg-slate-50/80">
            <TableHead>Category</TableHead>
            <TableHead>Element name</TableHead>
            <TableHead>Location</TableHead>
            <TableHead className="text-right">Manual qty</TableHead>
            <TableHead className="text-right">System qty</TableHead>
            <TableHead>Unit</TableHead>
            <TableHead className="text-right">Diff</TableHead>
            <TableHead className="text-right">Diff %</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Notes</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((r) => (
            <TableRow
              key={r.id}
              className={cn(
                r.status === "missing_in_system" && "bg-red-50/40",
                r.status === "unit_mismatch" && "bg-amber-50/40",
                r.status === "extra_in_system" && "bg-blue-50/30",
                r.status === "needs_review" && "bg-slate-50/60"
              )}
            >
              <TableCell className="whitespace-nowrap text-xs text-[var(--muted)]">
                {TAKEOFF_CATEGORY_LABELS[r.category]}
              </TableCell>
              <TableCell className="max-w-[180px] truncate font-medium">
                {r.elementName}
              </TableCell>
              <TableCell className="text-[var(--muted)] text-xs">
                {r.status === "extra_in_system" ? "—" : "—"}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {r.manualQuantity !== 0
                  ? r.manualQuantity.toLocaleString()
                  : "—"}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {r.systemQuantity !== undefined
                  ? r.systemQuantity.toLocaleString()
                  : "—"}
              </TableCell>
              <TableCell>{r.unit || "—"}</TableCell>
              <TableCell className="text-right tabular-nums">
                {r.difference !== undefined
                  ? (r.difference > 0 ? "+" : "") +
                    r.difference.toFixed(2)
                  : "—"}
              </TableCell>
              <TableCell className="text-right">
                <DiffCell pct={r.differencePercent} />
              </TableCell>
              <TableCell>
                <StatusBadge status={r.status} />
              </TableCell>
              <TableCell className="max-w-[160px] truncate text-xs text-[var(--muted)]">
                {r.notes || "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
