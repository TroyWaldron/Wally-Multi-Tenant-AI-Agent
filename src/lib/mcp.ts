// Connectors: a small MCP client (streamable HTTP transport) so AI staff can
// use a business's own systems. Each connector is one MCP server URL. The
// agent sees its tools as "<connector>__<tool>", filtered by the connector's
// allow list, and the policy engine still decides before anything runs.
import type { BetaTool } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { getConfig } from "@/lib/settings";
import type { Store } from "@/lib/store/types";
import type { Agent, Connector } from "@/lib/types";

const PROTOCOL = "2025-06-18";
const TIMEOUT_MS = 15_000;

export type McpTool = { name: string; description?: string; inputSchema?: Record<string, unknown>; annotations?: { readOnlyHint?: boolean } };
export type ConnectorTool = { connector: Connector; tool: McpTool; approval: boolean; readOnly: boolean };

export const tokenKey = (connectorId: string) => `MCP_TOKEN_${connectorId}`;

async function authHeader(c: Connector): Promise<Record<string, string>> {
  if (c.auth === "none") return {};
  const token = c.auth === "relay_secret" ? await getConfig(c.tenantId, "WIDGET_RELAY_SECRET") : await getConfig(c.tenantId, tokenKey(c.id));
  if (!token) throw new Error(c.auth === "relay_secret" ? "The website relay secret isn't set in Settings." : "No token saved for this connector.");
  return { Authorization: `Bearer ${token}` };
}

/** One JSON-RPC exchange; the server may answer as JSON or as an SSE stream. */
async function rpc(c: Connector, headers: Record<string, string>, id: number | null, method: string, params: unknown) {
  const res = await fetch(c.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": PROTOCOL, ...headers },
    body: JSON.stringify(id === null ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id, method, params }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok && res.status !== 202) throw new Error(`${c.name} answered HTTP ${res.status}.`);
  if (id === null) return { res, msg: null };
  const type = res.headers.get("content-type") ?? "";
  let msg: { result?: Record<string, unknown>; error?: { message?: string } } | null = null;
  if (type.includes("text/event-stream")) {
    const text = await res.text();
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      try {
        const m = JSON.parse(line.slice(5).trim());
        if (m.id === id) msg = m;
      } catch {}
    }
  } else {
    msg = await res.json().catch(() => null);
  }
  if (!msg) throw new Error(`${c.name} sent no answer.`);
  if (msg.error) throw new Error(`${c.name}: ${msg.error.message ?? "error"}`);
  return { res, msg };
}

/** Opens a session, runs one request, and returns its result. */
async function session<T>(c: Connector, method: string, params: unknown): Promise<T> {
  const auth = await authHeader(c);
  const init = await rpc(c, auth, 1, "initialize", { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "wally", version: "1.0" } });
  const sid = init.res.headers.get("mcp-session-id");
  const headers = { ...auth, ...(sid ? { "Mcp-Session-Id": sid } : {}) };
  await rpc(c, headers, null, "notifications/initialized", {}).catch(() => {});
  const { msg } = await rpc(c, headers, 2, method, params);
  return (msg?.result ?? {}) as T;
}

// Tool lists change rarely; keep them for a few minutes per connector.
const cache = new Map<string, { at: number; tools: McpTool[] }>();

export async function listConnectorTools(c: Connector, fresh = false): Promise<McpTool[]> {
  const hit = cache.get(c.id);
  if (!fresh && hit && Date.now() - hit.at < 5 * 60_000) return hit.tools;
  const r = await session<{ tools?: McpTool[] }>(c, "tools/list", {});
  const tools = r.tools ?? [];
  cache.set(c.id, { at: Date.now(), tools });
  return tools;
}

export async function callConnectorTool(c: Connector, tool: string, args: Record<string, unknown>): Promise<string> {
  const r = await session<{ content?: { type: string; text?: string }[]; structuredContent?: unknown; isError?: boolean }>(c, "tools/call", { name: tool, arguments: args });
  const text = (r.content ?? [])
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text)
    .join("\n");
  const out = text || (r.structuredContent ? JSON.stringify(r.structuredContent) : "(no content)");
  if (r.isError) throw new Error(out.slice(0, 500));
  return out.slice(0, 20_000);
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 20) || "connector";

export const toolName = (c: Connector, tool: string) => `${slug(c.name)}__${tool}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);

/**
 * The connector tools one agent may use, keyed by the name the model sees.
 * A connector that can't be reached is skipped so the agent still answers.
 */
export async function connectorToolsFor(store: Store, tenantId: string, agent: Agent): Promise<Map<string, ConnectorTool>> {
  const out = new Map<string, ConnectorTool>();
  const connectors = (await store.listConnectors(tenantId)).filter((c) => c.enabled && c.agentIds.includes(agent.id));
  await Promise.all(
    connectors.map(async (c) => {
      try {
        const tools = await listConnectorTools(c);
        for (const t of tools) {
          if (c.allowedTools.length && !c.allowedTools.includes(t.name)) continue;
          out.set(toolName(c, t.name), { connector: c, tool: t, approval: c.approvalTools.includes(t.name), readOnly: Boolean(t.annotations?.readOnlyHint) });
        }
      } catch (err) {
        console.error(`connector ${c.name} unavailable:`, err instanceof Error ? err.message : err);
      }
    })
  );
  return out;
}

export function asModelTools(tools: Map<string, ConnectorTool>): BetaTool[] {
  return [...tools].map(([name, t]) => ({
    name,
    description: `[${t.connector.name}] ${t.tool.description ?? t.tool.name}${t.approval ? " (a person must approve this first)" : ""}`.slice(0, 1000),
    input_schema: { type: "object", ...(t.tool.inputSchema ?? {}) } as BetaTool["input_schema"],
  }));
}
