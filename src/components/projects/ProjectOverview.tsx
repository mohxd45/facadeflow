"use client";

import type { Project } from "@/types/project";
import type { QuantityTakeoffItem } from "@/types/takeoff";
import { TAKEOFF_CATEGORY_LABELS } from "@/lib/constants";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface ProjectOverviewProps {
  project: Project;
  drawingCount: number;
  takeoffItems: QuantityTakeoffItem[];
}

export default function ProjectOverview({
  project,
  drawingCount,
  takeoffItems,
}: ProjectOverviewProps) {
  const categoryTotals = takeoffItems.reduce<
    Record<string, { quantity: number; unit: string }[]>
  >((acc, item) => {
    const label = TAKEOFF_CATEGORY_LABELS[item.category];
    if (!acc[label]) acc[label] = [];
    acc[label].push({ quantity: item.quantity, unit: item.unit });
    return acc;
  }, {});

  const aggregatedByCategory = Object.entries(categoryTotals).map(
    ([category, entries]) => {
      const byUnit = entries.reduce<Record<string, number>>((sum, e) => {
        sum[e.unit] = (sum[e.unit] ?? 0) + e.quantity;
        return sum;
      }, {});
      return { category, byUnit };
    }
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Project</CardDescription>
            <CardTitle className="text-lg">{project.name}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Client</CardDescription>
            <CardTitle className="text-lg">
              {project.clientName ?? "—"}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Location</CardDescription>
            <CardTitle className="text-lg">{project.location ?? "—"}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Drawings / Items</CardDescription>
            <CardTitle className="text-lg">
              {drawingCount} / {takeoffItems.length}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {project.description && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Description</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-[var(--muted)]">{project.description}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Quantities by Category</CardTitle>
          <CardDescription>
            Aggregated takeoff totals grouped by element category
          </CardDescription>
        </CardHeader>
        <CardContent>
          {aggregatedByCategory.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              No takeoff items yet. Add items in the Quantity Takeoff tab.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className="pb-2 text-left text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                      Category
                    </th>
                    <th className="pb-2 text-right text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                      Total Quantity
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {aggregatedByCategory.map(({ category, byUnit }) => (
                    <tr
                      key={category}
                      className="border-b border-[var(--border)] last:border-0"
                    >
                      <td className="py-2.5 font-medium">{category}</td>
                      <td className="py-2.5 text-right text-[var(--muted)]">
                        {Object.entries(byUnit)
                          .map(([unit, qty]) => `${qty.toLocaleString()} ${unit}`)
                          .join(" · ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
