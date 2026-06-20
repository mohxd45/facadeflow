/**
 * Quantity comparison service — Phase 9
 *
 * Matches manual quantity items against system takeoff items and computes
 * difference metrics for accuracy validation.
 *
 * Matching strategy (in priority order):
 *  1. Same category + same unit + similar locationFloor
 *  2. Same category + same unit (ignore locationFloor)
 *  3. Similar element name + same category
 *
 * "Similar" means one string starts with or contains the other
 * (case-insensitive), after basic normalisation.
 */

import { generateId } from "@/lib/utils";
import { TAKEOFF_CATEGORY_LABELS } from "@/lib/constants";
import type { QuantityTakeoffItem, TakeoffCategory } from "@/types/takeoff";
import type {
  ManualQuantityItem,
  QuantityComparisonResult,
  AccuracySummary,
  ComparisonStatus,
} from "@/types/validation";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
}

function similar(a: string, b: string): boolean {
  const na = normalise(a);
  const nb = normalise(b);
  return na === nb || na.includes(nb) || nb.includes(na);
}

function floorSimilar(a?: string, b?: string): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return similar(a, b);
}

function unitsCompatible(a: string, b: string): boolean {
  return normalise(a) === normalise(b);
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

type Candidate = QuantityTakeoffItem;

function findBestMatch(
  manual: ManualQuantityItem,
  candidates: Candidate[]
): { item: Candidate; exactUnit: boolean } | null {
  // Pass 1: category + unit + location
  const p1 = candidates.find(
    (c) =>
      c.category === manual.category &&
      unitsCompatible(c.unit, manual.unit) &&
      floorSimilar(c.locationFloor, manual.locationFloor)
  );
  if (p1) return { item: p1, exactUnit: true };

  // Pass 2: category + unit (ignore location)
  const p2 = candidates.find(
    (c) =>
      c.category === manual.category && unitsCompatible(c.unit, manual.unit)
  );
  if (p2) return { item: p2, exactUnit: true };

  // Pass 3: category + similar name (unit may differ → unit_mismatch)
  const p3 = candidates.find(
    (c) =>
      c.category === manual.category && similar(c.elementName, manual.elementName)
  );
  if (p3) return { item: p3, exactUnit: unitsCompatible(p3.unit, manual.unit) };

  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function compareManualVsSystem(
  manualItems: ManualQuantityItem[],
  systemItems: QuantityTakeoffItem[],
  projectId: string
): QuantityComparisonResult[] {
  const results: QuantityComparisonResult[] = [];
  const matchedSystemIds = new Set<string>();

  for (const manual of manualItems) {
    const unmatched = systemItems.filter((s) => !matchedSystemIds.has(s.id));
    const match = findBestMatch(manual, unmatched);

    if (!match) {
      results.push({
        id: generateId(),
        projectId,
        manualItemId: manual.id,
        systemItemId: undefined,
        category: manual.category,
        elementName: manual.elementName,
        manualQuantity: manual.quantity,
        systemQuantity: undefined,
        unit: manual.unit,
        difference: undefined,
        differencePercent: undefined,
        status: "missing_in_system",
        notes: manual.notes,
      });
      continue;
    }

    const sys = match.item;
    matchedSystemIds.add(sys.id);

    if (!match.exactUnit) {
      results.push({
        id: generateId(),
        projectId,
        manualItemId: manual.id,
        systemItemId: sys.id,
        category: manual.category,
        elementName: manual.elementName,
        manualQuantity: manual.quantity,
        systemQuantity: sys.quantity,
        unit: manual.unit,
        difference: undefined,
        differencePercent: undefined,
        status: "unit_mismatch",
        notes: `Manual unit: ${manual.unit} | System unit: ${sys.unit}`,
      });
      continue;
    }

    const diff = sys.quantity - manual.quantity;
    const diffPct =
      manual.quantity !== 0
        ? (diff / manual.quantity) * 100
        : undefined;

    const status: ComparisonStatus =
      Math.abs(diffPct ?? 0) < 0.01 ? "matched" : "needs_review";

    results.push({
      id: generateId(),
      projectId,
      manualItemId: manual.id,
      systemItemId: sys.id,
      category: manual.category,
      elementName: manual.elementName,
      manualQuantity: manual.quantity,
      systemQuantity: sys.quantity,
      unit: manual.unit,
      difference: diff,
      differencePercent: diffPct,
      status,
      notes: manual.notes ?? sys.notes,
    });
  }

  // Remaining system items have no manual match → extra_in_system
  for (const sys of systemItems) {
    if (matchedSystemIds.has(sys.id)) continue;
    results.push({
      id: generateId(),
      projectId,
      manualItemId: "",
      systemItemId: sys.id,
      category: sys.category as TakeoffCategory,
      elementName: sys.elementName,
      manualQuantity: 0,
      systemQuantity: sys.quantity,
      unit: sys.unit,
      difference: sys.quantity,
      differencePercent: undefined,
      status: "extra_in_system",
      notes: sys.notes,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Accuracy summary
// ---------------------------------------------------------------------------

export function computeAccuracySummary(
  results: QuantityComparisonResult[]
): AccuracySummary {
  const totalManual = results.filter(
    (r) => r.status !== "extra_in_system"
  ).length;
  const matched = results.filter((r) => r.status === "matched").length;
  const missingInSystem = results.filter(
    (r) => r.status === "missing_in_system"
  ).length;
  const extraInSystem = results.filter(
    (r) => r.status === "extra_in_system"
  ).length;
  const unitMismatches = results.filter(
    (r) => r.status === "unit_mismatch"
  ).length;

  const diffs = results
    .filter(
      (r) =>
        r.status === "matched" ||
        r.status === "needs_review"
    )
    .map((r) => Math.abs(r.differencePercent ?? 0));

  const averageAbsDiffPercent =
    diffs.length > 0 ? diffs.reduce((s, v) => s + v, 0) / diffs.length : 0;

  const accuracyScore = Math.max(
    0,
    Math.min(100, 100 - averageAbsDiffPercent)
  );

  return {
    totalManual,
    matched,
    missingInSystem,
    extraInSystem,
    unitMismatches,
    averageAbsDiffPercent,
    accuracyScore,
  };
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

function escapeCsv(v: string | number | undefined | null): string {
  const s = v === undefined || v === null ? "" : String(v);
  return s.includes(",") || s.includes('"') || s.includes("\n")
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

export function exportComparisonToCsv(
  results: QuantityComparisonResult[],
  projectName: string
): void {
  const STATUS_LABELS: Record<string, string> = {
    matched: "Matched",
    missing_in_system: "Missing in system",
    extra_in_system: "Extra in system",
    unit_mismatch: "Unit mismatch",
    needs_review: "Needs review",
  };

  const headers = [
    "Category",
    "Element Name",
    "Location / Floor",
    "Manual Qty",
    "System Qty",
    "Unit",
    "Difference",
    "Difference %",
    "Status",
    "Notes",
  ];

  const rows = results.map((r) => [
    TAKEOFF_CATEGORY_LABELS[r.category],
    r.elementName,
    "",
    r.manualQuantity !== 0 ? r.manualQuantity : "",
    r.systemQuantity ?? "",
    r.unit,
    r.difference !== undefined ? r.difference.toFixed(2) : "",
    r.differencePercent !== undefined ? r.differencePercent.toFixed(1) + "%" : "",
    STATUS_LABELS[r.status] ?? r.status,
    r.notes ?? "",
  ]);

  const csv = [headers, ...rows]
    .map((row) => row.map(escapeCsv).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${projectName.replace(/\s+/g, "-")}-accuracy-comparison.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
