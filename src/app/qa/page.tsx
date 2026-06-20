"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import Header from "@/components/layout/Header";
import PageContainer from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  XCircle,
  Circle,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Download,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

type CheckResult = "pass" | "fail" | "skip" | "untested";

interface CheckItem {
  id: string;
  name: string;
  expected: string;
}

interface CheckSection {
  id: string;
  title: string;
  items: CheckItem[];
}

interface CheckState {
  [itemId: string]: {
    result: CheckResult;
    notes: string;
  };
}

// ---------------------------------------------------------------------------
// Static checklist definition
// ---------------------------------------------------------------------------

const SECTIONS: CheckSection[] = [
  {
    id: "project",
    title: "Project Management",
    items: [
      { id: "proj-create", name: "Create a new project", expected: "Project appears in the Projects list with correct name, client, and location." },
      { id: "proj-view", name: "View project details", expected: "Project detail page opens and shows all tabs: Overview, Drawings, Takeoff, Layer Mapping, Accuracy." },
      { id: "proj-delete", name: "Delete a project", expected: "Project and all associated drawings/items are removed." },
    ],
  },
  {
    id: "upload",
    title: "Drawing Upload",
    items: [
      { id: "upload-pdf", name: "Upload a PDF file (< 10 MB)", expected: "Drawing appears in Drawings tab with status 'Ready'. File size shown correctly." },
      { id: "upload-dxf", name: "Upload a DXF file (< 10 MB)", expected: "Drawing appears in Drawings tab with status 'Ready'." },
      { id: "upload-large", name: "Upload a file > 250 MB", expected: "Drawing registered with status 'Queued' and clear warning message. No browser crash." },
      { id: "upload-invalid", name: "Upload a non-drawing file (.txt)", expected: "File is rejected with clear error. Other pending files still available." },
      { id: "upload-delete", name: "Delete a drawing", expected: "Drawing removed from list. Confirmation dialog shown before deletion." },
      { id: "upload-storage-badge", name: "Storage mode badge visible on upload form", expected: "Badge shows 'Local mode' or 'Supabase mode' with description." },
    ],
  },
  {
    id: "pdf",
    title: "PDF Analysis",
    items: [
      { id: "pdf-analyse", name: "Click 'Analyse PDF' on a ready PDF", expected: "Suggestions modal appears with extracted items. Page numbers shown in notes." },
      { id: "pdf-confidence", name: "High-confidence items selected by default", expected: "High = selected, Medium with qty = selected, Low = not selected." },
      { id: "pdf-accept", name: "Accept selected suggestions", expected: "Items appear in Quantity Takeoff tab with correct values." },
      { id: "pdf-no-text", name: "Analyse a scanned PDF (no text layer)", expected: "No suggestions shown. Friendly message about scanned document." },
      { id: "pdf-large", name: "Click 'Analyse PDF' on a PDF > 250 MB", expected: "Button disabled or shows 'file too large' tooltip." },
    ],
  },
  {
    id: "dxf-inspect",
    title: "DXF Inspection",
    items: [
      { id: "dxf-inspect-btn", name: "Click 'Inspect DXF' on a DXF drawing", expected: "DXF Inspect modal opens. Shows layer count, entity count, entity type breakdown." },
      { id: "dxf-inspect-layers", name: "Layer list populated", expected: "Layers visible with entity counts. Text labels and blocks listed if present." },
      { id: "dxf-inspect-create-mappings", name: "Click 'Create mappings from layers'", expected: "Layer Mapping tab populated with default mappings for all unmapped layers." },
      { id: "dxf-inspect-large", name: "Click Inspect on DXF > 100 MB", expected: "Button disabled with tooltip 'DXF over 100 MB requires backend processing'." },
    ],
  },
  {
    id: "dxf-takeoff",
    title: "DXF Takeoff Generation",
    items: [
      { id: "dxf-takeoff-generate", name: "Click 'Generate Takeoff' on a DXF", expected: "Suggestions modal opens with grouped category rows. Layer, entity count, qty, unit shown." },
      { id: "dxf-takeoff-accept", name: "Accept DXF suggestions", expected: "Items added to Quantity Takeoff tab. Source drawing linked." },
      { id: "dxf-takeoff-view-layer", name: "Click 'View source layer' in suggestion modal", expected: "Visual Review modal opens with that layer highlighted." },
    ],
  },
  {
    id: "layer-mapping",
    title: "Layer Mapping",
    items: [
      { id: "layer-create", name: "Save a layer mapping", expected: "Mapping appears in Layer Mapping tab with correct category, mode, unit." },
      { id: "layer-toggle", name: "Toggle a layer mapping off", expected: "Disabled layer is skipped in next DXF takeoff generation." },
      { id: "layer-delete", name: "Delete a layer mapping", expected: "Mapping removed from table." },
      { id: "layer-override", name: "Mapping overrides auto-inference", expected: "After saving mapping, re-generate DXF takeoff — result uses saved category/unit, note says 'Used saved layer mapping'." },
    ],
  },
  {
    id: "visual-review",
    title: "DXF Visual Review",
    items: [
      { id: "visual-open", name: "Click 'Visual Review' on a DXF drawing", expected: "SVG preview renders. Layer sidebar shows all layers with entity counts." },
      { id: "visual-toggle", name: "Toggle layer visibility", expected: "Layer geometry appears/disappears in SVG." },
      { id: "visual-highlight", name: "Click a layer to highlight it", expected: "Layer geometry highlighted in different colour. Sidebar shows measurement summary." },
      { id: "visual-large", name: "Visual review with > 10,000 entities", expected: "Warning shown: 'Large drawing. Rendering may be simplified.' No browser crash." },
    ],
  },
  {
    id: "takeoff",
    title: "Quantity Takeoff Table",
    items: [
      { id: "takeoff-add", name: "Manually add a takeoff item", expected: "Item appears in table with correct category, qty, unit, and auto-generated item code." },
      { id: "takeoff-edit", name: "Edit an existing item inline", expected: "Changes saved on blur/confirm." },
      { id: "takeoff-delete", name: "Delete a takeoff item", expected: "Item removed from table." },
      { id: "takeoff-csv", name: "Export takeoff as CSV", expected: "CSV file downloads. Contains all items with correct headers and values." },
      { id: "takeoff-excel", name: "Export takeoff as Excel", expected: "XLSX file downloads. Three sheets: Quantity Takeoff, Summary by Category, Drawing Register. Company branding visible if profile is set." },
      { id: "takeoff-empty-export", name: "'Export Excel' disabled when no items", expected: "Button disabled with tooltip 'No takeoff items to export'." },
    ],
  },
  {
    id: "accuracy",
    title: "Accuracy Comparison",
    items: [
      { id: "acc-add-manual", name: "Add a manual quantity item", expected: "Row appears in Manual Quantities table." },
      { id: "acc-compare", name: "Click 'Run comparison'", expected: "Comparison table shows matched/missing/extra items. Accuracy score displayed." },
      { id: "acc-csv", name: "Export comparison as CSV", expected: "CSV downloads with comparison results." },
    ],
  },
  {
    id: "settings",
    title: "Settings & Company Profile",
    items: [
      { id: "settings-company", name: "Save company profile", expected: "Name, address, phone saved. Logo preview visible if uploaded." },
      { id: "settings-logo", name: "Upload company logo", expected: "PNG/JPG/WebP accepted. Preview shown. Remove button works." },
      { id: "settings-debug", name: "Debug panel shows correct counts", expected: "Project, drawing, takeoff item counts match actual data. Storage mode correct." },
    ],
  },
  {
    id: "supabase",
    title: "Supabase Integration",
    items: [
      { id: "sb-test", name: "Test Supabase connection (all tables ready)", expected: "All 6 table rows show green 'Ready'. No errors." },
      { id: "sb-tables-missing", name: "Test connection with missing tables", expected: "Missing tables show red 'Missing'. Message: 'Run SQL from docs/supabase-schema.md'." },
      { id: "sb-upload", name: "Upload a drawing in Supabase mode", expected: "File appears in Supabase Storage bucket. Drawing metadata saved in Postgres." },
      { id: "sb-signed-url", name: "Preview a Supabase-stored drawing", expected: "Signed URL generated. Preview opens correctly." },
      { id: "sb-delete", name: "Delete a Supabase-stored drawing", expected: "File removed from Supabase Storage. Metadata deleted from DB." },
      { id: "sb-migrate", name: "Run local → Supabase migration", expected: "Records created in Supabase. Counts shown per entity type." },
      { id: "sb-pdf-analyse", name: "Analyse a PDF from Supabase Storage", expected: "File downloaded via signed URL. Analysis runs. Suggestions appear." },
      { id: "sb-dxf-analyse", name: "Analyse a DXF from Supabase Storage", expected: "File downloaded via signed URL. DXF inspect modal opens." },
    ],
  },
];

