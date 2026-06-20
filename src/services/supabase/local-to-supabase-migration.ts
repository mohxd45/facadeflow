/**
 * Local → Supabase migration helper (dev-only)
 *
 * Reads all data from localStorage, then inserts it into Supabase tables.
 * This is a one-way, non-destructive copy — local data is NOT deleted.
 *
 * Safe to run multiple times: UUIDs are preserved so duplicate inserts
 * will fail with a uniqueness error, which is caught and reported per-record.
 */

import { getSupabaseClient } from "./client";
import { readJson } from "@/lib/storage";
import { STORAGE_KEYS } from "@/lib/constants";
import type { Project } from "@/types/project";
import type { DrawingFile } from "@/types/drawing";
import type { QuantityTakeoffItem } from "@/types/takeoff";
import type { CadLayerMapping } from "@/types/cad";
import type { ManualQuantityItem } from "@/types/validation";
import type { CompanyProfile } from "@/types/company";
import {
  projectToDB,
  drawingToDB,
  takeoffToDB,
  layerMappingToDB,
  manualQuantityToDB,
  companyToDB,
} from "@/services/repositories/supabase/supabase-mappers";

export interface MigrationEntityResult {
  entity: string;
  total: number;
  migrated: number;
  skipped: number;
  errors: string[];
}

export interface MigrationResult {
  results: MigrationEntityResult[];
  completedAt: string;
}

async function migrateTable<T extends { id: string }>(
  entity: string,
  table: string,
  records: T[],
  toDBFn: (record: T) => Record<string, unknown>
): Promise<MigrationEntityResult> {
  const sb = getSupabaseClient();
  let migrated = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const record of records) {
    try {
      const row = { id: record.id, ...toDBFn(record) };
      const { error } = await sb.from(table).upsert(row, { onConflict: "id", ignoreDuplicates: false });
      if (error) {
        if (error.code === "23505") {
          // Unique violation = already exists
          skipped++;
        } else {
          errors.push(`${record.id}: ${error.message}`);
        }
      } else {
        migrated++;
      }
    } catch (err) {
      errors.push(`${record.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { entity, total: records.length, migrated, skipped, errors };
}

export async function migrateLocalDataToSupabase(): Promise<MigrationResult> {
  const projects = readJson<Project[]>(STORAGE_KEYS.projects, []);
  const drawings = readJson<DrawingFile[]>(STORAGE_KEYS.drawings, []);
  const takeoffItems = readJson<QuantityTakeoffItem[]>(STORAGE_KEYS.takeoffItems, []);
  const layerMappings = readJson<CadLayerMapping[]>(STORAGE_KEYS.layerMappings, []);
  const manualQty = readJson<ManualQuantityItem[]>(STORAGE_KEYS.manualQuantities, []);
  const company = readJson<CompanyProfile | null>(STORAGE_KEYS.companyProfile, null);

  const results: MigrationEntityResult[] = [];

  results.push(
    await migrateTable("Projects", "projects", projects, (p) => projectToDB(p))
  );
  results.push(
    await migrateTable("Drawings", "drawings", drawings, (d) => drawingToDB(d))
  );
  results.push(
    await migrateTable("Takeoff items", "quantity_takeoff_items", takeoffItems, (i) => takeoffToDB(i))
  );
  results.push(
    await migrateTable("Layer mappings", "layer_mappings", layerMappings, (m) => layerMappingToDB(m))
  );
  results.push(
    await migrateTable("Manual quantities", "manual_quantities", manualQty, (q) => manualQuantityToDB(q))
  );

  // Company profile is a single record
  if (company) {
    results.push(
      await migrateTable("Company profile", "company_profiles", [company], (c) => companyToDB(c))
    );
  } else {
    results.push({ entity: "Company profile", total: 0, migrated: 0, skipped: 0, errors: [] });
  }

  return { results, completedAt: new Date().toISOString() };
}
