import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NewsletterProjectPage from "@vivd/plugin-newsletter/frontend/NewsletterProjectPage";
import {
  NEWSLETTER_CAMPAIGNS_READ_ID,
  NEWSLETTER_SUMMARY_READ_ID,
  type NewsletterCampaignsPayload,
  type NewsletterSubscribersPayload,
  type NewsletterSummaryPayload,
} from "@vivd/plugin-newsletter/shared/summary";

const {
  ensureUseMutationMock,
  infoUseQueryMock,
  actionUseMutationMock,
  projectListUseQueryMock,
  readUseQueryMock,
  updateConfigUseMutationMock,
  useUtilsMock,
} = vi.hoisted(() => ({
  ensureUseMutationMock: vi.fn(),
  infoUseQueryMock: vi.fn(),
  actionUseMutationMock: vi.fn(),
  projectListUseQueryMock: vi.fn(),
  readUseQueryMock: vi.fn(),
  updateConfigUseMutationMock: vi.fn(),
  useUtilsMock: vi.fn(),
}));

const { useSessionMock } = vi.hoisted(() => ({
  useSessionMock: vi.fn(),
}));

vi.mock("@/components/settings/SettingsPageShell", () => ({
  SettingsPageShell: ({
    title,
    description,
    children,
  }: {
    title: string;
    description: string;
    children: ReactNode;
  }) => (
    <div>
      <h1>{title}</h1>
      <p>{description}</p>
      <div>{children}</div>
    </div>
  ),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange?: (value: string) => void;
    children: ReactNode;
  }) => (
    <select
      aria-label="mock-select"
      value={value}
      onChange={(event) => onValueChange?.(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({
    value,
    children,
  }: {
    value: string;
    children: ReactNode;
  }) => <option value={value}>{children}</option>,
  SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectValue: () => null,
}));

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({
    open,
    children,
  }: {
    open: boolean;
    children: ReactNode;
  }) => (open ? <div>{children}</div> : null),
  AlertDialogAction: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  AlertDialogCancel: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  AlertDialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: useUtilsMock,
    plugins: {
      info: {
        useQuery: infoUseQueryMock,
      },
      read: {
        useQuery: readUseQueryMock,
      },
      action: {
        useMutation: actionUseMutationMock,
      },
      ensure: {
        useMutation: ensureUseMutationMock,
      },
      updateConfig: {
        useMutation: updateConfigUseMutationMock,
      },
    },
    project: {
      list: {
        useQuery: projectListUseQueryMock,
      },
    },
  },
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: useSessionMock,
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

function createCampaignPayload(options: {
  offset: number;
  total: number;
  rows: NewsletterCampaignsPayload["rows"];
}): NewsletterCampaignsPayload {
  return {
    pluginId: "newsletter",
    enabled: true,
    status: "all",
    total: options.total,
    limit: 20,
    offset: options.offset,
    currentMode: "newsletter",
    audienceOptions: {
      allConfirmed: 25,
      modeConfirmed: 20,
    },
    rows: options.rows,
  };
}

