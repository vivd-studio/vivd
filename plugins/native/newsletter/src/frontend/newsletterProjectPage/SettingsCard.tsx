import { Loader2 } from "lucide-react";
import {
  Button,
  Field,
  FieldDescription,
  FieldLabel,
  Panel,
  PanelContent,
  PanelFooter,
  PanelHeader,
  PanelTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@vivd/ui";

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
    <Panel>
      <PanelHeader>
        <PanelTitle>Settings</PanelTitle>
      </PanelHeader>
      <PanelContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <Field>
            <FieldLabel>Mode</FieldLabel>
            <Select
              value={mode}
              onValueChange={(value) =>
                onModeChange(value as "newsletter" | "waitlist")
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newsletter">Newsletter</SelectItem>
                <SelectItem value="waitlist">Waitlist</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel>Collect name</FieldLabel>
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
          </Field>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field>
            <FieldLabel>Source hosts</FieldLabel>
            <Textarea
              value={sourceHostsInput}
              onChange={(event) => onSourceHostsChange(event.target.value)}
              placeholder="example.com"
              rows={4}
            />
            <FieldDescription>
              Comma- or newline-separated allowlist. Leave empty to use inferred
              project hosts.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel>Redirect allowlist</FieldLabel>
            <Textarea
              value={redirectHostsInput}
              onChange={(event) => onRedirectHostsChange(event.target.value)}
              placeholder="example.com"
              rows={4}
            />
            <FieldDescription>
              Allowed hosts for `_redirect` and confirmation page redirects.
            </FieldDescription>
          </Field>
        </div>
      </PanelContent>
      <PanelFooter className="justify-start">
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
      </PanelFooter>
    </Panel>
  );
}
