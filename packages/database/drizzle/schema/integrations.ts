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
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
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

// Lifecycle status of an outbox row (Phase 11a step 3c part 2). The delivery
// worker drives transitions; the enqueue path always inserts `pending`.
//
//   pending     -> waiting in the queue; next_attempt_at picks it up
//   delivering  -> a worker has reserved the row (claim window) and is POSTing
//   delivered   -> the consumer returned 2xx; terminal
//   failed      -> last attempt failed but retries remain; will retry at
//                  next_attempt_at after backoff
//   dead        -> attempt budget exhausted OR a permanent refusal (4xx); will
//                  not retry; visible in admin UI for manual replay
export const crossProductEventStatus = pgEnum("cross_product_event_status", [
  "pending",
  "delivering",
  "delivered",
  "failed",
  "dead",
]);

// Per-org monotonic sequence counter. One row per org; updated atomically
// inside the outbox-insert transaction via INSERT ... ON CONFLICT DO UPDATE
// RETURNING. PM uses sequenceNumber to detect missed events client-side
// (D-038 §4.2 "stable eventId + per-org monotonic sequence"). The counter is
// the integer source of truth -- nothing else should write to it.
export const crossProductEventOrgSequence = pgTable(
  "cross_product_event_org_sequence",
  {
    organizationId: text("organization_id").primaryKey(),
    lastSeq: bigint("last_seq", { mode: "number" }).notNull().default(0),
  },
);

// Transactional outbox for cross-product webhook events (Phase 11a step 3c
// part 2). Writes always happen inside the same DB transaction as the state-
// write that generated the event -- so a `run.completed` outbox row exists if
// and only if the run actually transitioned to completed.
//
// `payload` is sealed at write time: the delivery worker POSTs it verbatim
// (after computing the HMAC over body + timestamp). Re-fetching from `run` at
// emit time would risk delivering a payload that diverges from the historical
// state the event represents (e.g. a later status change).
//
// Per-consumer routing: each event row targets a specific `consumer_product`
// (chosen at enqueue time). A future fan-out model (one event -> N consumers)
// would write N rows with different consumer_product values, keeping the
// per-row delivery state independent.
export const crossProductEventOutbox = pgTable(
  "cross_product_event_outbox",
  {
    // Used as the wire `eventId` PM stores for idempotency dedup. The cuid2
    // shape matches the rest of the schema; stable across delivery attempts.
    id: id(),
    organizationId: orgId(),
    sequenceNumber: bigint("sequence_number", { mode: "number" }).notNull(),
    // The catalog event type. Free text rather than a pgEnum so adding a new
    // event type in a future cross-repo agreement doesn't require an ALTER
    // TYPE + downstream type-import migration. The procedure layer validates
    // against the live v1 catalog.
    eventType: text("event_type").notNull(),
    consumerProduct: text("consumer_product").notNull(),
    // Which entity the event is about. Run-scoped events set runId; vendor-
    // scoped events (step 2) set vendorId. Exactly one is populated per row
    // (enforced at enqueue time, not by a CHECK -- forward compat with future
    // event types that target other entities).
    runId: text("run_id"),
    vendorId: text("vendor_id"),
    // Echoed from `run.callbackPm*` so the delivery worker can include them
    // in the outgoing HMAC body without re-joining to `run` at drain time.
    // Null for events where the source row had no callback set (e.g. vendor
    // upserts), or for runs launched without cross-product callbacks.
    callbackPmServiceRequestId: text("callback_pm_service_request_id"),
    callbackPmWorkOrderId: text("callback_pm_work_order_id"),
    // Sealed envelope POSTed verbatim to the consumer. Includes everything
    // from D-038 §4.3's minimum payload shape: eventId, sequenceNumber,
    // eventType, occurredAt, organizationId, optional run fields, optional
    // vendor fields, crossProductOrigin, optional callback echo.
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: crossProductEventStatus("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    // When the worker should next pick this up. NULL after terminal states
    // (delivered, dead). The drain query is `WHERE status='pending' AND
    // next_attempt_at <= now() ORDER BY next_attempt_at ASC` -- the index
    // below makes that fast.
    nextAttemptAt: timestamp("next_attempt_at"),
    lastError: text("last_error"),
    deliveredAt: timestamp("delivered_at"),
    ...timestamps,
  },
  (t) => [
    // Pending-events drain by the worker: partial index on the pending queue
    // sorted by next_attempt_at so the worker's scan ignores delivered/dead
    // rows entirely.
    index("idx_cross_product_event_outbox_drain")
      .on(t.nextAttemptAt)
      .where(sql`${t.status} = 'pending'`),
    // Forensic lookup by run -- "what events fired for this run?" used by the
    // admin UI on the run detail page.
    index("idx_cross_product_event_outbox_run").on(t.runId),
    // Per-org gap detection: PM walks events in sequence order to verify
    // nothing was missed. Composite index (org, sequence) lets that scan
    // happen without a sort.
    index("idx_cross_product_event_outbox_org_seq").on(
      t.organizationId,
      t.sequenceNumber,
    ),
    // (org, sequence_number) is unique by construction -- the counter table
    // serializes the next value inside the same tx as the outbox insert.
    // Enforcing it at the schema level catches any future bug that bypasses
    // the helper.
    unique("uq_cross_product_event_outbox_org_seq").on(
      t.organizationId,
      t.sequenceNumber,
    ),
  ],
);