const STORAGE_KEY = "facade-takeoff:qa-results";

const RESULT_COLORS: Record<CheckResult, string> = {
  pass: "text-emerald-600",
  fail: "text-red-600",
  skip: "text-slate-400",
  untested: "text-slate-300",
};

const RESULT_ICONS: Record<CheckResult, React.ElementType> = {
  pass: CheckCircle2,
  fail: XCircle,
  skip: Circle,
  untested: Circle,
};

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function ResultButton({
  value,
  active,
  onClick,
}: {
  value: CheckResult;
  active: boolean;
  onClick: () => void;
}) {
  const labels: Record<CheckResult, string> = {
    pass: "Pass",
    fail: "Fail",
    skip: "Skip",
    untested: "Untested",
  };
  const colors: Record<CheckResult, string> = {
    pass: active ? "bg-emerald-600 text-white border-emerald-600" : "text-emerald-600 border-emerald-200 hover:bg-emerald-50",
    fail: active ? "bg-red-600 text-white border-red-600" : "text-red-600 border-red-200 hover:bg-red-50",
    skip: active ? "bg-slate-400 text-white border-slate-400" : "text-slate-500 border-slate-200 hover:bg-slate-50",
    untested: active ? "bg-slate-200 text-slate-700 border-slate-300" : "text-slate-400 border-slate-200 hover:bg-slate-50",
  };
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded border px-2 py-0.5 text-xs font-medium transition-colors",
        colors[value]
      )}
    >
      {labels[value]}
    </button>
  );
}

