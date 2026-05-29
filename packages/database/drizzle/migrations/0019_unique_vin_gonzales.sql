CREATE TABLE "sop_read_receipt" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"workflow_version_id" text NOT NULL,
	"user_id" text NOT NULL,
	"read_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_sop_read_receipt_version_user" UNIQUE("workflow_version_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "sop_read_receipt" ADD CONSTRAINT "sop_read_receipt_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_read_receipt" ADD CONSTRAINT "sop_read_receipt_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_read_receipt" ADD CONSTRAINT "sop_read_receipt_workflow_version_id_workflow_version_id_fk" FOREIGN KEY ("workflow_version_id") REFERENCES "public"."workflow_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_read_receipt" ADD CONSTRAINT "sop_read_receipt_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_sop_read_receipt_org" ON "sop_read_receipt" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_sop_read_receipt_workflow" ON "sop_read_receipt" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "idx_sop_read_receipt_user" ON "sop_read_receipt" USING btree ("user_id");