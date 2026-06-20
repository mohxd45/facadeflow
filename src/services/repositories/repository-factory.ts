/**
 * Repository factory — Phase 10
 *
 * Returns the correct repository implementation based on NEXT_PUBLIC_STORAGE_MODE.
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │  NEXT_PUBLIC_STORAGE_MODE=local   (default)                 │
 * │  → All data stored in localStorage / IndexedDB             │
 * │  → No backend required                                      │
 * │                                                             │
 * │  NEXT_PUBLIC_STORAGE_MODE=supabase                          │
 * │  → Data stored in Supabase Postgres + Storage               │
 * │  → Requires env vars + tables from docs/supabase-schema.md │
 * └─────────────────────────────────────────────────────────────┘
 *
 * Stores continue to import from here rather than importing concrete
 * repositories directly, so the storage backend is swappable.
 */

import { isSupabaseMode } from "@/lib/env";

// Local implementations
import { LocalProjectRepository } from "./local/project.local";
import { LocalDrawingRepository } from "./local/drawing.local";
import { LocalTakeoffRepository } from "./local/takeoff.local";
import { LocalLayerMappingRepository } from "./local/local-layer-mapping.repository";
import { LocalManualQuantityRepository } from "./local/manual-quantity.local";
import { LocalCompanyRepository } from "./local/local-company.repository";

// Supabase stubs (filled in when tables are ready)
import { SupabaseProjectRepository } from "./supabase/supabase-project.repository";
import { SupabaseDrawingRepository } from "./supabase/supabase-drawing.repository";
import { SupabaseTakeoffRepository } from "./supabase/supabase-takeoff.repository";
import { SupabaseLayerMappingRepository } from "./supabase/supabase-layer-mapping.repository";
import { SupabaseManualQuantityRepository } from "./supabase/supabase-manual-quantity.repository";
import { SupabaseCompanyRepository } from "./supabase/supabase-company.repository";

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

export function getProjectRepository() {
  return isSupabaseMode()
    ? new SupabaseProjectRepository()
    : new LocalProjectRepository();
}

export function getDrawingRepository() {
  return isSupabaseMode()
    ? new SupabaseDrawingRepository()
    : new LocalDrawingRepository();
}

export function getTakeoffRepository() {
  return isSupabaseMode()
    ? new SupabaseTakeoffRepository()
    : new LocalTakeoffRepository();
}

export function getLayerMappingRepository() {
  return isSupabaseMode()
    ? new SupabaseLayerMappingRepository()
    : new LocalLayerMappingRepository();
}

export function getManualQuantityRepository() {
  return isSupabaseMode()
    ? new SupabaseManualQuantityRepository()
    : new LocalManualQuantityRepository();
}

/** TODO: wire company store to factory when Supabase mode is active */
export function getCompanyRepository() {
  return isSupabaseMode()
    ? new SupabaseCompanyRepository()
    : new LocalCompanyRepository();
}
