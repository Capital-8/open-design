import { z } from "zod";

export const profileSchema = z.object({
  id: z.string().min(1),
  authUserId: z.string().min(1),
  email: z.string().email(),
  name: z.string().nullable(),
  image: z.string().nullable().optional(),
  status: z.enum(["active", "banned", "deleting", "deleted"]),
});
export const createdSchema = z.object({
  deviceId: z.string().min(1),
  deviceSecret: z.string().min(1),
  activationUrl: z.string().url(),
  userCode: z.string().min(1),
  expiresAt: z.string().datetime(),
  pollIntervalSeconds: z.number().int().min(1).max(30),
});
export const tokenSchema = z.object({
  status: z.enum(["pending", "approved", "cancelled", "expired", "consumed"]),
  controlKey: z.string().min(1).nullable().optional(),
});

export type AmrProfile = z.infer<typeof profileSchema>;
export type DeviceAuthorization = z.infer<typeof createdSchema>;
export type DeviceToken = z.infer<typeof tokenSchema>;
