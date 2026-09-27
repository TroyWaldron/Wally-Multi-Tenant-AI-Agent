"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopyBox({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-start gap-2 rounded-xl bg-ink-deep p-3">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre font-mono text-xs text-amber-light">{text}</code>
      <button
        type="button"
        aria-label={`Copy ${label}`}
        onClick={() => {
          navigator.clipboard.writeText(text).then(
            () => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            },
            () => setCopied(false)
          );
        }}
        className="shrink-0 rounded-md p-1.5 text-white/60 hover:bg-white/10 hover:text-white"
      >
        {copied ? <Check className="h-4 w-4 text-leaf" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  );
}
