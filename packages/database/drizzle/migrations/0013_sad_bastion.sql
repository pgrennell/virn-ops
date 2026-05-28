ALTER TABLE "run" ADD COLUMN "callback_pm_service_request_id" text;--> statement-breakpoint
ALTER TABLE "run" ADD COLUMN "callback_pm_work_order_id" text;--> statement-breakpoint
ALTER TABLE "run" ADD COLUMN "callback_webhook_events" text[];--> statement-breakpoint
CREATE INDEX "idx_run_callback_pm_sr_id" ON "run" USING btree ("callback_pm_service_request_id") WHERE "run"."callback_pm_service_request_id" is not null;