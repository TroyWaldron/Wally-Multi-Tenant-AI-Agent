// Integration settings. Lookup order: tenant setting -> platform setting ->
// environment variable, so a value typed into Settings overrides Vercel's
// env vars (the same rule as the Sunsational ops hub). Secrets never leave
// the server: the console only learns whether they are set.
import { systemStore } from "@/lib/session";

export type SettingDef = {
  key: string;
  label: string;
  scope: "tenant" | "platform";
  section: "n8n" | "knowledge" | "ai" | "whatsapp" | "slack" | "roi" | "calls" | "email";
  secret: boolean;
  help: string;
  placeholder?: string;
};

export const SETTING_DEFS: SettingDef[] = [
  {
    key: "SMTP_HOST",
    label: "Mail server (SMTP host)",
    scope: "tenant",
    section: "email",
    secret: false,
    help: "The business's outgoing mail server, e.g. smtp.gmail.com or smtp.office365.com.",
    placeholder: "smtp.example.com",
  },
  {
    key: "SMTP_PORT",
    label: "Port",
    scope: "tenant",
    section: "email",
    secret: false,
    help: "Usually 587 (or 465 for SSL).",
    placeholder: "587",
  },
  {
    key: "SMTP_USER",
    label: "Mailbox login",
    scope: "tenant",
    section: "email",
    secret: false,
    help: "The mailbox the AI staff send from, e.g. reservations@yourbusiness.com.",
  },
  {
    key: "SMTP_PASS",
    label: "Mailbox password",
    scope: "tenant",
    section: "email",
    secret: true,
    help: "For Gmail or Microsoft 365, an app password.",
  },
  {
    key: "EMAIL_FROM",
    label: "Send as",
    scope: "tenant",
    section: "email",
    secret: false,
    help: "Name and address people see, e.g. Sunsational Tobago <reservations@sunsationaltobago.com>. Blank uses the mailbox login.",
  },
  {
    key: "STAFF_EMAIL_DOMAINS",
    label: "Staff email domains",
    scope: "tenant",
    section: "email",
    secret: false,
    help: "Emails to these domains (comma separated) go out straight away. Everything else, like guests and suppliers, waits for a person's approval.",
    placeholder: "sunsationaltobago.com",
  },
  {
    key: "CALL_CONSENT_NOTICE",
    label: "What callers hear first",
    scope: "tenant",
    section: "calls",
    secret: false,
    help: "Said at the start of every call the AI answers. Leave blank for a notice that fits the business's country; where every party must agree to recording, the AI asks and hands over to a person if the caller says no.",
  },
  {
    key: "TRANSCRIPT_RETENTION_DAYS",
    label: "Keep call recordings and transcripts for (days)",
    scope: "tenant",
    section: "calls",
    secret: false,
    help: "After this, recordings and transcripts are deleted. Default 90.",
    placeholder: "90",
  },
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
    key: "WIDGET_RELAY_SECRET",
    label: "Website relay secret",
    scope: "tenant",
    section: "knowledge",
    secret: true,
    help: "Only needed when the business's own website relays guest chats to Wally from its server (like the Sunsational concierge). With it, each guest gets their own message limit instead of the whole site sharing one.",
  },
  {
    key: "BACKOFFICE_ALERT_URL",
    label: "Back office alert URL",
    scope: "tenant",
    section: "knowledge",
    secret: false,
    help: "Optional. When a guest needs a person, Wally also tells this address (signed with the Website relay secret), so the business's own back office can alert its staff, for example on their phones.",
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
    help: "Third model provider. Agents set to OpenAI GPT use it, and the router falls back to it when Anthropic and DeepSeek are unavailable.",
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
  {
    key: "SLACK_BOT_TOKEN",
    label: "Slack bot token",
    scope: "tenant",
    section: "slack",
    secret: true,
    help: "Bot User OAuth Token (starts xoxb-) from the Slack app's OAuth & Permissions page.",
  },
  {
    key: "SLACK_SIGNING_SECRET",
    label: "Slack signing secret",
    scope: "tenant",
    section: "slack",
    secret: true,
    help: "From the Slack app's Basic Information page. Proves events really come from Slack.",
  },
  {
    key: "SLACK_ALERT_CHANNEL",
    label: "Alert channel ID",
    scope: "tenant",
    section: "slack",
    secret: false,
    help: "Where 'a guest needs a person' is posted. In Slack, open the channel's details: the ID is at the bottom (starts with C). Invite the app to it first.",
    placeholder: "C0123456789",
  },
  {
    key: "ROI_MINUTES_PER_CHAT",
    label: "Staff minutes per chat",
    scope: "tenant",
    section: "roi",
    secret: false,
    help: "How long a person would spend on one guest chat. Used for hours saved. Default 6.",
    placeholder: "6",
  },
  {
    key: "ROI_HOURLY_COST",
    label: "Staff cost per hour (business currency)",
    scope: "tenant",
    section: "roi",
    secret: false,
    help: "What an hour of front-desk staff time costs the business, in its own currency. Default 50.",
    placeholder: "50",
  },
  {
    key: "ROI_FX_PER_USD",
    label: "Business currency per US$1",
    scope: "tenant",
    section: "roi",
    secret: false,
    help: "Converts the US$ price into the business's currency for the ROI figures. Default 6.8 (TT$).",
    placeholder: "6.8",
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
