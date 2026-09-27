// PII redaction. Two levels:
//  - "sensitive" runs on every customer message before it is stored or sent
//    to a model provider. It removes what nobody should ever keep in a chat:
//    payment card numbers (PCI DSS), bank account numbers (IBAN), and
//    government ID numbers such as US Social Security numbers. Names, emails
//    and phone numbers stay, because the receptionist needs them to follow up.
//  - "strict" also masks emails and phone numbers. It runs on the audit log,
//    which is kept for longer and read by more people than the conversation.
// Built for GDPR data minimisation and the Trinidad and Tobago Data
// Protection Act; masked values keep their last four digits so staff can
// still tell cards apart.

export type RedactionLevel = "sensitive" | "strict";

export type Redaction = { kind: "card" | "iban" | "national_id" | "email" | "phone"; count: number };

/** Luhn checksum, so only real-looking card numbers are removed, not booking references. */
function luhn(digits: string) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

const CARD = /\b(?:\d[ -]?){12,18}\d\b/g;
const IBAN = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g;
const SSN = /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g;
// Passport / national ID written out with its label ("passport no. AB123456", "national ID 19850101001").
const LABELLED_ID = /\b(passport|national id|id card|nis|driver'?s licen[cs]e)(\s*(?:no\.?|number|#|:)?\s*)([A-Z0-9-]{6,15})\b/gi;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE = /(?:\+|\b)\d[\d ()-]{7,}\d\b/g;

const last4 = (s: string) => s.replace(/\D/g, "").slice(-4);

export function redactPII(text: string, level: RedactionLevel = "sensitive"): { text: string; found: Redaction[] } {
  const counts = new Map<Redaction["kind"], number>();
  const hit = (k: Redaction["kind"]) => counts.set(k, (counts.get(k) ?? 0) + 1);
  let out = text;

  out = out.replace(CARD, (m) => {
    const digits = m.replace(/\D/g, "");
    if (digits.length < 13 || digits.length > 19 || !luhn(digits)) return m;
    hit("card");
    return `[card number removed, ending ${last4(digits)}]`;
  });
  out = out.replace(IBAN, (m) => {
    hit("iban");
    return `[bank account removed, ending ${last4(m)}]`;
  });
  out = out.replace(SSN, () => {
    hit("national_id");
    return "[ID number removed]";
  });
  out = out.replace(LABELLED_ID, (_m, label: string, sep: string) => {
    hit("national_id");
    return `${label}${sep}[ID number removed]`;
  });

  if (level === "strict") {
    out = out.replace(EMAIL, (m) => {
      hit("email");
      const [user, domain] = m.split("@");
      return `${user.slice(0, 1)}***@${domain}`;
    });
    out = out.replace(PHONE, (m) => {
      // Dates and times are not phone numbers.
      if (m.replace(/\D/g, "").length < 7 || /^\d{4}-\d{2}-\d{2}/.test(m)) return m;
      hit("phone");
      return `[phone ending ${last4(m)}]`;
    });
  }

  return { text: out, found: [...counts].map(([kind, count]) => ({ kind, count })) };
}

/** Redacts every string inside a JSON-like value (for audit details). */
export function redactDeep<T>(value: T, level: RedactionLevel = "strict"): T {
  if (typeof value === "string") return redactPII(value, level).text as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, level)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactDeep(v, level)])) as T;
  }
  return value;
}
