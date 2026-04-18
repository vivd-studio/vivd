import "@testing-library/jest-dom/vitest";
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@vivd/ui", async () => {
  const actual = await vi.importActual<any>("@vivd/ui");

  return {
    ...actual,
    Badge: ({
      children,
      ...props
    }: {
      children: ReactNode;
    } & HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
    Button: ({
      children,
      ...props
    }: {
      children: ReactNode;
    } & ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    Checkbox: ({
      checked,
      onCheckedChange,
      ...props
    }: {
      checked?: boolean;
      onCheckedChange?: (value: boolean) => void;
    } & InputHTMLAttributes<HTMLInputElement>) => (
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onCheckedChange?.(event.target.checked)}
        {...props}
      />
    ),
    Input: (props: InputHTMLAttributes<HTMLInputElement>) => (
      <input {...props} />
    ),
    Label: ({
      children,
      ...props
    }: {
      children: ReactNode;
    } & LabelHTMLAttributes<HTMLLabelElement>) => (
      <label {...props}>{children}</label>
    ),
    Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SelectTrigger: ({ children }: { children: ReactNode }) => (
      <div>{children}</div>
    ),
    SelectValue: () => <span>Select value</span>,
    SelectContent: ({
      children,
      ...props
    }: {
      children: ReactNode;
    } & HTMLAttributes<HTMLDivElement>) => (
      <div data-testid="source-select-content" {...props}>
        {children}
      </div>
    ),
    SelectItem: ({
      children,
      value,
    }: {
      children: ReactNode;
      value: string;
    }) => <div data-value={value}>{children}</div>,
    Sheet: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SheetContent: ({
      children,
      ...props
    }: {
      children: ReactNode;
    } & HTMLAttributes<HTMLDivElement>) => (
      <div data-testid="reservation-sheet-content" {...props}>
        {children}
      </div>
    ),
    SheetDescription: ({
      children,
      ...props
    }: {
      children: ReactNode;
    } & HTMLAttributes<HTMLParagraphElement>) => <p {...props}>{children}</p>,
    SheetFooter: ({
      children,
      ...props
    }: {
      children: ReactNode;
    } & HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
    SheetHeader: ({
      children,
      ...props
    }: {
      children: ReactNode;
    } & HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
    SheetTitle: ({
      children,
      ...props
    }: {
      children: ReactNode;
    } & HTMLAttributes<HTMLHeadingElement>) => <h2 {...props}>{children}</h2>,
    Textarea: (props: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
      <textarea {...props} />
    ),
  };
});

vi.mock("@/components/ui/badge", () => ({
  Badge: ({
    children,
    ...props
  }: {
    children: ReactNode;
  } & HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: {
    children: ReactNode;
  } & ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({
    checked,
    onCheckedChange,
    ...props
  }: {
    checked?: boolean;
    onCheckedChange?: (value: boolean) => void;
  } & InputHTMLAttributes<HTMLInputElement>) => (
    <input
      type="checkbox"
      checked={checked}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
      {...props}
    />
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({
    children,
    ...props
  }: {
    children: ReactNode;
  } & LabelHTMLAttributes<HTMLLabelElement>) => (
    <label {...props}>{children}</label>
  ),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  SelectValue: () => <span>Select value</span>,
  SelectContent: ({
    children,
    ...props
  }: {
    children: ReactNode;
  } & HTMLAttributes<HTMLDivElement>) => (
    <div data-testid="source-select-content" {...props}>
      {children}
    </div>
  ),
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) => (
    <div data-value={value}>{children}</div>
  ),
}));

vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetContent: ({
    children,
    ...props
  }: {
    children: ReactNode;
  } & HTMLAttributes<HTMLDivElement>) => (
    <div data-testid="reservation-sheet-content" {...props}>
      {children}
    </div>
  ),
  SheetDescription: ({
    children,
    ...props
  }: {
    children: ReactNode;
  } & HTMLAttributes<HTMLParagraphElement>) => <p {...props}>{children}</p>,
  SheetFooter: ({
    children,
    ...props
  }: {
    children: ReactNode;
  } & HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  SheetHeader: ({
    children,
    ...props
  }: {
    children: ReactNode;
  } & HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  SheetTitle: ({
    children,
    ...props
  }: {
    children: ReactNode;
  } & HTMLAttributes<HTMLHeadingElement>) => <h2 {...props}>{children}</h2>,
}));

vi.mock("@/components/ui/textarea", () => ({
  Textarea: (props: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
    <textarea {...props} />
  ),
}));

import { ReservationSheet } from "./tableBookingProjectPage/calendarSheets";

function createReservationEditor() {
  return {
    editingBookingId: null,
    reservationDate: "2026-04-18",
    setReservationDate: vi.fn(),
    reservationTime: "18:00",
    setReservationTime: vi.fn(),
    reservationPartySize: "2",
    setReservationPartySize: vi.fn(),
    reservationSourceChannel: "phone" as const,
    setReservationSourceChannel: vi.fn(),
    reservationName: "Ada Lovelace",
    setReservationName: vi.fn(),
    reservationEmail: "ada@example.com",
    setReservationEmail: vi.fn(),
    reservationPhone: "+49 123 456",
    setReservationPhone: vi.fn(),
    reservationNotes: "Window table",
    setReservationNotes: vi.fn(),
    reservationErrors: {},
    setReservationErrors: vi.fn(),
    clearReservationErrors: vi.fn(),
    sendGuestNotification: true,
    setSendGuestNotification: vi.fn(),
    resetReservationEditor: vi.fn(),
    startEditingReservation: vi.fn(),
  };
}

describe("ReservationSheet", () => {
  it("applies operator high-contrast mode to the sheet and source select portals", () => {
    render(
      <ReservationSheet
        open
        onOpenChange={vi.fn()}
        editor={createReservationEditor()}
        selectedDate="2026-04-18"
        timezone="Europe/Berlin"
        presentationMode="hc-dark"
        onSave={vi.fn()}
        pending={false}
      />,
    );

    expect(screen.getByTestId("reservation-sheet-content")).toHaveAttribute(
      "data-tb-operator-mode",
      "hc-dark",
    );
    expect(screen.getByTestId("source-select-content")).toHaveAttribute(
      "data-tb-operator-mode",
      "hc-dark",
    );
  });

  it("leaves the normal project sheet unscoped", () => {
    render(
      <ReservationSheet
        open
        onOpenChange={vi.fn()}
        editor={createReservationEditor()}
        selectedDate="2026-04-18"
        timezone="Europe/Berlin"
        presentationMode="normal"
        onSave={vi.fn()}
        pending={false}
      />,
    );

    expect(screen.getByTestId("reservation-sheet-content")).not.toHaveAttribute(
      "data-tb-operator-mode",
    );
    expect(screen.getByTestId("source-select-content")).not.toHaveAttribute(
      "data-tb-operator-mode",
    );
  });
});
