import { useEffect, useState } from "react";
import { toast } from "sonner";
import { LoadingSpinner } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { FormContent } from "@/components/settings/SettingsPageShell";

export function OrgSettings() {
  const utils = trpc.useUtils();
  const { data: orgData, isLoading } = trpc.organization.getMyOrganization.useQuery();
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
      toast.error("Failed to rename organization", { description: err.message });
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
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div>
          <div className="text-sm font-medium">Organization name</div>
          <p className="text-xs text-muted-foreground mt-0.5">
            The display name for this organization.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Input
              placeholder={org.slug}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <Button
            onClick={() => rename.mutate({ name: name.trim() })}
            disabled={rename.isPending || !name.trim() || name.trim() === org.name}
          >
            {rename.isPending ? "Saving..." : "Save name"}
          </Button>
        </div>
      </div>
    </FormContent>
  );
}
