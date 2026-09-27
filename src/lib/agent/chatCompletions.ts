// Adapter for providers that speak OpenAI's chat completions API (OpenAI
// itself and DeepSeek): the same tool loop as Claude.
import type { BetaMessageParam, BetaTool } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { executeTool, type ToolContext, type ToolEvent } from "@/lib/agent/runtime";

type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

type Completion = {
  model: string;
  choices: { message: { content: string | null; tool_calls?: ToolCall[] }; finish_reason: string }[];
  usage?: { prompt_tokens: number; completion_tokens: number };
};

export const PROVIDERS = {
  deepseek: { name: "DeepSeek", baseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com", maxTokensField: "max_tokens" },
  // OpenAI's newer models only accept max_completion_tokens.
  openai: { name: "OpenAI", baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1", maxTokensField: "max_completion_tokens" },
} as const;

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

export async function runChatCompletions(args: {
  provider: keyof typeof PROVIDERS;
  apiKey: string;
  model: string;
  system: string;
  tools: BetaTool[];
  history: BetaMessageParam[];
  ctx: ToolContext;
  toolEvents: ToolEvent[];
}) {
  const { ctx, toolEvents } = args;
  const messages: ChatMessage[] = [
    { role: "system", content: args.system },
    ...args.history.map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content : "" }) as ChatMessage),
  ];
  const tools = args.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } }));
  const out = { reply: "", model: null as string | null, inputTokens: 0, outputTokens: 0 };
  const p = PROVIDERS[args.provider];

  for (let turn = 0; turn < 6; turn++) {
    const res = await fetch(`${p.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${args.apiKey}` },
      body: JSON.stringify({ model: args.model, messages, tools, [p.maxTokensField]: 4096 }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`${p.name} HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as Completion;
    const choice = data.choices?.[0];
    if (!choice) throw new Error(`${p.name} returned no choices.`);
    out.model = data.model ?? args.model;
    out.inputTokens += data.usage?.prompt_tokens ?? 0;
    out.outputTokens += data.usage?.completion_tokens ?? 0;

    const calls = choice.message.tool_calls ?? [];
    messages.push({ role: "assistant", content: choice.message.content ?? "", ...(calls.length ? { tool_calls: calls } : {}) });
    if (!calls.length) {
      out.reply = (choice.message.content ?? "").trim();
      return out;
    }
    for (const call of calls) {
      const ev = await executeTool({ name: call.function.name, input: parseArgs(call.function.arguments) }, ctx);
      toolEvents.push(ev);
      messages.push({ role: "tool", tool_call_id: call.id, content: ev.result });
    }
  }
  return out;
}
