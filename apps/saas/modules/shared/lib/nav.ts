// Single source of truth for the IA defined in docs/UX_SPEC.md §3.
// Every nav area's capability gate and role requirement lives here so the
// sidebar, route guards, and server-side gating read the same definition.

import type { OrganizationMemberRole } from "@virn/auth";

// ---------------------------------------------------------------------------
// Areas
// ---------------------------------------------------------------------------

export const NAV_AREAS = {
	// Operate (UX_SPEC §3, §5 — deferred operator surfaces, Admin-reachable now)
	home: "home",
	myWork: "my-work",
	runs: "runs",
	// Build
	library: "library",
	templates: "templates",
	automations: "automations",
	// Read (Phase 10 / v1.5c -- reader-facing SOP surface, PRD §6.4).
	// Distinct from `library` because:
	//   - `library` is the authoring index: it lists drafts + in-review + all
	//     workflow states, gated to author-grade roles (builder/admin/owner).
	//   - `sop` is the readers' index: it lists ONLY published workflows,
	//     gated to everyone with org membership. Operators and reviewers
	//     need to read SOPs but should not see authoring noise (drafts /
	//     review state) on a workflow that hasn't been released yet.
	// /sop, /[id]/read, and the canonical /[id] redirect all gate on this.
	sop: "sop",
	// Understand
	reports: "reports",
	// Phase 15 -- thin compliance / evidence surface (S-10). Org-scoped at
	// /[organizationSlug]/compliance. Gated on capability=compliance.pack
	// (off by default) AND role in {reviewer, admin, owner}. Surfaces the
	// audit/evidence reader. Active governance flows (acknowledge, approve,
	// re-attestation) land in Phase 16.
	compliance: "compliance",
	// Admin
	configuration: "configuration",
	membersAndRoles: "members",
	agents: "agents",
	vendors: "vendors",
	dataSets: "data-sets",
	branding: "branding",
	integrations: "integrations",
	billing: "billing",
	orgGeneral: "general",
} as const;

export type NavArea = (typeof NAV_AREAS)[keyof typeof NAV_AREAS];

// ---------------------------------------------------------------------------
// Roles (permission axis — UX_SPEC §2)
//
// Owner / Admin / Builder / Operator / Reviewer are the preset roles
// (UX_SPEC §4.4 "Preset roles"). The schema currently exposes only Better
// Auth's owner | admin | member — the custom-role layer is reserved by
// ADR-004 and lands later. `mapBetterAuthRole` is the bridge.
// ---------------------------------------------------------------------------

export const ROLES = {
	owner: "owner",
	admin: "admin",
	builder: "builder",
	operator: "operator",
	reviewer: "reviewer",
} as const;

export type RoleId = (typeof ROLES)[keyof typeof ROLES];

export const ADMIN_SUPERSET_ROLES: readonly RoleId[] = [ROLES.owner, ROLES.admin];

export function mapBetterAuthRole(role: OrganizationMemberRole | null | undefined): RoleId {
	switch (role) {
		case "owner":
			return ROLES.owner;
		case "admin":
			return ROLES.admin;
		default:
			// Until ADR-004's custom-role layer ships, treat a plain member as an Operator.
			return ROLES.operator;
	}
}

// ---------------------------------------------------------------------------
// Capability keys referenced by gating
//
// Keys come from packages/database/drizzle/queries/config.ts PROFILES. The
// `satisfies Record<..., ProfileCapabilityKey>` clause type-pins every value
// against the canonical profile-managed set — renaming or removing a key in
// PROFILES surfaces a compile error here.
// ---------------------------------------------------------------------------

import type { ProfileCapabilityKey } from "@virn/database";

