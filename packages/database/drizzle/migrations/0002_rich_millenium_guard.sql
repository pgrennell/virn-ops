CREATE TABLE "participant_token" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"participant_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"last_used_at" timestamp,
	"revoked_at" timestamp,
	"issued_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_participant_token_hash" UNIQUE("token_hash"),
	CONSTRAINT "participant_token_expires_after_created" CHECK ("participant_token"."expires_at" > "participant_token"."created_at")
);
--> statement-breakpoint
ALTER TABLE "participant_token" ADD CONSTRAINT "participant_token_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_token" ADD CONSTRAINT "participant_token_participant_id_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_token" ADD CONSTRAINT "participant_token_issued_by_user_id_user_id_fk" FOREIGN KEY ("issued_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_participant_token_org" ON "participant_token" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_participant_token_participant" ON "participant_token" USING btree ("participant_id");