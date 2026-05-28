// packages/api/modules/packs/lib/install-property-ops.ts
//
// Materializes the property-ops pack manifest into a target organization. Idempotent
// at the row level: re-running an install is a no-op via the `pack_install` unique
// constraint (uq_pack_install_org_pack). Within a single install, each insert checks
// for the existing analogue (by slug / name) and reuses rather than duplicating --
// so an org that already has a "Property Manager" role gets reused, not a second one.
//
// On success, the org has:
//   - 10 vendor categories (idempotent by org+slug)
//   - 4 workflow roles (idempotent by org+name)
//   - 1 STR turnover workflow + published version (idempotent at the pack-install
//     boundary; if the org has already installed, we skip the workflow create entirely)
//   - 1 pack_install row
//
// What "idempotency" means in practice:
//   - First call:  installs everything, returns { alreadyInstalled: false, ... }
//   - Subsequent:  returns { alreadyInstalled: true } without writing anything
// The admin UI button uses this to render an enabled "Install" or a disabled
// "Already installed" state.

import {
	createVendorCategoryIfMissing,
	getPackInstallForOrg,
	getPropertyOpsPackVersion,
	insertField,
	insertPackInstall,
	insertSection,
	insertStep,
	insertStepDependency,
	insertWorkflowRole,
	listWorkflowRolesForOrg,
	writeAuditAndActivity,
} from "@virn/database";

import { createWorkflow } from "../../workflows/lib/workflow";
import { publishVersion } from "../../workflows/lib/publish";
import {
	PROPERTY_OPS_PACK_SLUG,
	PROPERTY_OPS_ROLES,
	PROPERTY_OPS_VENDOR_CATEGORIES,
	PROPERTY_OPS_WORKFLOWS,
	type WorkflowSeed,
} from "./property-ops-manifest";

export interface InstallContext {
	organizationId: string;
	userId: string;
}

export interface InstallResult {
	alreadyInstalled: boolean;
	packInstallId: string | null;
	created: {
		vendorCategories: number;
		workflowRoles: number;
		workflows: Array<{ workflowId: string; versionId: string; title: string }>;
	};
}

/** Install the property-ops pack into the given org. Idempotent: if a pack_install
 * row already exists for (orgId, propertyOpsPackId), skip everything and return
 * `alreadyInstalled: true`. */
export async function installPropertyOpsPack(
	ctx: InstallContext,
): Promise<InstallResult> {
	// 1. Look up the platform-seeded pack version. If missing, the platform seed
	//    script hasn't been run -- the procedure layer maps this to a 503-shaped error
	//    so the admin sees "Pack not yet available."
	const packVersion = await getPropertyOpsPackVersion();
	if (!packVersion) {
		throw new Error(
			`Property Ops pack not seeded at platform level. Run \`pnpm --filter @virn/scripts seed:property-ops-pack\` first.`,
		);
	}

	// 2. Idempotency gate at the pack_install boundary -- if already installed, bail.
	const existing = await getPackInstallForOrg(ctx.organizationId, packVersion.packId);
	if (existing) {
		return {
			alreadyInstalled: true,
			packInstallId: existing.id,
			created: { vendorCategories: 0, workflowRoles: 0, workflows: [] },
		};
	}

	// 3. Vendor categories (idempotent by org+slug -- createVendorCategoryIfMissing
	//    returns the existing row's id without re-inserting).
	let vendorCategoriesCreated = 0;
	for (const cat of PROPERTY_OPS_VENDOR_CATEGORIES) {
		const result = await createVendorCategoryIfMissing({
			organizationId: ctx.organizationId,
			slug: cat.slug,
			name: cat.name,
			description: cat.description,
		});
		if (result.created) vendorCategoriesCreated += 1;
	}

	// 4. Workflow roles (idempotent by org+name).
	const existingRoles = await listWorkflowRolesForOrg(ctx.organizationId);
	const existingRoleByName = new Map(existingRoles.map((r) => [r.name, r] as const));
	const roleIdByManifestKey = new Map<string, string>();
	let workflowRolesCreated = 0;
	for (const r of PROPERTY_OPS_ROLES) {
		const existingRow = existingRoleByName.get(r.name);
		if (existingRow) {
			roleIdByManifestKey.set(r.manifestKey, existingRow.id);
		} else {
			const created = await insertWorkflowRole({
				organizationId: ctx.organizationId,
				name: r.name,
				isInitiator: r.isInitiator,
			});
			roleIdByManifestKey.set(r.manifestKey, created.id);
			workflowRolesCreated += 1;
		}
	}

	// 5. Workflows -- create draft + sections/steps/fields/deps + publish.
	const createdWorkflows: InstallResult["created"]["workflows"] = [];
	for (const wf of PROPERTY_OPS_WORKFLOWS) {
		const result = await installWorkflow(ctx, wf, roleIdByManifestKey);
		createdWorkflows.push(result);
	}

	// 6. Pack install ledger row -- enforces "exactly one install per (org, pack)".
	const installRow = await insertPackInstall({
		organizationId: ctx.organizationId,
		packId: packVersion.packId,
		packVersionId: packVersion.id,
		installedBy: ctx.userId,
	});

	// 7. Audit + activity (one row for the install itself; per-workflow audit lands
	//    via the workflow.created / workflow_version.published events fired above).
	await writeAuditAndActivity({
		organizationId: ctx.organizationId,
		actorUserId: ctx.userId,
		action: "pack.installed",
		verb: "installed",
		entityType: "solution_pack",
		entityId: packVersion.packId,
		changes: {
			packSlug: PROPERTY_OPS_PACK_SLUG,
			packVersionId: packVersion.id,
			vendorCategoriesCreated,
			workflowRolesCreated,
			workflowsCreated: createdWorkflows.length,
		},
		metadata: { packInstallId: installRow.id },
		activityData: { packName: "Property Operations" },
	});

	return {
		alreadyInstalled: false,
		packInstallId: installRow.id,
		created: {
			vendorCategories: vendorCategoriesCreated,
			workflowRoles: workflowRolesCreated,
			workflows: createdWorkflows,
		},
	};
}

