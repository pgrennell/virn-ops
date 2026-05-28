CREATE TYPE "public"."cross_product_event_status" AS ENUM('pending', 'delivering', 'delivered', 'failed', 'dead');--> statement-breakpoint
CREATE TABLE "cross_product_event_org_sequence" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"last_seq" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cross_product_event_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"sequence_number" bigint NOT NULL,
	"event_type" text NOT NULL,
	"consumer_product" text NOT NULL,
	"run_id" text,
	"vendor_id" text,
	"callback_pm_service_request_id" text,
	"callback_pm_work_order_id" text,
	"payload" jsonb NOT NULL,
	"status" "cross_product_event_status" DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp,
	"last_error" text,
	"delivered_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_cross_product_event_outbox_org_seq" UNIQUE("organization_id","sequence_number")
);
--> statement-breakpoint
ALTER TABLE "cross_product_event_outbox" ADD CONSTRAINT "cross_product_event_outbox_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_cross_product_event_outbox_drain" ON "cross_product_event_outbox" USING btree ("next_attempt_at") WHERE "cross_product_event_outbox"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "idx_cross_product_event_outbox_run" ON "cross_product_event_outbox" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "idx_cross_product_event_outbox_org_seq" ON "cross_product_event_outbox" USING btree ("organization_id","sequence_number");