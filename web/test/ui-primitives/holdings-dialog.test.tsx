import { describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Disclosure } from "../../../packages/ui/src/primitives";
import { AmountValue, HoldingList, HoldingRow } from "../../../packages/ui/src/data";
import { Dialog } from "../../../packages/ui/src/dialog";

const html = (el: ReactElement) => renderToStaticMarkup(el);

describe("AmountValue", () => {
  it("renders unavailable distinctly, never as zero", () => {
    const out = html(<AmountValue value={null} unit="PLAY" />);
    expect(out).toContain("Unavailable");
    expect(out).not.toMatch(/>0</);
  });
  it("renders a genuine zero", () => {
    expect(html(<AmountValue value="0" unit="PLAY" />)).toContain("0");
  });
  it("pairs direction colour with sign and words", () => {
    const out = html(<AmountValue value="12.5" unit="PLAY" direction="out" />);
    expect(out).toContain("−12.5");
    expect(out).toContain('aria-label="Outgoing 12.5 PLAY"');
    expect(out).toContain("mp-down");
    expect(html(<AmountValue value="3" direction="in" />)).toContain('aria-label="Incoming 3"');
  });
  it("keeps very long amounts intact", () => {
    const long = "123,456,789,012,345,678,901.000000001";
    expect(html(<AmountValue value={long} />)).toContain(long);
  });
});

describe("HoldingList", () => {
  it("uses description-list semantics", () => {
    const out = html(
      <HoldingList label="Your position">
        <HoldingRow label="Stake" value={<AmountValue value="10" unit="PLAY" />} meta="Path A" />
      </HoldingList>,
    );
    expect(out).toContain('<dl class="mp-holdings" aria-label="Your position">');
    expect(out).toContain("<dt");
    expect(out).toContain("Path A");
  });
});

describe("Disclosure", () => {
  it("is closed by default and opens via defaultOpen", () => {
    expect(html(<Disclosure summary="Details">x</Disclosure>)).not.toContain(" open");
    const out = html(<Disclosure summary="Details" defaultOpen>x</Disclosure>);
    expect(out).toContain('open=""');
    expect(out).toContain("<summary");
  });
});

/** Walk an element tree (expanding nothing) to collect props of host elements. */
function hosts(node: ReactNode, type: string): Record<string, unknown>[] {
  if (Array.isArray(node)) return node.flatMap((n) => hosts(n, type));
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [...(node.type === type ? [node.props] : []), ...hosts(node.props.children as ReactNode, type)];
}

describe("Dialog", () => {
  it("labels itself by its title and has a named close button", () => {
    const out = html(<Dialog open={false} onClose={() => {}} title="Confirm deposit" description="Review first." />);
    expect(out).toMatch(/aria-labelledby="([^"]+)-title"/);
    expect(out).toContain("Confirm deposit");
    expect(out).toContain('aria-label="Close"');
    expect(out).toContain('type="button"');
  });
  it("Escape (cancel) and backdrop click call onClose", () => {
    const onClose = vi.fn();
    // Call Dialog inside a render so its hooks are valid, and capture the element it returns.
    let el = null as unknown as ReactElement<Record<string, unknown>>;
    function Probe() {
      el = Dialog({ open: false, onClose, title: "T" }) as ReactElement<Record<string, unknown>>;
      return el;
    }
    html(<Probe />);
    const prevent = vi.fn();
    (el.props.onCancel as (e: unknown) => void)({ preventDefault: prevent });
    expect(prevent).toHaveBeenCalled();
    const target = {};
    (el.props.onClick as (e: unknown) => void)({ target, currentTarget: target });
    (el.props.onClick as (e: unknown) => void)({ target: {}, currentTarget: target });
    expect(onClose).toHaveBeenCalledTimes(2);
    const [close] = hosts(el, "button");
    (close.onClick as () => void)();
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
