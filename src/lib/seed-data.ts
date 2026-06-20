import { STORAGE_KEYS } from "@/lib/constants";
import { readJson, writeJson } from "@/lib/storage";
import { generateId } from "@/lib/utils";
import { projectRepository } from "@/services/repositories/local/project.local";
import { drawingRepository } from "@/services/repositories/local/drawing.local";
import { takeoffRepository } from "@/services/repositories/local/takeoff.local";

export async function seedDemoData(): Promise<void> {
  if (readJson<boolean>(STORAGE_KEYS.seeded, false)) return;

  const project = await projectRepository.create({
    name: "Marina Tower Façade",
    clientName: "Emaar Development",
    location: "Dubai Marina, UAE",
    description:
      "Façade takeoff for ACP cladding, curtain wall, balustrades, and canopy details.",
  });

  const now = new Date().toISOString();

  const drawing1 = await drawingRepository.create({
    id: generateId(),
    projectId: project.id,
    fileName: "MT-ELEV-NORTH.pdf",
    fileType: "pdf",
    fileSize: 4_200_000,
    drawingViewType: "elevation",
    category: "elevation",
    floorOrLocation: "North elevation",
    uploadedAt: now,
    status: "ready",
    hasLocalBlob: false,
    notes: "Sample elevation drawing",
  });

  const drawing2 = await drawingRepository.create({
    id: generateId(),
    projectId: project.id,
    fileName: "MT-ACP-TYPICAL-FLOOR.pdf",
    fileType: "pdf",
    fileSize: 8_100_000,
    drawingViewType: "plan",
    category: "acp_cladding_plan",
    floorOrLocation: "Typical floor",
    uploadedAt: now,
    status: "ready",
    hasLocalBlob: false,
  });

  const drawing3 = await drawingRepository.create({
    id: generateId(),
    projectId: project.id,
    fileName: "MT-GLASS-BALUSTRADE.dxf",
    fileType: "dxf",
    fileSize: 2_800_000,
    drawingViewType: "layout",
    category: "glass_balustrade",
    floorOrLocation: "Podium level",
    uploadedAt: now,
    status: "ready",
    hasLocalBlob: false,
  });

  await drawingRepository.create({
    id: generateId(),
    projectId: project.id,
    fileName: "MT-CURTAIN-WALL-FULL.dwg",
    fileType: "dwg",
    fileSize: 312_000_000,
    drawingViewType: "plan",
    category: "curtain_wall_glass",
    floorOrLocation: "All levels",
    uploadedAt: now,
    status: "queued",
    hasLocalBlob: false,
    storagePath: `queued/${project.id}/curtain-wall.dwg`,
    notes: "Large DWG — queued for backend processing",
  });

  const takeoffItems = [
    {
      projectId: project.id,
      itemCode: "TKF-001",
      elementName: "ACP cladding panel — silver metallic",
      category: "acp_cladding" as const,
      drawingViewType: "plan" as const,
      locationFloor: "Typical floor",
      quantity: 1240,
      unit: "sqm",
      sourceDrawingId: drawing2.id,
      confidence: "high" as const,
    },
    {
      projectId: project.id,
      itemCode: "TKF-002",
      elementName: "Curtain wall glass panel — DGU",
      category: "curtain_wall_glass_panel" as const,
      drawingViewType: "elevation" as const,
      locationFloor: "Level 1–20",
      quantity: 856,
      unit: "sqm",
      sourceDrawingId: drawing1.id,
      confidence: "high" as const,
    },
    {
      projectId: project.id,
      itemCode: "TKF-003",
      elementName: "Glass balustrade — 12mm tempered",
      category: "glass_balustrade" as const,
      drawingViewType: "layout" as const,
      locationFloor: "Podium terrace",
      quantity: 186,
      unit: "lm",
      sourceDrawingId: drawing3.id,
      confidence: "manual" as const,
    },
    {
      projectId: project.id,
      itemCode: "TKF-004",
      elementName: "Aluminium fin — vertical 150mm",
      category: "aluminium_fins" as const,
      drawingViewType: "elevation" as const,
      locationFloor: "South elevation",
      quantity: 420,
      unit: "nos",
      sourceDrawingId: drawing1.id,
      confidence: "medium" as const,
    },
    {
      projectId: project.id,
      itemCode: "TKF-005",
      elementName: "Balcony railing — glass & aluminium",
      category: "balcony_railing" as const,
      drawingViewType: "elevation" as const,
      locationFloor: "Residential floors",
      quantity: 312,
      unit: "lm",
      sourceDrawingId: drawing1.id,
      confidence: "high" as const,
    },
    {
      projectId: project.id,
      itemCode: "TKF-006",
      elementName: "Entrance canopy — structural glass",
      category: "canopy" as const,
      drawingViewType: "detail" as const,
      locationFloor: "Ground level",
      quantity: 48,
      unit: "sqm",
      sourceDrawingId: drawing2.id,
      confidence: "manual" as const,
    },
  ];

  for (const item of takeoffItems) {
    await takeoffRepository.create(item);
  }

  writeJson(STORAGE_KEYS.seeded, true);
}
