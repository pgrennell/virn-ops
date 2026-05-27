CREATE TYPE "public"."NotificationTarget" AS ENUM('IN_APP', 'EMAIL');--> statement-breakpoint
CREATE TYPE "public"."NotificationType" AS ENUM('WELCOME', 'APP_UPDATE', 'RUN_ASSIGNED', 'RUN_COMPLETED', 'STEP_ASSIGNED', 'STEP_COMPLETED', 'STEP_OVERDUE', 'APPROVAL_REQUESTED', 'APPROVAL_DECIDED', 'ACKNOWLEDGMENT_DUE', 'SUGGESTION_RESOLVED', 'COMMENT_MENTION');--> statement-breakpoint
CREATE TYPE "public"."PurchaseType" AS ENUM('SUBSCRIPTION', 'ONE_TIME');--> statement-breakpoint
CREATE TYPE "public"."entity_type" AS ENUM('workflow', 'workflow_version', 'section', 'step', 'field', 'run', 'run_step', 'field_value', 'suggestion', 'automation_rule', 'version_approval', 'acknowledgment', 'template_listing', 'template_listing_version', 'solution_pack', 'pack_version', 'field_definition', 'role');--> statement-breakpoint
CREATE TYPE "public"."lifecycle_status" AS ENUM('active', 'inactive', 'archived');--> statement-breakpoint
CREATE TYPE "public"."workflow_type" AS ENUM('procedure', 'document', 'policy', 'form');--> statement-breakpoint
CREATE TYPE "public"."setting_data_type" AS ENUM('string', 'number', 'boolean', 'json', 'select', 'multiselect');--> statement-breakpoint
CREATE TYPE "public"."due_type" AS ENUM('none', 'offset_from_start', 'offset_from_step', 'from_date_field');--> statement-breakpoint
CREATE TYPE "public"."field_type" AS ENUM('text', 'textarea', 'number', 'date', 'select', 'multiselect', 'file', 'image', 'signature', 'member', 'lookup');--> statement-breakpoint
CREATE TYPE "public"."schedule_frequency" AS ENUM('daily', 'weekly', 'monthly', 'quarterly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."step_type" AS ENUM('task', 'approval', 'heading', 'one_off', 'code', 'ai');--> statement-breakpoint
CREATE TYPE "public"."workflow_version_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('active', 'completed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."run_step_status" AS ENUM('pending', 'completed', 'skipped', 'not_applicable');--> statement-breakpoint
CREATE TYPE "public"."automation_action_type" AS ENUM('show_step', 'hide_step', 'show_field', 'hide_field', 'set_required', 'assign', 'set_deadline', 'send_notification', 'call_webhook', 'run_workflow', 'set_field_value');--> statement-breakpoint
CREATE TYPE "public"."automation_condition_operator" AS ENUM('eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'not_contains', 'in', 'not_in', 'is_empty', 'is_not_empty');--> statement-breakpoint
CREATE TYPE "public"."automation_rule_logic" AS ENUM('and', 'or');--> statement-breakpoint
CREATE TYPE "public"."automation_trigger_type" AS ENUM('run_started', 'task_completed', 'field_changed');--> statement-breakpoint
CREATE TYPE "public"."approval_decision" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."suggestion_status" AS ENUM('open', 'accepted', 'rejected', 'merged');--> statement-breakpoint
CREATE TYPE "public"."listing_visibility" AS ENUM('private', 'link', 'organization', 'public');--> statement-breakpoint
CREATE TYPE "public"."field_definition_scope" AS ENUM('platform', 'pack', 'org');--> statement-breakpoint
CREATE TYPE "public"."permission_scope" AS ENUM('own', 'team', 'org', 'platform');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"accountId" text NOT NULL,
	"providerId" text NOT NULL,
	"userId" text NOT NULL,
	"accessToken" text,
	"refreshToken" text,
	"idToken" text,
	"accessTokenExpiresAt" timestamp,
	"refreshTokenExpiresAt" timestamp,
	"scope" text,
	"password" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"inviterId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"userId" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"createdAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"type" "NotificationType" NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"link" text,
	"read" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"createdAt" timestamp NOT NULL,
	"metadata" text,
	"paymentsCustomerId" text,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "passkey" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"publicKey" text NOT NULL,
	"userId" text NOT NULL,
	"credentialID" text NOT NULL,
	"counter" integer NOT NULL,
	"deviceType" text NOT NULL,
	"backedUp" boolean NOT NULL,
	"transports" text,
	"createdAt" timestamp,
	"aaguid" text
);
--> statement-breakpoint
CREATE TABLE "purchase" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text,
	"userId" text,
	"type" "PurchaseType" NOT NULL,
	"customerId" text NOT NULL,
	"subscriptionId" text,
	"priceId" text NOT NULL,
	"status" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp,
	CONSTRAINT "purchase_subscriptionId_unique" UNIQUE("subscriptionId")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"token" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp NOT NULL,
	"ipAddress" text,
	"userAgent" text,
	"userId" text NOT NULL,
	"impersonatedBy" text,
	"activeOrganizationId" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "twoFactor" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backupCodes" text NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"userId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"emailVerified" boolean DEFAULT false NOT NULL,
	"image" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"username" text,
	"displayUsername" text,
	"role" text,
	"banned" boolean DEFAULT false,
	"banReason" text,
	"banExpires" timestamp,
	"twoFactorEnabled" boolean DEFAULT false,
	"onboardingComplete" boolean,
	"paymentsCustomerId" text,
	"locale" text,
	"lastActiveOrganizationId" text,
	CONSTRAINT "user_email_unique" UNIQUE("email"),
	CONSTRAINT "user_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "user_notification_preference" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"type" "NotificationType" NOT NULL,
	"target" "NotificationTarget" NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capability" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"default_enabled" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" "lifecycle_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "capability_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "organization_capability" (
	"organization_id" text NOT NULL,
	"capability_id" text NOT NULL,
	"enabled" boolean NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organization_capability_organization_id_capability_id_pk" PRIMARY KEY("organization_id","capability_id")
);
--> statement-breakpoint
CREATE TABLE "organization_setting" (
	"organization_id" text NOT NULL,
	"setting_definition_id" text NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organization_setting_organization_id_setting_definition_id_pk" PRIMARY KEY("organization_id","setting_definition_id")
);
--> statement-breakpoint
CREATE TABLE "setting_definition" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"capability_id" text,
	"name" text NOT NULL,
	"description" text,
	"data_type" "setting_data_type" NOT NULL,
	"default_value" jsonb,
	"validation_schema" jsonb,
	"category" text,
	"is_advanced" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" "lifecycle_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "setting_definition_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "field" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_version_id" text NOT NULL,
	"step_id" text,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"field_type" "field_type" NOT NULL,
	"config" jsonb,
	"is_required" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "uq_field_version_key" UNIQUE("workflow_version_id","key")
);
--> statement-breakpoint
CREATE TABLE "schedule" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"frequency" "schedule_frequency" NOT NULL,
	"recurrence_config" jsonb,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"next_run_at" timestamp,
	"default_assignee_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "section" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_version_id" text NOT NULL,
	"title" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"hidden_by_default" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "step" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_version_id" text NOT NULL,
	"section_id" text,
	"assigned_role_id" text,
	"type" "step_type" DEFAULT 'task' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"position" integer DEFAULT 0 NOT NULL,
	"is_required" boolean DEFAULT true NOT NULL,
	"requires_all_assignees" boolean DEFAULT false NOT NULL,
	"is_stop_task" boolean DEFAULT false NOT NULL,
	"hidden_by_default" boolean DEFAULT false NOT NULL,
	"due_type" "due_type" DEFAULT 'none' NOT NULL,
	"due_offset_days" integer,
	"due_anchor_step_id" text,
	"due_source_field_id" text
);
--> statement-breakpoint
CREATE TABLE "step_dependency" (
	"id" text PRIMARY KEY NOT NULL,
	"step_id" text NOT NULL,
	"depends_on_step_id" text NOT NULL,
	CONSTRAINT "uq_step_dependency" UNIQUE("step_id","depends_on_step_id")
);
--> statement-breakpoint
CREATE TABLE "workflow" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"type" "workflow_type" DEFAULT 'procedure' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"review_interval_days" integer,
	"next_review_at" timestamp,
	"installed_from_listing_version_id" text,
	"created_by" text,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_role" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"is_initiator" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_version" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"status" "workflow_version_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp,
	"published_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_workflow_version_number" UNIQUE("workflow_id","version_number")
);
--> statement-breakpoint
CREATE TABLE "field_value" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"run_step_id" text,
	"field_id" text,
	"value" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_field_value_run_field" UNIQUE("run_id","field_id")
);
--> statement-breakpoint
CREATE TABLE "participant" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"run_id" text NOT NULL,
	"user_id" text,
	"guest_email" text,
	"guest_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "participant_identity" CHECK (("participant"."user_id" is not null) <> ("participant"."guest_email" is not null))
);
--> statement-breakpoint
CREATE TABLE "run" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"workflow_version_id" text NOT NULL,
	"schedule_id" text,
	"title" text NOT NULL,
	"status" "run_status" DEFAULT 'active' NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"due_at" timestamp,
	"completed_at" timestamp,
	"created_by" text,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_role_assignment" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"role_id" text NOT NULL,
	"participant_id" text NOT NULL,
	CONSTRAINT "uq_run_role_assignment" UNIQUE("run_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "run_step" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"step_id" text,
	"title" text NOT NULL,
	"description" text,
	"position" integer DEFAULT 0 NOT NULL,
	"status" "run_step_status" DEFAULT 'pending' NOT NULL,
	"assigned_role_id" text,
	"due_at" timestamp,
	"completed_by" text,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "run_step_assignee" (
	"id" text PRIMARY KEY NOT NULL,
	"run_step_id" text NOT NULL,
	"participant_id" text NOT NULL,
	CONSTRAINT "uq_run_step_assignee" UNIQUE("run_step_id","participant_id")
);
--> statement-breakpoint
CREATE TABLE "automation_action" (
	"id" text PRIMARY KEY NOT NULL,
	"rule_id" text NOT NULL,
	"action_type" "automation_action_type" NOT NULL,
	"target_step_id" text,
	"target_field_id" text,
	"target_role_id" text,
	"config" jsonb,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_condition" (
	"id" text PRIMARY KEY NOT NULL,
	"rule_id" text NOT NULL,
	"source_field_id" text,
	"operator" "automation_condition_operator" NOT NULL,
	"value" jsonb,
	"group_index" integer DEFAULT 0 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_rule" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"workflow_version_id" text NOT NULL,
	"trigger_type" "automation_trigger_type" NOT NULL,
	"trigger_step_id" text,
	"trigger_field_id" text,
	"logic" "automation_rule_logic" DEFAULT 'and' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_rule_fired" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"rule_id" text NOT NULL,
	"fired_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_run_rule_fired" UNIQUE("run_id","rule_id")
);
--> statement-breakpoint
CREATE TABLE "acknowledgment" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"workflow_version_id" text NOT NULL,
	"user_id" text NOT NULL,
	"acknowledged_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_acknowledgment_version_user" UNIQUE("workflow_version_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "suggestion" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"suggested_by" text,
	"body" text NOT NULL,
	"status" "suggestion_status" DEFAULT 'open' NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "version_approval" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_version_id" text NOT NULL,
	"requested_by" text,
	"approver_id" text,
	"decision" "approval_decision" DEFAULT 'pending' NOT NULL,
	"note" text,
	"decided_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template_category" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"parent_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "template_category_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "template_listing" (
	"id" text PRIMARY KEY NOT NULL,
	"publisher_organization_id" text,
	"category_id" text,
	"content_type" "workflow_type" DEFAULT 'procedure' NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"cover_image_key" text,
	"slug" text NOT NULL,
	"visibility" "listing_visibility" DEFAULT 'private' NOT NULL,
	"share_token" text,
	"is_official" boolean DEFAULT false NOT NULL,
	"install_count" integer DEFAULT 0 NOT NULL,
	"status" "lifecycle_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "template_listing_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "template_listing_version" (
	"id" text PRIMARY KEY NOT NULL,
	"listing_id" text NOT NULL,
	"source_workflow_version_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"changelog" text,
	"published_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_template_listing_version" UNIQUE("listing_id","version_number")
);
--> statement-breakpoint
CREATE TABLE "template_review" (
	"id" text PRIMARY KEY NOT NULL,
	"listing_id" text NOT NULL,
	"reviewer_user_id" text NOT NULL,
	"rating" integer NOT NULL,
	"body" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_template_review_listing_user" UNIQUE("listing_id","reviewer_user_id")
);
--> statement-breakpoint
CREATE TABLE "pack_install" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"pack_id" text NOT NULL,
	"pack_version_id" text NOT NULL,
	"installed_by" text,
	"installed_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_pack_install_org_pack" UNIQUE("organization_id","pack_id")
);
--> statement-breakpoint
CREATE TABLE "pack_version" (
	"id" text PRIMARY KEY NOT NULL,
	"pack_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"manifest" jsonb NOT NULL,
	"changelog" text,
	"published_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_pack_version_number" UNIQUE("pack_id","version_number")
);
--> statement-breakpoint
CREATE TABLE "solution_pack" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"summary" text,
	"is_official" boolean DEFAULT true NOT NULL,
	"status" "lifecycle_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "solution_pack_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "field_definition" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"object_type_id" text,
	"scope" "field_definition_scope" NOT NULL,
	"organization_id" text,
	"pack_version_id" text,
	"name" text NOT NULL,
	"description" text,
	"data_type" "setting_data_type" NOT NULL,
	"default_value" jsonb,
	"validation_schema" jsonb,
	"is_required" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" "lifecycle_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_field_definition_scope_key" UNIQUE("scope","organization_id","pack_version_id","object_type_id","key")
);
--> statement-breakpoint
CREATE TABLE "object_type" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" "lifecycle_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "object_type_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "plan" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" "lifecycle_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "plan_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "plan_capability" (
	"plan_id" text NOT NULL,
	"capability_id" text NOT NULL,
	"limits" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "plan_capability_plan_id_capability_id_pk" PRIMARY KEY("plan_id","capability_id")
);
--> statement-breakpoint
CREATE TABLE "group" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_member" (
	"group_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "group_member_group_id_user_id_pk" PRIMARY KEY("group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "permission" (
	"id" text PRIMARY KEY NOT NULL,
	"resource_type" text NOT NULL,
	"action" text NOT NULL,
	"scope" "permission_scope" NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_permission_resource_action_scope" UNIQUE("resource_type","action","scope")
);
--> statement-breakpoint
CREATE TABLE "role" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_system" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_role_org_key" UNIQUE("organization_id","key")
);
--> statement-breakpoint
CREATE TABLE "role_assignment" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"role_id" text NOT NULL,
	"user_id" text,
	"group_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "role_assignment_principal" CHECK (("role_assignment"."user_id" is not null) <> ("role_assignment"."group_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "role_permission" (
	"role_id" text NOT NULL,
	"permission_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "role_permission_role_id_permission_id_pk" PRIMARY KEY("role_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"entity_type" "entity_type",
	"entity_id" text,
	"changes" jsonb,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_event" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"actor_user_id" text,
	"verb" text NOT NULL,
	"entity_type" "entity_type" NOT NULL,
	"entity_id" text NOT NULL,
	"data" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachment" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"entity_type" "entity_type" NOT NULL,
	"entity_id" text NOT NULL,
	"uploader_user_id" text,
	"file_key" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text,
	"size_bytes" integer,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comment" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"entity_type" "entity_type" NOT NULL,
	"entity_id" text NOT NULL,
	"author_user_id" text,
	"body" text NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comment_mention" (
	"comment_id" text NOT NULL,
	"mentioned_user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_comment_mention" UNIQUE("comment_id","mentioned_user_id")
);
--> statement-breakpoint
CREATE TABLE "tag" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"status" "lifecycle_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_tag_org_key" UNIQUE("organization_id","key")
);
--> statement-breakpoint
CREATE TABLE "taggable" (
	"tag_id" text NOT NULL,
	"entity_type" "entity_type" NOT NULL,
	"entity_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_taggable" UNIQUE("tag_id","entity_type","entity_id")
);
--> statement-breakpoint
CREATE TABLE "webhook" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"secret" text,
	"events" text[] DEFAULT '{}' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_set" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" "lifecycle_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_data_set_org_key" UNIQUE("organization_id","key")
);
--> statement-breakpoint
CREATE TABLE "data_set_field" (
	"id" text PRIMARY KEY NOT NULL,
	"data_set_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"data_type" "setting_data_type" NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_data_set_field_key" UNIQUE("data_set_id","key")
);
--> statement-breakpoint
CREATE TABLE "data_set_record" (
	"id" text PRIMARY KEY NOT NULL,
	"data_set_id" text NOT NULL,
	"values" jsonb NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organizationId_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviterId_user_id_fk" FOREIGN KEY ("inviterId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organizationId_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_organizationId_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "twoFactor" ADD CONSTRAINT "twoFactor_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notification_preference" ADD CONSTRAINT "user_notification_preference_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_capability" ADD CONSTRAINT "organization_capability_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_capability" ADD CONSTRAINT "organization_capability_capability_id_capability_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."capability"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_setting" ADD CONSTRAINT "organization_setting_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_setting" ADD CONSTRAINT "organization_setting_setting_definition_id_setting_definition_id_fk" FOREIGN KEY ("setting_definition_id") REFERENCES "public"."setting_definition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setting_definition" ADD CONSTRAINT "setting_definition_capability_id_capability_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."capability"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field" ADD CONSTRAINT "field_workflow_version_id_workflow_version_id_fk" FOREIGN KEY ("workflow_version_id") REFERENCES "public"."workflow_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field" ADD CONSTRAINT "field_step_id_step_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."step"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule" ADD CONSTRAINT "schedule_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule" ADD CONSTRAINT "schedule_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule" ADD CONSTRAINT "schedule_default_assignee_id_user_id_fk" FOREIGN KEY ("default_assignee_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section" ADD CONSTRAINT "section_workflow_version_id_workflow_version_id_fk" FOREIGN KEY ("workflow_version_id") REFERENCES "public"."workflow_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step" ADD CONSTRAINT "step_workflow_version_id_workflow_version_id_fk" FOREIGN KEY ("workflow_version_id") REFERENCES "public"."workflow_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step" ADD CONSTRAINT "step_section_id_section_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."section"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step" ADD CONSTRAINT "step_assigned_role_id_workflow_role_id_fk" FOREIGN KEY ("assigned_role_id") REFERENCES "public"."workflow_role"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_dependency" ADD CONSTRAINT "step_dependency_step_id_step_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."step"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_dependency" ADD CONSTRAINT "step_dependency_depends_on_step_id_step_id_fk" FOREIGN KEY ("depends_on_step_id") REFERENCES "public"."step"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow" ADD CONSTRAINT "workflow_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow" ADD CONSTRAINT "workflow_installed_from_listing_version_id_template_listing_version_id_fk" FOREIGN KEY ("installed_from_listing_version_id") REFERENCES "public"."template_listing_version"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow" ADD CONSTRAINT "workflow_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_role" ADD CONSTRAINT "workflow_role_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_version" ADD CONSTRAINT "workflow_version_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_version" ADD CONSTRAINT "workflow_version_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_value" ADD CONSTRAINT "field_value_run_id_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_value" ADD CONSTRAINT "field_value_run_step_id_run_step_id_fk" FOREIGN KEY ("run_step_id") REFERENCES "public"."run_step"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_value" ADD CONSTRAINT "field_value_field_id_field_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."field"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant" ADD CONSTRAINT "participant_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant" ADD CONSTRAINT "participant_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_workflow_version_id_workflow_version_id_fk" FOREIGN KEY ("workflow_version_id") REFERENCES "public"."workflow_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_schedule_id_schedule_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedule"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_role_assignment" ADD CONSTRAINT "run_role_assignment_run_id_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_role_assignment" ADD CONSTRAINT "run_role_assignment_role_id_workflow_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."workflow_role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_role_assignment" ADD CONSTRAINT "run_role_assignment_participant_id_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_step" ADD CONSTRAINT "run_step_run_id_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_step" ADD CONSTRAINT "run_step_step_id_step_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."step"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_step" ADD CONSTRAINT "run_step_assigned_role_id_workflow_role_id_fk" FOREIGN KEY ("assigned_role_id") REFERENCES "public"."workflow_role"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_step" ADD CONSTRAINT "run_step_completed_by_user_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_step_assignee" ADD CONSTRAINT "run_step_assignee_run_step_id_run_step_id_fk" FOREIGN KEY ("run_step_id") REFERENCES "public"."run_step"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_step_assignee" ADD CONSTRAINT "run_step_assignee_participant_id_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_action" ADD CONSTRAINT "automation_action_rule_id_automation_rule_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."automation_rule"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_action" ADD CONSTRAINT "automation_action_target_step_id_step_id_fk" FOREIGN KEY ("target_step_id") REFERENCES "public"."step"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_action" ADD CONSTRAINT "automation_action_target_field_id_field_id_fk" FOREIGN KEY ("target_field_id") REFERENCES "public"."field"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_action" ADD CONSTRAINT "automation_action_target_role_id_workflow_role_id_fk" FOREIGN KEY ("target_role_id") REFERENCES "public"."workflow_role"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_condition" ADD CONSTRAINT "automation_condition_rule_id_automation_rule_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."automation_rule"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_condition" ADD CONSTRAINT "automation_condition_source_field_id_field_id_fk" FOREIGN KEY ("source_field_id") REFERENCES "public"."field"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rule" ADD CONSTRAINT "automation_rule_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rule" ADD CONSTRAINT "automation_rule_workflow_version_id_workflow_version_id_fk" FOREIGN KEY ("workflow_version_id") REFERENCES "public"."workflow_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rule" ADD CONSTRAINT "automation_rule_trigger_step_id_step_id_fk" FOREIGN KEY ("trigger_step_id") REFERENCES "public"."step"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rule" ADD CONSTRAINT "automation_rule_trigger_field_id_field_id_fk" FOREIGN KEY ("trigger_field_id") REFERENCES "public"."field"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_rule_fired" ADD CONSTRAINT "run_rule_fired_run_id_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_rule_fired" ADD CONSTRAINT "run_rule_fired_rule_id_automation_rule_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."automation_rule"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acknowledgment" ADD CONSTRAINT "acknowledgment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acknowledgment" ADD CONSTRAINT "acknowledgment_workflow_version_id_workflow_version_id_fk" FOREIGN KEY ("workflow_version_id") REFERENCES "public"."workflow_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acknowledgment" ADD CONSTRAINT "acknowledgment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion" ADD CONSTRAINT "suggestion_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion" ADD CONSTRAINT "suggestion_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion" ADD CONSTRAINT "suggestion_suggested_by_user_id_fk" FOREIGN KEY ("suggested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion" ADD CONSTRAINT "suggestion_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "version_approval" ADD CONSTRAINT "version_approval_workflow_version_id_workflow_version_id_fk" FOREIGN KEY ("workflow_version_id") REFERENCES "public"."workflow_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "version_approval" ADD CONSTRAINT "version_approval_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "version_approval" ADD CONSTRAINT "version_approval_approver_id_user_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_listing" ADD CONSTRAINT "template_listing_publisher_organization_id_organization_id_fk" FOREIGN KEY ("publisher_organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_listing" ADD CONSTRAINT "template_listing_category_id_template_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."template_category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_listing_version" ADD CONSTRAINT "template_listing_version_listing_id_template_listing_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."template_listing"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_listing_version" ADD CONSTRAINT "template_listing_version_source_workflow_version_id_workflow_version_id_fk" FOREIGN KEY ("source_workflow_version_id") REFERENCES "public"."workflow_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_review" ADD CONSTRAINT "template_review_listing_id_template_listing_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."template_listing"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_review" ADD CONSTRAINT "template_review_reviewer_user_id_user_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_install" ADD CONSTRAINT "pack_install_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_install" ADD CONSTRAINT "pack_install_pack_id_solution_pack_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."solution_pack"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_install" ADD CONSTRAINT "pack_install_pack_version_id_pack_version_id_fk" FOREIGN KEY ("pack_version_id") REFERENCES "public"."pack_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_install" ADD CONSTRAINT "pack_install_installed_by_user_id_fk" FOREIGN KEY ("installed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_version" ADD CONSTRAINT "pack_version_pack_id_solution_pack_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."solution_pack"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_definition" ADD CONSTRAINT "field_definition_object_type_id_object_type_id_fk" FOREIGN KEY ("object_type_id") REFERENCES "public"."object_type"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_definition" ADD CONSTRAINT "field_definition_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_definition" ADD CONSTRAINT "field_definition_pack_version_id_pack_version_id_fk" FOREIGN KEY ("pack_version_id") REFERENCES "public"."pack_version"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_capability" ADD CONSTRAINT "plan_capability_plan_id_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_capability" ADD CONSTRAINT "plan_capability_capability_id_capability_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."capability"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group" ADD CONSTRAINT "group_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_member" ADD CONSTRAINT "group_member_group_id_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_member" ADD CONSTRAINT "group_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role" ADD CONSTRAINT "role_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignment" ADD CONSTRAINT "role_assignment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignment" ADD CONSTRAINT "role_assignment_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignment" ADD CONSTRAINT "role_assignment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignment" ADD CONSTRAINT "role_assignment_group_id_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_permission_id_permission_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permission"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_event" ADD CONSTRAINT "activity_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_event" ADD CONSTRAINT "activity_event_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_uploader_user_id_user_id_fk" FOREIGN KEY ("uploader_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_mention" ADD CONSTRAINT "comment_mention_comment_id_comment_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_mention" ADD CONSTRAINT "comment_mention_mentioned_user_id_user_id_fk" FOREIGN KEY ("mentioned_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag" ADD CONSTRAINT "tag_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taggable" ADD CONSTRAINT "taggable_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook" ADD CONSTRAINT "webhook_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_set" ADD CONSTRAINT "data_set_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_set_field" ADD CONSTRAINT "data_set_field_data_set_id_data_set_id_fk" FOREIGN KEY ("data_set_id") REFERENCES "public"."data_set"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_set_record" ADD CONSTRAINT "data_set_record_data_set_id_data_set_id_fk" FOREIGN KEY ("data_set_id") REFERENCES "public"."data_set"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "invitation_organizationId_idx" ON "invitation" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "member_organizationId_idx" ON "member" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "member_userId_idx" ON "member" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "notification_userId_idx" ON "notification" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_slug_uidx" ON "organization" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "passkey_userId_idx" ON "passkey" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "passkey_credentialID_idx" ON "passkey" USING btree ("credentialID");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "twoFactor_secret_idx" ON "twoFactor" USING btree ("secret");--> statement-breakpoint
CREATE INDEX "twoFactor_userId_idx" ON "twoFactor" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "user_notification_preference_userId_idx" ON "user_notification_preference" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "user_notification_preference_user_type_target_uidx" ON "user_notification_preference" USING btree ("userId","type","target");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "idx_field_step" ON "field" USING btree ("step_id");--> statement-breakpoint
CREATE INDEX "idx_schedule_workflow" ON "schedule" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "idx_schedule_next_run" ON "schedule" USING btree ("next_run_at");--> statement-breakpoint
CREATE INDEX "idx_section_version" ON "section" USING btree ("workflow_version_id");--> statement-breakpoint
CREATE INDEX "idx_step_version" ON "step" USING btree ("workflow_version_id");--> statement-breakpoint
CREATE INDEX "idx_step_section" ON "step" USING btree ("section_id");--> statement-breakpoint
CREATE INDEX "idx_workflow_org" ON "workflow" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_workflow_role_org" ON "workflow_role" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_workflow_version_workflow" ON "workflow_version" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "idx_field_value_run" ON "field_value" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "idx_participant_run" ON "participant" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "idx_run_org" ON "run" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_run_workflow" ON "run" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "idx_run_status" ON "run" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_run_step_run" ON "run_step" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "idx_run_step_status" ON "run_step" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_automation_action_rule" ON "automation_action" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "idx_automation_condition_rule" ON "automation_condition" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "idx_automation_rule_org" ON "automation_rule" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_automation_rule_version" ON "automation_rule" USING btree ("workflow_version_id");--> statement-breakpoint
CREATE INDEX "idx_automation_rule_trigger" ON "automation_rule" USING btree ("trigger_type");--> statement-breakpoint
CREATE INDEX "idx_run_rule_fired_run" ON "run_rule_fired" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "idx_acknowledgment_org" ON "acknowledgment" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_acknowledgment_user" ON "acknowledgment" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_suggestion_org" ON "suggestion" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_suggestion_workflow" ON "suggestion" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "idx_suggestion_status" ON "suggestion" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_version_approval_version" ON "version_approval" USING btree ("workflow_version_id");--> statement-breakpoint
CREATE INDEX "idx_version_approval_approver" ON "version_approval" USING btree ("approver_id");--> statement-breakpoint
CREATE INDEX "idx_template_category_parent" ON "template_category" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "idx_template_listing_publisher" ON "template_listing" USING btree ("publisher_organization_id");--> statement-breakpoint
CREATE INDEX "idx_template_listing_category" ON "template_listing" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "idx_template_listing_visibility" ON "template_listing" USING btree ("visibility");--> statement-breakpoint
CREATE INDEX "idx_template_listing_version_listing" ON "template_listing_version" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX "idx_template_review_listing" ON "template_review" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX "idx_pack_install_org" ON "pack_install" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_pack_install_version" ON "pack_install" USING btree ("pack_version_id");--> statement-breakpoint
CREATE INDEX "idx_pack_version_pack" ON "pack_version" USING btree ("pack_id");--> statement-breakpoint
CREATE INDEX "idx_field_definition_org" ON "field_definition" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_field_definition_object_type" ON "field_definition" USING btree ("object_type_id");--> statement-breakpoint
CREATE INDEX "idx_plan_status" ON "plan" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_group_org" ON "group" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_role_org" ON "role" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_role_assignment_org" ON "role_assignment" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_role_assignment_role" ON "role_assignment" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "idx_role_assignment_user" ON "role_assignment" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_role_assignment_group" ON "role_assignment" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "idx_audit_log_org" ON "audit_log" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_audit_log_actor" ON "audit_log" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "idx_audit_log_entity" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_audit_log_created_at" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_activity_event_org" ON "activity_event" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_activity_event_actor" ON "activity_event" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "idx_activity_event_entity" ON "activity_event" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_activity_event_created_at" ON "activity_event" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_attachment_org" ON "attachment" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_attachment_entity" ON "attachment" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_attachment_uploader" ON "attachment" USING btree ("uploader_user_id");--> statement-breakpoint
CREATE INDEX "idx_comment_org" ON "comment" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_comment_entity" ON "comment" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_comment_author" ON "comment" USING btree ("author_user_id");--> statement-breakpoint
CREATE INDEX "idx_comment_mention_user" ON "comment_mention" USING btree ("mentioned_user_id");--> statement-breakpoint
CREATE INDEX "idx_tag_org" ON "tag" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_taggable_entity" ON "taggable" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_webhook_org" ON "webhook" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_data_set_org" ON "data_set" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_data_set_field_data_set" ON "data_set_field" USING btree ("data_set_id");--> statement-breakpoint
CREATE INDEX "idx_data_set_record_data_set" ON "data_set_record" USING btree ("data_set_id");