// Behaviour of the kit's data-state primitives and status/control semantics.
// Rendered to static markup (node environment); handlers are checked on the element tree.
import { describe, expect, it, vi } from "vitest";
import { createElement as h, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Button,
  EmptyState,
  ErrorState,
  IconButton,
  PartialDataNotice,
  Skeleton,
  StatusPill,
  statusLabels,
  type StatusTone,
} from "../../../packages/ui/src/primitives";

const html = (el: ReactElement) => renderToStaticMarkup(el);

/** Expand function components so we can find the rendered <button> and its props. */
function findButtons(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(findButtons);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  if (typeof node.type === "function") return findButtons((node.type as (p: unknown) => ReactNode)(node.props));
  const own = node.type === "button" ? [node] : [];
  return [...own, ...findButtons(node.props.children as ReactNode)];
}

describe("Skeleton", () => {
  it("announces one labelled status, not many anonymous nodes", () => {
    const out = html(h(Skeleton, { label: "Loading pool", className: "w-40" }));
    expect(out.match(/role="status"/g)).toHaveLength(1);
    expect(out).toContain('aria-label="Loading pool"');
    expect(out).toContain("mp-skeleton w-40");
  });
  it("has a default label", () => {
    expect(html(h(Skeleton))).toContain('aria-label="Loading"');
  });
});

describe("EmptyState", () => {
  it("renders title, description and action", () => {
    const out = html(h(EmptyState, { title: "No activity yet", description: "Deposits appear here.", action: h(Button, null, "Deposit") }));
    expect(out).toContain("No activity yet");
    expect(out).toContain("Deposits appear here.");
    expect(out).toContain('type="button"');
    expect(out).not.toContain('role="alert"');
  });
  it("omits optional parts", () => {
    const out = html(h(EmptyState, { title: "Nothing" }));
    expect(out).not.toContain("mp-state__desc");
    expect(out).not.toContain("mp-state__actions");
  });
});

describe("ErrorState", () => {
  it("is an alert with default title and safe description only", () => {
    const out = html(h(ErrorState, { description: "The history service is unavailable." }));
    expect(out).toContain('role="alert"');
    expect(out).toContain("Unable to load");
    expect(out).toContain("The history service is unavailable.");
    expect(out).not.toContain("<button");
  });
  it("calls onRetry from the retry button", () => {
    const onRetry = vi.fn();
    const [btn] = findButtons(h(ErrorState, { description: "x", onRetry }));
    expect(btn.props.type).toBe("button");
    (btn.props.onClick as () => void)();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
  it("marks retry busy and inert while retrying", () => {
    const onRetry = vi.fn();
    const el = h(ErrorState, { description: "x", onRetry, retrying: true });
    const [btn] = findButtons(el);
    expect(btn.props.onClick).toBeUndefined();
    const out = html(el);
    expect(out).toContain('aria-busy="true"');
    expect(out).toContain('aria-disabled="true"');
    expect(out).toContain("Retrying");
  });
});

describe("PartialDataNotice", () => {
  it("states partiality in words and offers retry", () => {
    const onRetry = vi.fn();
    const el = h(PartialDataNotice, { description: "3 of 5 pages loaded.", onRetry });
    const out = html(el);
    expect(out).toContain("Partial data.");
    expect(out).toContain("3 of 5 pages loaded.");
    expect(out).toContain('role="status"');
    (findButtons(el)[0].props.onClick as () => void)();
    expect(onRetry).toHaveBeenCalled();
  });
  it("wraps very long descriptions without truncation", () => {
    const long = "9".repeat(400);
    expect(html(h(PartialDataNotice, { description: long }))).toContain(long);
  });
});

describe("StatusPill", () => {
  it("expresses every status in words", () => {
    for (const tone of Object.keys(statusLabels) as StatusTone[]) {
      const out = html(h(StatusPill, { tone }));
      expect(out).toContain(statusLabels[tone]);
      expect(out).toContain('aria-hidden="true"'); // the colour dot is decorative
    }
  });
  it("unavailable does not claim an action", () => {
    expect(html(h(StatusPill, { tone: "unavailable" }))).toContain("Status unavailable");
  });
});

describe("Buttons", () => {
  it("default to type=button and pass disabled through", () => {
    const out = html(h(Button, { disabled: true }, "Claim"));
    expect(out).toContain('type="button"');
    expect(out).toContain("disabled");
  });
  it("icon-only buttons carry an accessible name", () => {
    expect(html(h(IconButton, { label: "Notifications" }, "!"))).toContain('aria-label="Notifications"');
  });
});
