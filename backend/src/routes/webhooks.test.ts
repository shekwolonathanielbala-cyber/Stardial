import express, { type Request } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/error.js";

vi.mock("../services/webhooks.service.js", () => ({
  extractWebhookDeliveryId: vi.fn(),
  getWebhookSigningSecret: vi.fn(),
  normalizeProvider: vi.fn((provider: string) => provider.trim().toLowerCase()),
  processWebhookDelivery: vi.fn(),
  verifyWebhookSignature: vi.fn(),
}));

import {
  extractWebhookDeliveryId,
  getWebhookSigningSecret,
  processWebhookDelivery,
  verifyWebhookSignature,
} from "../services/webhooks.service.js";
import { webhooksRouter } from "./webhooks.js";

const app = express();
app.use(
  express.json({
    verify: (req, _res, body) => {
      (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(body);
    },
  })
);
app.use("/webhooks", webhooksRouter);
app.use(errorHandler);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(extractWebhookDeliveryId).mockReturnValue("delivery-1");
  vi.mocked(getWebhookSigningSecret).mockReturnValue("test-webhook-secret");
  vi.mocked(processWebhookDelivery).mockResolvedValue({
    outcome: "processed",
    claim: {
      claimed: true,
      deliveryId: "delivery-1",
      claimToken: "claim-token",
      status: "processing",
      attempts: 1,
    },
  });
  vi.mocked(verifyWebhookSignature).mockReturnValue(true);
});

describe("webhook route authentication", () => {
  it("verifies the raw body before processing a valid delivery", async () => {
    const rawBody = '{"event":"payment"}';

    await request(app)
      .post("/webhooks/provider")
      .set("x-webhook-signature", "signature")
      .set("x-webhook-id", "delivery-1")
      .set("Content-Type", "application/json")
      .send(rawBody)
      .expect(200, { received: true, duplicate: false });

    expect(verifyWebhookSignature).toHaveBeenCalledWith(
      Buffer.from(rawBody),
      "signature",
      "test-webhook-secret"
    );
    expect(processWebhookDelivery).toHaveBeenCalledOnce();
  });

  it.each([
    ["invalid", "invalid-signature"],
    ["missing", undefined],
  ])("does not process a delivery with a %s signature", async (_label, signature) => {
    vi.mocked(verifyWebhookSignature).mockReturnValue(false);

    const req = request(app).post("/webhooks/provider").set("Content-Type", "application/json");
    if (signature) req.set("x-webhook-signature", signature);
    await req.send({ event: "payment" }).expect(401);

    expect(processWebhookDelivery).not.toHaveBeenCalled();
    expect(extractWebhookDeliveryId).not.toHaveBeenCalled();
  });
});

describe("webhook request body contract (Issue #15)", () => {
  function signedRequest() {
    return request(app)
      .post("/webhooks/provider")
      .set("x-webhook-signature", "signature")
      .set("x-webhook-id", "delivery-1")
      .set("Content-Type", "application/json");
  }

  it("accepts provider-specific fields alongside the validated envelope", async () => {
    const payload = {
      event: "payment.succeeded",
      data: { amount: 500, currency: "USDC" },
      provider_specific: { nested: true },
    };

    await signedRequest().send(payload).expect(200, { received: true, duplicate: false });

    expect(processWebhookDelivery).toHaveBeenCalledWith(
      "provider",
      "delivery-1",
      expect.objectContaining({ event: "payment.succeeded" }),
      expect.any(Buffer),
    );
  });

  it.each([
    ["an array body", [{ event: "payment" }]],
    ["a wrongly-typed delivery id", { delivery_id: 123 }],
    ["a non-object data field", { event: "payment", data: "not-an-object" }],
    ["an over-long event name", { event: "x".repeat(129) }],
  ])("rejects %s before processing", async (_label, payload) => {
    const res = await signedRequest().send(payload);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
    expect(processWebhookDelivery).not.toHaveBeenCalled();
  });
});
