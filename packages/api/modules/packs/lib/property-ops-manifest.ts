// packages/api/modules/packs/lib/property-ops-manifest.ts
//
// The PROPERTY-OPS solution pack content (BUILD_PLAN.md Phase 17a). Pure declarative
// content -- no DB calls, no side effects. `installPropertyOpsPack` (sibling file)
// translates this declaration into idempotent inserts.
//
// What's in the v1 manifest:
//   - 10 vendor categories (the property-ops set: pest-control, HVAC, plumbing,
//     landscaping, general-contractor, locksmith, cleaning, pool-spa, electrical,
//     appliance-repair).
//   - 4 org-level workflow roles (Property Manager [initiator], Housekeeper,
//     Inspector, Owner).
//   - 1 seed workflow template: STR Turnover & Housekeeping. ~17 steps across 4
//     sections, 1 kickoff form with property/booking/guest data, 1 stop-task on the
//     final "mark ready" gate.
//
// Deferred to follow-up chunks (Phase 17b-17e):
//   - 4 more seed templates: property inspection, maintenance routing, vendor
//     onboarding, tenant onboarding.
//   - Capability auto-grants when installing the pack.
//   - Setting defaults bundled with the pack.
//   - Reference automation_rules (need Phase 18 automation execution to actually fire).
//   - Data-set seeds (need Phase 9 Data Sets minimal subset).

export const PROPERTY_OPS_PACK_SLUG = "property-ops";
export const PROPERTY_OPS_PACK_NAME = "Property Operations";
export const PROPERTY_OPS_PACK_SUMMARY =
	"Starter content for property operations -- vendor categories, workflow roles, and a complete STR turnover & housekeeping template.";
export const PROPERTY_OPS_PACK_VERSION_NUMBER = 1;

// ---------------------------------------------------------------------------
// Vendor categories
// ---------------------------------------------------------------------------

export interface VendorCategorySeed {
	slug: string;
	name: string;
	description: string;
}

export const PROPERTY_OPS_VENDOR_CATEGORIES: readonly VendorCategorySeed[] = [
	{
		slug: "pest-control",
		name: "Pest Control",
		description: "Ants, roaches, rodents, termites, bedbugs. Routine + emergency.",
	},
	{
		slug: "hvac",
		name: "HVAC",
		description: "Heating, ventilation, air conditioning -- install, repair, maintenance.",
	},
	{
		slug: "plumbing",
		name: "Plumbing",
		description: "Leaks, drains, fixtures, water heaters, sewer.",
	},
	{
		slug: "electrical",
		name: "Electrical",
		description: "Wiring, outlets, fixtures, panel work, code compliance.",
	},
	{
		slug: "landscaping",
		name: "Landscaping & Grounds",
		description: "Lawn, irrigation, planting, tree work, snow removal.",
	},
	{
		slug: "cleaning",
		name: "Cleaning",
		description:
			"Turnover cleaning, deep clean, post-construction. Distinct from in-house housekeeping.",
	},
	{
		slug: "pool-spa",
		name: "Pool & Spa",
		description: "Pool service, hot-tub maintenance, chemical balancing.",
	},
	{
		slug: "locksmith",
		name: "Locksmith",
		description: "Rekey, lock replacement, smart-lock setup, lockouts.",
	},
	{
		slug: "appliance-repair",
		name: "Appliance Repair",
		description: "Fridge, oven, dishwasher, washer/dryer, microwave.",
	},
	{
		slug: "general-contractor",
		name: "General Contractor",
		description: "Multi-trade work, renovations, larger repairs.",
	},
];

// ---------------------------------------------------------------------------
// Workflow roles
// ---------------------------------------------------------------------------

export interface WorkflowRoleSeed {
	/** Stable identifier within the manifest -- used by step definitions to reference
	 * the role before its DB id is known. Never persisted; the row's name is its
	 * external identifier. */
	manifestKey: string;
	name: string;
	isInitiator: boolean;
}

export const PROPERTY_OPS_ROLES: readonly WorkflowRoleSeed[] = [
	{ manifestKey: "property-manager", name: "Property Manager", isInitiator: true },
	{ manifestKey: "housekeeper", name: "Housekeeper", isInitiator: false },
	{ manifestKey: "inspector", name: "Inspector", isInitiator: false },
	{ manifestKey: "owner", name: "Owner", isInitiator: false },
];

// ---------------------------------------------------------------------------
// Workflow template: STR Turnover & Housekeeping
// ---------------------------------------------------------------------------

// Field types -- mirrors the field_type pgEnum in schema/workflows.ts.
// (No `checkbox` -- the schema models confirmations as step completion or via
//  a single-option `select`.)
export type FieldTypeSeed =
	| "text"
	| "textarea"
	| "number"
	| "date"
	| "select"
	| "multiselect"
	| "file"
	| "image"
	| "signature"
	| "member"
	| "lookup";

export interface FieldSeed {
	key: string;
	label: string;
	fieldType: FieldTypeSeed;
	isRequired?: boolean;
	config?: Record<string, unknown> | null;
}

