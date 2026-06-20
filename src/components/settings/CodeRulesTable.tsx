"use client";

import { useState } from "react";
import { useCodeRuleStore } from "@/stores/code-rule-store";
import type { ItemCodeRule, CalculationMethod, CodeTakeoffUnit } from "@/types/code-takeoff";
import { TAKEOFF_CATEGORY_LABELS } from "@/lib/constants";
import type { TakeoffCategory } from "@/types/takeoff";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, RotateCcw, Trash2, Pencil, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

const METHOD_LABELS: Record<CalculationMethod, string> = {
  width_height_qty: "W × H × Qty",
  entered_area: "Enter area",
  entered_length: "Enter length",
  manual_quantity: "Manual qty",
};

const UNIT_OPTIONS: CodeTakeoffUnit[] = ["sqm", "lm", "nos", "set"];
const METHOD_OPTIONS: CalculationMethod[] = [
  "width_height_qty",
  "entered_area",
  "entered_length",
  "manual_quantity",
];
const CATEGORY_OPTIONS = Object.keys(TAKEOFF_CATEGORY_LABELS) as TakeoffCategory[];

// ---------------------------------------------------------------------------
// Inline row editor
// ---------------------------------------------------------------------------

interface EditState {
  codePrefix: string;
  label: string;
  category: TakeoffCategory;
  defaultUnit: CodeTakeoffUnit;
  calculationMethod: CalculationMethod;
  description: string;
}

function blankEdit(): EditState {
  return {
    codePrefix: "",
    label: "",
    category: "windows",
    defaultUnit: "sqm",
    calculationMethod: "width_height_qty",
    description: "",
  };
}

