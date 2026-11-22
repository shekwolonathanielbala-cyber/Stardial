import { describe, expect, it } from "vitest";
import {
  ProjectDetailResponseSchema,
  ProjectListResponseSchema,
} from "../schemas/project.schemas.js";
import { serializeProjectDetail, serializeProjectSummary } from "./projects.serializer.js";

const RAW_PROJECT = {
  project_id: "afrobeats_001",
  title: "Afrobeats Collective Vol. 1",
  project_type: "music",
  token: "CDOVDY3MZDG7PHCGVP7EP2EKQ2ENV26DZW6FKLBRN42LOGIZGXZV3WX5",
  owner: "GBJRKIYXAAFD3NZCWJXGUTNKYUQFZC2ANS6LRMBPJCE4IZSMJJMZPQBT",
  collaborators: [
    {
      address: "GCZTK3PNYXCVF7Z3ELVELEJZ7BVGPGPVJ3NVZNI7O6DVCHPA4JU6LXRV",
      alias: "Producer",
      basis_points: 6000,
    },
    {
      address: "GBG234UA6RBPDD5K6FHMQXHUXB5ALOENQGH24Y3W4ERX2YJNQ4MK4V25",
      alias: "Vocalist",
      basis_points: 4000,
    },
  ],
  locked: false,
  total_distributed: 12_345n,
  distribution_round: 2,
  contract_internal_note: "must not be exposed",
};

describe("project response serializers (Issue #21)", () => {
  it("projects list summaries omit nested collaborators and unknown contract fields", () => {
    const summary = serializeProjectSummary(RAW_PROJECT);

    expect(summary).toEqual({
      projectId: "afrobeats_001",
      title: "Afrobeats Collective Vol. 1",
      projectType: "music",
      owner: "GBJRKIYXAAFD3NZCWJXGUTNKYUQFZC2ANS6LRMBPJCE4IZSMJJMZPQBT",
      token: "CDOVDY3MZDG7PHCGVP7EP2EKQ2ENV26DZW6FKLBRN42LOGIZGXZV3WX5",
      locked: false,
      balance: "0",
      totalDistributed: "12345",
      distributionRound: 2,
      collaboratorCount: 2,
    });
    expect(summary).not.toHaveProperty("collaborators");
    expect(summary).not.toHaveProperty("contract_internal_note");
    expect(
      ProjectListResponseSchema.safeParse({
        projects: [summary],
        total: 1,
        nextCursor: null,
      }).success
    ).toBe(true);
  });

  it("project detail keeps collaborators but still drops undeclared fields", () => {
    const detail = serializeProjectDetail({
      ...RAW_PROJECT,
      balance: 900n,
      expiresAt: "2027-01-01T00:00:00.000Z",
      participantPaymentStatuses: [
        {
          address: "GCZTK3PNYXCVF7Z3ELVELEJZ7BVGPGPVJ3NVZNI7O6DVCHPA4JU6LXRV",
          alias: "Producer",
          basisPoints: 6000,
          status: "paid",
          roundId: "round-1",
          lastUpdated: 1_732_012_800,
          internalFlag: true,
        },
        { address: "broken", status: "not-a-real-status" },
      ],
    });

    expect(detail.collaborators).toEqual([
      {
        address: "GCZTK3PNYXCVF7Z3ELVELEJZ7BVGPGPVJ3NVZNI7O6DVCHPA4JU6LXRV",
        alias: "Producer",
        basisPoints: 6000,
      },
      {
        address: "GBG234UA6RBPDD5K6FHMQXHUXB5ALOENQGH24Y3W4ERX2YJNQ4MK4V25",
        alias: "Vocalist",
        basisPoints: 4000,
      },
    ]);
    expect(detail.balance).toBe("900");
    expect(detail.expiresAt).toBe("2027-01-01T00:00:00.000Z");
    expect(detail.participantPaymentStatuses).toEqual([
      {
        address: "GCZTK3PNYXCVF7Z3ELVELEJZ7BVGPGPVJ3NVZNI7O6DVCHPA4JU6LXRV",
        alias: "Producer",
        basisPoints: 6000,
        status: "paid",
        roundId: "round-1",
        lastUpdated: 1_732_012_800,
      },
    ]);
    expect(detail).not.toHaveProperty("contract_internal_note");
    expect(ProjectDetailResponseSchema.safeParse(detail).success).toBe(true);
  });

  it("accepts camelCase records so cached and in-process values use one contract", () => {
    const detail = serializeProjectDetail({
      projectId: "camel_project",
      title: "Camel",
      projectType: "film",
      owner: "GOWNER",
      token: "GTOKEN",
      locked: true,
      balance: "0",
      totalDistributed: "10",
      distributionRound: 1,
      collaboratorCount: 1,
      collaborators: [{ address: "GCOLLAB", alias: "A", basisPoints: 10_000 }],
      expiresAt: null,
      participantPaymentStatuses: null,
    });

    expect(detail.projectId).toBe("camel_project");
    expect(detail.collaborators).toEqual([{ address: "GCOLLAB", alias: "A", basisPoints: 10_000 }]);
    expect(detail.participantPaymentStatuses).toBeNull();
  });
});
