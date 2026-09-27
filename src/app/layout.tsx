import type { Metadata } from "next";
import { Figtree, JetBrains_Mono, Sora } from "next/font/google";
import "./globals.css";

const sora = Sora({ subsets: ["latin"], variable: "--font-sora", weight: ["600", "700"] });
const figtree = Figtree({ subsets: ["latin"], variable: "--font-figtree" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", weight: ["500"] });

export const metadata: Metadata = {
  title: "Wally Console",
  description: "Lease, configure and supervise AI staff for your business.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sora.variable} ${figtree.variable} ${jetbrains.variable}`}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
