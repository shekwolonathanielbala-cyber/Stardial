import { NextFunction, Request, Response, Router } from "express";
import { AppError, ErrorCode, ErrorType } from "../lib/errors.js";
import {
  extractWebhookDeliveryId,
  getWebhookSigningSecret,
  normalizeProvider,
  processWebhookDelivery,
  verifyWebhookSignature,
} from "../services/webhooks.service.js";
import { webhookPayloadSchema } from "../schemas/webhook.schemas.js";

export const webhooksRouter = Router();

function unauthorized(message: string): AppError {
  const error = new AppError(ErrorType.AUTH, ErrorCode.UNAUTHORIZED, message);
  (error as AppError & { statusCode?: number }).statusCode = 401;
  return error;
}

webhooksRouter.post("/:provider", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawProvider = Array.isArray(req.params.provider)
      ? req.params.provider[0]
      : req.params.provider;
    const provider = normalizeProvider(rawProvider);
    if (!provider || provider.length > 64) {
      throw new AppError(
        ErrorType.VALIDATION,
        ErrorCode.VALIDATION_ERROR,
        "Webhook provider is invalid."
      );
    }

    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    if (!rawBody) {
      throw unauthorized("Webhook signature could not be verified.");
    }

    const secret = getWebhookSigningSecret(provider);
    if (!secret) {
      throw unauthorized("Webhook signing is not configured.");
    }

    const signature =
      req.header("x-webhook-signature") ??
      req.header("x-signature") ??
      req.header("x-hub-signature-256");
    if (!verifyWebhookSignature(rawBody, signature, secret)) {
      throw unauthorized("Webhook signature is invalid.");
    }

    // Validate the JSON contract only after the signature check, so an
    // unauthenticated caller cannot probe payload validation. Unknown
    // provider-specific fields pass through; consumed fields and nesting are
    // type-checked before deduplication or processor execution.
    const payload = webhookPayloadSchema.parse(req.body);

    const deliveryId = extractWebhookDeliveryId(req, payload);
    if (!deliveryId) {
      throw new AppError(
        ErrorType.VALIDATION,
        ErrorCode.VALIDATION_ERROR,
        "Webhook delivery ID is missing."
      );
    }

    const result = await processWebhookDelivery(provider, deliveryId, payload, rawBody);
    return res.status(200).json({
      received: true,
      duplicate: result.outcome === "duplicate",
    });
  } catch (error) {
    return next(error);
  }
});
