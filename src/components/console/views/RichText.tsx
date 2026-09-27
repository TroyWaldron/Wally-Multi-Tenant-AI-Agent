import { Fragment, type ReactNode } from "react";

// The same small markdown subset the website widget renders (public/widget.js):
// **bold**, "- " and "1. " lists, and | tables |. Plain React nodes, no HTML.
function inline(text: string): ReactNode[] {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : <Fragment key={i}>{part}</Fragment>));
}

const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
const isRow = (line: string) => /^\s*\|/.test(line);
const isDivider = (line: string) => /^\s*\|?[\s:|-]+\|?\s*$/.test(line);
const bullet = /^\s*(?:[-*•]|\d+[.)])\s+/;

export function RichText({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (isRow(line)) {
      const rows: string[] = [];
      while (i < lines.length && isRow(lines[i])) rows.push(lines[i++]);
      const [head, ...body] = rows.filter((r) => !isDivider(r));
      blocks.push(
        <div key={blocks.length} className="my-1.5 overflow-x-auto">
          <table className="min-w-full border-collapse text-xs">
            <thead>
              <tr>{cells(head ?? "").map((c, n) => <th key={n} className="bg-ink/5 px-2 py-1 text-left font-semibold whitespace-nowrap">{inline(c)}</th>)}</tr>
            </thead>
            <tbody>
              {body.map((r, n) => (
                <tr key={n} className="border-t border-ink/8">{cells(r).map((c, m) => <td key={m} className="px-2 py-1 align-top">{inline(c)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }
    if (bullet.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: string[] = [];
      while (i < lines.length && bullet.test(lines[i])) items.push(lines[i++].replace(bullet, ""));
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List key={blocks.length} className={`my-1 pl-5 ${ordered ? "list-decimal" : "list-disc"}`}>
          {items.map((it, n) => <li key={n}>{inline(it)}</li>)}
        </List>
      );
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !isRow(lines[i]) && !bullet.test(lines[i])) para.push(lines[i++].replace(/^#+\s*/, ""));
    blocks.push(
      <p key={blocks.length} className="my-1 first:mt-0 last:mb-0">
        {para.map((t, n) => <Fragment key={n}>{n > 0 && <br />}{inline(t)}</Fragment>)}
      </p>
    );
  }
  return <>{blocks}</>;
}
