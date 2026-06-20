"use client";

import { useEffect, useRef } from "react";
import { seedDemoData } from "@/lib/seed-data";
import { useProjectStore } from "@/stores/project-store";
import { useDrawingStore } from "@/stores/drawing-store";
import { useTakeoffStore } from "@/stores/takeoff-store";
import { useLayerMappingStore } from "@/stores/layer-mapping-store";
import { useManualQuantityStore } from "@/stores/manual-quantity-store";
import { useCompanyStore } from "@/stores/company-store";
import { useScaleCalibrationStore } from "@/stores/scale-calibration-store";
import { useCodeRuleStore } from "@/stores/code-rule-store";
import { useCodeTakeoffStore } from "@/stores/code-takeoff-store";
import { useDrawingTakeoffStore } from "@/stores/drawing-takeoff-store";
import { useDrawingIssueStore } from "@/stores/drawing-issue-store";
import { useOcrResultStore } from "@/stores/ocr-result-store";

export default function StoreHydrator({
  children,
}: {
  children: React.ReactNode;
}) {
  const hasHydratedRef = useRef(false);
  const projectsHydrated = useProjectStore((s) => s.isHydrated);

  useEffect(() => {
    if (hasHydratedRef.current) return;
    hasHydratedRef.current = true;

    async function init() {
      await seedDemoData();
      useScaleCalibrationStore.getState().hydrate();
      await Promise.all([
        useProjectStore.getState().hydrate(),
        useDrawingStore.getState().hydrate(),
        useTakeoffStore.getState().hydrate(),
        useLayerMappingStore.getState().hydrate(),
        useManualQuantityStore.getState().hydrate(),
        useCompanyStore.getState().hydrate(),
        useCodeRuleStore.getState().hydrate(),
        useCodeTakeoffStore.getState().hydrate(),
        useDrawingTakeoffStore.getState().hydrate(),
        useDrawingIssueStore.getState().hydrate(),
        useOcrResultStore.getState().hydrate(),
      ]);
    }
    init();
  }, []);

  if (!projectsHydrated) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="text-sm text-[var(--muted)]">Loading…</p>
      </div>
    );
  }

  return <>{children}</>;
}
