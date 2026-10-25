/* Frozen chart contract (docs/frontend-v2/interfaces.md, "Chart props").
 * Numeric values are display-only plotting coordinates; formattedValue and label
 * are exact strings supplied by the web adapter and are rendered verbatim. */
export type GlowPoint = {
  id: string;
  x: number;
  value: number | null;
  label: string;
  formattedValue: string;
};

export type GlowSeries = { id: string; label: string; points: GlowPoint[]; tone?: "primary" | "secondary" };

export type GlowLineChartProps = {
  title: string;
  summary: string;
  series: GlowSeries[];
  threshold?: { value: number; label: string };
  xTicks?: Array<{ x: number; label: string }>;
  formatAxisValue: (value: number) => string;
  variant?: "hero" | "comparison" | "sparkline";
  selectedPointId?: string | null;
  onSelectedPointChange?: (id: string | null) => void;
  height?: number;
  className?: string;
};
