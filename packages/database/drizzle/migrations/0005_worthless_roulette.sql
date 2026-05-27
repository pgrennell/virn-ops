CREATE TYPE "public"."vendor_status" AS ENUM('active', 'preferred', 'approved', 'under_review', 'probation', 'blacklisted');--> statement-breakpoint
ALTER TYPE "public"."actor_kind" ADD VALUE 'vendor';--> statement-breakpoint
ALTER TYPE "public"."entity_type" ADD VALUE 'vendor';--> statement-breakpoint
ALTER TYPE "public"."entity_type" ADD VALUE 'vendor_contact';--> statement-breakpoint
ALTER TYPE "public"."participant_kind" ADD VALUE 'vendor';--> statement-breakpoint
CREATE TABLE "vendor" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category_id" text,
	"status" "vendor_status" DEFAULT 'active' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"linked_pm_vendor_id" text,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "uq_vendor_org_name" UNIQUE("organization_id","name")
);
--> statement-breakpoint
CREATE TABLE "vendor_capability" (
	"id" text PRIMARY KEY NOT NULL,
	"vendor_id" text NOT NULL,
	"capability_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_vendor_capability" UNIQUE("vendor_id","capability_id")
);
--> statement-breakpoint
CREATE TABLE "vendor_category" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"parent_category_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_vendor_category_org_slug" UNIQUE("organization_id","slug")
);
--> statement-breakpoint
CREATE TABLE "vendor_contact" (
	"id" text PRIMARY KEY NOT NULL,
	"vendor_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"role" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "participant" DROP CONSTRAINT "participant_identity";--> statement-breakpoint
ALTER TABLE "participant" ADD COLUMN "vendor_id" text;--> statement-breakpoint
ALTER TABLE "participant" ADD COLUMN "vendor_contact_id" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "cross_product_origin" text;--> statement-breakpoint
ALTER TABLE "activity_event" ADD COLUMN "cross_product_origin" text;--> statement-breakpoint
ALTER TABLE "vendor" ADD CONSTRAINT "vendor_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor" ADD CONSTRAINT "vendor_category_id_vendor_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."vendor_category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor" ADD CONSTRAINT "vendor_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_capability" ADD CONSTRAINT "vendor_capability_vendor_id_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_capability" ADD CONSTRAINT "vendor_capability_capability_id_capability_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."capability"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_category" ADD CONSTRAINT "vendor_category_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_contact" ADD CONSTRAINT "vendor_contact_vendor_id_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_vendor_org" ON "vendor" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_vendor_org_category_active" ON "vendor" USING btree ("organization_id","category_id","is_active");--> statement-breakpoint
CREATE INDEX "idx_vendor_linked_pm" ON "vendor" USING btree ("linked_pm_vendor_id");--> statement-breakpoint
CREATE INDEX "idx_vendor_capability_vendor" ON "vendor_capability" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "idx_vendor_capability_capability" ON "vendor_capability" USING btree ("capability_id");--> statement-breakpoint
CREATE INDEX "idx_vendor_category_parent" ON "vendor_category" USING btree ("parent_category_id");--> statement-breakpoint
CREATE INDEX "idx_vendor_category_org" ON "vendor_category" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_vendor_contact_vendor" ON "vendor_contact" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "idx_vendor_contact_vendor_active" ON "vendor_contact" USING btree ("vendor_id","is_active");--> statement-breakpoint
ALTER TABLE "participant" ADD CONSTRAINT "participant_vendor_id_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant" ADD CONSTRAINT "participant_vendor_contact_id_vendor_contact_id_fk" FOREIGN KEY ("vendor_contact_id") REFERENCES "public"."vendor_contact"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant" ADD CONSTRAINT "participant_identity" CHECK ((
        ("participant"."kind"::text = 'user' and "participant"."user_id" is not null and "participant"."guest_email" is null and "participant"."agent_id" is null and "participant"."vendor_id" is null and "participant"."vendor_contact_id" is null) or
        ("participant"."kind"::text = 'guest' and "participant"."guest_email" is not null and "participant"."user_id" is null and "participant"."agent_id" is null and "participant"."vendor_id" is null and "participant"."vendor_contact_id" is null) or
        ("participant"."kind"::text = 'agent' and "participant"."agent_id" is not null and "participant"."user_id" is null and "participant"."guest_email" is null and "participant"."vendor_id" is null and "participant"."vendor_contact_id" is null) or
        ("participant"."kind"::text = 'vendor' and "participant"."vendor_id" is not null and "participant"."vendor_contact_id" is not null and "participant"."user_id" is null and "participant"."guest_email" is null and "participant"."agent_id" is null)
      ));