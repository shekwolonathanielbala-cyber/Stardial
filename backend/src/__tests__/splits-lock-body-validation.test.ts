import { describe, expect, it } from "vitest";
import request from "supertest";

import { app } from "../index.js";
import { OWNER } from "./request-body-validation.test.js";

const LOCK_PROJECT_INVALID_BODIES: Array<{ badBody: unknown; extra?: Record<string, unknown>; description: string }> = [
  {
    badBody: { owner: "not-a-valid-stellar-address" },
    description: "malformed owner address",
  },
  {
    badBody: { owner: "" },
    description: "empty owner",
  },
  {
    badBody: {},
    description: "missing owner",
  },
  {
    badBody: { owner: OWNER },
    extra: { actor: OWNER },
    description: "extra unknown field",
  },
];

describe("POST /splits/{projectId}/lock", () => {
  it.each(LOCK_PROJECT_INVALID_BODIES)("rejects $description", async ({ badBody, extra }) => {
    const json = extra ? { ...badBody, ...extra } : badBody;

    const response = await request(app)
      .post("/splits/valid-project-id/lock")
      .send(json)
      .expect(400);

    expect(response.body).toMatchObject({
      error: "validation_error",
      code: "VALIDATION_ERROR",
    });
  });

  it("rejects non-object bodies", async () => {
    await Promise.all([
      request(app)
        .post("/splits/valid-project-id/lock")
        .set("Content-Type", "application/json")
        .send([{ owner: OWNER }])
        .expect(400)
        .then((response) =>
          expect(response.body).toMatchObject({
            error: "validation_error",
            code: "VALIDATION_ERROR",
          })
        ),
      request(app)
        .post("/splits/valid-project-id/lock")
        .set("Content-Type", "application/json")
        .send(OWNER)
        .expect(400)
        .then((response) =>
          expect(response.body).toMatchObject({
            error: "validation_error",
            code: "VALIDATION_ERROR",
          })
        ),
    ]);
  });
});