export const CAPABILITIES = {
	automationRules: "automation.rules",
	integrationsWebhooks: "integrations.webhooks",
	// Workflow Builder palette gates (UX_SPEC §4.3): each authoring affordance
	// (approval step type, condition + stop-task, guest assignee, advanced field
	// types, AI step type) is gated on the org having the matching capability
	// enabled. The resolver fans these out via PROFILES in
	// @virn/database/queries/config.ts.
	governanceApprovals: "governance.approvals",
	guestParticipants: "workflows.guest_participants",
	fieldsCustomDefinitions: "fields.custom_definitions",
	// Lifts step.type=ai from reserved to live (Phase 8 step 4). Default ON across
	// all profiles per the 2026-05-26 pivot — AI is v1, not a deferred power-user
	// feature.
	agentSteps: "workflows.agent_steps",
	// Phase 15 -- compliance pack flag. NOT profile-managed (none of the three
	// enablement profiles touch it); org-level opt-in via /settings/general.
	// The satisfies clause is widened with the literal to keep the rename-safe
	// pin for profile-managed keys without requiring this one to live in a
	// PROFILES entry it doesn't belong in.
	compliancePack: "compliance.pack",
} as const satisfies Record<string, ProfileCapabilityKey | "compliance.pack">;

export type CapabilityKey = (typeof CAPABILITIES)[keyof typeof CAPABILITIES];

// ---------------------------------------------------------------------------
// Area definitions — the gating spine
// ---------------------------------------------------------------------------

export interface NavAreaDefinition {
	area: NavArea;
	/** Which preset roles may see this area. Admin/Owner is a superset (UX_SPEC §2). */
	allowedRoles: readonly RoleId[];
	/** Optional capability gate (capability axis). Undefined = always capability-enabled. */
	capability?: CapabilityKey;
	/** Phase tag for UI affordances and seo. Mirrors §3's NOW / DEFER markers. */
	phase: "now" | "defer-design";
}

