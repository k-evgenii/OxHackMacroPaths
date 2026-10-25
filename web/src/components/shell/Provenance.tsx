"use client";
import { useQueries } from "@tanstack/react-query";
import { forecastQuery, manifestQuery, provenance } from "@/lib/artifacts";

/**
 * Data date and model label for every figure that comes from the precomputed research artefacts
 * (forecast quotes, planner). Those are computed offline, not live, so say so wherever they appear.
 */
export function Provenance({ className = "" }: { className?: string }) {
  const [m, f] = useQueries({ queries: [manifestQuery, forecastQuery] });
  if (!m.data || !f.data) return null;
  const p = provenance(m.data, f.data);
  return (
    <aside
      aria-label="Data date and model"
      className={`rounded-card border border-border bg-surface p-3 text-xs text-muted ${className}`}
    >
      <p>
        <span className="font-medium text-text">Not live.</span> Precomputed forecast, an illustration until settlement; settlement
        uses the realised on-chain path only.
      </p>
      <p className="mt-1">
        Data as of:{" "}
        {p.snapshots.length ? p.snapshots.map((s) => `${s.id} retrieved ${s.retrievedAt}`).join("; ") : "date not recorded in the artefact"}
      </p>
      <p className="mt-1">
        Model: {p.label} ({p.version})
      </p>
    </aside>
  );
}
