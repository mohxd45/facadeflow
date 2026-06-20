/**
 * Supabase browser client — lazy singleton.
 *
 * Use `getSupabaseClient()` wherever you need the client.
 * It throws immediately if Supabase env vars are missing, giving
 * a clear error rather than a cryptic network failure.
 *
 * This module is never imported in local-mode code paths, so the
 * @supabase/supabase-js bundle is only loaded when actually needed.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env, isSupabaseConfigured } from "@/lib/env";

let _client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (_client) return _client;

  if (!isSupabaseConfigured()) {
    throw new Error(
      "Supabase is not configured. " +
        "Please add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY " +
        "to your .env.local file and restart the dev server."
    );
  }

  _client = createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: {
      // Facade Takeoff v1 does not implement user auth yet.
      // Anonymous sessions are sufficient for single-user local deployments.
      persistSession: true,
      autoRefreshToken: true,
    },
  });

  return _client;
}

/**
 * Returns the client or null when Supabase is not configured.
 * Use this in UI code that degrades gracefully.
 */
export function tryGetSupabaseClient(): SupabaseClient | null {
  try {
    return getSupabaseClient();
  } catch {
    return null;
  }
}
