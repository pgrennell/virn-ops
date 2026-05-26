// apps/saas/modules/builder/lib/types.ts
//
// Inlined shapes for the workflows.getVersionBundle response. Avoids coupling the
// Builder to the api lib's internal types -- structural matching keeps the contract
// enforced. Mirrors `VersionEditBundle` from @virn/database/queries/workflows.ts.

import type { FieldType, StepType } from "@runs/types";

export interface VersionEditBundleWorkflow {
	id: string;
	organizationId: string;
	title: string;
	description: string | null;
	type: "procedure" | "document" | "policy" | "form";
	isActive: boolean;
}

export interface VersionEditBundleVersion {
	id: string;
	workflowId: string;
	versionNumber: number;
	status: "draft" | "published" | "archived";
	publishedAt: Date | string | null;
	publishedBy: string | null;
}

export interface VersionEditBundleSection {
	id: string;
	workflowVersionId: string;
	title: string;
	position: number;
}

export interface VersionEditBundleStep {
	id: string;
	workflowVersionId: string;
	sectionId: string | null;
	assignedRoleId: string | null;
	type: StepType;
	title: string;
	description: string | null;
	position: number;
	isRequired: boolean;
	isStopTask: boolean;
	dueType: "none" | "offset_from_start" | "offset_from_step" | "from_date_field";
	dueOffsetDays: number | null;
	dueAnchorStepId: string | null;
	dueSourceFieldId: string | null;
}

export interface VersionEditBundleField {
	id: string;
	stepId: string | null;
	key: string;
	label: string;
	fieldType: FieldType;
	config: Record<string, unknown> | null;
	isRequired: boolean;
	position: number;
	isKeyLocked: boolean;
}

export interface VersionEditBundleResponse {
	version: VersionEditBundleVersion;
	sections: VersionEditBundleSection[];
	steps: VersionEditBundleStep[];
	fields: VersionEditBundleField[];
	dependencies: Array<{ stepId: string; dependsOnStepId: string }>;
	workflow: VersionEditBundleWorkflow;
}
