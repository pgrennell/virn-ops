CREATE TYPE "public"."playbook_lifecycle_event" AS ENUM('run.completed', 'run.state_changed', 'listing.entity_set_added', 'vendor.upserted');--> statement-breakpoint
CREATE TYPE "public"."playbook_run_status" AS ENUM('pending', 'active', 'waiting', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."playbook_run_step_status" AS ENUM('pending', 'active', 'waiting', 'completed', 'skipped', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."playbook_step_type" AS ENUM('wait_for_duration', 'wait_for_event', 'launch_workflow', 'send_notification', 'branch_on_data_set', 'write_to_data_set');--> statement-breakpoint
CREATE TYPE "public"."playbook_trigger_type" AS ENUM('manual', 'lifecycle_event');--> statement-breakpoint
ALTER TYPE "public"."entity_type" ADD VALUE 'playbook';--> statement-breakpoint
ALTER TYPE "public"."entity_type" ADD VALUE 'playbook_version';--> statement-breakpoint
ALTER TYPE "public"."entity_type" ADD VALUE 'playbook_run';--> statement-breakpoint
ALTER TYPE "public"."entity_type" ADD VALUE 'playbook_run_step';--> statement-breakpoint
CREATE TABLE "playbook" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"entity_set_ids" text[] DEFAULT '{}' NOT NULL,
	"review_state" "review_state" DEFAULT 'draft' NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"ai_authoring_prompt_id" text,
	"created_by" text,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_playbook_org_name" UNIQUE("organization_id","name")
);
--> statement-breakpoint
CREATE TABLE "playbook_run" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"playbook_version_id" text NOT NULL,
	"status" "playbook_run_status" DEFAULT 'pending' NOT NULL,
	"trigger_entity_type" text,
	"trigger_entity_id" text,
	"trigger_payload" jsonb NOT NULL,
	"trigger_fingerprint" text NOT NULL,
	"current_step_id" text,
	"next_wake_at" timestamp,
	"started_at" timestamp,
	"completed_at" timestamp,
	"cancelled_at" timestamp,
	"cancelled_by_user_id" text,
	"cross_product_origin" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_playbook_run_dedup" UNIQUE("playbook_version_id","trigger_entity_id","trigger_fingerprint")
);
--> statement-breakpoint
CREATE TABLE "playbook_run_step" (
	"id" text PRIMARY KEY NOT NULL,
	"playbook_run_id" text NOT NULL,
	"playbook_step_id" text NOT NULL,
	"status" "playbook_run_step_status" DEFAULT 'pending' NOT NULL,
	"result_payload" jsonb,
	"launched_run_id" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "playbook_step" (
	"id" text PRIMARY KEY NOT NULL,
	"playbook_version_id" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"type" "playbook_step_type" NOT NULL,
	"config" jsonb NOT NULL,
	"branch_label" text,
	"parent_step_id" text,
	"provenance" "step_provenance" DEFAULT 'manually_edited' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "playbook_version" (
	"id" text PRIMARY KEY NOT NULL,
	"playbook_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"trigger_type" "playbook_trigger_type" NOT NULL,
	"trigger_event" "playbook_lifecycle_event",
	"trigger_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedup_window_hours" integer,
	"published_at" timestamp,
	"published_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_playbook_version_number" UNIQUE("playbook_id","version_number")
);
--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "labelOverrides" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "playbook" ADD CONSTRAINT "playbook_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook" ADD CONSTRAINT "playbook_ai_authoring_prompt_id_ai_authoring_prompt_id_fk" FOREIGN KEY ("ai_authoring_prompt_id") REFERENCES "public"."ai_authoring_prompt"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook" ADD CONSTRAINT "playbook_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_run" ADD CONSTRAINT "playbook_run_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_run" ADD CONSTRAINT "playbook_run_playbook_version_id_playbook_version_id_fk" FOREIGN KEY ("playbook_version_id") REFERENCES "public"."playbook_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_run" ADD CONSTRAINT "playbook_run_current_step_id_playbook_step_id_fk" FOREIGN KEY ("current_step_id") REFERENCES "public"."playbook_step"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_run" ADD CONSTRAINT "playbook_run_cancelled_by_user_id_user_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_run_step" ADD CONSTRAINT "playbook_run_step_playbook_run_id_playbook_run_id_fk" FOREIGN KEY ("playbook_run_id") REFERENCES "public"."playbook_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_run_step" ADD CONSTRAINT "playbook_run_step_playbook_step_id_playbook_step_id_fk" FOREIGN KEY ("playbook_step_id") REFERENCES "public"."playbook_step"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_run_step" ADD CONSTRAINT "playbook_run_step_launched_run_id_run_id_fk" FOREIGN KEY ("launched_run_id") REFERENCES "public"."run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_step" ADD CONSTRAINT "playbook_step_playbook_version_id_playbook_version_id_fk" FOREIGN KEY ("playbook_version_id") REFERENCES "public"."playbook_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_step" ADD CONSTRAINT "playbook_step_parent_step_id_playbook_step_id_fk" FOREIGN KEY ("parent_step_id") REFERENCES "public"."playbook_step"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_version" ADD CONSTRAINT "playbook_version_playbook_id_playbook_id_fk" FOREIGN KEY ("playbook_id") REFERENCES "public"."playbook"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_version" ADD CONSTRAINT "playbook_version_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_playbook_org" ON "playbook" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_playbook_run_org" ON "playbook_run" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_playbook_run_status" ON "playbook_run" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_playbook_run_next_wake" ON "playbook_run" USING btree ("next_wake_at");--> statement-breakpoint
CREATE INDEX "idx_playbook_run_step_run" ON "playbook_run_step" USING btree ("playbook_run_id");--> statement-breakpoint
CREATE INDEX "idx_playbook_run_step_step" ON "playbook_run_step" USING btree ("playbook_step_id");--> statement-breakpoint
CREATE INDEX "idx_playbook_step_version_position" ON "playbook_step" USING btree ("playbook_version_id","position");--> statement-breakpoint
CREATE INDEX "idx_playbook_step_parent" ON "playbook_step" USING btree ("parent_step_id");--> statement-breakpoint
CREATE INDEX "idx_playbook_version_playbook" ON "playbook_version" USING btree ("playbook_id");