// Placeholder root layout. Agent 3 (fe/03-shell) owns and replaces this file.
import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/lib/providers";

export const metadata: Metadata = {
  title: "MacroPaths",
  description: "Path-dependent contracts on US CPI inflation, settled on Solana devnet.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
