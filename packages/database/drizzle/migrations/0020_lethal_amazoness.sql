ALTER TABLE "run" ADD COLUMN "entity_type" "entity_type";--> statement-breakpoint
ALTER TABLE "run" ADD COLUMN "entity_id" text;--> statement-breakpoint
CREATE INDEX "idx_run_entity_context" ON "run" USING btree ("organization_id","entity_type","entity_id","status") WHERE "run"."entity_type" is not null;