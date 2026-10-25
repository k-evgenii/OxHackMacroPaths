import { Suspense } from "react";
import { ActivityPage } from "@/features/activity/ActivityPage";

export const metadata = { title: "Activity · MacroPaths" };

// Suspense: session selection reads ?session= via search params on the client.
export default function Page() {
  return (
    <Suspense fallback={null}>
      <ActivityPage />
    </Suspense>
  );
}
