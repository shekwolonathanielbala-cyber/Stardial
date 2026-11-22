import { z } from "zod";
import { PARTICIPANT_STATUSES, type ParticipantStatus } from "../lib/split-lifecycle.js";

/**
 * Explicit response contracts for split project reads (Issue #21).
 *
 * The project endpoints used to serialize whatever `scValToNative` produced,
 * so every on-chain field — including the full nested collaborator list on
 * list responses — reached the client by default. These schemas are the single
 * source of truth for what the API is allowed to emit; the serializers in
 * `serializers/projects.serializer.ts` strip everything else.
 */

export const ProjectCollaboratorResponseSchema = z
  .object({
    address: z.string().describe("Collaborator Stellar address"),
    alias: z.string().describe("Collaborator display name"),
    basisPoints: z.number().int().describe("Share of the split in basis points (10000 = 100%)"),
  })
  .strict();

const ParticipantStatusSchema = z.enum(
  PARTICIPANT_STATUSES as readonly [ParticipantStatus, ...ParticipantStatus[]]
);

export const ParticipantPaymentStatusResponseSchema = z
  .object({
    address: z.string(),
    alias: z.string().nullable(),
    basisPoints: z.number().int(),
    status: ParticipantStatusSchema,
    roundId: z.string().nullable(),
    lastUpdated: z.number().nullable(),
  })
  .strict();

/**
 * The fields a list view needs. Collaborators are represented by a count so a
 * page of N projects does not repeat every collaborator object N times.
 */
export const ProjectSummaryResponseSchema = z
  .object({
    projectId: z.string(),
    title: z.string(),
    projectType: z.string(),
    owner: z.string(),
    token: z.string(),
    locked: z.boolean(),
    balance: z.string().describe("Current project balance in stroops"),
    totalDistributed: z.string().describe("Total distributed in stroops"),
    distributionRound: z.number().int(),
    collaboratorCount: z.number().int().nonnegative(),
  })
  .strict();

export const ProjectDetailResponseSchema = ProjectSummaryResponseSchema.extend({
  collaborators: z.array(ProjectCollaboratorResponseSchema),
  expiresAt: z.string().nullable(),
  participantPaymentStatuses: z.array(ParticipantPaymentStatusResponseSchema).nullable(),
}).strict();

export const ProjectListResponseSchema = z
  .object({
    projects: z.array(ProjectSummaryResponseSchema),
    total: z.number().int().nonnegative(),
    nextCursor: z.string().nullable(),
  })
  .strict();

export type ProjectSummaryResponse = z.infer<typeof ProjectSummaryResponseSchema>;
export type ProjectDetailResponse = z.infer<typeof ProjectDetailResponseSchema>;
export type ProjectCollaboratorResponse = z.infer<typeof ProjectCollaboratorResponseSchema>;
export type ParticipantPaymentStatusResponse = z.infer<
  typeof ParticipantPaymentStatusResponseSchema
>;