export interface StepSeed {
	manifestKey: string;
	title: string;
	description: string;
	roleManifestKey?: string;
	dueOffsetDays?: number;
	isStopTask?: boolean;
	/** manifestKeys of steps this one stop-task-depends on (must complete first). */
	dependsOn?: readonly string[];
	fields?: readonly FieldSeed[];
}

export interface SectionSeed {
	manifestKey: string;
	title: string;
	steps: readonly StepSeed[];
}

export interface WorkflowSeed {
	slug: string;
	title: string;
	description: string;
	type: "procedure" | "document" | "policy" | "form";
	kickoffFields: readonly FieldSeed[];
	sections: readonly SectionSeed[];
}

export const STR_TURNOVER_WORKFLOW: WorkflowSeed = {
	slug: "str-turnover-housekeeping",
	title: "STR Turnover & Housekeeping",
	description:
		"Standard turnover between guest checkout and next check-in. Covers verification, cleaning, inspection, restocking, and owner notification. Designed to run start-to-finish in one calendar day; per-step due offsets are hour-shaped but stored in days for v1 (refines once due_type=offset_from_step lands).",
	type: "procedure",
	kickoffFields: [
		{
			key: "property_name",
			label: "Property name",
			fieldType: "text",
			isRequired: true,
		},
		{
			key: "property_address",
			label: "Property address",
			fieldType: "text",
			isRequired: true,
		},
		{
			key: "unit_label",
			label: "Unit / room label",
			fieldType: "text",
			isRequired: false,
		},
		{
			key: "checkout_at",
			label: "Guest checkout (date/time)",
			fieldType: "date",
			isRequired: true,
		},
		{
			key: "next_checkin_at",
			label: "Next guest check-in (date/time)",
			fieldType: "date",
			isRequired: true,
		},
		{
			key: "booking_reference",
			label: "Booking reference",
			fieldType: "text",
			isRequired: false,
		},
		{
			key: "guest_name",
			label: "Departing guest name",
			fieldType: "text",
			isRequired: false,
		},
		{
			key: "special_instructions",
			label: "Special instructions",
			fieldType: "textarea",
			isRequired: false,
		},
	],
	sections: [
		{
			manifestKey: "sec-prep",
			title: "Pre-arrival prep",
			steps: [
				{
					manifestKey: "step-verify-checkout",
					title: "Verify checkout",
					description:
						"Confirm the guest has fully checked out. Note any flagged issues from the guest's departure (damage, lost items, complaints).",
					roleManifestKey: "property-manager",
					dueOffsetDays: 0,
					fields: [
						// (Checkout-confirmed gate is captured by step completion -- no
						//  separate field needed; the operator clicks Complete to assert.)
						{
							key: "guest_flagged_issues",
							label: "Issues flagged by departing guest",
							fieldType: "textarea",
							isRequired: false,
						},
					],
				},
				{
					manifestKey: "step-schedule-cleaning",
					title: "Schedule cleaning team",
					description:
						"Assign the housekeeper for this turnover. Note any special prep beyond the standard checklist.",
					roleManifestKey: "property-manager",
					dueOffsetDays: 0,
					fields: [
						{
							key: "cleaning_special_prep",
							label: "Special prep notes",
							fieldType: "textarea",
							isRequired: false,
						},
					],
				},
				{
					manifestKey: "step-confirm-next-guest",
					title: "Confirm next-guest details",
					description:
						"Pull next-guest particulars from the booking platform: arrival time, party size, special requests.",
					roleManifestKey: "property-manager",
					dueOffsetDays: 0,
					fields: [
						{
							key: "next_guest_party_size",
							label: "Next-guest party size",
							fieldType: "number",
							isRequired: false,
						},
						{
							key: "next_guest_requests",
							label: "Next-guest special requests",
							fieldType: "textarea",
							isRequired: false,
						},
					],
				},
			],
		},
		{
			manifestKey: "sec-clean",
			title: "Clean",
			steps: [
				{
					manifestKey: "step-trash-linens",
					title: "Trash, linens, and dishwasher",
					description:
						"Pull all trash. Strip beds + bath linens for laundry. Start the dishwasher on any leftover dishes.",
					roleManifestKey: "housekeeper",
					dueOffsetDays: 0,
				},
				{
					manifestKey: "step-kitchen",
					title: "Kitchen deep clean",
					description:
						"All appliances wiped (inside + outside). Countertops + cabinets clean. Floor mopped. Empty + restock dishwasher.",
					roleManifestKey: "housekeeper",
					dueOffsetDays: 0,
				},
				{
					manifestKey: "step-bathrooms",
					title: "Bathrooms deep clean",
					description:
						"Toilets scrubbed inside + outside. Showers + sinks scrubbed. Mirrors clean. Floor mopped. Restock toilet paper, soap, shampoo.",
					roleManifestKey: "housekeeper",
					dueOffsetDays: 0,
				},
				{
					manifestKey: "step-bedrooms",
					title: "Bedrooms",
					description:
						"Beds remade with fresh linens. Dust + vacuum. Check under beds and inside drawers for guest-left items.",
					roleManifestKey: "housekeeper",
					dueOffsetDays: 0,
					fields: [
						{
							key: "items_found",
							label: "Items found by guests",
							fieldType: "textarea",
							isRequired: false,
						},
					],
				},
				{
					manifestKey: "step-living-areas",
					title: "Living areas",
					description:
						"Vacuum + dust. Cushions arranged. Surfaces wiped. Verify remote controls + electronics in place.",
					roleManifestKey: "housekeeper",
					dueOffsetDays: 0,
				},
				{
					manifestKey: "step-touch-ups",
					title: "General touch-ups",
					description:
						"Mirrors + windows streak-free. Trash bins replaced with fresh bags. Air-fresheners refreshed.",
					roleManifestKey: "housekeeper",
					dueOffsetDays: 0,
				},
			],
		},
		{
			manifestKey: "sec-inspect",
			title: "Inspect + restock",
			steps: [
				{
					manifestKey: "step-damage-check",
					title: "Damage / wear check",
					description:
						"Walk the unit looking for damage to walls, floors, furniture, fixtures. Photograph anything new or concerning.",
					roleManifestKey: "inspector",
					dueOffsetDays: 0,
					fields: [
						{
							key: "damage_photos",
							label: "Damage / wear photos",
							fieldType: "file",
							isRequired: false,
							config: { multiple: true },
						},
						{
							key: "damage_notes",
							label: "Damage notes",
							fieldType: "textarea",
							isRequired: false,
						},
					],
				},
				{
					manifestKey: "step-functional-check",
					title: "Functional check",
					description:
						"Verify HVAC heats/cools, plumbing has no leaks, WiFi reachable, smart-locks pair, all electronics power on.",
					roleManifestKey: "inspector",
					dueOffsetDays: 0,
					fields: [
						{
							key: "systems_operational",
							label: "Operational systems (check all that pass)",
							fieldType: "multiselect",
							isRequired: true,
							config: {
								options: [
									{ value: "hvac", label: "HVAC heats/cools correctly" },
									{ value: "plumbing", label: "Plumbing OK (no leaks)" },
									{ value: "wifi", label: "WiFi reachable + at expected speed" },
									{ value: "smart_lock", label: "Smart locks paired + responsive" },
									{ value: "electronics", label: "TVs / streaming work" },
									{ value: "appliances", label: "Major appliances functional" },
								],
							},
						},
						{
							key: "functional_notes",
							label: "Any functional issues to flag",
							fieldType: "textarea",
							isRequired: false,
						},
					],
				},
				{
					manifestKey: "step-restock",
					title: "Restock consumables",
					description:
						"Top up toilet paper, hand soap, shampoo, conditioner, body wash, dish soap, dishwasher tabs, trash bags, coffee, sugar/sweetener, paper towels.",
					roleManifestKey: "inspector",
					dueOffsetDays: 0,
					fields: [
						{
							key: "restock_below_min",
							label: "Items unable to restock (note shortages)",
							fieldType: "textarea",
							isRequired: false,
						},
					],
				},
				{
					manifestKey: "step-final-walkthrough",
					title: "Final walkthrough + photos",
					description:
						"Walk the unit with fresh eyes. Photograph each room as it appears to the next guest. These photos go to the owner + serve as evidence in case of damage disputes.",
					roleManifestKey: "inspector",
					dueOffsetDays: 0,
					fields: [
						{
							key: "walkthrough_photos",
							label: "Final walkthrough photos (every room)",
							fieldType: "file",
							isRequired: true,
							config: { multiple: true },
						},
					],
				},
			],
		},
		{
			manifestKey: "sec-wrap",
			title: "Wrap up",
			steps: [
				{
					manifestKey: "step-mark-ready",
					title: "Mark unit ready for next guest",
					description:
						"Final gate -- confirms the unit has been cleaned, inspected, restocked, and photographed. Blocked until the final walkthrough is complete.",
					roleManifestKey: "inspector",
					dueOffsetDays: 0,
					isStopTask: true,
					dependsOn: ["step-final-walkthrough"],
					// Confirmation is captured by step completion -- clicking Complete
					// here is the explicit "yes, ready" gate. No field needed.
				},
				{
					manifestKey: "step-notify-owner",
					title: "Send turnover report to owner",
					description:
						"Email the owner a turnover summary -- final walkthrough photos, any damage notes, and a confirmation the unit is ready.",
					roleManifestKey: "property-manager",
					dueOffsetDays: 0,
				},
				{
					manifestKey: "step-confirm-platform",
					title: "Confirm ready on booking platform",
					description:
						"Update the booking platform (Airbnb, VRBO, Hostfully) that the unit is ready for the next guest.",
					roleManifestKey: "property-manager",
					dueOffsetDays: 0,
				},
			],
		},
	],
};

export const PROPERTY_OPS_WORKFLOWS: readonly WorkflowSeed[] = [STR_TURNOVER_WORKFLOW];
