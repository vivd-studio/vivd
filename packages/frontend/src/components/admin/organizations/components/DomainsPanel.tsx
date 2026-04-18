import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { LoadingSpinner } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Panel } from "@/components/ui/panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import type { Organization, OrganizationDomain } from "../types";

type DomainUsage = "tenant_host" | "publish_target";
type DomainType = "managed_subdomain" | "custom_domain";
type DomainStatus = "active" | "disabled" | "pending_verification";

type Props = {
  selectedOrg: Organization;
  domains: OrganizationDomain[];
  domainsLoading: boolean;
  domainsError: unknown;
  addDomainPending: boolean;
  setDomainStatusPending: boolean;
  setDomainUsagePending: boolean;
  startDomainVerificationPending: boolean;
  checkDomainVerificationPending: boolean;
  removeDomainPending: boolean;
  onAddDomain: (input: {
    organizationId: string;
    domain: string;
    usage: DomainUsage;
    type: DomainType;
    status: DomainStatus;
  }) => void;
  onSetDomainStatus: (input: { domainId: string; status: DomainStatus }) => void;
  onSetDomainUsage: (input: { domainId: string; usage: DomainUsage }) => void;
  onStartDomainVerification: (input: { domainId: string }) => void;
  onCheckDomainVerification: (input: { domainId: string }) => void;
  onRemoveDomain: (input: { domainId: string }) => void;
};

function formatDate(value: string | Date | null): string {
  if (!value) return "Not verified";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Not verified";
  return date.toLocaleString();
}

function isManagedTenantHost(domain: OrganizationDomain): boolean {
  return domain.type === "managed_subdomain" && domain.usage === "tenant_host";
}

export function DomainsPanel({
  selectedOrg,
  domains,
  domainsLoading,
  domainsError,
  addDomainPending,
  setDomainStatusPending,
  setDomainUsagePending,
  startDomainVerificationPending,
  checkDomainVerificationPending,
  removeDomainPending,
  onAddDomain,
  onSetDomainStatus,
  onSetDomainUsage,
  onStartDomainVerification,
  onCheckDomainVerification,
  onRemoveDomain,
}: Props) {
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newDomain, setNewDomain] = useState("");
  const [newUsage, setNewUsage] = useState<DomainUsage>("publish_target");
  const [newType, setNewType] = useState<DomainType>("custom_domain");
  const [newStatus, setNewStatus] = useState<DomainStatus>("pending_verification");

  const sortedDomains = useMemo(
    () =>
      [...domains].sort((a, b) => {
        if (a.usage === b.usage) return a.domain.localeCompare(b.domain);
        return a.usage.localeCompare(b.usage);
      }),
    [domains],
  );

  const submitAddDomain = () => {
    const trimmedDomain = newDomain.trim();
    if (!trimmedDomain) return;
    onAddDomain({
      organizationId: selectedOrg.id,
      domain: trimmedDomain,
      usage: newUsage,
      type: newType,
      status: newStatus,
    });
    setAddDialogOpen(false);
    setNewDomain("");
    setNewUsage("publish_target");
    setNewType("custom_domain");
    setNewStatus("pending_verification");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          Managed tenant hosts and publish-target allowlist for <strong>{selectedOrg.name}</strong>.
        </div>
        <Button onClick={() => setAddDialogOpen(true)} size="sm" className="gap-1.5">
          <Plus className="size-4" />
          Add domain
        </Button>
      </div>

      {domainsLoading && (
        <LoadingSpinner message="Loading domains..." className="justify-start" />
      )}
      {Boolean(domainsError) && (
        <div className="text-sm text-destructive">
          Failed to load domains: {String(domainsError)}
        </div>
      )}

      {!domainsLoading && !domainsError && (
        <Panel className="overflow-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-surface-sunken text-muted-foreground">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">Domain</th>
                <th className="px-3 py-2 font-medium">Usage</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Verification</th>
                <th className="px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedDomains.map((row) => {
                const managedHost = isManagedTenantHost(row);
                const removeDisabled = managedHost && row.status === "active";
                const nextStatus: DomainStatus = row.status === "active" ? "disabled" : "active";

                return (
                  <tr key={row.id} className="border-t align-top">
                    <td className="px-3 py-2">
                      <div className="font-mono text-xs">{row.domain}</div>
                      {managedHost && (
                        <div className="text-[11px] text-muted-foreground mt-1">
                          Managed tenant host (read-only usage)
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={row.usage === "tenant_host" ? "secondary" : "outline"}>
                        {row.usage}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={row.type === "managed_subdomain" ? "secondary" : "outline"}>
                        {row.type}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      <StatusPill
                        tone={
                          row.status === "active"
                            ? "success"
                            : row.status === "pending_verification"
                              ? "warn"
                              : "neutral"
                        }
                        dot
                      >
                        {row.status}
                      </StatusPill>
                    </td>
                    <td className="px-3 py-2">
                      <div>{formatDate(row.verifiedAt)}</div>
                      {row.verificationToken && (
                        <code className="text-[11px] text-muted-foreground break-all">
                          {row.verificationToken}
                        </code>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={setDomainStatusPending}
                          onClick={() =>
                            onSetDomainStatus({
                              domainId: row.id,
                              status: nextStatus,
                            })
                          }
                        >
                          {row.status === "active" ? "Disable" : "Enable"}
                        </Button>

                        <Select
                          value={row.usage}
                          onValueChange={(value) =>
                            onSetDomainUsage({
                              domainId: row.id,
                              usage: value as DomainUsage,
                            })
                          }
                          disabled={managedHost || setDomainUsagePending}
                        >
                          <SelectTrigger className="h-8 w-[160px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="tenant_host">tenant_host</SelectItem>
                            <SelectItem value="publish_target">publish_target</SelectItem>
                          </SelectContent>
                        </Select>

                        {row.type === "custom_domain" && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={startDomainVerificationPending}
                              onClick={() => onStartDomainVerification({ domainId: row.id })}
                            >
                              Start verification
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={checkDomainVerificationPending}
                              onClick={() => onCheckDomainVerification({ domainId: row.id })}
                            >
                              Check verification
                            </Button>
                          </>
                        )}

                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={removeDomainPending || removeDisabled}
                          onClick={() => onRemoveDomain({ domainId: row.id })}
                        >
                          Remove
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {sortedDomains.length === 0 && (
                <tr>
                  <td className="px-3 py-4 text-muted-foreground" colSpan={6}>
                    No domains configured yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Panel>
      )}

      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add organization domain</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <Field>
              <FieldLabel htmlFor="new-domain" required>
                Domain
              </FieldLabel>
              <Input
                id="new-domain"
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
                placeholder="example.com"
              />
            </Field>
            <Field>
              <FieldLabel>Usage</FieldLabel>
              <Select
                value={newUsage}
                onValueChange={(value) => setNewUsage(value as DomainUsage)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="publish_target">publish_target</SelectItem>
                  <SelectItem value="tenant_host">tenant_host</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>Type</FieldLabel>
              <Select
                value={newType}
                onValueChange={(value) => setNewType(value as DomainType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="custom_domain">custom_domain</SelectItem>
                  <SelectItem value="managed_subdomain">managed_subdomain</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>Status</FieldLabel>
              <Select
                value={newStatus}
                onValueChange={(value) => setNewStatus(value as DomainStatus)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending_verification">pending_verification</SelectItem>
                  <SelectItem value="active">active</SelectItem>
                  <SelectItem value="disabled">disabled</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitAddDomain} disabled={addDomainPending || !newDomain.trim()}>
              {addDomainPending ? "Adding..." : "Add domain"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
