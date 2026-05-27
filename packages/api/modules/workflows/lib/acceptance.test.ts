// THE acceptance test. The whole point of Pass 1.
//
// Walk the full build -> publish -> launchRun loop with an in-memory @virn/database
// stub. Assert that the run snapshot launchRun produces from the published version
// carries the expected steps, the expected per-step fields, and -- most importantly --
// the field KEYS preserved through the snapshot (Invariant #5: keys are the stable
// identity; the run's field_value rows reference the same field rows the published
// version pins).
//
// If this passes, the authoring half (builder API) and the execution half (run engine
// snapshot) are wired together: a workflow built through this API can be launched.
//
// The store is intentionally minimal -- it covers exactly the surface launchRun reads
// and the builder lib writes. Anything outside that surface is mocked to no-op.

import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// In-memory store (hoisted so vi.mock factories can reach it).
// ---------------------------------------------------------------------------

interface Store {
	workflows: Map<string, { id: string; organizationId: string; title: string; type: string; deletedAt: Date | null }>;
	versions: Map<
		string,
		{
			id: string;
			workflowId: string;
			versionNumber: number;
			status: "draft" | "published" | "archived";
			publishedAt: Date | null;
			publishedBy: string | null;
		}
	>;
	sections: Map<string, { id: string; workflowVersionId: string; title: string; position: number }>;
	steps: Map<
		string,
		{
			id: string;
			workflowVersionId: string;
			sectionId: string | null;
			assignedRoleId: string | null;
			type: string;
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
	>;
	fields: Map<
		string,
		{
			id: string;
			workflowVersionId: string;
			stepId: string | null;
			key: string;
			label: string;
			fieldType: string;
			config: Record<string, unknown> | null;
			isRequired: boolean;
			position: number;
		}
	>;
	dependencies: Array<{ stepId: string; dependsOnStepId: string }>;
	auditWrites: Array<{ action: string; entityType: string; entityId: string }>;
	runSnapshots: Array<unknown>; // captured for assertion
	nextId: number;
}

const { store, nextId } = vi.hoisted(() => {
	const s: Store = {
		workflows: new Map(),
		versions: new Map(),
		sections: new Map(),
		steps: new Map(),
		fields: new Map(),
		dependencies: [],
		auditWrites: [],
		runSnapshots: [],
		nextId: 1,
	};
	const next = () => `id_${s.nextId++}`;
	return { store: s, nextId: next };
});

function resetStore() {
	store.workflows.clear();
	store.versions.clear();
	store.sections.clear();
	store.steps.clear();
	store.fields.clear();
	store.dependencies = [];
	store.auditWrites = [];
	store.runSnapshots = [];
	store.nextId = 1;
}

// ---------------------------------------------------------------------------
// Mock @virn/database surface. Every function the builder + run engine read or write
// resolves against the in-memory store.
// ---------------------------------------------------------------------------

vi.mock("@virn/database", () => {
	const dbStub = {
		query: {
			workflowVersion: {
				findFirst: vi.fn(),
			},
			section: {
				findMany: vi.fn(async (opts: {
					where: (
						s: { id: string; workflowVersionId: string },
						helpers: { eq: (lhs: unknown, rhs: unknown) => null },
					) => unknown;
					orderBy?: unknown;
				}) => {
					// Sniff the where clause to find the workflowVersionId being queried.
					let targetVersionId: string | undefined;
					const marker = { id: "_marker_", workflowVersionId: { __isMarker: true } as unknown as string };
					const eqShim = (lhs: unknown, rhs: unknown) => {
						if (
							typeof lhs === "object" &&
							lhs !== null &&
							(lhs as { __isMarker?: boolean }).__isMarker === true
						) {
							targetVersionId = String(rhs);
						}
						return null;
					};
					opts.where(marker, { eq: eqShim });
					if (!targetVersionId) return [];
					return [...store.sections.values()]
						.filter((s) => s.workflowVersionId === targetVersionId)
						.sort((a, b) => a.position - b.position);
				}),
			},
		},
		transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(dbStub)),
	};

	dbStub.query.workflowVersion.findFirst.mockImplementation(async (opts?: {
		where?: (v: typeof versionShape, h: { eq: typeof eq; and: typeof and }) => unknown;
		with?: Record<string, unknown>;
	}) => {
		const versionId = (opts as unknown as { __versionId?: string })?.__versionId;
		// Tests pass a custom selector via the where fn — for our acceptance walk we just
		// pick the most-recently-created draft. Simpler: surface a `__versionId` hint when
		// callers need a specific one. publish.ts and discardDraft pass `eq(vv.id, X)`,
		// so we re-implement the where-resolver below.
		if (versionId) {
			return enrichVersion(store.versions.get(versionId));
		}
		// Fallback: scan the versions and return the first matching. Drizzle's actual
		// where fn isn't trivially evaluable here, so we cheat: publishVersion uses
		// `eq(vv.id, input.versionId)` -- look up by argument. We can't read the arg,
		// so the test injects the version id via the lookup-by-id helpers below.
		return null;
	});

	const versionShape = {} as unknown;
	const eq = ((..._args: unknown[]) => null) as unknown;
	const and = ((..._args: unknown[]) => null) as unknown;

	function enrichVersion(v: Store["versions"] extends Map<string, infer V> ? V | undefined : never) {
		if (!v) return null;
		const wf = store.workflows.get(v.workflowId)!;
		const steps = [...store.steps.values()].filter((s) => s.workflowVersionId === v.id);
		const versions = [...store.versions.values()].filter((vv) => vv.workflowId === v.workflowId);
		return { ...v, workflow: { ...wf, versions }, steps };
	}

	return {
		db: dbStub,

		// --- Workflow CRUD ---
		insertWorkflowWithDraft: vi.fn(async (input: {
			organizationId: string;
			title: string;
			description: string | null;
			type: "procedure" | "document" | "policy" | "form";
			createdBy: string;
		}) => {
			const workflowId = nextId();
			const versionId = nextId();
			store.workflows.set(workflowId, {
				id: workflowId,
				organizationId: input.organizationId,
				title: input.title,
				type: input.type,
				deletedAt: null,
			});
			store.versions.set(versionId, {
				id: versionId,
				workflowId,
				versionNumber: 1,
				status: "draft",
				publishedAt: null,
				publishedBy: null,
			});
			return { workflowId, versionId };
		}),

		getWorkflowForOrg: vi.fn(async (orgId: string, workflowId: string) => {
			const w = store.workflows.get(workflowId);
			return w && w.organizationId === orgId ? w : null;
		}),

		getWorkflowWithVersions: vi.fn(async (orgId: string, workflowId: string) => {
			const w = store.workflows.get(workflowId);
			if (!w || w.organizationId !== orgId) return null;
			const versions = [...store.versions.values()]
				.filter((v) => v.workflowId === workflowId)
				.sort((a, b) => b.versionNumber - a.versionNumber);
			const draft = versions.find((v) => v.status === "draft") ?? null;
			const latestPub = versions.find((v) => v.status === "published") ?? null;
			return { workflow: w, currentDraft: draft, latestPublished: latestPub, allVersions: versions };
		}),

		// --- Section / step / field / dep CRUD ---
		insertSection: vi.fn(async (input: { workflowVersionId: string; title: string; position?: number }) => {
			const id = nextId();
			store.sections.set(id, {
				id,
				workflowVersionId: input.workflowVersionId,
				title: input.title,
				position: input.position ?? 0,
			});
			return { id };
		}),

		insertStep: vi.fn(async (input: {
			workflowVersionId: string;
			sectionId?: string | null;
			assignedRoleId?: string | null;
			type?: "task" | "approval" | "heading" | "one_off" | "code" | "ai";
			title: string;
			description?: string | null;
			position?: number;
			isRequired?: boolean;
			isStopTask?: boolean;
			dueType?: "none" | "offset_from_start" | "offset_from_step" | "from_date_field";
			dueOffsetDays?: number | null;
			dueAnchorStepId?: string | null;
			dueSourceFieldId?: string | null;
		}) => {
			const id = nextId();
			store.steps.set(id, {
				id,
				workflowVersionId: input.workflowVersionId,
				sectionId: input.sectionId ?? null,
				assignedRoleId: input.assignedRoleId ?? null,
				type: input.type ?? "task",
				title: input.title,
				description: input.description ?? null,
				position: input.position ?? 0,
				isRequired: input.isRequired ?? true,
				isStopTask: input.isStopTask ?? false,
				dueType: input.dueType ?? "none",
				dueOffsetDays: input.dueOffsetDays ?? null,
				dueAnchorStepId: input.dueAnchorStepId ?? null,
				dueSourceFieldId: input.dueSourceFieldId ?? null,
			});
			return { id };
		}),

		insertField: vi.fn(async (input: {
			workflowVersionId: string;
			stepId: string | null;
			key: string;
			label: string;
			fieldType: string;
			config?: Record<string, unknown> | null;
			isRequired?: boolean;
			position?: number;
		}) => {
			const id = nextId();
			store.fields.set(id, {
				id,
				workflowVersionId: input.workflowVersionId,
				stepId: input.stepId,
				key: input.key,
				label: input.label,
				fieldType: input.fieldType,
				config: input.config ?? null,
				isRequired: input.isRequired ?? false,
				position: input.position ?? 0,
			});
			return { id };
		}),

		insertStepDependency: vi.fn(async (input: { stepId: string; dependsOnStepId: string }) => {
			if (!store.dependencies.some((d) => d.stepId === input.stepId && d.dependsOnStepId === input.dependsOnStepId)) {
				store.dependencies.push({ stepId: input.stepId, dependsOnStepId: input.dependsOnStepId });
			}
		}),

		// --- Guards' targeted reads ---
		getVersionWithWorkflow: vi.fn(async (versionId: string) => {
			const v = store.versions.get(versionId);
			if (!v) return null;
			return { version: v, workflow: store.workflows.get(v.workflowId)! };
		}),

		getFieldWithVersion: vi.fn(async (fieldId: string) => {
			const f = store.fields.get(fieldId);
			if (!f) return null;
			return { field: f, version: store.versions.get(f.workflowVersionId)! };
		}),

		getStepWithVersion: vi.fn(async (stepId: string) => {
			const s = store.steps.get(stepId);
			if (!s) return null;
			return { step: s, version: store.versions.get(s.workflowVersionId)! };
		}),

		getSectionWithVersion: vi.fn(async (sectionId: string) => {
			const s = store.sections.get(sectionId);
			if (!s) return null;
			return { section: s, version: store.versions.get(s.workflowVersionId)! };
		}),

		// --- Lock-check probes (no references in this test) ---
		findFieldByKey: vi.fn(async (workflowVersionId: string, key: string, excludeFieldId?: string) => {
			const match = [...store.fields.values()].find(
				(f) => f.workflowVersionId === workflowVersionId && f.key === key && f.id !== excludeFieldId,
			);
			return match ? { id: match.id } : null;
		}),

		findFieldReferencers: vi.fn(async () => []), // no automation_conditions or due-sources in this fixture

		findStepReferencers: vi.fn(async (stepId: string) => {
			const out: Array<{ type: "step_dependency_blocker" | "due_anchor"; stepId: string }> = [];
			for (const d of store.dependencies) {
				if (d.dependsOnStepId === stepId) {
					out.push({ type: "step_dependency_blocker", stepId: d.stepId });
				}
			}
			for (const s of store.steps.values()) {
				if (s.dueAnchorStepId === stepId) {
					out.push({ type: "due_anchor", stepId: s.id });
				}
			}
			return out;
		}),

		// --- Publish primitives ---
		publishVersionRow: vi.fn(async (input: { versionId: string; publishedByUserId: string }) => {
			const v = store.versions.get(input.versionId);
			if (!v || v.status !== "draft") return false;
			store.versions.set(v.id, {
				...v,
				status: "published",
				publishedAt: new Date(),
				publishedBy: input.publishedByUserId,
			});
			return true;
		}),

		// --- Run engine reads (THIS is the launch-compatibility contract) ---
		getLatestPublishedWorkflowVersion: vi.fn(async (workflowId: string) => {
			const versions = [...store.versions.values()]
				.filter((v) => v.workflowId === workflowId && v.status === "published")
				.sort((a, b) => b.versionNumber - a.versionNumber);
			return versions[0] ?? null;
		}),

		getWorkflowVersionById: vi.fn(async (versionId: string) => store.versions.get(versionId) ?? null),

		getVersionLaunchBundle: vi.fn(async (workflowVersionId: string) => {
			const steps = [...store.steps.values()]
				.filter((s) => s.workflowVersionId === workflowVersionId)
				.sort((a, b) => a.position - b.position);
			const fields = [...store.fields.values()]
				.filter((f) => f.workflowVersionId === workflowVersionId)
				.sort((a, b) => a.position - b.position);
			const stepIds = new Set(steps.map((s) => s.id));
			const deps = store.dependencies.filter((d) => stepIds.has(d.stepId));
			return { steps, fields, deps };
		}),

		// --- Run snapshot (captures what launchRun WROTE) ---
		insertRunSnapshot: vi.fn(async (input: {
			organizationId: string;
			workflowId: string;
			workflowVersionId: string;
			title: string;
			startedAt: Date;
			steps: Array<{ stepId: string; title: string; dueAt: Date | null; position: number }>;
			kickoffValues: Array<{ fieldId: string; value: unknown }>;
			participants: Array<{ tempKey: string }>;
			roleAssignments: unknown[];
			stepAssignments: unknown[];
		}) => {
			const runId = nextId();
			store.runSnapshots.push({ runId, input });
			const runStepIdByStepId = new Map<string, string>();
			for (const s of input.steps) runStepIdByStepId.set(s.stepId, nextId());
			const participantIdByTempKey = new Map<string, string>();
			for (const p of input.participants) participantIdByTempKey.set(p.tempKey, nextId());
			return { runId, runStepIdByStepId, participantIdByTempKey };
		}),

		// --- Validation passthrough (real validateFieldValue does Zod parsing; for the
		// acceptance walk we accept any value, since the keys are what we're asserting). ---
		validateFieldValue: vi.fn((_f: unknown, v: unknown) => v),

		// --- Audit no-op (assertions don't depend on audit shape here; D-017/D-018
		// audit shapes are covered in publish.test.ts + fork.test.ts). ---
		writeAuditAndActivity: vi.fn(async (input: { action: string; entityType: string; entityId: string }) => {
			store.auditWrites.push({
				action: input.action,
				entityType: input.entityType,
				entityId: input.entityId,
			});
		}),

		// --- Fork-path support ---
		nextVersionNumber: vi.fn(async (workflowId: string) => {
			const max = [...store.versions.values()]
				.filter((v) => v.workflowId === workflowId)
				.reduce((m, v) => (v.versionNumber > m ? v.versionNumber : m), 0);
			return max + 1;
		}),

		insertDraftVersion: vi.fn(async (input: { workflowId: string; versionNumber: number }) => {
			const id = nextId();
			store.versions.set(id, {
				id,
				workflowId: input.workflowId,
				versionNumber: input.versionNumber,
				status: "draft",
				publishedAt: null,
				publishedBy: null,
			});
			return { id };
		}),

		// updateStep is hit by the fork-path patch step (remapping dueAnchorStepId/
		// dueSourceFieldId). For this acceptance fixture neither is set on any step,
		// so the call list will be empty -- but wire it anyway so the surface exists.
		updateStep: vi.fn(async (input: { stepId: string; dueAnchorStepId?: string | null; dueSourceFieldId?: string | null }) => {
			const s = store.steps.get(input.stepId);
			if (!s) return;
			if (input.dueAnchorStepId !== undefined) s.dueAnchorStepId = input.dueAnchorStepId;
			if (input.dueSourceFieldId !== undefined) s.dueSourceFieldId = input.dueSourceFieldId;
		}),

		// --- Stubs for surfaces this test doesn't exercise ---
		archiveWorkflow: vi.fn(),
		deleteField: vi.fn(),
		deleteSection: vi.fn(),
		deleteStep: vi.fn(),
		deleteStepDependency: vi.fn(),
		deleteVersion: vi.fn(),
		deleteWorkflowRole: vi.fn(),
		findLockedFieldIds: vi.fn(async () => new Set()),
		getVersionEditBundle: vi.fn(),
		insertWorkflowRole: vi.fn(),
		listWorkflowsForOrg: vi.fn(),
		listWorkflowRolesForOrg: vi.fn(),
		reorderSteps: vi.fn(),
		updateField: vi.fn(),
		updateSection: vi.fn(),
		updateWorkflow: vi.fn(),
		updateWorkflowRole: vi.fn(),
	};
});

