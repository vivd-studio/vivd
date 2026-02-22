import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { OrgForm, Organization } from "../types";

type Props = {
  organizations: Organization[];
  selectedOrgId: string;
  onSelectOrg: (orgId: string) => void;
  selectedOrg: Organization | null;
  orgForm: OrgForm;
  onOrgFormChange: (next: OrgForm) => void;
  onCreateOrg: () => void;
  createOrgPending: boolean;
  createOrgError: unknown;
};

export function OrganizationsSelectorCard({
  organizations,
  selectedOrgId,
  onSelectOrg,
  selectedOrg,
  orgForm,
  onOrgFormChange,
  onCreateOrg,
  createOrgPending,
  createOrgError,
}: Props) {
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5 flex-1 max-w-sm">
          <Label>Organization</Label>
          <Select value={selectedOrgId} onValueChange={onSelectOrg}>
            <SelectTrigger>
              <SelectValue placeholder="Select an organization" />
            </SelectTrigger>
            <SelectContent>
              {organizations.map((org) => (
                <SelectItem key={org.id} value={org.id}>
                  <span className="flex items-center gap-2">
                    {org.name}
                    <span className="text-muted-foreground">({org.slug})</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selectedOrg && (
          <div className="flex items-center gap-2">
            <Badge variant={selectedOrg.status === "active" ? "default" : "destructive"}>
              {selectedOrg.status}
            </Badge>
            <span className="text-sm text-muted-foreground">
              {selectedOrg.memberCount} member{selectedOrg.memberCount === 1 ? "" : "s"}
            </span>
          </div>
        )}
      </div>

      <Collapsible open={createOpen} onOpenChange={setCreateOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1 px-2 -ml-2">
            <ChevronRight
              className={`h-4 w-4 transition-transform ${createOpen ? "rotate-90" : ""}`}
            />
            Create organization
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="rounded-lg border bg-card p-4 mt-2 space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="space-y-1.5 flex-1">
                <Label htmlFor="org-slug">Slug</Label>
                <Input
                  id="org-slug"
                  placeholder="e.g. acme"
                  value={orgForm.slug}
                  onChange={(e) =>
                    onOrgFormChange({
                      ...orgForm,
                      slug: e.target.value,
                    })
                  }
                />
              </div>
              <div className="space-y-1.5 flex-1">
                <Label htmlFor="org-name">Display name</Label>
                <Input
                  id="org-name"
                  placeholder="e.g. Acme Inc."
                  value={orgForm.name}
                  onChange={(e) =>
                    onOrgFormChange({
                      ...orgForm,
                      name: e.target.value,
                    })
                  }
                />
              </div>
              <Button
                onClick={onCreateOrg}
                disabled={createOrgPending || !orgForm.slug.trim() || !orgForm.name.trim()}
              >
                {createOrgPending ? "Creating..." : "Create"}
              </Button>
            </div>
            {Boolean(createOrgError) && (
              <div className="text-sm text-red-500">{String(createOrgError)}</div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
