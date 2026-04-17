import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export function NewsletterSettingsCard(props: {
  mode: "newsletter" | "waitlist";
  collectName: boolean;
  sourceHostsInput: string;
  redirectHostsInput: string;
  isPending: boolean;
  onModeChange: (value: "newsletter" | "waitlist") => void;
  onCollectNameChange: (value: boolean) => void;
  onSourceHostsChange: (value: string) => void;
  onRedirectHostsChange: (value: string) => void;
  onSave: () => void;
}) {
  const {
    mode,
    collectName,
    sourceHostsInput,
    redirectHostsInput,
    isPending,
    onModeChange,
    onCollectNameChange,
    onSourceHostsChange,
    onRedirectHostsChange,
    onSave,
  } = props;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Mode</Label>
            <Select
              value={mode}
              onValueChange={(value) => onModeChange(value as "newsletter" | "waitlist")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newsletter">Newsletter</SelectItem>
                <SelectItem value="waitlist">Waitlist</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Collect name</Label>
            <Select
              value={collectName ? "yes" : "no"}
              onValueChange={(value) => onCollectNameChange(value === "yes")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="no">Email only</SelectItem>
                <SelectItem value="yes">Email + name</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Source hosts</Label>
            <Textarea
              value={sourceHostsInput}
              onChange={(event) => onSourceHostsChange(event.target.value)}
              placeholder="example.com"
              rows={4}
            />
            <p className="text-xs text-muted-foreground">
              Comma- or newline-separated allowlist. Leave empty to use inferred project hosts.
            </p>
          </div>
          <div className="space-y-2">
            <Label>Redirect allowlist</Label>
            <Textarea
              value={redirectHostsInput}
              onChange={(event) => onRedirectHostsChange(event.target.value)}
              placeholder="example.com"
              rows={4}
            />
            <p className="text-xs text-muted-foreground">
              Allowed hosts for `_redirect` and confirmation page redirects.
            </p>
          </div>
        </div>
        <Button onClick={onSave} disabled={isPending}>
          {isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving
            </>
          ) : (
            "Save settings"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
