import { notFound } from "next/navigation";
import type { ReactNode } from "react";

// Developer console gate. Evaluated on the server per request; there is no
// query-string or public client flag bypass. Disabled => 404.
export const dynamic = "force-dynamic";

export default function DevLayout({ children }: { children: ReactNode }) {
  if (process.env.DEV_CONSOLE !== "1") notFound();
  return <div data-dev-console="">{children}</div>;
}
