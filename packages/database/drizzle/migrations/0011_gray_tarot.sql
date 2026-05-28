ALTER TABLE "run_step" ADD COLUMN "due_type" "due_type" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "run_step" ADD COLUMN "due_offset_days" integer;--> statement-breakpoint
ALTER TABLE "run_step" ADD COLUMN "due_anchor_step_id" text;--> statement-breakpoint
ALTER TABLE "run_step" ADD COLUMN "due_source_field_id" text;--> statement-breakpoint
-- Backfill: copy the source step's due-rule columns into the runStep snapshot
-- so existing in-flight runs continue to recompute correctly after this
-- migration. ALTER ... ADD COLUMN with NOT NULL + DEFAULT 'none' already
-- populates due_type for existing rows; this UPDATE overwrites it with the
-- live step's value plus copies the three nullable companions. Runs whose
-- step_id has been nulled (definition step deleted) get the column default
-- (due_type='none', companions null) -- recompute is a no-op for them.
UPDATE "run_step"
   SET "due_type" = "step"."due_type",
       "due_offset_days" = "step"."due_offset_days",
       "due_anchor_step_id" = "step"."due_anchor_step_id",
       "due_source_field_id" = "step"."due_source_field_id"
  FROM "step"
 WHERE "run_step"."step_id" = "step"."id";--> statement-breakpoint
CREATE INDEX "idx_run_step_due_anchor" ON "run_step" USING btree ("due_anchor_step_id") WHERE "run_step"."due_anchor_step_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_run_step_due_source_field" ON "run_step" USING btree ("due_source_field_id") WHERE "run_step"."due_source_field_id" IS NOT NULL;
