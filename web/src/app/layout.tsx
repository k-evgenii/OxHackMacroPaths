import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/lib/providers";
import { AppShell } from "@/components/shell/AppShell";

export const metadata: Metadata = {
  title: "MacroPaths",
  description: "Path-dependent contracts on US CPI inflation, settled on Solana devnet.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0f0b09" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