export const NAV_AREA_DEFINITIONS: Record<NavArea, NavAreaDefinition> = {
	// Operate — deferred design, reachable by admins for testing (UX_SPEC §1, §5).
	[NAV_AREAS.home]: {
		area: NAV_AREAS.home,
		allowedRoles: [ROLES.operator, ROLES.builder, ROLES.reviewer, ROLES.admin, ROLES.owner],
		phase: "defer-design",
	},
	[NAV_AREAS.myWork]: {
		area: NAV_AREAS.myWork,
		allowedRoles: [ROLES.operator, ROLES.builder, ROLES.reviewer, ROLES.admin, ROLES.owner],
		phase: "defer-design",
	},
	[NAV_AREAS.runs]: {
		area: NAV_AREAS.runs,
		allowedRoles: [ROLES.operator, ROLES.builder, ROLES.admin, ROLES.owner],
		phase: "defer-design",
	},
	// Build
	[NAV_AREAS.library]: {
		area: NAV_AREAS.library,
		allowedRoles: [ROLES.builder, ROLES.admin, ROLES.owner],
		phase: "now",
	},
	[NAV_AREAS.templates]: {
		area: NAV_AREAS.templates,
		allowedRoles: [ROLES.builder, ROLES.admin, ROLES.owner],
		phase: "now",
	},
	[NAV_AREAS.automations]: {
		area: NAV_AREAS.automations,
		allowedRoles: [ROLES.builder, ROLES.admin, ROLES.owner],
		capability: CAPABILITIES.automationRules,
		phase: "now",
	},
	// Phase 10 / v1.5c (PRD §6.4) -- reader-facing SOP surface. All org members
	// can browse + read published SOPs; operators are the primary audience.
	// Authoring is still gated through `library`, which excludes operators.
	[NAV_AREAS.sop]: {
		area: NAV_AREAS.sop,
		allowedRoles: [
			ROLES.operator,
			ROLES.builder,
			ROLES.reviewer,
			ROLES.admin,
			ROLES.owner,
		],
		phase: "now",
	},
	// Understand
	[NAV_AREAS.reports]: {
		area: NAV_AREAS.reports,
		allowedRoles: [ROLES.builder, ROLES.admin, ROLES.owner],
		phase: "defer-design",
	},
	// Phase 15 -- compliance / evidence reader (S-10). Reviewer role is the
	// primary audience; admin/owner superset gets it. Capability-gated so
	// orgs that don't opt in keep the surface hidden.
	[NAV_AREAS.compliance]: {
		area: NAV_AREAS.compliance,
		allowedRoles: [ROLES.reviewer, ROLES.admin, ROLES.owner],
		capability: CAPABILITIES.compliancePack,
		phase: "now",
	},
	// Admin
	[NAV_AREAS.configuration]: {
		area: NAV_AREAS.configuration,
		allowedRoles: [ROLES.admin, ROLES.owner],
		phase: "now",
	},
	[NAV_AREAS.membersAndRoles]: {
		area: NAV_AREAS.membersAndRoles,
		allowedRoles: [ROLES.admin, ROLES.owner],
		phase: "now",
	},
	[NAV_AREAS.agents]: {
		area: NAV_AREAS.agents,
		// Admin/owner only — agents hold credentials that act on org data via the MCP
		// surface (Phase 11). Per ADR-006 + D-022, agent management is privileged.
		allowedRoles: [ROLES.admin, ROLES.owner],
		phase: "now",
	},
	[NAV_AREAS.vendors]: {
		area: NAV_AREAS.vendors,
		// Admin/owner only — vendor entries shape who can be assigned to vendor-fulfilled
		// run steps and carry per-org status flags (preferred / blacklisted / etc.) that
		// influence picker selection. Per ADR-007 + D-023.
		allowedRoles: [ROLES.admin, ROLES.owner],
		phase: "now",
	},
	[NAV_AREAS.dataSets]: {
		area: NAV_AREAS.dataSets,
		// Admin/owner only -- data sets are org-level reference catalogs (S-02).
		// Lookup fields reference them by stable key (Phase 9b).
		allowedRoles: [ROLES.admin, ROLES.owner],
		phase: "now",
	},
	[NAV_AREAS.branding]: {
		area: NAV_AREAS.branding,
		allowedRoles: [ROLES.admin, ROLES.owner],
		phase: "defer-design",
	},
	[NAV_AREAS.integrations]: {
		area: NAV_AREAS.integrations,
		allowedRoles: [ROLES.admin, ROLES.owner],
		capability: CAPABILITIES.integrationsWebhooks,
		phase: "now",
	},
	[NAV_AREAS.billing]: {
		area: NAV_AREAS.billing,
		allowedRoles: [ROLES.admin, ROLES.owner],
		phase: "now",
	},
	[NAV_AREAS.orgGeneral]: {
		area: NAV_AREAS.orgGeneral,
		allowedRoles: [ROLES.admin, ROLES.owner],
		phase: "now",
	},
};

// ---------------------------------------------------------------------------
// Nav groups (sidebar rendering)
// ---------------------------------------------------------------------------

export type NavGroupId = "operate" | "build" | "understand" | "admin";

export interface NavItem {
	area: NavArea;
	/** Route segment under `/{orgSlug}/`. For admin items this is `settings/<seg>`. */
	segment: string;
	/** Lucide icon name — keeps this file framework-free; components map it. */
	icon: string;
	/** i18n-ready label key. Translations may be added later; for now the label is the value. */
	label: string;
}

export interface NavGroup {
	id: NavGroupId;
	label: string;
	items: readonly NavItem[];
}

