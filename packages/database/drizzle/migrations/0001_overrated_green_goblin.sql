ALTER TABLE "template_listing" DROP CONSTRAINT "template_listing_publisher_organization_id_organization_id_fk";
--> statement-breakpoint
DROP INDEX "idx_schedule_next_run";--> statement-breakpoint
ALTER TABLE "audit_log" ALTER COLUMN "entity_type" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ALTER COLUMN "entity_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "field" ADD COLUMN "created_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "field" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "section" ADD COLUMN "created_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "section" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "step" ADD COLUMN "created_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "step" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "step_dependency" ADD COLUMN "created_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "step_dependency" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "run_role_assignment" ADD COLUMN "created_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "run_role_assignment" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "run_step" ADD COLUMN "created_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "run_step" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "run_step_assignee" ADD COLUMN "created_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "run_step_assignee" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "automation_action" ADD COLUMN "created_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "automation_action" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "automation_condition" ADD COLUMN "created_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "automation_condition" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "template_listing" ADD CONSTRAINT "template_listing_publisher_organization_id_organization_id_fk" FOREIGN KEY ("publisher_organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_field_value_run_step" ON "field_value" USING btree ("run_step_id");--> statement-breakpoint
CREATE INDEX "idx_run_org_status_due" ON "run" USING btree ("organization_id","status","due_at");--> statement-breakpoint
CREATE INDEX "idx_run_role_assignment_participant" ON "run_role_assignment" USING btree ("participant_id");--> statement-breakpoint
CREATE INDEX "idx_run_step_status_due" ON "run_step" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "idx_run_step_assignee_participant" ON "run_step_assignee" USING btree ("participant_id");--> statement-breakpoint
CREATE INDEX "idx_suggestion_org_status" ON "suggestion" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "idx_schedule_next_run" ON "schedule" USING btree ("next_run_at") WHERE "schedule"."is_active" = true AND "schedule"."next_run_at" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_entity_id_nonempty" CHECK (length("audit_log"."entity_id") > 0);--> statement-breakpoint
ALTER TABLE "activity_event" ADD CONSTRAINT "activity_event_entity_id_nonempty" CHECK (length("activity_event"."entity_id") > 0);--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_entity_id_nonempty" CHECK (length("attachment"."entity_id") > 0);--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_entity_id_nonempty" CHECK (length("comment"."entity_id") > 0);--> statement-breakpoint
ALTER TABLE "taggable" ADD CONSTRAINT "taggable_entity_id_nonempty" CHECK (length("taggable"."entity_id") > 0);