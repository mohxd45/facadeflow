/**
 * Centralised environment variable access.
 * All env reads go through this module so typos fail loudly.
 */

export type StorageMode = "local" | "supabase";

export const env = {
  storageMode: (process.env.NEXT_PUBLIC_STORAGE_MODE ?? "local") as StorageMode,
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
} as const;

/** True when the app is configured to use Supabase. */
export function isSupabaseMode(): boolean {
  return env.storageMode === "supabase";
}

/** True when both Supabase env variables are present. */
export function isSupabaseConfigured(): boolean {
  return Boolean(env.supabaseUrl && env.supabaseAnonKey);
}

/**
 * Returns a human-readable description of the current storage mode,
 * including any configuration warnings.
 */
export function storageModeStatus(): {
  mode: StorageMode;
  configured: boolean;
  warning?: string;
} {
  const mode = env.storageMode;
  if (mode === "local") {
    return { mode, configured: true };
  }
  const configured = isSupabaseConfigured();
  return {
    mode,
    configured,
    warning: configured
      ? undefined
      : "Supabase is not configured. Please add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to your environment.",
  };
}