async function installWorkflow(
	ctx: InstallContext,
	wf: WorkflowSeed,
	roleIdByManifestKey: Map<string, string>,
): Promise<{ workflowId: string; versionId: string; title: string }> {
	// Create the workflow + initial draft version. Pack-installed workflows persist
	// the manifest slug so PM (and other cross-product callers) can launch by slug
	// per Phase 11a step 3(a).
	const { workflowId, draftVersionId } = await createWorkflow(
		{ organizationId: ctx.organizationId, userId: ctx.userId },
		{
			title: wf.title,
			description: wf.description,
			type: wf.type,
			slug: wf.slug,
		},
	);

	// Kickoff fields (stepId = null).
	for (const f of wf.kickoffFields) {
		await insertField({
			workflowVersionId: draftVersionId,
			stepId: null,
			key: f.key,
			label: f.label,
			fieldType: f.fieldType,
			isRequired: f.isRequired ?? false,
			config: f.config ?? null,
		});
	}

	// Sections + steps + step-fields, recording the manifest-key -> db-id map for
	// step_dependency resolution after all steps exist.
	const stepIdByManifestKey = new Map<string, string>();
	for (const section of wf.sections) {
		const { id: sectionId } = await insertSection({
			workflowVersionId: draftVersionId,
			title: section.title,
		});
		for (const stepSeed of section.steps) {
			const { id: stepId } = await insertStep({
				workflowVersionId: draftVersionId,
				sectionId,
				assignedRoleId: stepSeed.roleManifestKey
					? (roleIdByManifestKey.get(stepSeed.roleManifestKey) ?? null)
					: null,
				type: "task",
				title: stepSeed.title,
				description: stepSeed.description,
				isStopTask: stepSeed.isStopTask ?? false,
				dueType: stepSeed.dueOffsetDays !== undefined ? "offset_from_start" : "none",
				dueOffsetDays: stepSeed.dueOffsetDays ?? null,
			});
			stepIdByManifestKey.set(stepSeed.manifestKey, stepId);
			for (const f of stepSeed.fields ?? []) {
				await insertField({
					workflowVersionId: draftVersionId,
					stepId,
					key: f.key,
					label: f.label,
					fieldType: f.fieldType,
					isRequired: f.isRequired ?? false,
					config: f.config ?? null,
				});
			}
		}
	}

	// Step dependencies (after all steps exist).
	for (const section of wf.sections) {
		for (const stepSeed of section.steps) {
			for (const depKey of stepSeed.dependsOn ?? []) {
				const depStepId = stepIdByManifestKey.get(depKey);
				const fromStepId = stepIdByManifestKey.get(stepSeed.manifestKey);
				if (!depStepId || !fromStepId) continue;
				await insertStepDependency({
					stepId: fromStepId,
					dependsOnStepId: depStepId,
				});
			}
		}
	}

	// Publish the version so it's immediately runnable.
	await publishVersion(
		{ organizationId: ctx.organizationId, userId: ctx.userId },
		{ versionId: draftVersionId },
	);

	return { workflowId, versionId: draftVersionId, title: wf.title };
}

/** Helper for the procedure layer: just checks the pack_install state without
 * any writes. Returns the platform pack's existence + whether the org has installed. */
export async function getPropertyOpsInstallStatus(
	organizationId: string,
): Promise<{
	packAvailable: boolean;
	installed: boolean;
	installedAt: Date | null;
}> {
	const packVersion = await getPropertyOpsPackVersion();
	if (!packVersion) {
		return { packAvailable: false, installed: false, installedAt: null };
	}
	const install = await getPackInstallForOrg(organizationId, packVersion.packId);
	return {
		packAvailable: true,
		installed: install !== null,
		installedAt: install?.installedAt ?? null,
	};
}
