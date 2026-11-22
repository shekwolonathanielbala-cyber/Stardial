import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/error.js";
import { requestIdMiddleware } from "../middleware/request-id.js";

vi.mock("../services/rpc-response-validation.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../services/rpc-response-validation.js")>();
  return {
    ...actual,
    // The generated contract count is already a native number in this test.
    decodeContractValue: vi.fn((_method: string, _schema: unknown, value: unknown) => value),
  };
});

vi.mock("../services/splits.service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/splits.service.js")>();
  return {
    ...actual,
    listProjects: vi.fn(),
    simulateReadOnlyContractCall: vi.fn(),
  };
});

import { listProjects, simulateReadOnlyContractCall } from "../services/splits.service.js";
import { splitsRouter } from "../routes/splits.js";

const RAW_PROJECT = {
  project_id: "afrobeats_001",
  title: "Afrobeats Collective Vol. 1",
  project_type: "music",
  owner: "GBJRKIYXAAFD3NZCWJXGUTNKYUQFZC2ANS6LRMBPJCE4IZSMJJMZPQBT",
  token: "CDOVDY3MZDG7PHCGVP7EP2EKQ2ENV26DZW6FKLBRN42LOGIZGXZV3WX5",
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
  internal_contract_field: "must not leak",
};

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(requestIdMiddleware);
  app.use("/splits", splitsRouter);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /splits response payload (Issue #21)", () => {
  it("returns explicit summaries instead of raw on-chain project objects", async () => {
    vi.mocked(listProjects).mockResolvedValue([RAW_PROJECT] as never);
    vi.mocked(simulateReadOnlyContractCall).mockResolvedValue(1 as never);

    const res = await request(createApp()).get("/splits?start=0&limit=10").expect(200);

    expect(res.body).toEqual({
      projects: [
        {
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
        },
      ],
      total: 1,
      nextCursor: null,
    });
    expect(res.body.projects[0]).not.toHaveProperty("collaborators");
    expect(JSON.stringify(res.body)).not.toContain("internal_contract_field");
  });
});