// Now wire dbStub.query.workflowVersion.findFirst against the store. publishVersion calls
// it with `where: (vv, { eq }) => eq(vv.id, X)` -- we sniff the eq call to extract X.
import { db } from "@virn/database";
// Replace the default findFirst with a version-aware shim. We call store directly.
(db as unknown as {
	query: { workflowVersion: { findFirst: ReturnType<typeof vi.fn> } };
}).query.workflowVersion.findFirst.mockImplementation(
	async (opts: {
		where: (
			v: { id: string },
			helpers: {
				eq: (lhs: unknown, rhs: unknown) => null;
				and: (...args: unknown[]) => null;
			},
		) => unknown;
	}) => {
		// We invoke the where fn with a "marker" object whose id field is a Symbol; the
		// helpers capture whichever id is being equated. Cheap, version-agnostic.
		let targetId: string | undefined;
		const marker = { id: { __isMarker: true } as unknown as string };
		const eqShim = (lhs: unknown, rhs: unknown) => {
			if (
				typeof lhs === "object" &&
				lhs !== null &&
				(lhs as { __isMarker?: boolean }).__isMarker === true
			) {
				targetId = String(rhs);
			}
			return null;
		};
		const andShim = (..._args: unknown[]) => null;
		opts.where(marker, { eq: eqShim, and: andShim });
		if (!targetId) return null;
		const v = store.versions.get(targetId);
		if (!v) return null;
		const wf = store.workflows.get(v.workflowId)!;
		const steps = [...store.steps.values()].filter((s) => s.workflowVersionId === v.id);
		const versions = [...store.versions.values()].filter((vv) => vv.workflowId === v.workflowId);
		return { ...v, workflow: { ...wf, versions }, steps };
	},
);

