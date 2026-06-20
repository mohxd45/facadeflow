import type { TakeoffCategory } from "@/types/takeoff";

export interface ManualQuantityItem {
  id: string;
  projectId: string;
  itemCode?: string;
  elementName: string;
  category: TakeoffCategory;
  locationFloor?: string;
  quantity: number;
  unit: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type CreateManualQuantityInput = Omit<
  ManualQuantityItem,
  "id" | "createdAt" | "updatedAt"
>;

export type ComparisonStatus =
  | "matched"
  | "missing_in_system"
  | "extra_in_system"
  | "unit_mismatch"
  | "needs_review";

export interface QuantityComparisonResult {
  id: string;
  projectId: string;
  manualItemId: string;
  systemItemId?: string;
  category: TakeoffCategory;
  elementName: string;
  manualQuantity: number;
  systemQuantity?: number;
  unit: string;
  difference?: number;
  differencePercent?: number;
  status: ComparisonStatus;
  notes?: string;
}

export interface AccuracySummary {
  totalManual: number;
  matched: number;
  missingInSystem: number;
  extraInSystem: number;
  unitMismatches: number;
  averageAbsDiffPercent: number;
  accuracyScore: number;
}
