// Frozen primitive props (interfaces.md, worker 08). Types only; worker 08 implements Skeleton,
// EmptyState, ErrorState and PartialDataNotice and exports them through the UI barrel.
// Existing Button/Card/StatusPill props stay as in primitives.tsx.
import type { ReactNode } from "react";

export type SkeletonProps = { className?: string; label?: string };
export type EmptyStateProps = { title: string; description?: string; action?: ReactNode; className?: string };
export type ErrorStateProps = {
  title?: string;
  description: string;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
};
export type PartialDataNoticeProps = { description: string; onRetry?: () => void; retrying?: boolean; className?: string };
