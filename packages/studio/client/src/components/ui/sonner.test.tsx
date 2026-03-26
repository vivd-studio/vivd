import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { sonnerPropsSpy } = vi.hoisted(() => ({
  sonnerPropsSpy: vi.fn(),
}));

vi.mock("@/components/theme", () => ({
  useTheme: () => ({ theme: "dark" }),
}));

vi.mock("sonner", () => ({
  Toaster: (props: unknown) => {
    sonnerPropsSpy(props);
    return null;
  },
}));

import { Toaster } from "./sonner";

describe("Toaster", () => {
  it("uses readable semantic toast styling for light and dark surfaces", () => {
    render(<Toaster />);

    const props = sonnerPropsSpy.mock.calls.at(-1)?.[0] as {
      toastOptions?: {
        classNames?: Record<string, string>;
      };
    };

    const classNames = props.toastOptions?.classNames;
    expect(classNames?.toast).toContain("bg-background");
    expect(classNames?.toast).not.toContain("!bg-background");
    expect(classNames?.toast).toContain("backdrop-blur-none");
    expect(classNames?.closeButton).toContain("bg-background");
    expect(classNames?.closeButton).not.toContain("!bg-background");
    expect(classNames?.success).toContain("[&_[data-description]]:!text-white/90");
    expect(classNames?.success).toContain("dark:!bg-emerald-500");
    expect(classNames?.success).not.toContain("/10");
    expect(classNames?.error).toContain("dark:!bg-red-500");
    expect(classNames?.info).toContain("!bg-blue-600");
    expect(classNames?.warning).toContain("!bg-amber-700");
    expect(classNames?.error).not.toContain("/10");
  });
});
