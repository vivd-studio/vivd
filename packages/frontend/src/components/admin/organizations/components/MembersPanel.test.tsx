import { useState } from "react";
import type { ComponentProps } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MembersPanel } from "./MembersPanel";
import type {
  MemberEdits,
  OrganizationInvitation,
  OrganizationMember,
  OrganizationProject,
  OrganizationUserLookup,
  UserForm,
} from "../types";

type OverrideProps = Partial<ComponentProps<typeof MembersPanel>>;

const baseUserForm: UserForm = {
  email: "",
  name: "",
  password: "",
  organizationRole: "admin",
  projectSlug: "",
};

const baseOrg = {
  id: "org-1",
  slug: "acme",
  name: "Acme",
  status: "active",
  memberCount: 1,
} as const;

function renderPanel(overrides: OverrideProps = {}) {
  function Harness() {
    const {
      userForm: _ignoredUserForm,
      setUserForm: _ignoredSetUserForm,
      memberEdits: _ignoredMemberEdits,
      setMemberEdits: _ignoredSetMemberEdits,
      ...restOverrides
    } = overrides;
    const [userForm, setUserForm] = useState<UserForm>(
      overrides.userForm ?? baseUserForm,
    );
    const [memberEdits, setMemberEdits] = useState<MemberEdits>({});
    const props = {
      selectedOrg: baseOrg as never,
      projects: ([] as OrganizationProject[]).concat(overrides.projects ?? []),
      invitations: ([] as OrganizationInvitation[]).concat(
        overrides.invitations ?? [],
      ),
      invitationsLoading: false,
      invitationsError: null,
      existingUserLookup: (overrides.existingUserLookup ??
        null) as OrganizationUserLookup | null,
      existingUserLookupLoading: false,
      existingUserLookupError: null,
      addExistingPending: false,
      addExistingError: null,
      onAddExistingMember: vi.fn(),
      invitePending: false,
      inviteError: null,
      onInviteMember: vi.fn(),
      resendInvitationPending: false,
      cancelInvitationPending: false,
      onResendInvitation: vi.fn(),
      onCancelInvitation: vi.fn(),
      membersLoading: false,
      membersError: null,
      members: ([] as OrganizationMember[]).concat(overrides.members ?? []),
      memberEdits,
      setMemberEdits,
      updateMemberRolePending: false,
      removeMemberPending: false,
      onSaveMember: vi.fn(),
      onRemoveMember: vi.fn(),
      ...restOverrides,
    };

    return (
      <MembersPanel
        {...(props as ComponentProps<typeof MembersPanel>)}
        userForm={userForm}
        setUserForm={setUserForm}
        memberEdits={memberEdits}
        setMemberEdits={setMemberEdits}
      />
    );
  }

  return render(<Harness />);
}

describe("MembersPanel", () => {
  it("allows adding an existing account directly", async () => {
    const onAddExistingMember = vi.fn();
    renderPanel({
      userForm: {
        email: "pat@example.com",
        name: "",
        password: "",
        organizationRole: "admin",
        projectSlug: "",
      },
      existingUserLookup: {
        exists: true,
        user: {
          id: "user-1",
          email: "pat@example.com",
          name: "Pat Example",
          role: "user",
        },
      },
      onAddExistingMember,
    });

    fireEvent.click(screen.getByRole("button", { name: "Invite or add member" }));
    const addTab = screen.getByRole("tab", { name: "Add member" });
    fireEvent.mouseDown(addTab);
    fireEvent.click(addTab);

    await waitFor(() => {
      expect(screen.getByText("Existing account found")).toBeInTheDocument();
    });
    const addButton = screen.getByRole("button", { name: "Add member" });
    expect(addButton).toBeEnabled();

    fireEvent.click(addButton);
    expect(onAddExistingMember).toHaveBeenCalledTimes(1);
  });

  it("blocks direct add when the user is already a member", async () => {
    renderPanel({
      userForm: {
        email: "pat@example.com",
        name: "",
        password: "",
        organizationRole: "admin",
        projectSlug: "",
      },
      existingUserLookup: {
        exists: true,
        user: {
          id: "user-1",
          email: "pat@example.com",
          name: "Pat Example",
          role: "user",
        },
      },
      members: [
        {
          id: "member-1",
          organizationId: "org-1",
          userId: "user-1",
          role: "admin",
          createdAt: new Date().toISOString(),
          assignedProjectSlug: null,
          user: {
            id: "user-1",
            email: "pat@example.com",
            name: "Pat Example",
            role: "user",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        },
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "Invite or add member" }));
    const addTab = screen.getByRole("tab", { name: "Add member" });
    fireEvent.mouseDown(addTab);
    fireEvent.click(addTab);

    await waitFor(() => {
      expect(screen.getByText("User is already a member")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Add member" })).toBeDisabled();
  });

  it("allows creating a new member with name and password", async () => {
    const onAddExistingMember = vi.fn();
    renderPanel({
      userForm: {
        email: "new@example.com",
        name: "New Person",
        password: "password123",
        organizationRole: "admin",
        projectSlug: "",
      },
      existingUserLookup: {
        exists: false,
        user: null,
      },
      onAddExistingMember,
    });

    fireEvent.click(screen.getByRole("button", { name: "Invite or add member" }));
    const addTab = screen.getByRole("tab", { name: "Add member" });
    fireEvent.mouseDown(addTab);
    fireEvent.click(addTab);

    await waitFor(() => {
      expect(screen.getByText("No existing account found")).toBeInTheDocument();
    });

    const addButton = screen.getByRole("button", { name: "Add member" });
    expect(addButton).toBeEnabled();

    fireEvent.click(addButton);
    expect(onAddExistingMember).toHaveBeenCalledTimes(1);
  });
});
