/**
 * AI Visual Detection API Route — Phase 6C
 *
 * POST /api/ai-visual-detection
 * Body: AiVisualReviewInput
 * Returns: AiVisualDetectionResult
 *
 * Server-side only:
 * - OPENAI_API_KEY is read only on server.
 * - Never returns secrets.
 * - Only rendered images + safe metadata are sent to provider.
 */

import { NextRequest, NextResponse } from "next/server";
import type { AiVisualReviewInput } from "@/types/drawing-intelligence";
import { runAiVisualDetection } from "@/services/drawing-intelligence/ai-visual-detection.service";

export async function POST(req: NextRequest): Promise<NextResponse> {
  let input: AiVisualReviewInput;
  try {
    input = (await req.json()) as AiVisualReviewInput;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!input?.projectId || !Array.isArray(input?.evidence)) {
    return NextResponse.json(
      { error: "projectId and evidence are required" },
      { status: 400 }
    );
  }

  try {
    const result = await runAiVisualDetection(input);
    return NextResponse.json(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Visual detection route failed";
    return NextResponse.json(
      { error: `Visual detection failed: ${message}` },
      { status: 500 }
    );
  }
}

