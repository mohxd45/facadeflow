/**
 * Supabase connection and table-readiness test.
 *
 * Runs lightweight queries against each expected table and returns
 * a structured result so the Settings page can display status clearly.
 */

import { tryGetSupabaseClient } from "./client";
import { isSupabaseConfigured } from "@/lib/env";

export interface TableTestResult {
  table: string;
  ok: boolean;
  error?: string;
}

export interface ConnectionTestResult {
  envConfigured: boolean;
  connected: boolean;
  tables: TableTestResult[];
  testedAt: string;
  error?: string;
}

const EXPECTED_TABLES = [
  "projects",
  "drawings",
  "quantity_takeoff_items",
  "layer_mappings",
  "manual_quantities",
  "company_profiles",
] as const;

export async function testSupabaseConnection(): Promise<ConnectionTestResult> {
  const testedAt = new Date().toISOString();

  if (!isSupabaseConfigured()) {
    return {
      envConfigured: false,
      connected: false,
      tables: [],
      testedAt,
      error: "NEXT_PUBLIC_SUPABASE_URL and/or NEXT_PUBLIC_SUPABASE_ANON_KEY are not set.",
    };
  }

  const client = tryGetSupabaseClient();
  if (!client) {
    return {
      envConfigured: true,
      connected: false,
      tables: [],
      testedAt,
      error: "Could not create Supabase client. Check your environment variables.",
    };
  }

  // Quick connectivity check — try fetching the projects table
  const { error: pingError } = await client
    .from("projects")
    .select("id")
    .limit(1);

  const connected = !pingError ||
    // "PGRST200" = relation does not exist — network reached but table missing
    pingError.code === "PGRST200" ||
    pingError.code === "42P01";

  if (!connected) {
    return {
      envConfigured: true,
      connected: false,
      tables: [],
      testedAt,
      error: `Network error: ${pingError?.message}`,
    };
  }

  // Test each table individually
  const tables: TableTestResult[] = await Promise.all(
    EXPECTED_TABLES.map(async (table) => {
      const { error } = await client.from(table).select("id").limit(1);
      if (!error) return { table, ok: true };

      // 42P01 = undefined table (Postgres) or PGRST200 = PostgREST relation not found
      const missing = error.code === "42P01" || error.code === "PGRST200";
      return {
        table,
        ok: false,
        error: missing
          ? "Table does not exist. Run SQL from docs/supabase-schema.md"
          : error.message,
      };
    })
  );

  return { envConfigured: true, connected, tables, testedAt };
}