function ruleToEdit(r: ItemCodeRule): EditState {
  return {
    codePrefix: r.codePrefix,
    label: r.label,
    category: r.category,
    defaultUnit: r.defaultUnit,
    calculationMethod: r.calculationMethod,
    description: r.description ?? "",
  };
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function CodeRulesTable() {
  const rules = useCodeRuleStore((s) => s.rules);
  const addRule = useCodeRuleStore((s) => s.addRule);
  const updateRule = useCodeRuleStore((s) => s.updateRule);
  const deleteRule = useCodeRuleStore((s) => s.deleteRule);
  const toggleActive = useCodeRuleStore((s) => s.toggleActive);
  const resetToDefaults = useCodeRuleStore((s) => s.resetToDefaults);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState>(blankEdit());
  const [addingNew, setAddingNew] = useState(false);
  const [newState, setNewState] = useState<EditState>(blankEdit());
  const [busy, setBusy] = useState(false);

  const sorted = [...rules].sort((a, b) => a.codePrefix.localeCompare(b.codePrefix));

  // ── Helpers ──────────────────────────────────────────────────────────────

  const startEdit = (rule: ItemCodeRule) => {
    setEditingId(rule.id);
    setEditState(ruleToEdit(rule));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditState(blankEdit());
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setBusy(true);
    try {
      await updateRule(editingId, {
        label: editState.label,
        category: editState.category,
        defaultUnit: editState.defaultUnit,
        calculationMethod: editState.calculationMethod,
        description: editState.description || undefined,
      });
      cancelEdit();
    } finally {
      setBusy(false);
    }
  };

  const saveNew = async () => {
    if (!newState.codePrefix.trim() || !newState.label.trim()) return;
    setBusy(true);
    try {
      await addRule({
        codePrefix: newState.codePrefix.trim().toUpperCase(),
        label: newState.label.trim(),
        category: newState.category,
        defaultUnit: newState.defaultUnit,
        calculationMethod: newState.calculationMethod,
        description: newState.description || undefined,
        isActive: true,
        isDefault: false,
      });
      setAddingNew(false);
      setNewState(blankEdit());
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async () => {
    if (!window.confirm("Reset to default company code rules? User-added rules will be removed.")) return;
    setBusy(true);
    try { await resetToDefaults(); } finally { setBusy(false); }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this rule?")) return;
    await deleteRule(id);
  };

  // ── Reusable select ───────────────────────────────────────────────────────

  function Select<T extends string>({
    value,
    onChange,
    options,
    labelFn,
    className,
  }: {
    value: T;
    onChange: (v: T) => void;
    options: T[];
    labelFn?: (v: T) => string;
    className?: string;
  }) {
    return (
      <select
        className={cn(
          "h-7 rounded border border-slate-300 bg-white px-1.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-400",
          className
        )}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {labelFn ? labelFn(o) : o}
          </option>
        ))}
      </select>
    );
  }

  // ── Row renderer ─────────────────────────────────────────────────────────

  function RuleRow({ rule }: { rule: ItemCodeRule }) {
    const isEditing = editingId === rule.id;
    if (isEditing) {
      return (
        <TableRow className="bg-blue-50">
          <TableCell className="font-mono text-xs">{rule.codePrefix}</TableCell>
          <TableCell>
            <Input
              className="h-7 text-xs"
              value={editState.label}
              onChange={(e) => setEditState((s) => ({ ...s, label: e.target.value }))}
            />
          </TableCell>
          <TableCell>
            <Select
              value={editState.category}
              onChange={(v) => setEditState((s) => ({ ...s, category: v }))}
              options={CATEGORY_OPTIONS}
              labelFn={(c) => TAKEOFF_CATEGORY_LABELS[c]}
            />
          </TableCell>
          <TableCell>
            <Select
              value={editState.defaultUnit}
              onChange={(v) => setEditState((s) => ({ ...s, defaultUnit: v }))}
              options={UNIT_OPTIONS}
            />
          </TableCell>
          <TableCell>
            <Select
              value={editState.calculationMethod}
              onChange={(v) => setEditState((s) => ({ ...s, calculationMethod: v }))}
              options={METHOD_OPTIONS}
              labelFn={(m) => METHOD_LABELS[m]}
              className="w-36"
            />
          </TableCell>
          <TableCell colSpan={2} className="text-right">
            <div className="flex gap-1 justify-end">
              <Button size="sm" className="h-6 text-[10px] px-2" disabled={busy} onClick={saveEdit}>
                <Check className="h-3 w-3" />
              </Button>
              <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={cancelEdit}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          </TableCell>
        </TableRow>
      );
    }

    return (
      <TableRow className={cn(!rule.isActive && "opacity-50")}>
        <TableCell className="font-mono text-xs font-semibold">{rule.codePrefix}</TableCell>
        <TableCell className="text-xs">{rule.label}</TableCell>
        <TableCell className="text-xs">{TAKEOFF_CATEGORY_LABELS[rule.category]}</TableCell>
        <TableCell>
          <Badge variant="secondary" className="text-[10px]">{rule.defaultUnit}</Badge>
        </TableCell>
        <TableCell className="text-xs text-slate-600">{METHOD_LABELS[rule.calculationMethod]}</TableCell>
        <TableCell>
          <button
            type="button"
            onClick={() => toggleActive(rule.id)}
            className={cn(
              "relative inline-flex h-4 w-8 items-center rounded-full transition-colors shrink-0",
              rule.isActive ? "bg-green-500" : "bg-slate-300"
            )}
          >
            <span
              className={cn(
                "inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform",
                rule.isActive ? "translate-x-4" : "translate-x-1"
              )}
            />
          </button>
        </TableCell>
        <TableCell className="text-right">
          <div className="flex gap-1 justify-end">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              title="Edit"
              onClick={() => startEdit(rule)}
            >
              <Pencil className="h-3 w-3" />
            </Button>
            {!rule.isDefault && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-red-500"
                title="Delete"
                onClick={() => handleDelete(rule.id)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </div>
        </TableCell>
      </TableRow>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-600">
          {rules.filter((r) => r.isActive).length} active · {rules.length} total
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[11px]"
            onClick={() => { setAddingNew(true); setNewState(blankEdit()); }}
          >
            <Plus className="h-3.5 w-3.5" />
            Add rule
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[11px] text-amber-700 border-amber-300"
            onClick={handleReset}
            disabled={busy}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset defaults
          </Button>
        </div>
      </div>

      <div className="rounded-md border border-slate-200 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50 text-[11px]">
              <TableHead className="h-8 py-0 w-20">Prefix</TableHead>
              <TableHead className="h-8 py-0">Label</TableHead>
              <TableHead className="h-8 py-0">Category</TableHead>
              <TableHead className="h-8 py-0 w-16">Unit</TableHead>
              <TableHead className="h-8 py-0">Method</TableHead>
              <TableHead className="h-8 py-0 w-16">Active</TableHead>
              <TableHead className="h-8 py-0 w-16 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((rule) => (
              <RuleRow key={rule.id} rule={rule} />
            ))}

            {/* Add new row */}
            {addingNew && (
              <TableRow className="bg-green-50">
                <TableCell>
                  <Input
                    className="h-7 text-xs font-mono uppercase"
                    placeholder="e.g. GR"
                    value={newState.codePrefix}
                    onChange={(e) =>
                      setNewState((s) => ({ ...s, codePrefix: e.target.value }))
                    }
                  />
                </TableCell>
                <TableCell>
                  <Input
                    className="h-7 text-xs"
                    placeholder="Label"
                    value={newState.label}
                    onChange={(e) =>
                      setNewState((s) => ({ ...s, label: e.target.value }))
                    }
                  />
                </TableCell>
                <TableCell>
                  <Select
                    value={newState.category}
                    onChange={(v) => setNewState((s) => ({ ...s, category: v }))}
                    options={CATEGORY_OPTIONS}
                    labelFn={(c) => TAKEOFF_CATEGORY_LABELS[c]}
                  />
                </TableCell>
                <TableCell>
                  <Select
                    value={newState.defaultUnit}
                    onChange={(v) => setNewState((s) => ({ ...s, defaultUnit: v }))}
                    options={UNIT_OPTIONS}
                  />
                </TableCell>
                <TableCell>
                  <Select
                    value={newState.calculationMethod}
                    onChange={(v) => setNewState((s) => ({ ...s, calculationMethod: v }))}
                    options={METHOD_OPTIONS}
                    labelFn={(m) => METHOD_LABELS[m]}
                    className="w-36"
                  />
                </TableCell>
                <TableCell colSpan={2} className="text-right">
                  <div className="flex gap-1 justify-end">
                    <Button size="sm" className="h-6 text-[10px] px-2" disabled={busy || !newState.codePrefix || !newState.label} onClick={saveNew}>
                      <Check className="h-3 w-3" />
                      Save
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={() => setAddingNew(false)}>
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )}

            {rules.length === 0 && !addingNew && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-xs text-slate-500 py-6">
                  No code rules yet. Click &ldquo;Add rule&rdquo; or &ldquo;Reset defaults&rdquo;.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <p className="text-[10px] text-slate-500">
        Default rules cannot be deleted — toggle Active to disable them.
        Matching uses longest prefix: A/FIN-01 matches A/FIN before A.
      </p>
    </div>
  );
}
