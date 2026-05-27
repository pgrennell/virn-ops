ALTER TYPE "public"."entity_type" ADD VALUE 'listing';--> statement-breakpoint
CREATE TABLE "listing" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"property_type" text,
	"address" jsonb,
	"external_listing_id" text,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "listing" ADD CONSTRAINT "listing_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing" ADD CONSTRAINT "listing_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_listing_org" ON "listing" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_listing_org_deleted" ON "listing" USING btree ("organization_id","deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_listing_org_external_id" ON "listing" USING btree ("organization_id","external_listing_id") WHERE "listing"."external_listing_id" is not null;