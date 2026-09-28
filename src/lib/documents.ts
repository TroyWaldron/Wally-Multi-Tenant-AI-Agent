// Letters, Word documents and Excel sheets made by AI staff. Built on the
// server, stored in the business's private folder, shared as short-lived links.
import { randomUUID } from "node:crypto";
import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import ExcelJS from "exceljs";
import { isSupabaseConfigured, serviceClient } from "@/lib/supabase";
import type { Store } from "@/lib/store/types";
import type { AgentDocument, Tenant } from "@/lib/types";

const BUCKET = "documents";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
/** How long a shared link works. */
export const LINK_DAYS = 7;

type Globals = { __wallyDocFiles?: Map<string, Buffer> };
const g = globalThis as Globals;
const demoFiles = () => (g.__wallyDocFiles ??= new Map());

// Plain text with light markdown: "# " headings, "- " bullets, blank lines between paragraphs.
function paragraphs(body: string) {
  return body.split(/\r?\n/).map((line) => {
    const t = line.trimEnd();
    if (/^#{1,3} /.test(t)) return new Paragraph({ text: t.replace(/^#+ /, ""), heading: t.startsWith("##") ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_1 });
    if (/^[-*] /.test(t)) return new Paragraph({ text: t.slice(2), bullet: { level: 0 } });
    return new Paragraph({ children: [new TextRun(t)], spacing: { after: 120 } });
  });
}

export async function buildWord(tenant: Pick<Tenant, "name" | "profile" | "timezone">, d: { title: string; body: string; letter?: { to?: string; signOff?: string } }) {
  const children: Paragraph[] = [];
  if (d.letter) {
    const date = new Intl.DateTimeFormat("en-GB", { timeZone: tenant.timezone, day: "numeric", month: "long", year: "numeric" }).format(new Date());
    const head = [tenant.name, tenant.profile.address, tenant.profile.phone, tenant.profile.email].filter(Boolean) as string[];
    children.push(...head.map((l, i) => new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: l, bold: i === 0 })] })));
    children.push(new Paragraph({ text: "" }), new Paragraph({ text: date }), new Paragraph({ text: "" }));
    if (d.letter.to) children.push(...d.letter.to.split(/\r?\n/).map((l) => new Paragraph({ text: l })), new Paragraph({ text: "" }));
    children.push(new Paragraph({ children: [new TextRun({ text: d.title, bold: true })], spacing: { after: 200 } }));
  } else {
    children.push(new Paragraph({ text: d.title, heading: HeadingLevel.TITLE }));
  }
  children.push(...paragraphs(d.body));
  if (d.letter?.signOff) children.push(new Paragraph({ text: "" }), ...d.letter.signOff.split(/\r?\n/).map((l) => new Paragraph({ text: l })));
  return Packer.toBuffer(new Document({ creator: tenant.name, title: d.title, sections: [{ children }] }));
}

export type Sheet = { name: string; columns: string[]; rows: (string | number | null)[][] };

export async function buildExcel(tenant: Pick<Tenant, "name">, d: { title: string; sheets: Sheet[] }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = tenant.name;
  for (const s of d.sheets.slice(0, 10)) {
    const ws = wb.addWorksheet(s.name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Sheet1");
    ws.addRow(s.columns);
    ws.getRow(1).font = { bold: true };
    for (const r of s.rows.slice(0, 5000)) ws.addRow(r.map((v) => (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v)) ? Number(v) : v)));
    ws.columns.forEach((c, i) => (c.width = Math.min(50, Math.max(10, ...[s.columns[i] ?? "", ...s.rows.slice(0, 200).map((r) => String(r[i] ?? ""))].map((x) => x.length + 2)))));
    ws.views = [{ state: "frozen", ySplit: 1 }];
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const safe = (s: string) => s.replace(/[^a-z0-9]+/gi, "-").replace(/(^-|-$)/g, "").slice(0, 60) || "document";

/** Saves a built file for the business and records it. */
export async function saveDocument(store: Store, tenantId: string, d: { agentId: string | null; title: string; kind: AgentDocument["kind"]; content: Buffer }) {
  const ext = d.kind === "excel" ? "xlsx" : "docx";
  const filename = `${safe(d.title)}.${ext}`;
  const path = `${tenantId}/${randomUUID()}/${filename}`;
  if (isSupabaseConfigured()) {
    const { error } = await serviceClient().storage.from(BUCKET).upload(path, d.content, { contentType: ext === "xlsx" ? XLSX : DOCX });
    if (error) throw new Error(error.message);
  } else {
    demoFiles().set(path, d.content);
  }
  return store.addDocument(tenantId, { agentId: d.agentId, title: d.title, kind: d.kind, filename, path });
}

/** A link to download the file, valid for LINK_DAYS (null in demo mode). */
export async function documentLink(doc: Pick<AgentDocument, "path" | "filename">) {
  if (!isSupabaseConfigured()) return null;
  const { data } = await serviceClient().storage.from(BUCKET).createSignedUrl(doc.path, LINK_DAYS * 86_400, { download: doc.filename });
  return data?.signedUrl ?? null;
}

export async function documentFile(doc: Pick<AgentDocument, "path" | "filename" | "kind">) {
  let content: Buffer | undefined;
  if (isSupabaseConfigured()) {
    const { data, error } = await serviceClient().storage.from(BUCKET).download(doc.path);
    if (error || !data) throw new Error(error?.message ?? "file missing");
    content = Buffer.from(await data.arrayBuffer());
  } else {
    content = demoFiles().get(doc.path);
    if (!content) throw new Error("file missing");
  }
  return { filename: doc.filename, content, contentType: doc.kind === "excel" ? XLSX : DOCX };
}
