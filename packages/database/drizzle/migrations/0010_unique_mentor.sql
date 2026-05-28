CREATE TABLE "ai_authoring_prompt" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"prompt" text NOT NULL,
	"source_text" text,
	"response_json" jsonb NOT NULL,
	"entity_schema_snapshot" jsonb NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow" ADD COLUMN "ai_authoring_prompt_id" text;--> statement-breakpoint
ALTER TABLE "ai_authoring_prompt" ADD CONSTRAINT "ai_authoring_prompt_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_authoring_prompt" ADD CONSTRAINT "ai_authoring_prompt_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow" ADD CONSTRAINT "workflow_ai_authoring_prompt_id_ai_authoring_prompt_id_fk" FOREIGN KEY ("ai_authoring_prompt_id") REFERENCES "public"."ai_authoring_prompt"("id") ON DELETE set null ON UPDATE no action;