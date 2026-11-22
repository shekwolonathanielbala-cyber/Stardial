import { PARTICIPANT_STATUSES, type ParticipantStatus } from "../lib/split-lifecycle.js";
import type {
  ParticipantPaymentStatusResponse,
  ProjectCollaboratorResponse,
  ProjectDetailResponse,
  ProjectSummaryResponse,
} from "../schemas/project.schemas.js";

/**
 * Response serializers for split project reads (Issue #21).
 *
 * Contract reads decode into whatever shape the contract uses (`project_id`,
 * `total_distributed`, `basis_points`, BigInt amounts, …). Returning that
 * object directly makes the wire format an accident of the contract, and it
 * grows silently whenever the contract gains a field. These functions map the
 * decoded value onto the explicit response contracts and drop the rest.
 */

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function firstPresent(record: UnknownRecord, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }
  return undefined;
}

function toText(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  return fallback;
}

function toInteger(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return fallback;
}

function toBoolean(value: unknown): boolean {
  return value === true;
}

function collaboratorsOf(record: UnknownRecord): UnknownRecord[] {
  const collaborators = firstPresent(record, ["collaborators"]);
  return Array.isArray(collaborators)
    ? collaborators.map((collaborator) => asRecord(collaborator))
    : [];
}

function serializeCollaborator(collaborator: UnknownRecord): ProjectCollaboratorResponse {
  return {
    address: toText(collaborator.address),
    alias: toText(collaborator.alias),
    basisPoints: toInteger(firstPresent(collaborator, ["basisPoints", "basis_points"])),
  };
}

function serializeParticipantStatus(value: unknown): ParticipantPaymentStatusResponse | null {
  const status = asRecord(value);
  const state = status.status;
  if (typeof state !== "string" || !PARTICIPANT_STATUSES.includes(state as ParticipantStatus)) {
    return null;
  }

  const lastUpdated = status.lastUpdated;
  return {
    address: toText(status.address),
    alias: typeof status.alias === "string" ? status.alias : null,
    basisPoints: toInteger(firstPresent(status, ["basisPoints", "basis_points"])),
    status: state as ParticipantStatus,
    roundId: typeof status.roundId === "string" ? status.roundId : null,
    lastUpdated:
      typeof lastUpdated === "number" && Number.isFinite(lastUpdated) ? lastUpdated : null,
  };
}

/** List-view projection: no nested collaborator objects. */
export function serializeProjectSummary(project: unknown): ProjectSummaryResponse {
  const record = asRecord(project);
  const collaborators = collaboratorsOf(record);

  return {
    projectId: toText(firstPresent(record, ["projectId", "project_id"])),
    title: toText(record.title),
    projectType: toText(firstPresent(record, ["projectType", "project_type"])),
    owner: toText(record.owner),
    token: toText(record.token),
    locked: toBoolean(record.locked),
    balance: toText(record.balance, "0"),
    totalDistributed: toText(firstPresent(record, ["totalDistributed", "total_distributed"]), "0"),
    distributionRound: toInteger(firstPresent(record, ["distributionRound", "distribution_round"])),
    collaboratorCount: toInteger(record.collaboratorCount, collaborators.length),
  };
}

/** Detail-view projection: summary plus the fields only a single project needs. */
export function serializeProjectDetail(project: unknown): ProjectDetailResponse {
  const record = asRecord(project);
  const statuses = record.participantPaymentStatuses;
  const participantPaymentStatuses = Array.isArray(statuses)
    ? statuses
        .map(serializeParticipantStatus)
        .filter((status): status is ParticipantPaymentStatusResponse => status !== null)
    : null;

  return {
    ...serializeProjectSummary(record),
    collaborators: collaboratorsOf(record).map(serializeCollaborator),
    expiresAt: typeof record.expiresAt === "string" ? record.expiresAt : null,
    participantPaymentStatuses,
  };
}
