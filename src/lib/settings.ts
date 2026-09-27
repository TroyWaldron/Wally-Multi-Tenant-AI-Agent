// Integration settings. Lookup order: tenant setting -> platform setting ->
// environment variable, so a value typed into Settings overrides Vercel's
// env vars (the same rule as the Sunsational ops hub). Secrets never leave
// the server: the console only learns whether they are set.
import { systemStore } from "@/lib/session";

export type SettingDef = {
  key: string;
  label: string;
  scope: "tenant" | "platform";
  section: "n8n" | "knowledge" | "ai" | "whatsapp";
  secret: boolean;
  help: string;
  placeholder?: string;
};

export const SETTING_DEFS: SettingDef[] = [
  {
    key: "N8N_WEBHOOK_URL",
    label: "n8n webhook URL",
    scope: "tenant",
    section: "n8n",
    secret: false,
    help: "Production URL of this business's Webhook node. Wally sends every event here, and calls it for agent workflows (check availability, draft invoice...).",
    placeholder: "https://n8n.example.com/webhook/wally-events",
  },
  {
    key: "N8N_SECRET",
    label: "Shared secret",
    scope: "tenant",
    section: "n8n",
    secret: true,
    help: "Sent as the X-Wally-Secret header on every call to n8n, and required on every call n8n makes back to Wally for this business.",
  },
  {
    key: "KNOWLEDGE_SYNC_URL",
    label: "Website knowledge feed",
    scope: "tenant",
    section: "knowledge",
    secret: false,
    help: "A URL on the business's own site that returns its FAQ and descriptions as JSON. Wally re-imports it daily (and from Knowledge > Sync now), so agents never work from an old copy.",
    placeholder: "https://www.example.com/api/public/knowledge",
  },
  {
    key: "ANTHROPIC_API_KEY",
    label: "Anthropic API key",
    scope: "platform",
    section: "ai",
    secret: true,
    help: "Powers agents on Claude models. With neither this nor a DeepSeek key, agents answer in demo mode from the knowledge base only.",
    placeholder: "sk-ant-...",
  },
  {
    key: "DEEPSEEK_API_KEY",
    label: "DeepSeek API key",
    scope: "platform",
    section: "ai",
    secret: true,
    help: "Low-cost model. Agents set to DeepSeek use it, and any agent uses it when no Anthropic key is set.",
  },
  {
    key: "OPENAI_API_KEY",
    label: "OpenAI API key",
    scope: "platform",
    section: "ai",
    secret: true,
    help: "Fallback model option in the router and speech-to-text for voice notes (wired in phase 1-2).",
  },
  {
    key: "WHATSAPP_VERIFY_TOKEN",
    label: "WhatsApp verify token",
    scope: "platform",
    section: "whatsapp",
    secret: true,
    help: "Any string you choose; paste the same value into Meta's webhook setup for /api/webhooks/whatsapp.",
  },
  {
    key: "WHATSAPP_APP_SECRET",
    label: "Meta app secret",
    scope: "platform",
    section: "whatsapp",
    secret: true,
    help: "Used to verify Meta's X-Hub-Signature-256 on incoming WhatsApp webhooks.",
  },
];

export async function getConfig(tenantId: string | null, key: string): Promise<string | undefined> {
  const store = systemStore();
  if (tenantId) {
    const t = (await store.getSettings(tenantId)).find((s) => s.key === key);
    if (t?.value) return t.value;
  }
  const p = (await store.getSettings(null)).find((s) => s.key === key);
  if (p?.value) return p.value;
  return process.env[key] || undefined;
}

export type SettingStatus = SettingDef & { configured: boolean; source: "tenant" | "platform" | "environment" | "none"; value?: string };

export async function settingsStatus(tenantId: string): Promise<SettingStatus[]> {
  const store = systemStore();
  const [tenantRows, platformRows] = await Promise.all([store.getSettings(tenantId), store.getSettings(null)]);
  return SETTING_DEFS.map((d) => {
    const t = d.scope === "tenant" ? tenantRows.find((r) => r.key === d.key) : undefined;
    const p = platformRows.find((r) => r.key === d.key);
    const env = process.env[d.key];
    const hit = t?.value ? { source: "tenant" as const, v: t.value } : p?.value ? { source: "platform" as const, v: p.value } : env ? { source: "environment" as const, v: env } : null;
    return { ...d, configured: Boolean(hit), source: hit?.source ?? "none", value: hit && !d.secret ? hit.v : undefined };
  });
}
