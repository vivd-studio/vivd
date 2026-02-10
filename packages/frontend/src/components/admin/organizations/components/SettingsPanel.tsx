import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { Organization } from "../types";

type Props = {
  selectedOrg: Organization;
  githubPrefixForm: string;
  setGithubPrefixForm: (next: string) => void;
  savePending: boolean;
  onSave: () => void;
};

export function SettingsPanel({
  selectedOrg,
  githubPrefixForm,
  setGithubPrefixForm,
  savePending,
  onSave,
}: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Settings</CardTitle>
        <CardDescription>
          Configuration for <strong>{selectedOrg.name}</strong>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          <div>
            <div className="text-sm font-medium">GitHub repository prefix</div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Prefix for auto-created repository names. A trailing "-" is added automatically if missing.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 max-w-sm">
              <Input
                placeholder={selectedOrg.slug}
                value={githubPrefixForm}
                onChange={(e) => setGithubPrefixForm(e.target.value)}
              />
            </div>
            <Button
              onClick={onSave}
              disabled={savePending || githubPrefixForm.trim() === selectedOrg.githubRepoPrefix}
            >
              {savePending ? "Saving..." : "Save prefix"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
