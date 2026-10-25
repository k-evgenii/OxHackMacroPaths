import "./viz.css";
import { gaugeArc } from "./series";

/** Half-circle score gauge; `text` is the exact formatted score. */
export function ScoreGauge({ fraction, text, label }: { fraction: number; text: string; label: string }) {
  return (
    <figure className="viz-root mx-auto w-full max-w-[220px]">
      <svg viewBox="0 0 100 58" role="img" aria-label={`${label}: ${text}`} className="w-full">
        <path d={gaugeArc(1)} fill="none" stroke="var(--viz-track)" strokeWidth={8} strokeLinecap="round" />
        {fraction > 0 ? <path d={gaugeArc(fraction)} fill="none" stroke="var(--viz-value)" strokeWidth={8} strokeLinecap="round" /> : null}
      </svg>
      <figcaption className="-mt-6 text-center">
        <div className="text-xl font-semibold tabular-nums">{text}</div>
        <div className="text-xs opacity-70">{label}</div>
      </figcaption>
    </figure>
  );
}

/** Horizontal bar of a statistic against its cap. */
export function CapBar({ fraction, label, detail }: { fraction: number; label: string; detail: string }) {
  return (
    <div className="viz-root">
      <div className="mb-1 flex justify-between gap-2 text-xs"><span className="opacity-70">{label}</span><span className="tabular-nums">{detail}</span></div>
      <div className="h-2 w-full rounded bg-[var(--viz-track)]" role="meter" aria-valuemin={0} aria-valuemax={1} aria-valuenow={fraction} aria-label={label}>
        <div className="h-2 rounded bg-[var(--viz-value)]" style={{ width: `${fraction * 100}%` }} />
      </div>
    </div>
  );
}
