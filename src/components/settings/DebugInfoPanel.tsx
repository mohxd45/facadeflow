"use client";

import { useState, useEffect } from "react";
import { env, storageModeStatus } from "@/lib/env";
import { useProjectStore } from "@/stores/project-store";
import { useDrawingStore } from "@/stores/drawing-store";
import { useTakeoffStore } from "@/stores/takeoff-store";
import { useLayerMappingStore } from "@/stores/layer-mapping-store";
import { useManualQuantityStore } from "@/stores/manual-quantity-store";
import { CheckCircle2, XCircle } from "lucide-react";

const APP_VERSION = "0.1.0";

function Row({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 border-b border-[var(--border)] last:border-0">
      <span className="text-sm text-[var(--muted)]">{label}</span>
      <span className={`text-sm font-medium ${mono ? "font-mono text-xs" : ""}`}>{value}</span>
    </div>
  );
}

function BoolRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 border-b border-[var(--border)] last:border-0">
      <span className="text-sm text-[var(--muted)]">{label}</span>
      <span className={`flex items-center gap-1.5 text-sm font-medium ${ok ? "text-emerald-600" : "text-red-600"}`}>
        {ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
        {ok ? "Available" : "Unavailable"}
      </span>
    </div>
  );
}

export default function DebugInfoPanel() {
  const projects = useProjectStore((s) => s.projects);
  const drawings = useDrawingStore((s) => s.drawings);
  const items = useTakeoffStore((s) => s.items);
  const mappings = useLayerMappingStore((s) => s.mappings);
  const manualQty = useManualQuantityStore((s) => s.items);

  const status = storageModeStatus();

  const [localStorageOk, setLocalStorageOk] = useState<boolean | null>(null);
  const [indexedDbOk, setIndexedDbOk] = useState<boolean | null>(null);
  const [localStorageUsed, setLocalStorageUsed] = useState<string | null>(null);

  useEffect(() => {
    // Test localStorage
    try {
      const key = "__ft_probe__";
      localStorage.setItem(key, "1");
      localStorage.removeItem(key);
      setLocalStorageOk(true);

      // Estimate usage
      let total = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i) ?? "";
        const v = localStorage.getItem(k) ?? "";
        total += k.length + v.length;
      }
      const kb = (total * 2) / 1024; // UTF-16 = 2 bytes per char
      setLocalStorageUsed(kb < 1024 ? `${kb.toFixed(1)} KB` : `${(kb / 1024).toFixed(2)} MB`);
    } catch {
      setLocalStorageOk(false);
    }

    // Test IndexedDB
    try {
      const req = indexedDB.open("__ft_probe__", 1);
      req.onsuccess = () => {
        req.result.close();
        indexedDB.deleteDatabase("__ft_probe__");
        setIndexedDbOk(true);
      };
      req.onerror = () => setIndexedDbOk(false);
    } catch {
      setIndexedDbOk(false);
    }
  }, []);

  return (
    <div className="rounded-lg border border-[var(--border)] bg-white shadow-sm px-5 py-1">
      <Row label="App version" value={APP_VERSION} />
      <Row label="Storage mode" value={
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${status.mode === "local" ? "bg-slate-100 text-slate-700" : "bg-blue-100 text-blue-700"}`}>
          {status.mode}
        </span>
      } />
      <Row label="NEXT_PUBLIC_SUPABASE_URL" value={env.supabaseUrl ? <span className="text-xs text-emerald-600 font-mono">{env.supabaseUrl.slice(0, 30)}…</span> : <span className="text-xs text-slate-400">Not set</span>} />
      <Row label="Projects" value={projects.length} />
      <Row label="Drawings" value={drawings.length} />
      <Row label="Takeoff items" value={items.length} />
      <Row label="Layer mappings" value={mappings.length} />
      <Row label="Manual quantities" value={manualQty.length} />
      {localStorageOk !== null && (
        <>
          <BoolRow label="localStorage" ok={localStorageOk} />
          {localStorageOk && localStorageUsed && (
            <Row label="localStorage used (est.)" value={localStorageUsed} />
          )}
        </>
      )}
      {indexedDbOk !== null && <BoolRow label="IndexedDB" ok={indexedDbOk} />}
      <Row label="User agent" value={
        <span className="truncate max-w-[200px] block text-right text-xs text-[var(--muted)]">
          {typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 40) + "…" : "—"}
        </span>
      } />
    </div>
  );
}
