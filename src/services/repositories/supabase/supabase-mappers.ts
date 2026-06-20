/**
 * Field mappers: camelCase TypeScript ↔ snake_case Supabase columns
 *
 * Rules:
 *  - fromDB()  converts a raw Supabase row → TypeScript object
 *  - toDB()    converts a TypeScript object → Supabase insert/update payload
 *    (omits id / created_at for inserts; Supabase generates those)
 */

import type { Project, CreateProjectInput } from "@/types/project";
import type { DrawingFile, CreateDrawingInput } from "@/types/drawing";
import type { QuantityTakeoffItem, CreateTakeoffItemInput } from "@/types/takeoff";
import type { CadLayerMapping, CreateLayerMappingInput } from "@/types/cad";
import type { ManualQuantityItem, CreateManualQuantityInput } from "@/types/validation";
import type { CompanyProfile, CreateCompanyProfileInput } from "@/types/company";

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function projectFromDB(row: any): Project {
  return {
    id: row.id,
    name: row.name,
    clientName: row.client_name ?? undefined,
    location: row.location ?? undefined,
    description: row.description ?? undefined,
    notes: row.notes ?? undefined,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function projectToDB(input: CreateProjectInput) {
  return {
    name: input.name,
    client_name: input.clientName ?? null,
    location: input.location ?? null,
    description: input.description ?? null,
    status: "active",
  };
}

export function projectUpdateToDB(data: Partial<Project>) {
  return {
    ...(data.name !== undefined && { name: data.name }),
    ...(data.clientName !== undefined && { client_name: data.clientName }),
    ...(data.location !== undefined && { location: data.location }),
    ...(data.description !== undefined && { description: data.description }),
    ...(data.notes !== undefined && { notes: data.notes }),
    ...(data.status !== undefined && { status: data.status }),
  };
}

// ---------------------------------------------------------------------------
// Drawings
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function drawingFromDB(row: any): DrawingFile {
  return {
    id: row.id,
    projectId: row.project_id,
    fileName: row.file_name,
    fileType: row.file_type,
    fileSize: Number(row.file_size),
    drawingViewType: row.drawing_view_type ?? "plan",
    category: row.category,
    floorOrLocation: row.floor_or_location ?? undefined,
    uploadedAt: row.uploaded_at,
    previewUrl: row.preview_url ?? undefined,
    storagePath: row.storage_path ?? undefined,
    status: row.status,
    notes: row.notes ?? undefined,
    hasLocalBlob: row.has_local_blob ?? false,
    errorMessage: row.error_message ?? undefined,
  };
}

export function drawingToDB(input: CreateDrawingInput & Partial<DrawingFile>) {
  return {
    id: input.id,                                         // pass through pre-generated id
    project_id: input.projectId,
    file_name: input.fileName,
    file_type: input.fileType,
    file_size: input.fileSize,
    drawing_view_type: input.drawingViewType ?? "plan",
    category: input.category,
    floor_or_location: input.floorOrLocation ?? null,
    uploaded_at: input.uploadedAt ?? new Date().toISOString(),
    preview_url: input.previewUrl ?? null,
    storage_path: input.storagePath ?? null,
    status: input.status ?? "uploaded",
    notes: input.notes ?? null,
    has_local_blob: input.hasLocalBlob ?? false,
    error_message: input.errorMessage ?? null,
  };
}

export function drawingUpdateToDB(data: Partial<DrawingFile>) {
  const out: Record<string, unknown> = {};
  if (data.fileName !== undefined)       out.file_name = data.fileName;
  if (data.fileType !== undefined)       out.file_type = data.fileType;
  if (data.fileSize !== undefined)       out.file_size = data.fileSize;
  if (data.drawingViewType !== undefined) out.drawing_view_type = data.drawingViewType;
  if (data.category !== undefined)       out.category = data.category;
  if (data.floorOrLocation !== undefined) out.floor_or_location = data.floorOrLocation;
  if (data.previewUrl !== undefined)     out.preview_url = data.previewUrl;
  if (data.storagePath !== undefined)    out.storage_path = data.storagePath;
  if (data.status !== undefined)         out.status = data.status;
  if (data.notes !== undefined)          out.notes = data.notes;
  if (data.hasLocalBlob !== undefined)   out.has_local_blob = data.hasLocalBlob;
  if (data.errorMessage !== undefined)   out.error_message = data.errorMessage;
  return out;
}

// ---------------------------------------------------------------------------
// Takeoff items
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function takeoffFromDB(row: any): QuantityTakeoffItem {
  return {
    id: row.id,
    projectId: row.project_id,
    itemCode: row.item_code,
    elementName: row.element_name,
    category: row.category,
    drawingViewType: row.drawing_view_type ?? "plan",
    locationFloor: row.location_floor ?? "",
    quantity: Number(row.quantity),
    unit: row.unit,
    sourceDrawingId: row.source_drawing_id ?? "",
    confidence: row.confidence ?? "manual",
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function takeoffToDB(input: CreateTakeoffItemInput) {
  return {
    project_id: input.projectId,
    item_code: input.itemCode,
    element_name: input.elementName,
    category: input.category,
    drawing_view_type: input.drawingViewType ?? "plan",
    location_floor: input.locationFloor ?? "",
    quantity: input.quantity,
    unit: input.unit,
    source_drawing_id: input.sourceDrawingId || null,
    confidence: input.confidence ?? "manual",
    notes: input.notes ?? null,
  };
}

export function takeoffUpdateToDB(data: Partial<QuantityTakeoffItem>) {
  const out: Record<string, unknown> = {};
  if (data.itemCode !== undefined)        out.item_code = data.itemCode;
  if (data.elementName !== undefined)     out.element_name = data.elementName;
  if (data.category !== undefined)        out.category = data.category;
  if (data.drawingViewType !== undefined) out.drawing_view_type = data.drawingViewType;
  if (data.locationFloor !== undefined)   out.location_floor = data.locationFloor;
  if (data.quantity !== undefined)        out.quantity = data.quantity;
  if (data.unit !== undefined)            out.unit = data.unit;
  if (data.sourceDrawingId !== undefined) out.source_drawing_id = data.sourceDrawingId || null;
  if (data.confidence !== undefined)      out.confidence = data.confidence;
  if (data.notes !== undefined)           out.notes = data.notes;
  return out;
}

// ---------------------------------------------------------------------------
// Layer mappings
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function layerMappingFromDB(row: any): CadLayerMapping {
  return {
    id: row.id,
    projectId: row.project_id,
    layerName: row.layer_name,
    category: row.category,
    measurementMode: row.measurement_mode ?? "auto",
    unit: row.unit,
    enabled: row.enabled ?? true,
    notes: row.notes ?? undefined,
    entityCount: row.entity_count ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function layerMappingToDB(input: CreateLayerMappingInput) {
  return {
    project_id: input.projectId,
    layer_name: input.layerName,
    category: input.category,
    measurement_mode: input.measurementMode ?? "auto",
    unit: input.unit,
    enabled: input.enabled ?? true,
    notes: input.notes ?? null,
    entity_count: input.entityCount ?? null,
  };
}

export function layerMappingUpdateToDB(data: Partial<CadLayerMapping>) {
  const out: Record<string, unknown> = {};
  if (data.layerName !== undefined)        out.layer_name = data.layerName;
  if (data.category !== undefined)         out.category = data.category;
  if (data.measurementMode !== undefined)  out.measurement_mode = data.measurementMode;
  if (data.unit !== undefined)             out.unit = data.unit;
  if (data.enabled !== undefined)          out.enabled = data.enabled;
  if (data.notes !== undefined)            out.notes = data.notes;
  if (data.entityCount !== undefined)      out.entity_count = data.entityCount;
  return out;
}

// ---------------------------------------------------------------------------
// Manual quantities
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function manualQuantityFromDB(row: any): ManualQuantityItem {
  return {
    id: row.id,
    projectId: row.project_id,
    itemCode: row.item_code ?? undefined,
    elementName: row.element_name,
    category: row.category,
    locationFloor: row.location_floor ?? undefined,
    quantity: Number(row.quantity),
    unit: row.unit,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function manualQuantityToDB(input: CreateManualQuantityInput) {
  return {
    project_id: input.projectId,
    item_code: input.itemCode ?? null,
    element_name: input.elementName,
    category: input.category,
    location_floor: input.locationFloor ?? null,
    quantity: input.quantity,
    unit: input.unit,
    notes: input.notes ?? null,
  };
}

export function manualQuantityUpdateToDB(data: Partial<ManualQuantityItem>) {
  const out: Record<string, unknown> = {};
  if (data.itemCode !== undefined)       out.item_code = data.itemCode;
  if (data.elementName !== undefined)    out.element_name = data.elementName;
  if (data.category !== undefined)       out.category = data.category;
  if (data.locationFloor !== undefined)  out.location_floor = data.locationFloor;
  if (data.quantity !== undefined)       out.quantity = data.quantity;
  if (data.unit !== undefined)           out.unit = data.unit;
  if (data.notes !== undefined)          out.notes = data.notes;
  return out;
}

// ---------------------------------------------------------------------------
// Company profile
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function companyFromDB(row: any): CompanyProfile {
  return {
    id: row.id,
    companyName: row.company_name,
    logoDataUrl: row.logo_data_url ?? undefined,
    address: row.address ?? undefined,
    phone: row.phone ?? undefined,
    email: row.email ?? undefined,
    website: row.website ?? undefined,
    trn: row.trn ?? undefined,
    preparedBy: row.prepared_by ?? undefined,
    checkedBy: row.checked_by ?? undefined,
    defaultNotes: row.default_notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function companyToDB(input: CreateCompanyProfileInput) {
  return {
    company_name: input.companyName,
    logo_data_url: input.logoDataUrl ?? null,
    address: input.address ?? null,
    phone: input.phone ?? null,
    email: input.email ?? null,
    website: input.website ?? null,
    trn: input.trn ?? null,
    prepared_by: input.preparedBy ?? null,
    checked_by: input.checkedBy ?? null,
    default_notes: input.defaultNotes ?? null,
  };
}

export function companyUpdateToDB(data: Partial<CompanyProfile>) {
  const out: Record<string, unknown> = {};
  if (data.companyName !== undefined)   out.company_name = data.companyName;
  if (data.logoDataUrl !== undefined)   out.logo_data_url = data.logoDataUrl;
  if (data.address !== undefined)       out.address = data.address;
  if (data.phone !== undefined)         out.phone = data.phone;
  if (data.email !== undefined)         out.email = data.email;
  if (data.website !== undefined)       out.website = data.website;
  if (data.trn !== undefined)           out.trn = data.trn;
  if (data.preparedBy !== undefined)    out.prepared_by = data.preparedBy;
  if (data.checkedBy !== undefined)     out.checked_by = data.checkedBy;
  if (data.defaultNotes !== undefined)  out.default_notes = data.defaultNotes;
  return out;
}
