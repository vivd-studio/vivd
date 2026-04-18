import * as React from "react";

import { cn } from "./utils";

/**
 * Field — form field shell that keeps label / control / description / error
 * spacing consistent across the app.
 *
 * Usage:
 *
 *   <Field>
 *     <FieldLabel htmlFor="slug">Slug</FieldLabel>
 *     <Input id="slug" value={slug} onChange={...} />
 *     <FieldDescription>URL-friendly identifier.</FieldDescription>
 *     <FieldError>{errors.slug?.message}</FieldError>
 *   </Field>
 *
 * Pairs any input primitive (Input, Textarea, Select, PasswordInput) with a
 * consistent label and helper/error line. Label htmlFor + control id stays
 * the caller's responsibility — no hidden wiring.
 */

const Field = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("flex flex-col gap-1.5", className)} {...props} />
));
Field.displayName = "Field";

const FieldLabel = React.forwardRef<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement> & { required?: boolean }
>(({ className, children, required, ...props }, ref) => (
  <label
    ref={ref}
    className={cn(
      "text-sm font-medium leading-none text-foreground",
      className,
    )}
    {...props}
  >
    {children}
    {required ? (
      <span aria-hidden="true" className="ml-0.5 text-destructive">
        *
      </span>
    ) : null}
  </label>
));
FieldLabel.displayName = "FieldLabel";

const FieldDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-xs leading-snug text-muted-foreground", className)}
    {...props}
  />
));
FieldDescription.displayName = "FieldDescription";

const FieldError = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, children, ...props }, ref) => {
  if (!children) return null;
  return (
    <p
      ref={ref}
      role="alert"
      className={cn("text-xs leading-snug text-destructive", className)}
      {...props}
    >
      {children}
    </p>
  );
});
FieldError.displayName = "FieldError";

export { Field, FieldLabel, FieldDescription, FieldError };
