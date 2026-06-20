"use client";

import { useState } from "react";
import type { ManualQuantityItem, CreateManualQuantityInput } from "@/types/validation";
import type { TakeoffCategory } from "@/types/takeoff";
import { TAKEOFF_CATEGORY_LABELS, TAKEOFF_UNITS } from "@/lib/constants";
import { useManualQuantityStore } from "@/stores/manual-quantity-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Pencil, Trash2, Upload } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ManualQuantityTableProps {
  projectId: string;
  items: ManualQuantityItem[];
}

const DEFAULT_FORM: Omit<CreateManualQuantityInput, "projectId"> = {
  elementName: "",
  category: "acp_cladding",
  locationFloor: "",
  quantity: 0,
  unit: "sqm",
  notes: "",
};

// ---------------------------------------------------------------------------
// Form dialog
// ---------------------------------------------------------------------------

interface ItemDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial?: Partial<typeof DEFAULT_FORM>;
  title: string;
  submitLabel: string;
  onSubmit: (values: typeof DEFAULT_FORM) => Promise<void>;
}

function ItemDialog({
  open,
  onOpenChange,
  initial,
  title,
  submitLabel,
  onSubmit,
}: ItemDialogProps) {
  const [form, setForm] = useState<typeof DEFAULT_FORM>({
    ...DEFAULT_FORM,
    ...initial,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = (key: keyof typeof DEFAULT_FORM, val: unknown) =>
    setForm((prev) => ({ ...prev, [key]: val }));

  const handleOpenChange = (o: boolean) => {
    if (!o) {
      setForm({ ...DEFAULT_FORM, ...initial });
      setError(null);
    }
    onOpenChange(o);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.elementName.trim()) {
      setError("Element name is required.");
      return;
    }
    if (form.quantity <= 0) {
      setError("Quantity must be greater than 0.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit(form);
      handleOpenChange(false);
    } catch {
      setError("Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Enter the manual (reference) quantity for comparison.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          {error && (
            <p className="text-sm text-red-600 rounded-md border border-red-200 bg-red-50 px-3 py-2">
              {error}
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {/* Element name */}
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-[var(--muted)]">
                Element name <span className="text-red-500">*</span>
              </label>
              <Input
                value={form.elementName}
                onChange={(e) => patch("elementName", e.target.value)}
                placeholder="e.g. ACP Cladding Level 1-5"
                className="h-8 text-sm"
              />
            </div>

            {/* Category */}
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--muted)]">
                Category
              </label>
              <Select
                value={form.category}
                onValueChange={(v) => patch("category", v)}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TAKEOFF_CATEGORY_LABELS).map(([k, label]) => (
                    <SelectItem key={k} value={k}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Location / floor */}
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--muted)]">
                Location / Floor
              </label>
              <Input
                value={form.locationFloor}
                onChange={(e) => patch("locationFloor", e.target.value)}
                placeholder="e.g. Level 5"
                className="h-8 text-sm"
              />
            </div>

            {/* Quantity */}
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--muted)]">
                Quantity <span className="text-red-500">*</span>
              </label>
              <Input
                type="number"
                min={0}
                step="any"
                value={form.quantity || ""}
                onChange={(e) =>
                  patch("quantity", parseFloat(e.target.value) || 0)
                }
                className="h-8 text-sm"
              />
            </div>

            {/* Unit */}
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--muted)]">
                Unit
              </label>
              <Select
                value={form.unit}
                onValueChange={(v) => patch("unit", v)}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TAKEOFF_UNITS.map((u) => (
                    <SelectItem key={u} value={u}>
                      {u}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Notes */}
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-[var(--muted)]">
                Notes
              </label>
              <Input
                value={form.notes}
                onChange={(e) => patch("notes", e.target.value)}
                placeholder="e.g. Measured from Level 1 to 5 podium"
                className="h-8 text-sm"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? "Saving…" : submitLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Main table
// ---------------------------------------------------------------------------

export default function ManualQuantityTable({
  projectId,
  items,
}: ManualQuantityTableProps) {
  const createItem = useManualQuantityStore((s) => s.createItem);
  const updateItem = useManualQuantityStore((s) => s.updateItem);
  const deleteItem = useManualQuantityStore((s) => s.deleteItem);

  const [addOpen, setAddOpen] = useState(false);
  const [editItem, setEditItem] = useState<ManualQuantityItem | null>(null);

  const handleAdd = async (form: typeof DEFAULT_FORM) => {
    await createItem({ ...form, projectId, category: form.category as TakeoffCategory });
  };

  const handleEdit = async (form: typeof DEFAULT_FORM) => {
    if (!editItem) return;
    await updateItem(editItem.id, { ...form, category: form.category as TakeoffCategory });
  };

  const handleDelete = async (item: ManualQuantityItem) => {
    if (!window.confirm(`Delete manual item "${item.elementName}"?`)) return;
    await deleteItem(item.id);
  };

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-[var(--muted)]">
          {items.length} manual item{items.length !== 1 && "s"}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled
            title="CSV import coming soon"
          >
            <Upload className="h-4 w-4" />
            Import CSV
          </Button>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" />
            Add manual item
          </Button>
        </div>
      </div>

      {/* Empty state */}
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--border)] py-12 text-center">
          <p className="text-sm font-medium">No manual quantities yet</p>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Add reference quantities from your manual takeoff sheet to compare
            against the system.
          </p>
          <Button className="mt-4" size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" />
            Add first item
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-white">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/80">
                <TableHead>Element name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Location / Floor</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium max-w-[200px] truncate">
                    {item.elementName}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-[var(--muted)]">
                    {TAKEOFF_CATEGORY_LABELS[item.category]}
                  </TableCell>
                  <TableCell className="text-[var(--muted)]">
                    {item.locationFloor || "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-medium">
                    {item.quantity.toLocaleString()}
                  </TableCell>
                  <TableCell>{item.unit}</TableCell>
                  <TableCell className="max-w-[160px] truncate text-[var(--muted)]">
                    {item.notes || "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Edit"
                        onClick={() => setEditItem(item)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Delete"
                        onClick={() => handleDelete(item)}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Dialogs */}
      <ItemDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        title="Add Manual Quantity"
        submitLabel="Add item"
        onSubmit={handleAdd}
      />

      <ItemDialog
        open={editItem !== null}
        onOpenChange={(o) => !o && setEditItem(null)}
        initial={
          editItem
            ? {
                elementName: editItem.elementName,
                category: editItem.category,
                locationFloor: editItem.locationFloor ?? "",
                quantity: editItem.quantity,
                unit: editItem.unit,
                notes: editItem.notes ?? "",
              }
            : undefined
        }
        title="Edit Manual Quantity"
        submitLabel="Save changes"
        onSubmit={handleEdit}
      />
    </div>
  );
}
