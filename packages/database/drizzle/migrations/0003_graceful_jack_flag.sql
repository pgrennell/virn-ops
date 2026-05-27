-- Phase 8 step 1 (ADR-006 + D-022) — agent table + participant.kind discriminator +
-- actor_kind enum on audit_log / activity_event. Hand-edited from Drizzle's generated
-- output to interleave backfill steps before the NOT NULL constraints (Drizzle can't
-- infer the backfill expressions automatically).
--
-- Backfill premises:
--   - Every existing `participant` row has either user_id or guest_email non-null (the
--     dropped participant_identity CHECK enforced this); the CASE expression covers all.
--   - Every existing audit_log / activity_event row was written by user-triggered code
--     (no guest/agent writers exist yet) — 'user' is the correct backfill literal.

-- 1) Enums (must exist before referencing columns are added) -----------------------------
CREATE TYPE "public"."actor_kind" AS ENUM('user', 'guest', 'agent');--> statement-breakpoint
CREATE TYPE "public"."participant_kind" AS ENUM('user', 'guest', 'agent');--> statement-breakpoint

-- 2) New tables: agent + agent_capability -----------------------------------------------
CREATE TABLE "agent" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"credential_hash" text NOT NULL,
	"credential_last_four" text,
	"credential_rotated_at" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "uq_agent_org_name" UNIQUE("organization_id","name")
);
--> statement-breakpoint
CREATE TABLE "agent_capability" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"capability_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_agent_capability" UNIQUE("agent_id","capability_id")
);
--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_capability" ADD CONSTRAINT "agent_capability_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_capability" ADD CONSTRAINT "agent_capability_capability_id_capability_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."capability"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_agent_org" ON "agent" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_agent_org_active" ON "agent" USING btree ("organization_id","is_active");--> statement-breakpoint
CREATE INDEX "idx_agent_capability_agent" ON "agent_capability" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_agent_capability_capability" ON "agent_capability" USING btree ("capability_id");--> statement-breakpoint

-- 3) participant: drop old CHECK, add kind + agent_id with proper backfill --------------
ALTER TABLE "participant" DROP CONSTRAINT "participant_identity";--> statement-breakpoint
ALTER TABLE "participant" ADD COLUMN "kind" "participant_kind";--> statement-breakpoint
UPDATE "participant" SET "kind" = CASE WHEN "user_id" IS NOT NULL THEN 'user'::participant_kind ELSE 'guest'::participant_kind END;--> statement-breakpoint
ALTER TABLE "participant" ALTER COLUMN "kind" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "participant" ADD COLUMN "agent_id" text;--> statement-breakpoint
ALTER TABLE "participant" ADD CONSTRAINT "participant_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant" ADD CONSTRAINT "participant_identity" CHECK ((
        ("participant"."kind" = 'user' and "participant"."user_id" is not null and "participant"."guest_email" is null and "participant"."agent_id" is null) or
        ("participant"."kind" = 'guest' and "participant"."guest_email" is not null and "participant"."user_id" is null and "participant"."agent_id" is null) or
        ("participant"."kind" = 'agent' and "participant"."agent_id" is not null and "participant"."user_id" is null and "participant"."guest_email" is null)
      ));--> statement-breakpoint

-- 4) audit_log: actor_kind (with backfill) + actor_participant_id ----------------------
ALTER TABLE "audit_log" ADD COLUMN "actor_kind" "actor_kind";--> statement-breakpoint
UPDATE "audit_log" SET "actor_kind" = 'user'::actor_kind;--> statement-breakpoint
ALTER TABLE "audit_log" ALTER COLUMN "actor_kind" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "actor_participant_id" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_participant_id_participant_id_fk" FOREIGN KEY ("actor_participant_id") REFERENCES "public"."participant"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audit_log_actor_participant" ON "audit_log" USING btree ("actor_participant_id");--> statement-breakpoint

-- 5) activity_event: same pattern as audit_log -----------------------------------------
ALTER TABLE "activity_event" ADD COLUMN "actor_kind" "actor_kind";--> statement-breakpoint
UPDATE "activity_event" SET "actor_kind" = 'user'::actor_kind;--> statement-breakpoint
ALTER TABLE "activity_event" ALTER COLUMN "actor_kind" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_event" ADD COLUMN "actor_participant_id" text;--> statement-breakpoint
ALTER TABLE "activity_event" ADD CONSTRAINT "activity_event_actor_participant_id_participant_id_fk" FOREIGN KEY ("actor_participant_id") REFERENCES "public"."participant"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_activity_event_actor_participant" ON "activity_event" USING btree ("actor_participant_id");
