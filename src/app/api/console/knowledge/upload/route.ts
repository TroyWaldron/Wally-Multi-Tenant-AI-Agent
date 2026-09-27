import { after, NextResponse, type NextRequest } from "next/server";
import { extractText, getDocumentProxy } from "unpdf";
import { chunkText, embedPending } from "@/lib/embeddings";
import { getSession, systemStore } from "@/lib/session";

// Knowledge > Upload a PDF: the text is split into articles the agents can
// search (and embedded for meaning-based search when OpenAI is set up). The
// file itself is not kept. A signed-in user of the business only.
const MAX_BYTES = 4 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Your session expired. Sign in again." }, { status: 401 });
  const form = await req.formData().catch(() => null);
  const tenantId = String(form?.get("tenantId") ?? "");
  const file = form?.get("file");
  const tenant = tenantId ? await session.store.getTenant(tenantId) : null;
  if (!tenant) return NextResponse.json({ error: "You don't have access to that business." }, { status: 403 });
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a PDF first." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "That PDF is over 4 MB. Split it or save a smaller copy." }, { status: 413 });
  if (file.type && file.type !== "application/pdf") return NextResponse.json({ error: "Only PDF files for now." }, { status: 415 });

  let text: string;
  try {
    const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
    const r = await extractText(pdf, { mergePages: false });
    text = (Array.isArray(r.text) ? r.text : [r.text]).join("\n\n");
  } catch {
    return NextResponse.json({ error: "Couldn't read that PDF. Is it password protected?" }, { status: 422 });
  }
  const chunks = chunkText(text);
  if (!chunks.length) return NextResponse.json({ error: "No text found. Scanned PDFs (images of pages) aren't supported yet." }, { status: 422 });

  const name = file.name.replace(/\.pdf$/i, "").slice(0, 80) || "Document";
  const source = `pdf:${file.name.slice(0, 100)}`;
  // Uploading the same file again replaces its earlier articles.
  const existing = (await session.store.listKnowledge(tenant.id)).filter((k) => k.source === source);
  for (const k of existing) await session.store.deleteKnowledge(tenant.id, k.id);
  for (let i = 0; i < chunks.length; i++) {
    await session.store.addKnowledge(tenant.id, { title: chunks.length > 1 ? `${name} (part ${i + 1} of ${chunks.length})` : name, content: chunks[i], source });
  }
  await session.store.audit(tenant.id, { actorType: "user", actor: session.user.email, action: "knowledge.pdf_uploaded", detail: { file: file.name, articles: chunks.length, replaced: existing.length } });
  after(() => embedPending(systemStore(), tenant).catch((err) => console.error("embedding failed", err)));
  return NextResponse.json({ ok: true, articles: chunks.length, replaced: existing.length });
}
