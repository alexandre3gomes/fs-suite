import { z } from 'zod';

export const UserSchema = z.object({
  id: z.string().cuid(),
  email: z.string().email(),
  name: z.string().min(1),
  avatarUrl: z.string().url().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type User = z.infer<typeof UserSchema>;

export const UpdateUserSchema = z.object({
  name: z.string().min(1).max(100).optional(),
});

export type UpdateUserDto = z.infer<typeof UpdateUserSchema>;