describe("NewsletterProjectPage", () => {
  let campaignsByOffset: Record<number, NewsletterCampaignsPayload>;

  beforeEach(() => {
    campaignsByOffset = {
      0: createCampaignPayload({
        offset: 0,
        total: 1,
        rows: [
          {
            id: "campaign-old",
            subject: "Old draft",
            body: "Old body",
            status: "draft",
            audience: "all_confirmed",
            mode: "newsletter",
            estimatedRecipientCount: 25,
            createdAt: "2026-04-15T10:00:00.000Z",
            updatedAt: "2026-04-15T10:00:00.000Z",
          },
        ],
      }),
    };

    useSessionMock.mockReset();
    infoUseQueryMock.mockReset();
    readUseQueryMock.mockReset();
    actionUseMutationMock.mockReset();
    ensureUseMutationMock.mockReset();
    updateConfigUseMutationMock.mockReset();
    projectListUseQueryMock.mockReset();
    useUtilsMock.mockReset();

    useSessionMock.mockReturnValue({
      data: {
        user: {
          role: "super_admin",
        },
      },
    });

    useUtilsMock.mockReturnValue({
      plugins: {
        catalog: {
          invalidate: vi.fn().mockResolvedValue(undefined),
        },
        info: {
          invalidate: vi.fn().mockResolvedValue(undefined),
        },
        read: {
          invalidate: vi.fn().mockResolvedValue(undefined),
        },
      },
    });

    projectListUseQueryMock.mockReturnValue({
      data: {
        projects: [{ slug: "site-1", title: "Site 1" }],
      },
      isLoading: false,
      refetch: vi.fn().mockResolvedValue(undefined),
    });

    infoUseQueryMock.mockReturnValue({
      data: {
        pluginId: "newsletter",
        entitled: true,
        enabled: true,
        instanceId: "plugin-1",
        status: "enabled",
        config: {
          mode: "newsletter",
          collectName: false,
          sourceHosts: [],
          redirectHostAllowlist: [],
        },
        usage: {
          subscribeEndpoint: "https://example.com/subscribe",
          confirmEndpoint: "https://example.com/confirm",
          unsubscribeEndpoint: "https://example.com/unsubscribe",
          expectedFields: ["email"],
          optionalFields: ["name"],
          inferredAutoSourceHosts: ["example.com"],
        },
        snippets: {
          html: "<form></form>",
          astro: "<form></form>",
        },
        details: {
          counts: {
            total: 25,
            pending: 0,
            confirmed: 25,
            unsubscribed: 0,
            bounced: 0,
            complained: 0,
          },
        },
      },
      isLoading: false,
      refetch: vi.fn().mockResolvedValue(undefined),
    });

    readUseQueryMock.mockImplementation((input: any) => {
      if (input.readId === NEWSLETTER_SUMMARY_READ_ID) {
        const summary: NewsletterSummaryPayload = {
          pluginId: "newsletter",
          enabled: true,
          rangeDays: 30,
          counts: {
            total: 25,
            pending: 0,
            confirmed: 25,
            unsubscribed: 0,
            bounced: 0,
            complained: 0,
          },
          recent: {
            signups: 4,
            confirmations: 4,
            unsubscribes: 0,
          },
        };
        return {
          data: { result: summary },
          isLoading: false,
          refetch: vi.fn().mockResolvedValue(undefined),
        };
      }

      if (input.readId === NEWSLETTER_CAMPAIGNS_READ_ID) {
        return {
          data: {
            result:
              campaignsByOffset[input.input.offset] ??
              createCampaignPayload({
                offset: input.input.offset,
                total: 0,
                rows: [],
              }),
          },
          isLoading: false,
          refetch: vi.fn().mockResolvedValue(undefined),
        };
      }

      const subscribers: NewsletterSubscribersPayload = {
        pluginId: "newsletter",
        enabled: true,
        status: "all",
        search: "",
        total: 0,
        limit: 100,
        offset: 0,
        rows: [],
      };
      return {
        data: { result: subscribers },
        isLoading: false,
        refetch: vi.fn().mockResolvedValue(undefined),
      };
    });

    actionUseMutationMock.mockImplementation((options: any) => ({
      mutate: (variables: any, mutateOptions?: { onSettled?: () => void }) => {
        if (variables.actionId === "save_campaign_draft") {
          options.onSuccess?.({
            pluginId: "newsletter",
            actionId: "save_campaign_draft",
            result: {
              campaignId: "campaign-new",
              estimatedRecipientCount: 20,
            },
          });
        } else if (variables.actionId === "delete_campaign_draft") {
          options.onSuccess?.({
            pluginId: "newsletter",
            actionId: "delete_campaign_draft",
            result: {
              campaignId: variables.args[0],
            },
          });
        } else {
          options.onSuccess?.({
            pluginId: "newsletter",
            actionId: variables.actionId,
            result: {},
          });
        }
        mutateOptions?.onSettled?.();
      },
      isPending: false,
      variables: undefined,
    }));

    ensureUseMutationMock.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      variables: undefined,
    });

    updateConfigUseMutationMock.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      variables: undefined,
    });
  });

  it("keeps new draft fields visible after save until refreshed campaign data catches up", async () => {
    render(<NewsletterProjectPage projectSlug="site-1" />);

    await waitFor(() => expect(screen.getByDisplayValue("Old draft")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "New draft" }));
    fireEvent.change(screen.getByPlaceholderText("April launch update"), {
      target: { value: "Launch update" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(
        "Write the announcement you want to send to confirmed subscribers.",
      ),
      {
        target: { value: "Fresh draft body" },
      },
    );

    fireEvent.click(screen.getByRole("button", { name: "Create draft" }));

    await waitFor(() =>
      expect(screen.getByDisplayValue("Launch update")).toBeInTheDocument(),
    );
    expect(screen.getByDisplayValue("Fresh draft body")).toBeInTheDocument();
  });

  it("lets operators paginate through saved campaign drafts", async () => {
    campaignsByOffset = {
      0: createCampaignPayload({
        offset: 0,
        total: 25,
        rows: [
          {
            id: "campaign-1",
            subject: "Campaign 1",
            body: "First page body",
            status: "draft",
            audience: "all_confirmed",
            mode: "newsletter",
            estimatedRecipientCount: 25,
            createdAt: "2026-04-15T10:00:00.000Z",
            updatedAt: "2026-04-15T10:00:00.000Z",
          },
        ],
      }),
      20: createCampaignPayload({
        offset: 20,
        total: 25,
        rows: [
          {
            id: "campaign-21",
            subject: "Campaign 21",
            body: "Second page body",
            status: "draft",
            audience: "mode_confirmed",
            mode: "newsletter",
            estimatedRecipientCount: 20,
            createdAt: "2026-04-16T10:00:00.000Z",
            updatedAt: "2026-04-16T10:00:00.000Z",
          },
        ],
      }),
    };

    render(<NewsletterProjectPage projectSlug="site-1" />);

    await waitFor(() => expect(screen.getByDisplayValue("Campaign 1")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Next drafts" }));

    await waitFor(() => expect(screen.getByDisplayValue("Campaign 21")).toBeInTheDocument());
    expect(screen.getByText(/page 2 of 2/i)).toBeInTheDocument();
  });
});
