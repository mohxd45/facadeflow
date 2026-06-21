/**
 * Phase 5E QA fixture — AI Review final hardening checks.
 *
 * Run:
 *   npx tsx scripts/qa-fixtures/run-phase5e-qa.ts
 */

import { NextRequest } from "next/server";
import { POST as aiReviewPost } from "../../src/app/api/ai-review/route";
import { runAiReviewViaGateway } from "../../src/services/ai-review/ai-review-gateway.service";
import {
  aiCannotMarkVerified,
  aiCannotMutateQuantityFields,
} from "../../src/services/ai-review/ai-review-action.service";
import type { AiReviewRunInput } from "../../src/types/ai-review";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface Row {
  scenario: string;
  expected: string;
  actual: string;
  status: "PASS" | "FAIL";
}

const rows: Row[] = [];

function check(scenario: string, expected: string, actual: string, pass: boolean) {
  rows.push({ scenario, expected, actual, status: pass ? "PASS" : "FAIL" });
}

const baseInput: AiReviewRunInput = {
  projectId: "proj-5e",
  packageAnalysisResult: {
    hasElevation: false,
    hasPlan: false,
    hasSchedule: false,
    hasSection: false,
  },
};

function makeRequest(input: AiReviewRunInput): NextRequest {
  return new NextRequest("http://localhost/api/ai-review", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

async function parseJsonResponse(resp: Response): Promise<Record<string, unknown>> {
  return (await resp.json()) as Record<string, unknown>;
}

async function withEnvAndFetch<T>(
  env: Partial<Record<string, string>>,
  mockedFetch: typeof global.fetch | null,
  fn: () => Promise<T>
): Promise<T> {
  const original = {
    AI_REVIEW_PROVIDER: process.env.AI_REVIEW_PROVIDER,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    AI_REVIEW_MODEL: process.env.AI_REVIEW_MODEL,
    AI_REVIEW_TIMEOUT_MS: process.env.AI_REVIEW_TIMEOUT_MS,
    AI_REVIEW_MAX_INPUT_CHARS: process.env.AI_REVIEW_MAX_INPUT_CHARS,
  };
  const originalFetch = global.fetch;

  process.env.AI_REVIEW_PROVIDER = env.AI_REVIEW_PROVIDER;
  process.env.OPENAI_API_KEY = env.OPENAI_API_KEY;
  process.env.AI_REVIEW_MODEL = env.AI_REVIEW_MODEL;
  process.env.AI_REVIEW_TIMEOUT_MS = env.AI_REVIEW_TIMEOUT_MS;
  process.env.AI_REVIEW_MAX_INPUT_CHARS = env.AI_REVIEW_MAX_INPUT_CHARS;

  if (mockedFetch) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    global.fetch = mockedFetch as any;
  }

  try {
    return await fn();
  } finally {
    process.env.AI_REVIEW_PROVIDER = original.AI_REVIEW_PROVIDER;
    process.env.OPENAI_API_KEY = original.OPENAI_API_KEY;
    process.env.AI_REVIEW_MODEL = original.AI_REVIEW_MODEL;
    process.env.AI_REVIEW_TIMEOUT_MS = original.AI_REVIEW_TIMEOUT_MS;
    process.env.AI_REVIEW_MAX_INPUT_CHARS = original.AI_REVIEW_MAX_INPUT_CHARS;
    global.fetch = originalFetch;
  }
}

async function run() {
  // 5E-01: provider disabled / missing key -> mock fallback path (safe)
  await withEnvAndFetch(
    { AI_REVIEW_PROVIDER: "openai", OPENAI_API_KEY: "", AI_REVIEW_MODEL: "gpt-5-mini" },
    null,
    async () => {
      const resp = await aiReviewPost(makeRequest(baseInput));
      const body = await parseJsonResponse(resp as unknown as Response);
      const runtimeMeta = body.runtimeMeta as Record<string, unknown> | undefined;
      const warnings = (body.warnings ?? []) as unknown[];
      check(
        "5E-01: openai provider without key falls back to mock",
        "runtimeMeta.source=mock",
        String(runtimeMeta?.source),
        runtimeMeta?.source === "mock"
      );
      check(
        "5E-01b: missing-key warning is included",
        "contains OPENAI_API_KEY is missing",
        JSON.stringify(warnings),
        warnings.some((w) => typeof w === "string" && w.includes("OPENAI_API_KEY is missing"))
      );
    }
  );

  // 5E-02: malformed OpenAI response JSON -> mock_fallback
  await withEnvAndFetch(
    { AI_REVIEW_PROVIDER: "openai", OPENAI_API_KEY: "sk-test", AI_REVIEW_MODEL: "gpt-5-mini" },
    (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "not-json" } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )) as typeof global.fetch,
    async () => {
      const resp = await aiReviewPost(makeRequest(baseInput));
      const body = await parseJsonResponse(resp as unknown as Response);
      const runtimeMeta = body.runtimeMeta as Record<string, unknown> | undefined;
      check(
        "5E-02: non-JSON LLM payload falls back",
        "runtimeMeta.source=mock_fallback",
        String(runtimeMeta?.source),
        runtimeMeta?.source === "mock_fallback"
      );
    }
  );

  // 5E-03: empty content -> mock_fallback
  await withEnvAndFetch(
    { AI_REVIEW_PROVIDER: "openai", OPENAI_API_KEY: "sk-test", AI_REVIEW_MODEL: "gpt-5-mini" },
    (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "" } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )) as typeof global.fetch,
    async () => {
      const resp = await aiReviewPost(makeRequest(baseInput));
      const body = await parseJsonResponse(resp as unknown as Response);
      const runtimeMeta = body.runtimeMeta as Record<string, unknown> | undefined;
      check(
        "5E-03: empty LLM content falls back",
        "runtimeMeta.source=mock_fallback",
        String(runtimeMeta?.source),
        runtimeMeta?.source === "mock_fallback"
      );
    }
  );

  // 5E-04: malformed finding enums -> strict-validate -> mock_fallback
  await withEnvAndFetch(
    { AI_REVIEW_PROVIDER: "openai", OPENAI_API_KEY: "sk-test", AI_REVIEW_MODEL: "gpt-5-mini" },
    (async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: "test",
                  findings: [
                    {
                      findingType: "missing_information",
                      riskLevel: "weird",
                      suggestedAction: "invalid_action",
                      confidence: "high",
                      title: "x",
                      message: "x",
                      recommendation: "x",
                    },
                  ],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )) as typeof global.fetch,
    async () => {
      const resp = await aiReviewPost(makeRequest(baseInput));
      const body = await parseJsonResponse(resp as unknown as Response);
      const runtimeMeta = body.runtimeMeta as Record<string, unknown> | undefined;
      check(
        "5E-04: malformed finding enums fall back",
        "runtimeMeta.source=mock_fallback",
        String(runtimeMeta?.source),
        runtimeMeta?.source === "mock_fallback"
      );
    }
  );

  // 5E-05: wrong candidate ID gets sanitized to undefined (no crash)
  await withEnvAndFetch(
    { AI_REVIEW_PROVIDER: "openai", OPENAI_API_KEY: "sk-test", AI_REVIEW_MODEL: "gpt-5-mini" },
    (async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: "candidate mismatch test",
                  findings: [
                    {
                      candidateId: "candidate-not-in-input",
                      findingType: "missing_information",
                      riskLevel: "high",
                      suggestedAction: "send_to_missing_info",
                      confidence: "high",
                      title: "Needs schedule",
                      message: "No schedule found",
                      recommendation: "Upload schedule",
                      sourceDrawingNames: [],
                      sourcePages: [],
                      linkedEvidenceIds: [],
                    },
                  ],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )) as typeof global.fetch,
    async () => {
      const resp = await aiReviewPost(makeRequest(baseInput));
      const body = await parseJsonResponse(resp as unknown as Response);
      const runtimeMeta = body.runtimeMeta as Record<string, unknown> | undefined;
      const findings = (body.findings ?? []) as Array<Record<string, unknown>>;
      check(
        "5E-05: candidate mismatch still returns openai result",
        "runtimeMeta.source=openai",
        String(runtimeMeta?.source),
        runtimeMeta?.source === "openai"
      );
      check(
        "5E-05b: mismatched candidateId sanitized to undefined",
        "finding.candidateId is undefined",
        findings.length > 0 ? String(findings[0].candidateId) : "no finding",
        findings.length > 0 && typeof findings[0].candidateId === "undefined"
      );
    }
  );

  // 5E-06: OpenAI failure/timeout path -> mock_fallback
  await withEnvAndFetch(
    { AI_REVIEW_PROVIDER: "openai", OPENAI_API_KEY: "sk-test", AI_REVIEW_MODEL: "gpt-5-mini" },
    (async () => {
      throw new Error("simulated timeout");
    }) as typeof global.fetch,
    async () => {
      const resp = await aiReviewPost(makeRequest(baseInput));
      const body = await parseJsonResponse(resp as unknown as Response);
      const runtimeMeta = body.runtimeMeta as Record<string, unknown> | undefined;
      check(
        "5E-06: OpenAI fetch error falls back",
        "runtimeMeta.source=mock_fallback",
        String(runtimeMeta?.source),
        runtimeMeta?.source === "mock_fallback"
      );
    }
  );

  // 5E-07: gateway hardening — malformed API payload falls back
  {
    const originalFetch = global.fetch;
    try {
      global.fetch = (async () =>
        new Response(
          JSON.stringify({
            id: "x",
            projectId: "proj-5e",
            summary: "bad payload",
            status: "completed",
            findings: [
              {
                id: "f1",
                projectId: "proj-5e",
                findingType: "missing_information",
                riskLevel: "high",
                suggestedAction: "invalid_action",
                confidence: "high",
                title: "t",
                message: "m",
                recommendation: "r",
                linkedEvidenceIds: [],
                sourceDrawingNames: [],
                sourcePages: [],
                createdAt: new Date().toISOString(),
              },
            ],
            warnings: [],
            runtimeMeta: {
              source: "openai",
              modelUsed: "gpt-5-mini",
              fallbackUsed: false,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )) as typeof global.fetch;

      const gw = await runAiReviewViaGateway(baseInput);
      check(
        "5E-07: gateway rejects malformed finding action and falls back",
        "source=mock_fallback",
        gw.source,
        gw.source === "mock_fallback"
      );
    } finally {
      global.fetch = originalFetch;
    }
  }

  // 5E-08: duplicate-run guard exists in UI logic
  {
    const src = readFileSync(
      resolve("src/components/projects/DrawingPackageReviewTab.tsx"),
      "utf-8"
    );
    check(
      "5E-08: duplicate-run guard present",
      "contains 'if (isRunningAiReview)'",
      src.includes("if (isRunningAiReview)") ? "present" : "missing",
      src.includes("if (isRunningAiReview)")
    );
    check(
      "5E-08b: AI Review is user-triggered (no auto-run on mount)",
      "no useEffect calling handleRunAiReview",
      src.includes("handleRunAiReview()") ? "found auto-call" : "no auto-call",
      !src.includes("handleRunAiReview()")
    );
  }

  // 5E-09: mutation safety helpers still true (Phase 5D unchanged)
  check(
    "5E-09: AI cannot mark verified/final helper",
    "true",
    String(aiCannotMarkVerified()),
    aiCannotMarkVerified() === true
  );
  check(
    "5E-09b: AI cannot mutate quantity fields helper",
    "true",
    String(aiCannotMutateQuantityFields()),
    aiCannotMutateQuantityFields() === true
  );

  const pass = rows.filter((r) => r.status === "PASS").length;
  const fail = rows.length - pass;

  const pad = (s: string, n: number) =>
    s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);

  console.log("\n" + pad("Scenario", 52) + pad("Status", 8) + pad("Expected", 34) + "Actual");
  console.log("-".repeat(120));
  for (const row of rows) {
    const icon = row.status === "PASS" ? "✓" : "✗";
    console.log(
      pad(row.scenario, 52) +
        pad(`${icon} ${row.status}`, 8) +
        pad(row.expected, 34) +
        row.actual
    );
  }
  console.log(`\nPhase 5E QA: ${pass} passed, ${fail} failed out of ${rows.length} checks.\n`);

  if (fail > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Phase 5E QA fixture crashed:", err);
  process.exit(1);
});

