// Phase 10 / v1.5c (PRD §6.4) -- view-mode resolution for the canonical
// workflow detail page at /[orgSlug]/library/workflows/[id].
//
// PRD §6.4 calls for `/library/workflows/[id]?view={author|read}` to be the
// single canonical URL with a viewer-permission default. Physically the two
// views still live at sibling routes (`/builder`, `/read`) because their
// shells differ -- but the bare detail URL exists as a redirect router that
// honors the query param + role default.
//
// Decision matrix:
//
//   view=author + admin -> /builder
//   view=author + member -> /read       (member has no edit perms; redirect
//                                        to the read view they can use)
//   view=read   + any   -> /read
//   no view + admin     -> /builder     (admin default)
//   no view + member    -> /read        (member default)
//
// Why a pure function: the Next.js page is a thin wrapper that calls this
// resolver after assertCanSee threads role + slug + id. The resolver is
// unit-testable without standing up the gating-server snapshot machinery.

export type WorkflowViewParam = "author" | "read" | undefined;

export interface WorkflowViewResolution {
	/** Path to redirect to, relative to the workflow detail. Always starts with
	 * `/` and is absolute under the org-scoped route. */
	redirectTo: string;
}

export interface ResolveViewArgs {
	organizationSlug: string;
	workflowId: string;
	/** Raw value of `?view=` from searchParams. Anything other than the two
	 * literal values is treated as omitted (defensive against typos / drift). */
	viewParam: string | string[] | undefined;
	/** Whether the viewing user has admin/owner-grade write permission. */
	isAdminOrOwner: boolean;
}

function normalizeViewParam(raw: string | string[] | undefined): WorkflowViewParam {
	const value = Array.isArray(raw) ? raw[0] : raw;
	if (value === "author" || value === "read") return value;
	return undefined;
}

export function resolveWorkflowView(
	args: ResolveViewArgs,
): WorkflowViewResolution {
	const view = normalizeViewParam(args.viewParam);
	const base = `/${args.organizationSlug}/library/workflows/${args.workflowId}`;

	// Explicit author intent: admin gets the Builder; member falls back to read
	// (their session can't edit anyway).
	if (view === "author") {
		return {
			redirectTo: args.isAdminOrOwner ? `${base}/builder` : `${base}/read`,
		};
	}

	// Explicit read intent or member default: read view.
	if (view === "read" || !args.isAdminOrOwner) {
		return { redirectTo: `${base}/read` };
	}

	// No view + admin: builder (admin default).
	return { redirectTo: `${base}/builder` };
}
