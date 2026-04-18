import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useSessionMock, getMyMembershipUseQueryMock } = vi.hoisted(() => ({
  useSessionMock: vi.fn(),
  getMyMembershipUseQueryMock: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: useSessionMock,
  },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    organization: {
      getMyMembership: {
        useQuery: getMyMembershipUseQueryMock,
      },
    },
  },
}));

import { usePermissions } from "./usePermissions";

describe("usePermissions", () => {
  beforeEach(() => {
    useSessionMock.mockReset();
    getMyMembershipUseQueryMock.mockReset();

    useSessionMock.mockReturnValue({
      data: {
        user: {
          role: "user",
        },
      },
    });
    getMyMembershipUseQueryMock.mockReturnValue({
      data: {
        organizationRole: "member",
      },
    });
  });

  it("keeps client editors project-scoped while allowing AI features", () => {
    getMyMembershipUseQueryMock.mockReturnValueOnce({
      data: {
        organizationRole: "client_editor",
      },
    });

    const { result } = renderHook(() => usePermissions());

    expect(result.current.isClientEditor).toBe(true);
    expect(result.current.canUseAgent).toBe(true);
    expect(result.current.canUseAiImages).toBe(true);
    expect(result.current.canManageProjects).toBe(false);
    expect(result.current.canManageUsers).toBe(false);
  });

  it("does not treat ordinary members as project admins", () => {
    const { result } = renderHook(() => usePermissions());

    expect(result.current.organizationRole).toBe("member");
    expect(result.current.isAdmin).toBe(false);
    expect(result.current.canManageProjects).toBe(false);
    expect(result.current.canManageUsers).toBe(false);
  });
});
