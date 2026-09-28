// Email from AI staff, through the business's own mailbox (SMTP). Emails to
// the business's staff domains go straight out; anything else goes to the
// approval inbox and is sent when a person approves it.
import nodemailer from "nodemailer";
import { getConfig } from "@/lib/settings";

export type OutgoingEmail = {
  to: string[];
  subject: string;
  text: string;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
  /** A calendar invite (.ics) sent as a proper invitation. */
  icalEvent?: string;
};

export const splitAddresses = (v: unknown) =>
  (Array.isArray(v) ? v.map(String) : String(v ?? "").split(/[,;\s]+/))
    .map((x) => x.trim().toLowerCase())
    .filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));

export async function emailConfigured(tenantId: string) {
  const [host, user, pass] = await Promise.all([getConfig(tenantId, "SMTP_HOST"), getConfig(tenantId, "SMTP_USER"), getConfig(tenantId, "SMTP_PASS")]);
  return Boolean(host && user && pass);
}

/** True when every address is at one of the business's staff domains. */
export async function allStaff(tenantId: string, addresses: string[]) {
  const domains = ((await getConfig(tenantId, "STAFF_EMAIL_DOMAINS")) ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
  return addresses.length > 0 && domains.length > 0 && addresses.every((a) => domains.includes(a.split("@")[1]));
}

export async function sendEmail(tenantId: string, m: OutgoingEmail) {
  const [host, port, user, pass, from] = await Promise.all(
    ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "EMAIL_FROM"].map((k) => getConfig(tenantId, k))
  );
  if (!host || !user || !pass) throw new Error("No mailbox is set up (Settings, Email).");
  const p = Number(port) || 587;
  const transport = nodemailer.createTransport({ host, port: p, secure: p === 465, auth: { user, pass } });
  const info = await transport.sendMail({
    from: from || user,
    to: m.to.join(", "),
    subject: m.subject,
    text: m.text,
    attachments: m.attachments,
    ...(m.icalEvent ? { icalEvent: { method: "REQUEST", content: m.icalEvent } } : {}),
  });
  return info.messageId as string;
}

/** A calendar invite Google Calendar, Outlook and Apple Calendar all accept. */
export function icsInvite(e: { uid: string; title: string; startUtc: string; endUtc: string; location?: string; notes?: string; organizer: string; attendees: string[] }) {
  const stamp = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
  const org = (/<([^>]+)>/.exec(e.organizer)?.[1] ?? e.organizer).trim();
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Wally//AI staff//EN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${e.uid}@wally`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(e.startUtc)}`,
    `DTEND:${stamp(e.endUtc)}`,
    `SUMMARY:${esc(e.title)}`,
    ...(e.location ? [`LOCATION:${esc(e.location)}`] : []),
    ...(e.notes ? [`DESCRIPTION:${esc(e.notes)}`] : []),
    `ORGANIZER:mailto:${org}`,
    ...e.attendees.map((a) => `ATTENDEE;RSVP=TRUE:mailto:${a}`),
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

/** What an agent asked to send; kept on an approval until a person says yes. */
export type EmailRequest = { to: string[]; subject: string; text: string; documentIds?: string[]; invite?: { title: string; startUtc: string; endUtc: string; location?: string; notes?: string } };