function CheckItemRow({
  item,
  state,
  onChange,
}: {
  item: CheckItem;
  state: { result: CheckResult; notes: string };
  onChange: (result: CheckResult, notes: string) => void;
}) {
  const Icon = RESULT_ICONS[state.result];

  return (
    <div className={cn(
      "border-b border-[var(--border)] px-4 py-3 last:border-0",
      state.result === "pass" && "bg-emerald-50/40",
      state.result === "fail" && "bg-red-50/40",
    )}>
      <div className="flex items-start gap-3">
        <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", RESULT_COLORS[state.result])} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{item.name}</p>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            Expected: {item.expected}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {(["pass", "fail", "skip", "untested"] as CheckResult[]).map((r) => (
              <ResultButton
                key={r}
                value={r}
                active={state.result === r}
                onClick={() => onChange(r, state.notes)}
              />
            ))}
          </div>
          <textarea
            value={state.notes}
            onChange={(e) => onChange(state.result, e.target.value)}
            placeholder="Notes (optional)"
            rows={1}
            className="mt-2 w-full resize-none rounded border border-[var(--border)] bg-white px-2 py-1 text-xs text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>
    </div>
  );
}

function SectionPanel({
  section,
  checks,
  onUpdate,
}: {
  section: CheckSection;
  checks: CheckState;
  onUpdate: (id: string, result: CheckResult, notes: string) => void;
}) {
  const [open, setOpen] = useState(true);

  const items = section.items;
  const passed = items.filter((i) => checks[i.id]?.result === "pass").length;
  const failed = items.filter((i) => checks[i.id]?.result === "fail").length;
  const total = items.length;
  const allPassed = passed === total;
  const anyFailed = failed > 0;

  return (
    <div className="rounded-lg border border-[var(--border)] bg-white shadow-sm overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-50"
      >
        <div className="flex items-center gap-3">
          {open ? <ChevronDown className="h-4 w-4 text-[var(--muted)]" /> : <ChevronRight className="h-4 w-4 text-[var(--muted)]" />}
          <span className="font-semibold text-sm">{section.title}</span>
          <span className={cn(
            "rounded-full px-2 py-0.5 text-xs font-medium",
            allPassed ? "bg-emerald-100 text-emerald-700" : anyFailed ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-600"
          )}>
            {passed}/{total}
          </span>
        </div>
        <div className="flex gap-1.5">
          {passed > 0 && <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-700">{passed} ✓</span>}
          {failed > 0 && <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700">{failed} ✗</span>}
        </div>
      </button>

      {open && (
        <div>
          {items.map((item) => (
            <CheckItemRow
              key={item.id}
              item={item}
              state={checks[item.id] ?? { result: "untested", notes: "" }}
              onChange={(result, notes) => onUpdate(item.id, result, notes)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function computeSummary(checks: CheckState) {
  const allItems = SECTIONS.flatMap((s) => s.items);
  const total = allItems.length;
  const pass = allItems.filter((i) => checks[i.id]?.result === "pass").length;
  const fail = allItems.filter((i) => checks[i.id]?.result === "fail").length;
  const skip = allItems.filter((i) => checks[i.id]?.result === "skip").length;
  const untested = total - pass - fail - skip;
  return { total, pass, fail, skip, untested };
}

export default function QAPage() {
  const [checks, setChecks] = useState<CheckState>({});
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // Load from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        setChecks(parsed.checks ?? {});
        setSavedAt(parsed.savedAt ?? null);
      }
    } catch {
      // ignore
    }
  }, []);

  const persist = useCallback((newChecks: CheckState) => {
    const payload = { checks: newChecks, savedAt: new Date().toISOString() };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      setSavedAt(payload.savedAt);
    } catch {
      // ignore storage errors
    }
  }, []);

  const handleUpdate = (id: string, result: CheckResult, notes: string) => {
    const next = { ...checks, [id]: { result, notes } };
    setChecks(next);
    persist(next);
  };

  const handleReset = () => {
    if (!window.confirm("Reset all QA results? This cannot be undone.")) return;
    setChecks({});
    localStorage.removeItem(STORAGE_KEY);
    setSavedAt(null);
  };

  const handleExportCsv = () => {
    const rows: string[] = ["Section,Test,Expected,Result,Notes"];
    for (const section of SECTIONS) {
      for (const item of section.items) {
        const s = checks[item.id] ?? { result: "untested", notes: "" };
        const cols = [
          section.title,
          item.name,
          item.expected,
          s.result,
          s.notes || "",
        ].map((v) => `"${String(v).replace(/"/g, '""')}"`);
        rows.push(cols.join(","));
      }
    }
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `facade-takeoff-qa-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const { total, pass, fail, skip, untested } = computeSummary(checks);
  const scorePercent = total > 0 ? Math.round((pass / (pass + fail || 1)) * 100) : 0;

  return (
    <PageContainer>
      <Header
        title="QA Checklist"
        subtitle="Test all major workflows before real user testing"
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleExportCsv}>
              <Download className="h-4 w-4" />
              Export CSV
            </Button>
            <Button variant="outline" size="sm" onClick={handleReset}>
              <RotateCcw className="h-4 w-4" />
              Reset
            </Button>
          </div>
        }
      />

      {/* Summary bar */}
      <div className="rounded-lg border border-[var(--border)] bg-white px-5 py-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap gap-4 text-sm">
            <span className="text-[var(--muted)]">Total: <strong className="text-[var(--foreground)]">{total}</strong></span>
            <span className="text-emerald-600">Pass: <strong>{pass}</strong></span>
            <span className="text-red-600">Fail: <strong>{fail}</strong></span>
            <span className="text-slate-400">Skip: <strong>{skip}</strong></span>
            <span className="text-slate-300">Untested: <strong className="text-[var(--muted)]">{untested}</strong></span>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-xs text-[var(--muted)]">Pass rate (tested)</p>
              <p className={cn(
                "text-lg font-bold",
                scorePercent >= 90 ? "text-emerald-600" : scorePercent >= 70 ? "text-amber-600" : "text-red-600"
              )}>{pass + fail > 0 ? `${scorePercent}%` : "—"}</p>
            </div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-3 h-2 rounded-full bg-slate-100 overflow-hidden flex">
          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${(pass / total) * 100}%` }} />
          <div className="h-full bg-red-400 transition-all" style={{ width: `${(fail / total) * 100}%` }} />
          <div className="h-full bg-slate-300 transition-all" style={{ width: `${(skip / total) * 100}%` }} />
        </div>

        {savedAt && (
          <p className="mt-2 text-xs text-[var(--muted)]">
            Last saved: {new Date(savedAt).toLocaleString()}
          </p>
        )}
      </div>

      {/* Sections */}
      <div className="space-y-4">
        {SECTIONS.map((section) => (
          <SectionPanel
            key={section.id}
            section={section}
            checks={checks}
            onUpdate={handleUpdate}
          />
        ))}
      </div>

      <p className="text-center text-xs text-[var(--muted)]">
        Results are saved to localStorage automatically. Use Export CSV to share or archive.{" "}
        <Link href="/" className="underline hover:text-[var(--foreground)]">Back to Dashboard</Link>
      </p>
    </PageContainer>
  );
}
