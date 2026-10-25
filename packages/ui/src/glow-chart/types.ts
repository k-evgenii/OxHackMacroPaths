// Frozen glow chart props (interfaces.md "Chart props"). Worker 09 implements GlowLineChart /
// GlowSparkline against these; the UI barrel exports them at integration.
// Numeric values are bounded plotting coordinates; formattedValue comes from exact caller formatting.

export type GlowPoint = {
  id: string;
  x: number;
  /** null = gap (unobserved), never interpolated */
  value: number | null;
  label: string;
  formattedValue: string;
};

export type GlowSeries = { id: string; label: string; points: GlowPoint[]; tone?: "primary" | "secondary" };

export type GlowLineChartProps = {
  title: string;
  summary: string;
  series: GlowSeries[];
  /** bandLabel (optional, caller-formatted): annotation for the shaded above-threshold band. */
  threshold?: { value: number; label: string; bandLabel?: string };
  /** Optional progressive reveal: draw only points with x <= that point's x; the rest is hidden, not zeroed.
   * null/undefined or an unknown id = everything shown. */
  revealUpToPointId?: string | null;
  xTicks?: Array<{ x: number; label: string }>;
  formatAxisValue: (value: number) => string;
  variant?: "hero" | "comparison" | "sparkline";
  selectedPointId?: string | null;
  onSelectedPointChange?: (id: string | null) => void;
  height?: number;
  className?: string;
};

/** GlowSparkline: same props with the variant fixed to sparkline. */
export type GlowSparklineProps = Omit<GlowLineChartProps, "variant">;
