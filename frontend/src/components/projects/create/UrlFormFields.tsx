import type { UseFormReturn } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { AlertTriangle } from "lucide-react";
import type { UrlFormValues } from "@/lib/form-schemas";

interface UrlFormFieldsProps {
  form: UseFormReturn<UrlFormValues>;
  /** Optional class for the URL input (e.g., "h-12" for larger inputs) */
  inputClassName?: string;
}

/**
 * Shared form fields for URL-based project creation.
 * Includes URL input and ownership disclaimer checkbox.
 */
export function UrlFormFields({ form, inputClassName }: UrlFormFieldsProps) {
  return (
    <>
      <FormField
        control={form.control}
        name="url"
        render={({ field }) => (
          <FormItem>
            <FormControl>
              <Input
                placeholder="Enter a URL (e.g., https://example.com)"
                className={inputClassName}
                {...field}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="disclaimer"
        render={({ field }) => (
          <FormItem>
            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 border border-border">
              <Checkbox
                id="disclaimer"
                checked={field.value}
                onCheckedChange={field.onChange}
                className="mt-0.5"
              />
              <label
                htmlFor="disclaimer"
                className="text-sm text-muted-foreground cursor-pointer"
              >
                <span className="flex items-center gap-1.5 text-foreground font-medium mb-1">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />I own this
                  website and its content
                </span>
                By checking this box, you confirm that you have the rights to
                use this website's content for generating a new landing page.
              </label>
            </div>
            <FormMessage />
          </FormItem>
        )}
      />

      {form.formState.errors.root && (
        <p className="text-sm font-medium text-destructive">
          {form.formState.errors.root.message}
        </p>
      )}
    </>
  );
}
