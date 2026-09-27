import { NextResponse, type NextRequest } from "next/server";
import { safeEqual } from "@/lib/secrets";
import { systemStore } from "@/lib/session";
import { getConfig } from "@/lib/settings";

// A business's own back office (for example Sunsational's Operations Hub)
// calling Wally from its server. It names the business by its widget key and
// proves it is that business's server with the Website relay secret, which
// only ever lives in the two servers' settings, never in a browser.
export async function partnerContext(req: NextRequest) {
  const key = req.headers.get("x-wally-key") ?? "";
  const secret = req.headers.get("x-wally-relay-secret") ?? "";
  const store = systemStore();
  const tenant = key && secret ? await store.getTenantByPublicKey(key) : null;
  const expected = tenant ? await getConfig(tenant.id, "WIDGET_RELAY_SECRET") : null;
  if (!tenant || !expected || !safeEqual(secret, expected)) {
    return { error: NextResponse.json({ error: "Not allowed." }, { status: 401 }) } as const;
  }
  return { store, tenant } as const;
}
