// @vitest-environment jsdom
// Smoke test for the DOM test environment (jsdom + @testing-library/react). Opt in per file with the pragma above.
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { render, screen, cleanup } from "@testing-library/react";

describe("jsdom environment", () => {
  it("renders a React element", () => {
    render(createElement("button", { type: "button" }, "Connect"));
    expect(screen.getByRole("button", { name: "Connect" })).toBeTruthy();
    cleanup();
  });
});
