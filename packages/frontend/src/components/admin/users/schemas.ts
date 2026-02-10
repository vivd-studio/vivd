import * as z from "zod";

export const addUserSchema = z
  .object({
    name: z.string().min(2, "Name must be at least 2 characters"),
    email: z.string().email("Invalid email address"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    role: z.enum(["user", "super_admin"]),
  });

export type AddUserFormValues = z.infer<typeof addUserSchema>;

export const updateUserSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  role: z.enum(["super_admin", "user"]),
  newPassword: z
    .string()
    .transform((val) => {
      const trimmed = val?.trim();
      return trimmed?.length ? trimmed : undefined;
    })
    .refine((val) => !val || val.length >= 8, {
      message: "Password must be at least 8 characters",
    })
    .optional(),
});

export type UpdateUserFormValues = z.infer<typeof updateUserSchema>;
