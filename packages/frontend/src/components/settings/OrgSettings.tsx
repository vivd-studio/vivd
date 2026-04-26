import { useEffect, useState } from "react";
import { toast } from "sonner";
import { LoadingSpinner } from "@/components/common";
import {
  Button,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  Panel,
  PanelContent,
  PanelDescription,
  PanelHeader,
  PanelTitle,
} from "@vivd/ui";

import { trpc } from "@/lib/trpc";
import { FormContent } from "@/components/settings/SettingsPageShell";

export function OrgSettings() {
  const utils = trpc.useUtils();
  const { data: orgData, isLoading } =
    trpc.organization.getMyOrganization.useQuery();
  const org = orgData?.organization ?? null;

  const [name, setName] = useState("");

  useEffect(() => {
    setName(org?.name ?? "");
  }, [org?.name]);

  const rename = trpc.organization.updateOrganizationName.useMutation({
    onSuccess: async () => {
      await utils.organization.getMyOrganization.invalidate();
      await utils.organization.listMyOrganizations.invalidate();
      toast.success("Organization name updated");
    },
    onError: (err) => {
      toast.error("Failed to rename organization", {
        description: err.message,
      });
    },
  });

  if (isLoading) {
    return <LoadingSpinner message="Loading..." />;
  }

  if (!org) {
    return <div className="text-muted-foreground">Organization not found.</div>;
  }

  return (
    <FormContent>
      <Panel>
        <PanelHeader>
          <PanelTitle>Organization name</PanelTitle>
          <PanelDescription>
            Update the display name used across this organization workspace.
          </PanelDescription>
        </PanelHeader>
        <PanelContent>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <Field className="flex-1">
              <FieldLabel htmlFor="organization-name">Display name</FieldLabel>
              <Input
                id="organization-name"
                placeholder={org.slug}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <FieldDescription>
                Defaults to the slug until you set a clearer label here.
              </FieldDescription>
            </Field>
            <Button
              onClick={() => rename.mutate({ name: name.trim() })}
              disabled={
                rename.isPending || !name.trim() || name.trim() === org.name
              }
            >
              {rename.isPending ? "Saving..." : "Save name"}
            </Button>
          </div>
        </PanelContent>
      </Panel>
    </FormContent>
  );
}
