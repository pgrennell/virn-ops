// packages/database/drizzle/schema/integrations.ts
//
// Cross-product integration surfaces (Phase 11a step 3, D-025 + D-035 + D-037).
// Distinct from the unused legacy `webhook` table in collab.ts -- that one
// scaffolded a generic per-org outbound subscription pattern that was never
// wired. The integrations module is specifically for **cross-product**
// integration: sibling Virn products (PM in v1, future mobile / partner
// integrations) registering with Ops to receive lifecycle events.
//
// What lives here as it lands:
//   - outbound_webhook_credential (this commit): registered consumer +
//     HMAC-signing secret + return-URL allowlist for D-037 link-out flow.
//   - cross_product_event_outbox (Phase 11a step 3c): the transactional outbox
//     the delivery worker drains.
//   - cross_product_event_delivery_attempt (Phase 11a step 3c, if needed): per-
//     attempt forensic trail for diagnosing webhook failures.

import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { id, orgId, softDelete, timestamps, user } from "./_shared";

// One row per consumer-product per org. The HMAC signing secret is stored
// encrypted at rest (AES-256-GCM) -- see
// queries/outbound-webhook-credential-crypto.ts. The delivery worker decrypts
// on every emit to compute the HMAC; the plaintext never leaves Ops's server
// after the one-time-reveal at create/rotate time.
//
// `allowedReturnUrlPrefixes` is consumed by the D-037 link-out flow on the
// guest run view: a `?returnUrl=` query param on /run-guest is honored only if
// it prefix-matches one of these entries. Empty array means no returnUrl
// honored -- safe default.
export const outboundWebhookCredential = pgTable(
  "outbound_webhook_credential",
  {
    id: id(),
    organizationId: orgId(),
    // `virn-pm` in v1. Free text so future cross-product callers (mobile app,
    // partner integrations) register without a schema migration. Combined with
    // `organization_id` in the partial unique index below -- one active
    // credential per consumer per org.
    consumerProduct: text("consumer_product").notNull(),
    endpointUrl: text("endpoint_url").notNull(),
    // AES-256-GCM ciphertext format: `aes-256-gcm$<ivHex>$<authTagHex>$<ctHex>`.
    // The algo prefix is for forward-compatibility (a future rotation to a
    // different scheme can identify ciphertexts written under the old key).
    signingSecretEncrypted: text("signing_secret_encrypted").notNull(),
    // Last 4 chars of the plaintext for UI display. Mirrors
    // agent.credentialLastFour -- convenience only, not a secret. Stored
    // separately from the ciphertext so a UI list view doesn't have to decrypt
    // every row just to render "...a3f9".
    signingSecretLastFour: text("signing_secret_last_four"),
    // D-037 link-out + return convention. Validated as prefix-matches against
    // `?returnUrl=` on the guest run view. Empty array = no returnUrl accepted.
    allowedReturnUrlPrefixes: text("allowed_return_url_prefixes")
      .array()
      .notNull()
      .default(sql`'{}'`),
    isActive: boolean("is_active").notNull().default(true),
    // Stamped on creation and on every secret rotation so the UI can show
    // "secret last rotated 4d ago" and ops can audit when a credential turned
    // over. Distinct from `updatedAt` (which moves on any column update).
    secretRotatedAt: timestamp("secret_rotated_at").notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    ...softDelete,
    ...timestamps,
  },
  (t) => [
    index("idx_outbound_webhook_credential_org").on(t.organizationId),
    // One active credential per (org, consumer_product). Partial index excludes
    // soft-deleted rows so re-registration after a delete works cleanly.
    // Re-registering while a credential is still live raises a unique-violation
    // that the procedure layer translates to CONFLICT.
    uniqueIndex("uq_outbound_webhook_credential_org_consumer")
      .on(t.organizationId, t.consumerProduct)
      .where(sql`${t.deletedAt} is null`),
  ],
);
