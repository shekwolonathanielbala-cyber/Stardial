import { z } from "zod";

/**
 * Request body contract for inbound provider webhooks (Issue #15).
 *
 * Providers own their payload schemas, so unknown provider-specific fields are
 * intentionally allowed through. What is validated here is everything this API
 * actually consumes: the delivery-id fields used for deduplication, the
 * optional event descriptors, and the shape/type of the nested `data` and
 * `payload` objects. A non-object body, an array, or a wrongly-typed known
 * field is rejected before any processor runs or any delivery row is claimed.
 */

const DELIVERY_ID_KEYS = [
  "delivery_id",
  "deliveryId",
  "event_id",
  "eventId",
  "id",
  "messageId",
] as const;

const deliveryIdField = z.string().trim().min(1).max(256);
const eventNameField = z.string().min(1).max(128);
const nestedPayloadField = z.record(z.string(), z.unknown());

const deliveryIdShape = Object.fromEntries(
  DELIVERY_ID_KEYS.map((key) => [key, deliveryIdField.optional()]),
) as Record<(typeof DELIVERY_ID_KEYS)[number], z.ZodOptional<typeof deliveryIdField>>;

export const webhookPayloadSchema = z
  .object({
    ...deliveryIdShape,
    event: eventNameField.optional(),
    type: eventNameField.optional(),
    data: nestedPayloadField.optional(),
    payload: nestedPayloadField.optional(),
  })
  .passthrough();

export type WebhookPayload = z.infer<typeof webhookPayloadSchema>;