// ---------------------------------------------------------------------------
// The actual test
// ---------------------------------------------------------------------------

// Imported AFTER the mock so they pick up our store-backed @virn/database.
import { launchRun } from "../../runs/lib/launch-run";

import { createWorkflow } from "./workflow";
import { createSection, createStep, createField, addStepDependency } from "./structure";
import { publishVersion } from "./publish";

const CTX = { organizationId: "org_1", userId: "user_1" };

beforeEach(() => {
	resetStore();
});

describe("ACCEPTANCE: build a workflow through the API, publish, launch a run", () => {
	it("snapshot carries every step + the field KEYS preserved verbatim", async () => {
		// 1. Build a workflow + initial draft.
		const { workflowId, draftVersionId } = await createWorkflow(CTX, {
			title: "Onboarding",
			description: "Acceptance test workflow",
			type: "procedure",
		});
		expect(workflowId).toBeTruthy();
		expect(draftVersionId).toBeTruthy();
		expect(store.versions.get(draftVersionId)!.status).toBe("draft");

		// 2. Add a section.
		const sec = await createSection(CTX, {
			workflowVersionId: draftVersionId,
			title: "Setup",
		});

		// 3. Add two steps in the section.
		const step1 = await createStep(CTX, {
			workflowVersionId: draftVersionId,
			sectionId: sec.id,
			title: "Collect signed agreement",
			isStopTask: true,
		});
		const step2 = await createStep(CTX, {
			workflowVersionId: draftVersionId,
			sectionId: sec.id,
			title: "Provision accounts",
		});

		// 4. Kickoff field + step fields.
		const kickoffField = await createField(CTX, {
			workflowVersionId: draftVersionId,
			stepId: null,
			label: "Customer name",
			fieldType: "text",
			isRequired: true,
		});
		expect(kickoffField.key).toBe("customer_name"); // auto-slug

		const refField = await createField(CTX, {
			workflowVersionId: draftVersionId,
			stepId: step1.id,
			label: "Reference number",
			fieldType: "text",
			isRequired: true,
		});
		expect(refField.key).toBe("reference_number");

		const systemsField = await createField(CTX, {
			workflowVersionId: draftVersionId,
			stepId: step2.id,
			label: "Systems provisioned",
			fieldType: "multiselect",
			isRequired: true,
			config: { options: ["Email", "Slack", "GitHub"] },
		});
		expect(systemsField.key).toBe("systems_provisioned");

		// 5. Step2 depends on step1 completing (stop-task).
		await addStepDependency(CTX, {
			stepId: step2.id,
			dependsOnStepId: step1.id,
		});

		// 6. Publish.
		const publishResult = await publishVersion(CTX, { versionId: draftVersionId });
		expect(publishResult).toEqual({ versionId: draftVersionId, versionNumber: 1 });
		expect(store.versions.get(draftVersionId)!.status).toBe("published");

		// 7. Launch a run off the published workflow via the run engine's launchRun.
		const launched = await launchRun(CTX, {
			workflowId,
			kickoffValues: { customer_name: "Acme Corp" },
			roleAssignments: [],
		});
		expect(launched.runId).toBeTruthy();

		// 8. The snapshot's the proof. Assert insertRunSnapshot saw what we expect.
		const snapshot = store.runSnapshots[0] as {
			runId: string;
			input: {
				workflowId: string;
				workflowVersionId: string;
				steps: Array<{ stepId: string; title: string }>;
				kickoffValues: Array<{ fieldId: string; value: unknown }>;
			};
		};
		expect(snapshot.input.workflowId).toBe(workflowId);
		expect(snapshot.input.workflowVersionId).toBe(draftVersionId);

		// Steps: both, in position order, with definition stepIds matching what we built.
		expect(snapshot.input.steps).toHaveLength(2);
		const snapshotStepIds = snapshot.input.steps.map((s) => s.stepId);
		expect(snapshotStepIds).toEqual([step1.id, step2.id]);
		expect(snapshot.input.steps.map((s) => s.title)).toEqual([
			"Collect signed agreement",
			"Provision accounts",
		]);

		// THE LOAD-BEARING ASSERTION: kickoff field value lands keyed by the field row
		// the published version pins. The fieldId in the snapshot's kickoffValues must
		// resolve back to the field whose key is `customer_name` -- proving the key
		// crosses the build -> publish -> snapshot boundary intact (Invariant #5).
		expect(snapshot.input.kickoffValues).toHaveLength(1);
		const kickoffFieldId = snapshot.input.kickoffValues[0].fieldId;
		const pinnedField = store.fields.get(kickoffFieldId);
		expect(pinnedField).toBeDefined();
		expect(pinnedField!.key).toBe("customer_name");
		expect(snapshot.input.kickoffValues[0].value).toBe("Acme Corp");

		// And the step fields exist in the published version, keyed correctly. (They're
		// not in the snapshot rows -- they're FK'd via field_value -> field.id at
		// completion time. We assert they survive in the version.)
		const versionFields = [...store.fields.values()].filter(
			(f) => f.workflowVersionId === draftVersionId,
		);
		const keysInVersion = versionFields.map((f) => f.key).sort();
		expect(keysInVersion).toEqual(["customer_name", "reference_number", "systems_provisioned"]);
	});

	it("publishing then re-publishing through editPublished yields v1 published + v2 draft (no in-flight runs perturbed)", async () => {
		// Reuse the build pattern, publish, then editPublished to fork.
		const { workflowId, draftVersionId: v1 } = await createWorkflow(CTX, {
			title: "Workflow A",
			type: "procedure",
		});
		const step = await createStep(CTX, {
			workflowVersionId: v1,
			title: "Only step",
		});
		await createField(CTX, {
			workflowVersionId: v1,
			stepId: step.id,
			label: "Note",
			fieldType: "textarea",
		});
		await publishVersion(CTX, { versionId: v1 });
		expect(store.versions.get(v1)!.status).toBe("published");

		// Launch a run against v1 -- this run holds its own snapshot.
		const launched1 = await launchRun(CTX, {
			workflowId,
			kickoffValues: {},
			roleAssignments: [],
		});
		const snapshot1 = (store.runSnapshots[0] as { input: { workflowVersionId: string } }).input;
		expect(snapshot1.workflowVersionId).toBe(v1);
		expect(launched1.runId).toBeTruthy();

		// Now fork. v1 stays published; a v2 draft is created.
		const { editPublished } = await import("./publish");
		const fork = await editPublished(CTX, { workflowId });
		expect(fork.forked).toBe(true);
		expect(store.versions.get(fork.draftVersionId)!.status).toBe("draft");
		expect(store.versions.get(v1)!.status).toBe("published"); // UNCHANGED

		// In-flight run snapshot still references v1, not v2 (Invariant #4).
		expect(snapshot1.workflowVersionId).toBe(v1);
	});

	it("editPublished called twice in a row returns the SAME draft (resume, not double-fork)", async () => {
		const { workflowId, draftVersionId: v1 } = await createWorkflow(CTX, {
			title: "Workflow B",
			type: "procedure",
		});
		await createStep(CTX, { workflowVersionId: v1, title: "Only step" });
		await publishVersion(CTX, { versionId: v1 });

		const { editPublished } = await import("./publish");
		const first = await editPublished(CTX, { workflowId });
		expect(first.forked).toBe(true);

		const second = await editPublished(CTX, { workflowId });
		expect(second.forked).toBe(false);
		expect(second.draftVersionId).toBe(first.draftVersionId);

		// Only ONE draft for this workflow exists.
		const drafts = [...store.versions.values()].filter(
			(v) => v.workflowId === workflowId && v.status === "draft",
		);
		expect(drafts).toHaveLength(1);
	});
});
