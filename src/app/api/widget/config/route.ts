import { NextResponse, type NextRequest } from "next/server";
import { CORS_HEADERS } from "@/lib/cors";
import { systemStore } from "@/lib/session";

export function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS });
}

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key") ?? "";
  const store = systemStore();
  const tenant = key ? await store.getTenantByPublicKey(key) : null;
  if (!tenant) return NextResponse.json({ error: "Unknown widget key." }, { status: 404, headers: CORS_HEADERS });
  const agents = await store.listAgents(tenant.id);
  const agent = agents.find((a) => a.status === "live" && a.channels.includes("web"));
  return NextResponse.json(
    {
      business: tenant.name,
      agent: agent ? { name: agent.name, title: agent.title } : null,
      color: tenant.branding.color ?? "#1c7f7a",
      welcome: tenant.branding.welcome ?? `Hi, how can ${tenant.name} help?`,
      position: tenant.branding.position ?? "right",
    },
    { headers: CORS_HEADERS }
  );
}
