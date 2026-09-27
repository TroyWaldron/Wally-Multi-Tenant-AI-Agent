// Wally's mark: a speech bubble with a small "W" wave, drawn inline so it
// themes with currentColor.
export function WallyMark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <path d="M6 5h20a4 4 0 0 1 4 4v11a4 4 0 0 1-4 4H14l-6 5v-5H6a4 4 0 0 1-4-4V9a4 4 0 0 1 4-4z" fill="currentColor" opacity=".18" />
      <path d="M8 11l3 8 3-6 3 6 3-6 3 6 2-8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
