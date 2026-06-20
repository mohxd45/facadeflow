"use client";

import { useMemo, useState } from "react";
import type { QuantityTakeoffItem } from "@/types/takeoff";
import type { QuantityComparisonResult } from "@/types/validation";
import { useManualQuantityStore } from "@/stores/manual-quantity-store";
import {
  compareManualVsSystem,
  computeAccuracySummary,
  exportComparisonToCsv,
} from "@/services/validation/quantity-comparison.service";
import ManualQuantityTable from "./ManualQuantityTable";
import AccuracySummaryPanel from "./AccuracySummary";
import ComparisonTable from "./ComparisonTable";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Download, RefreshCw, ShieldCheck } from "lucide-react";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface AccuracyTabProps {
  projectId: string;
  projectName: string;
  systemItems: QuantityTakeoffItem[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AccuracyTab({
  projectId,
  projectName,
  systemItems,
}: AccuracyTabProps) {
  const allManual = useManualQuantityStore((s) => s.items);

  const manualItems = useMemo(
    () => allManual.filter((i) => i.projectId === projectId),
    [allManual, projectId]
  );

  const [results, setResults] = useState<QuantityComparisonResult[] | null>(
    null
  );

  const summary = useMemo(
    () => (results ? computeAccuracySummary(results) : null),
    [results]
  );

  const handleRunComparison = () => {
    const r = compareManualVsSystem(manualItems, systemItems, projectId);
    setResults(r);
  };

  const handleExport = () => {
    if (!results) return;
    exportComparisonToCsv(results, projectName);
  };

  const canCompare = manualItems.length > 0;

  return (
    <div className="space-y-6">
      {/* Section header */}
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-blue-600" />
          Accuracy Validation
        </h2>
        <p className="mt-0.5 text-sm text-[var(--muted)]">
          Enter your manual (reference) quantities, then run a comparison
          against the system&apos;s extracted takeoff. This is for validation
          only — nothing is overwritten automatically.
        </p>
      </div>

      {/* Inner tabs: Manual Input | Comparison Results */}
      <Tabs defaultValue="manual">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="manual">
              Manual quantities ({manualItems.length})
            </TabsTrigger>
            <TabsTrigger value="comparison" disabled={results === null}>
              Comparison results{results ? ` (${results.length})` : ""}
            </TabsTrigger>
          </TabsList>

          <div className="flex gap-2">
            {results && (
              <Button variant="outline" size="sm" onClick={handleExport}>
                <Download className="h-4 w-4" />
                Export CSV
              </Button>
            )}
            <Button
              size="sm"
              onClick={handleRunComparison}
              disabled={!canCompare}
              title={
                !canCompare
                  ? "Add at least one manual quantity to run comparison."
                  : undefined
              }
            >
              <RefreshCw className="h-4 w-4" />
              Run comparison
            </Button>
          </div>
        </div>

        {/* Manual quantities tab */}
        <TabsContent value="manual" className="mt-4">
          <ManualQuantityTable projectId={projectId} items={manualItems} />
        </TabsContent>

        {/* Comparison results tab */}
        <TabsContent value="comparison" className="mt-4 space-y-4">
          {summary && <AccuracySummaryPanel summary={summary} />}

          {results && results.length > 0 && (
            <>
              {/* Info note */}
              <p className="text-xs text-[var(--muted)]">
                Diff % colours:{" "}
                <span className="text-emerald-700 font-medium">&lt;5%</span>{" "}
                excellent,{" "}
                <span className="text-amber-600 font-medium">5–15%</span>{" "}
                acceptable,{" "}
                <span className="text-red-600 font-medium">&gt;15%</span>{" "}
                investigate. Rows are sorted by severity.
              </p>

              <ComparisonTable results={results} />
            </>
          )}

          {results && results.length === 0 && (
            <div className="rounded-lg border border-dashed border-[var(--border)] py-10 text-center text-sm text-[var(--muted)]">
              No items to compare. Add manual quantities and system takeoff
              items first.
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* System items notice */}
      <div className="rounded-md border border-[var(--border)] bg-slate-50 px-4 py-3 text-xs text-[var(--muted)]">
        <strong>System takeoff items:</strong> {systemItems.length} item
        {systemItems.length !== 1 && "s"} from the Quantity Takeoff tab will be
        used for comparison. Add more items there before running this validation.
      </div>
    </div>
  );
}
