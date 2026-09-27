import type { RunSpec } from './index.ts';

// Internal design contracts only. No external SDK method is implied or called.
export interface ModelRequest {
  messages: ReadonlyArray<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  remainingInputTokens: number;
  remainingOutputTokens: number;
}

export interface ModelResult {
  text: string;
  modelId: string;
  providerRequestId: string;
  usage: { inputTokens: number; outputTokens: number };
  measuredCostUsd: number | null;
  costIsEstimate: boolean;
}

export interface ModelAdapter {
  complete(request: ModelRequest, signal: AbortSignal): Promise<ModelResult>;
}

export interface SandboxResult {
  operationId: string;
  checkpointId: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  cpuSeconds: number | null;
  measuredCostUsd: number | null;
}

export interface SandboxAdapter {
  // Candidate inputs and frozen checks are staged through separate capabilities.
  execute(input: { snapshotDigest: string; patchDigest: string | null; spec: RunSpec },
    signal: AbortSignal): Promise<SandboxResult>;
  cancel(operationId: string): Promise<void>;
}
