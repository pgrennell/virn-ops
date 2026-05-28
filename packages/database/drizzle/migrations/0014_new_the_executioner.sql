CREATE TABLE "outbound_webhook_credential" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"consumer_product" text NOT NULL,
	"endpoint_url" text NOT NULL,
	"signing_secret_encrypted" text NOT NULL,
	"signing_secret_last_four" text,
	"allowed_return_url_prefixes" text[] DEFAULT '{}' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"secret_rotated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outbound_webhook_credential" ADD CONSTRAINT "outbound_webhook_credential_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_webhook_credential" ADD CONSTRAINT "outbound_webhook_credential_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_outbound_webhook_credential_org" ON "outbound_webhook_credential" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_outbound_webhook_credential_org_consumer" ON "outbound_webhook_credential" USING btree ("organization_id","consumer_product") WHERE "outbound_webhook_credential"."deleted_at" is null;