/**
 * AI-first quantity extraction orchestration (MVP).
 *
 * Guarantees execution order:
 *  1) AI visual detection
 *  2) system extraction
 *  3) reconciliation/merge
 */

export interface AiFirstExtractPipelineResult<TAi, TSystem, TReconciled> {
  ai: TAi;
  system: TSystem;
  reconciled: TReconciled;
  executionOrder: Array<"ai_visual" | "system_extraction" | "reconciliation">;
}

export async function runAiFirstExtractPipeline<TAi, TSystem, TReconciled>(deps: {
  runAiVisual: () => Promise<TAi>;
  runSystemExtraction: () => Promise<TSystem>;
  reconcile: (input: { ai: TAi; system: TSystem }) => Promise<TReconciled> | TReconciled;
}): Promise<AiFirstExtractPipelineResult<TAi, TSystem, TReconciled>> {
  const executionOrder: Array<"ai_visual" | "system_extraction" | "reconciliation"> = [];

  executionOrder.push("ai_visual");
  const ai = await deps.runAiVisual();

  executionOrder.push("system_extraction");
  const system = await deps.runSystemExtraction();

  executionOrder.push("reconciliation");
  const reconciled = await deps.reconcile({ ai, system });

  return { ai, system, reconciled, executionOrder };
}