export const NAV_GROUPS: readonly NavGroup[] = [
	{
		id: "operate",
		label: "Operate",
		items: [
			{ area: NAV_AREAS.home, segment: "home", icon: "Home", label: "Home" },
			{ area: NAV_AREAS.myWork, segment: "my-work", icon: "CheckSquare", label: "My work" },
			{ area: NAV_AREAS.runs, segment: "runs", icon: "Play", label: "Runs" },
			{ area: NAV_AREAS.sop, segment: "sop", icon: "BookOpen", label: "SOPs" },
		],
	},
	{
		id: "build",
		label: "Build",
		items: [
			{ area: NAV_AREAS.library, segment: "library", icon: "Folder", label: "Library" },
			{ area: NAV_AREAS.templates, segment: "templates", icon: "LayoutGrid", label: "Templates" },
			{
				area: NAV_AREAS.automations,
				segment: "automations",
				icon: "Zap",
				label: "Automations",
			},
		],
	},
	{
		id: "understand",
		label: "Understand",
		items: [
			{ area: NAV_AREAS.reports, segment: "reports", icon: "BarChart3", label: "Reports" },
			// Phase 15 -- compliance / evidence reader. Hidden until the org flips
			// CAPABILITIES.compliancePack on; gated to reviewer/admin/owner.
			{ area: NAV_AREAS.compliance, segment: "compliance", icon: "ShieldCheck", label: "Compliance" },
		],
	},
	{
		id: "admin",
		label: "Admin",
		items: [
			{
				area: NAV_AREAS.configuration,
				segment: "settings/configuration",
				icon: "SlidersHorizontal",
				label: "Configuration",
			},
			{
				area: NAV_AREAS.membersAndRoles,
				segment: "settings/members",
				icon: "Users",
				label: "Members & roles",
			},
			{
				area: NAV_AREAS.agents,
				segment: "settings/agents",
				icon: "Bot",
				label: "Agents",
			},
			{
				area: NAV_AREAS.vendors,
				segment: "settings/vendors",
				icon: "Briefcase",
				label: "Vendors",
			},
			{
				area: NAV_AREAS.dataSets,
				segment: "settings/data-sets",
				icon: "Database",
				label: "Data sets",
			},
			{
				area: NAV_AREAS.branding,
				segment: "settings/branding",
				icon: "Palette",
				label: "Branding",
			},
			{
				area: NAV_AREAS.integrations,
				segment: "settings/integrations",
				icon: "Plug",
				label: "Integrations",
			},
			{ area: NAV_AREAS.billing, segment: "settings/billing", icon: "CreditCard", label: "Billing" },
			{
				area: NAV_AREAS.orgGeneral,
				segment: "settings/general",
				icon: "Settings",
				label: "Org general",
			},
		],
	},
];

export function navHref(orgSlug: string, segment: string): string {
	return `/${orgSlug}/${segment}`;
}

// ---------------------------------------------------------------------------
// Account-context nav (rendered by AccountShell)
//
// Distinct from NAV_GROUPS above: account routes live outside any org context, so
// these items use absolute paths (no orgSlug prefix). Capability/role gating
// doesn't apply — account settings are per-user.
// ---------------------------------------------------------------------------

export interface AccountNavItem {
	id: string;
	/** Absolute path. */
	href: string;
	icon: string;
	label: string;
}

export interface AccountNavGroup {
	id: string;
	label: string;
	items: readonly AccountNavItem[];
}

export const ACCOUNT_NAV_GROUPS: readonly AccountNavGroup[] = [
	{
		id: "account",
		label: "Account",
		items: [
			{ id: "general", href: "/settings/general", icon: "Settings", label: "General" },
			{ id: "security", href: "/settings/security", icon: "Lock", label: "Security" },
			{ id: "notifications", href: "/settings/notifications", icon: "Bell", label: "Notifications" },
			{ id: "billing", href: "/settings/billing", icon: "CreditCard", label: "Billing" },
		],
	},
	{
		id: "tools",
		label: "Tools",
		items: [
			{ id: "chatbot", href: "/chatbot", icon: "BotMessageSquare", label: "AI chatbot" },
		],
	},
];

/** Platform-admin (Better Auth `user.role === "admin"`) group, appended when the
 * viewer has that role. Distinct from org-admin (which is a membership role). */
export const PLATFORM_ADMIN_NAV_GROUP: AccountNavGroup = {
	id: "platform-admin",
	label: "Platform",
	items: [{ id: "admin", href: "/admin", icon: "ShieldUser", label: "Admin" }],
};
