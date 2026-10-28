import { z } from "zod";
const money = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/)
  .max(100);
const date = z.string().datetime();
const identity = {
  workspaceId: z.string().min(1),
  workspaceMemberId: z.string().min(1),
};
const wallet = z.object({
  balanceUsd: money,
  expiresAt: date.nullable(),
  updatedAt: date.nullable(),
});
export const balanceSchema = wallet.extend({
  ...identity,
  billingScopeVersion: z.literal(2),
});
const clock = z.object({
  epoch: z.string().min(1),
  counter: z.string().regex(/^\d+$/),
});
export const snapshotSchema = z.object({
  schemaVersion: z.literal(1),
  ...identity,
  billingScopeVersion: z.literal(2),
  billing: z.object({
    billingState: z.string().nullable(),
    planId: z.string().nullable(),
  }),
  wallet,
  revisions: z.object({ billing: z.string(), wallet: z.string() }),
  revisionClocks: z.object({ billing: clock, wallet: clock }),
});
export const preflightSchema = z.object({
  schemaVersion: z.literal(1),
  ...identity,
  modelId: z.string().nullable(),
  generatedAt: date,
  balanceUsd: money,
  funding: z.enum(["wallet", "coding_plan", "gateway"]),
  modelCovered: z.boolean().nullable(),
  codingPlan: z.object({
    workspaceId: z.string(),
    generatedAt: date,
    eligible: z.boolean(),
    tier: z.enum(["go", "plus", "pro", "max"]).nullable(),
    windows: z.array(
      z.object({
        policyId: z.string().min(1),
        durationSeconds: z.number().int().positive(),
        resetMode: z.enum(["activity_triggered", "anchored_recurring"]),
        usedCredits: z.string().regex(/^\d+$/),
        limitCredits: z.string().regex(/^[1-9]\d*$/),
        remainingCredits: z.string().regex(/^\d+$/),
        windowStart: date.nullable(),
        resetsAt: date.nullable(),
      }),
    ),
  }),
});

export const summarySchema = z
  .object({
    balanceUsd: money,
    creditsPerUsd: z.number().positive(),
    balances: z.object({
      subscriptionCredits: z.string(),
      rechargeCredits: z.string(),
      totalAvailableCredits: z.string(),
    }),
    membershipTier: z.string().nullable(),
  })
  .passthrough();
