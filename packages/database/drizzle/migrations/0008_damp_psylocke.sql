CREATE TYPE "public"."review_state" AS ENUM('draft', 'in_review', 'published', 'archived');--> statement-breakpoint
CREATE TABLE "entity_set" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"entity_type" "entity_type" NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_entity_set_org_type_name" UNIQUE("organization_id","entity_type","name")
);
--> statement-breakpoint
CREATE TABLE "entity_set_member" (
	"entity_set_id" text NOT NULL,
	"entity_type" "entity_type" NOT NULL,
	"entity_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "entity_set_member_entity_set_id_entity_type_entity_id_pk" PRIMARY KEY("entity_set_id","entity_type","entity_id")
);
--> statement-breakpoint
ALTER TABLE "workflow" ADD COLUMN "entity_set_ids" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow" ADD COLUMN "review_state" "review_state" DEFAULT 'draft' NOT NULL;--> statement-breakpoint
-- Backfill (per PRD §8.1): workflows that already have at least one published version
-- are at editorial-state 'published'; the column default 'draft' covers everything else.
-- New columns are safe to update in-place even if the table is hot -- review_state isn't
-- read by any v1.5-pre code path, so this is a soft change.
UPDATE "workflow" SET "review_state" = 'published'
WHERE EXISTS (
  SELECT 1 FROM "workflow_version"
  WHERE "workflow_version"."workflow_id" = "workflow"."id"
    AND "workflow_version"."status" = 'published'
);--> statement-breakpoint
ALTER TABLE "entity_set" ADD CONSTRAINT "entity_set_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_set_member" ADD CONSTRAINT "entity_set_member_entity_set_id_entity_set_id_fk" FOREIGN KEY ("entity_set_id") REFERENCES "public"."entity_set"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_entity_set_org" ON "entity_set" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_entity_set_org_type" ON "entity_set" USING btree ("organization_id","entity_type");--> statement-breakpoint
CREATE INDEX "idx_entity_set_member_entity" ON "entity_set_member" USING btree ("entity_type","entity_id");