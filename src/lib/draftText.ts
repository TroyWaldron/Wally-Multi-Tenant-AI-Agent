// The wording of a draft or email waiting for approval. Kept free of server
// imports so the console's approval cards can use it.
import type { Approval } from "@/lib/types";

/** The editable text of an approval that sends something: an agent's draft or an email waiting for approval. */
export function editableOf(a: Pick<Approval, "payload">): { subject?: string; body: string } | null {
  const d = a.payload.draft as { subject?: string; body?: string } | undefined;
  if (d && typeof d.body === "string") return { subject: d.subject, body: d.body };
  const e = a.payload.email as { subject?: string; text?: string } | undefined;
  if (e && typeof e.text === "string") return { subject: e.subject, body: e.text };
  return null;
}
