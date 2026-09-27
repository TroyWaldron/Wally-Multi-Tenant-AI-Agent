// LLM router catalog. Anthropic and DeepSeek models run today; OpenAI is
// listed so agents can be configured for it, and is skipped by the router
// until its adapter lands.
export type ModelInfo = {
  id: string;
  label: string;
  provider: "anthropic" | "deepseek" | "openai";
  inputPerM: number; // USD per million tokens
  outputPerM: number;
  supportsEffort: boolean;
  note: string;
};

export const MODELS: ModelInfo[] = [
  { id: "claude-opus-5", label: "Claude Opus 5", provider: "anthropic", inputPerM: 5, outputPerM: 25, supportsEffort: true, note: "Best reasoning; default" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", provider: "anthropic", inputPerM: 2, outputPerM: 10, supportsEffort: true, note: "Balanced cost and quality" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", provider: "anthropic", inputPerM: 1, outputPerM: 5, supportsEffort: false, note: "Fastest, lowest cost" },
  { id: "deepseek-chat", label: "DeepSeek", provider: "deepseek", inputPerM: 0.3, outputPerM: 1.2, supportsEffort: false, note: "Lowest cost; no effort control" },
  { id: "gpt-fallback", label: "OpenAI GPT", provider: "openai", inputPerM: 2.5, outputPerM: 10, supportsEffort: false, note: "Fallback option (phase 1)" },
];

export function getModel(id: string | null | undefined) {
  return MODELS.find((m) => m.id === id);
}

export function costUsd(modelId: string, input: number, output: number) {
  const m = getModel(modelId);
  if (!m) return 0;
  return (input * m.inputPerM + output * m.outputPerM) / 1_000_000;
}
