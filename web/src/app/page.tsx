import { Suspense } from "react";
import { Dashboard } from "@/features/dashboard";

// Session selection is URL-driven (?session=), so the client tree reads search params.
export default function Home() {
  return (
    <Suspense fallback={null}>
      <Dashboard />
    </Suspense>
  );
}
