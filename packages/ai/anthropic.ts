// packages/ai/anthropic.ts
//
// Anthropic SDK client + model defaults for Virn's first-party Claude usage. Distinct
// from `index.ts` which configures the Vercel AI SDK's OpenAI adapter for the legacy
// streaming chat surface; new authoring/agent work routes through this module so we get
// native prompt-cache control + structured-output validation via @anthropic-ai/sdk.
//
// Model defaults follow the v1.5b PRD §8.4 anchor: claude-sonnet-4-6 by default for
// cost; switch to claude-opus-4-7 if dogfooding shows structured-output reliability
// gaps. Adaptive thinking is the right knob on Sonnet 4.6 (budget_tokens is deprecated).

import Anthropic from "@anthropic-ai/sdk";

/** Default model for Virn AI authoring + agent flows (v1.5b PRD §8.4). Override per-call
 * when a specific workflow benefits from Opus reasoning. */
export const VIRN_AI_MODEL = "claude-sonnet-4-6" as const;

/** Lazily-constructed singleton client. Avoids paying SDK init cost in test environments
 * that mock the import surface; reading ANTHROPIC_API_KEY at call time also means a
 * missing env doesn't crash module load. */
let _client: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
	if (_client) return _client;
	_client = new Anthropic();
	return _client;
}

/** Test-only escape hatch: inject a stub client for unit tests. Production code never
 * calls this. */
export function __setAnthropicClientForTest(stub: Anthropic | null): void {
	_client = stub;
}

export { Anthropic };
