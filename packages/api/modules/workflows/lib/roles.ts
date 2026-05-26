// packages/api/modules/workflows/lib/roles.ts
//
// Workflow roles (e.g. "Operator", "Reviewer") are ORG-level, not version-bound -- a
// single role is reused across many workflows + versions, and the run engine resolves
// the role to a participant at launch time. So role CRUD has no draft-only guard; it's
// simply scoped to the org.
//
// Distinct from Better Auth's organization roles (owner/admin/member), which govern
// app-level permissions. Workflow roles are a domain concept: "who fills this step?"

import {
	deleteWorkflowRole,
	insertWorkflowRole,
	updateWorkflowRole,
	writeAuditAndActivity,
} from "@virn/database";

export interface RoleContext {
	organizationId: string;
	userId: string;
}

export async function createWorkflowRole(
	ctx: RoleContext,
	input: { name: string; isInitiator?: boolean },
): Promise<{ id: string }> {
	const result = await insertWorkflowRole({
		organizationId: ctx.organizationId,
		name: input.name,
		isInitiator: input.isInitiator,
	});

	await writeAuditAndActivity({
		organizationId: ctx.organizationId,
		actorUserId: ctx.userId,
		action: "workflow_role.created",
		verb: "created",
		entityType: "role",
		entityId: result.id,
		changes: { name: input.name, isInitiator: input.isInitiator ?? false },
		metadata: {},
		activityData: { roleName: input.name },
	});

	return result;
}

export async function updateWorkflowRoleOp(
	ctx: RoleContext,
	input: { roleId: string; name?: string; isInitiator?: boolean },
): Promise<void> {
	const changes: Record<string, unknown> = {};
	if (input.name !== undefined) changes.name = input.name;
	if (input.isInitiator !== undefined) changes.isInitiator = input.isInitiator;
	if (Object.keys(changes).length === 0) return;

	await updateWorkflowRole({
		organizationId: ctx.organizationId,
		roleId: input.roleId,
		name: input.name,
		isInitiator: input.isInitiator,
	});

	await writeAuditAndActivity({
		organizationId: ctx.organizationId,
		actorUserId: ctx.userId,
		action: "workflow_role.updated",
		verb: "updated",
		entityType: "role",
		entityId: input.roleId,
		changes,
		metadata: {},
		activityData: {},
	});
}

export async function deleteWorkflowRoleOp(
	ctx: RoleContext,
	input: { roleId: string },
): Promise<void> {
	// step.assignedRoleId -> set null on delete (schema). Existing steps lose their
	// assignment but otherwise survive; the builder can re-assign. Not refusing here
	// because role removal is a legitimate org-cleanup gesture, and the run engine
	// already tolerates unassigned steps at launch (matching steps simply launch
	// unassigned per launchRun).
	await deleteWorkflowRole({
		organizationId: ctx.organizationId,
		roleId: input.roleId,
	});

	await writeAuditAndActivity({
		organizationId: ctx.organizationId,
		actorUserId: ctx.userId,
		action: "workflow_role.deleted",
		verb: "deleted",
		entityType: "role",
		entityId: input.roleId,
		changes: {},
		metadata: {},
		activityData: {},
	});
}
