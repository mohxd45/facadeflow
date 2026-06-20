import type { DrawingViewType } from "./drawing";

export type TakeoffCategory =
  | "balcony_railing"
  | "glass_balustrade"
  | "acp_cladding"
  | "curtain_wall_glass_panel"
  | "aluminium_fins"
  | "canopy"
  | "glass_partitions"
  | "windows"
  | "doors"
  | "louvers"
  | "screen";

export type ConfidenceLevel = "manual" | "high" | "medium" | "low";

export interface QuantityTakeoffItem {
  id: string;
  projectId: string;
  itemCode: string;
  elementName: string;
  category: TakeoffCategory;
  drawingViewType: DrawingViewType;
  locationFloor: string;
  quantity: number;
  unit: string;
  sourceDrawingId: string;
  confidence: ConfidenceLevel;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type CreateTakeoffItemInput = Omit<
  QuantityTakeoffItem,
  "id" | "createdAt" | "updatedAt"
>;
