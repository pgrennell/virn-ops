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
	/** Whether the step blocks run completion. Defaults to `true` (matching
	 * `step.isRequired` default). Set `false` for steps that are skipped when
	 * the precondition doesn't apply (e.g. "notify tenant" when the unit is
	 * vacant). Until conditional visibility ships (Phase 6), `isRequired: false`
	 * is the operator's "skip when appropriate" signal. */
	isRequired?: boolean;
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

// ---------------------------------------------------------------------------
// Workflow template: Property Inspection (Phase 17b)
// ---------------------------------------------------------------------------
//
// One workflow covers four inspection occasions (move-in / move-out / periodic /
// annual / between-guests for STR) via the `inspection_type` kickoff selector.
// Property managers run the same systematic walk regardless of which occasion
// triggered it; the type drives downstream paperwork (lease attachments,
// owner reports) rather than the inspection itself. Mirrors the STR Turnover
// shape -- ~16 steps across 5 sections, stop-task on the final report gate.

export const PROPERTY_INSPECTION_WORKFLOW: WorkflowSeed = {
	slug: "property-inspection",
	title: "Property Inspection",
	description:
		"Systematic walk of a property covering exterior, grounds, interior rooms, and major systems. One workflow serves multiple occasions (move-in / move-out / periodic / annual / between-guests for STR) via the inspection_type kickoff selector. Final report gates on the photo set so the owner receives a complete record.",
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
			key: "inspection_type",
			label: "Inspection occasion",
			fieldType: "select",
			isRequired: true,
			config: {
				options: [
					{ value: "move_in", label: "Move-in (LTR)" },
					{ value: "move_out", label: "Move-out (LTR)" },
					{ value: "periodic", label: "Periodic (LTR)" },
					{ value: "annual", label: "Annual (any tenure)" },
					{ value: "between_guests", label: "Between guests (STR)" },
				],
			},
		},
		{
			key: "tenant_display_name",
			label: "Tenant / guest name",
			fieldType: "text",
			isRequired: false,
		},
		{
			key: "lease_id",
			label: "Lease / booking reference",
			fieldType: "text",
			isRequired: false,
		},
		{
			key: "access_instructions",
			label: "Access instructions",
			fieldType: "textarea",
			isRequired: false,
		},
	],
	sections: [
		{
			manifestKey: "sec-prep",
			title: "Pre-inspection prep",
			steps: [
				{
					manifestKey: "step-schedule",
					title: "Schedule inspection",
					description:
						"Confirm date + arrival window with the inspector. For LTR move-in/move-out: notify the tenant per state-required notice period. For STR between-guests: align with the turnover window so the inspection happens after cleaning, before next check-in.",
					roleManifestKey: "property-manager",
					dueOffsetDays: 0,
				},
				{
					manifestKey: "step-gather",
					title: "Gather equipment + prior notes",
					description:
						"Equipment: flashlight, moisture meter, voltage tester, camera, signed checklist. Pull the prior inspection report from the file -- known issues to verify resolved, plus the baseline state of the property.",
					roleManifestKey: "inspector",
					dueOffsetDays: 0,
					fields: [
						{
							key: "prior_inspection_notes_pulled",
							label: "Prior inspection report attached",
							fieldType: "file",
							isRequired: false,
						},
					],
				},
			],
		},
		{
			manifestKey: "sec-exterior",
			title: "Exterior + grounds",
			steps: [
				{
					manifestKey: "step-exterior",
					title: "Exterior walkaround",
					description:
						"Siding / paint / stucco condition. Roof visible from ground (no climbing). Gutters + downspouts. Foundation visible cracks. Window trim + sealant.",
					roleManifestKey: "inspector",
					dueOffsetDays: 0,
					fields: [
						{
							key: "exterior_issues",
							label: "Exterior issues observed",
							fieldType: "textarea",
							isRequired: false,
						},
					],
				},
				{
					manifestKey: "step-grounds",
					title: "Grounds + driveway",
					description:
						"Landscaping condition. Driveway + walkway surface. Fencing + gates. Irrigation visible damage. Outdoor lighting fixtures.",
					roleManifestKey: "inspector",
					dueOffsetDays: 0,
				},
				{
					manifestKey: "step-entry",
					title: "Entry + common areas",
					description:
						"Entry doors + locks + weather seals. Common-area lighting. Mailbox + intercom + smart-lock operation.",
					roleManifestKey: "inspector",
					dueOffsetDays: 0,
				},
			],
		},
		{
			manifestKey: "sec-rooms",
			title: "Interior — rooms",
			steps: [
				{
					manifestKey: "step-kitchen",
					title: "Kitchen",
					description:
						"All appliances power on + function (fridge cold, oven heats, dishwasher cycles, microwave runs, garbage disposal). Cabinets + drawers + counters condition. Sink + faucet + spray for leaks. Floor + grout condition.",
					roleManifestKey: "inspector",
					dueOffsetDays: 0,
				},
				{
					manifestKey: "step-bathrooms",
					title: "Bathrooms",
					description:
						"Toilets flush + refill cleanly. Showers / tubs for leaks + caulking. Sinks + faucets. Exhaust fan operation. Floor + grout. Cabinets.",
					roleManifestKey: "inspector",
					dueOffsetDays: 0,
				},
				{
					manifestKey: "step-bedrooms",
					title: "Bedrooms",
					description:
						"Windows open + close + lock. Closet doors + interiors. Wall + ceiling condition. Floor + carpet condition. Outlets + switches verified working.",
					roleManifestKey: "inspector",
					dueOffsetDays: 0,
				},
				{
					manifestKey: "step-living-areas",
					title: "Living areas",
					description:
						"Windows + window treatments. Walls + ceilings (water stains, cracks). Floor + baseboards. Fireplace + chimney damper (if present).",
					roleManifestKey: "inspector",
					dueOffsetDays: 0,
				},
				{
					manifestKey: "step-storage",
					title: "Garage / utility / storage",
					description:
						"Water heater (age + visible corrosion + drain pan). Breaker box (labels + tripped breakers). Garage door operation + auto-reverse safety. Crawl space / attic access if reachable.",
					roleManifestKey: "inspector",
					dueOffsetDays: 0,
				},
			],
		},
		{
			manifestKey: "sec-systems",
			title: "Interior — systems",
			steps: [
				{
					manifestKey: "step-hvac",
					title: "HVAC operation",
					description:
						"Thermostat responds. Heat cycle reaches setpoint. Cool cycle reaches setpoint. Filter date + cleanliness. Visible duct condition. Any unusual noise / smell.",
					roleManifestKey: "inspector",
					dueOffsetDays: 0,
					fields: [
						{
							key: "hvac_filter_replaced_date",
							label: "HVAC filter replaced (date)",
							fieldType: "date",
							isRequired: false,
						},
					],
				},
				{
					manifestKey: "step-plumbing",
					title: "Plumbing pressure + leaks",
					description:
						"Run every faucet hot + cold for 30 seconds. Note any pressure issues. Check under-sink for moisture. Test main shutoff is accessible.",
					roleManifestKey: "inspector",
					dueOffsetDays: 0,
				},
				{
					manifestKey: "step-electrical",
					title: "Electrical + life safety",
					description:
						"Every outlet + switch tested. GFCI buttons trip + reset (kitchen, bathrooms, exterior). Smoke detectors test-button beeps. CO detectors test-button beeps. Fire extinguisher charge gauge (if present).",
					roleManifestKey: "inspector",
					dueOffsetDays: 0,
					fields: [
						{
							key: "smoke_detectors_passed",
							label: "Smoke detectors all tested OK",
							fieldType: "select",
							isRequired: true,
							config: {
								options: [
									{ value: "pass", label: "All passed" },
									{ value: "fail", label: "One or more failed" },
									{ value: "na", label: "Not present (flagged for install)" },
								],
							},
						},
						{
							key: "co_detectors_passed",
							label: "CO detectors all tested OK",
							fieldType: "select",
							isRequired: true,
							config: {
								options: [
									{ value: "pass", label: "All passed" },
									{ value: "fail", label: "One or more failed" },
									{ value: "na", label: "Not present (flagged for install)" },
								],
							},
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
					manifestKey: "step-photos",
					title: "Final photo set",
					description:
						"One representative photo per room, plus close-ups of any noted issue. Used as the baseline for the next inspection + supports any damage disputes.",
					roleManifestKey: "inspector",
					dueOffsetDays: 0,
					fields: [
						{
							key: "inspection_photos",
							label: "Inspection photos",
							fieldType: "file",
							isRequired: true,
							config: { multiple: true },
						},
					],
				},
				{
					manifestKey: "step-report",
					title: "File inspection report + notify owner",
					description:
						"Compile observations + photos into the inspection report. Sign + date. File under the property + (for LTR) attach to the lease record. Email the owner a summary with the report attached.",
					roleManifestKey: "property-manager",
					dueOffsetDays: 0,
					isStopTask: true,
					dependsOn: ["step-photos"],
					fields: [
						{
							key: "report_filed_at",
							label: "Report filed (date/time)",
							fieldType: "date",
							isRequired: true,
						},
						{
							key: "owner_notified",
							label: "Owner notified",
							fieldType: "select",
							isRequired: true,
							config: {
								options: [
									{ value: "yes", label: "Yes — owner emailed" },
									{ value: "self_managed", label: "N/A — self-managed" },
								],
							},
						},
					],
				},
			],
		},
	],
};

// ---------------------------------------------------------------------------
// Workflow template: Maintenance Routing (Phase 17c)
// ---------------------------------------------------------------------------
//
// End-to-end work-order flow: receive request -> triage -> dispatch to vendor
// -> verify completion -> close out. Designed to handle the common case
// (tenant reports leak, PM routes to plumber, plumber fixes + invoices, PM
// closes WO) while leaving room for the optional owner-approval gate when
// cost exceeds threshold.
//
// Conditional visibility is deferred to Phase 6, so the owner-approval step
// is `isRequired: false` rather than branched -- operators skip it when
// not needed. When Phase 6 ships visibility rules, that step becomes
// hiddenByDefault + revealed when severity in {emergency, urgent} OR cost
// exceeds a configurable threshold.

export const MAINTENANCE_ROUTING_WORKFLOW: WorkflowSeed = {
	slug: "maintenance-routing",
	title: "Maintenance Routing",
	description:
		"End-to-end work-order flow: receive a maintenance request, triage severity + category, dispatch to the right vendor, verify completion, and close out with invoice reconciliation. Stop-task on the final close gate ensures the record is filed before the WO can be marked closed.",
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
			key: "tenant_display_name",
			label: "Reporting tenant / guest",
			fieldType: "text",
			isRequired: false,
		},
		{
			key: "lease_id",
			label: "Lease / booking reference",
			fieldType: "text",
			isRequired: false,
		},
		{
			key: "request_description",
			label: "Issue description",
			fieldType: "textarea",
			isRequired: true,
		},
		{
			key: "severity",
			label: "Severity",
			fieldType: "select",
			isRequired: true,
			config: {
				options: [
					{
						value: "emergency",
						label: "Emergency (life safety / habitability — same-day)",
					},
					{
						value: "urgent",
						label: "Urgent (no hot water, AC out — 24-48h)",
					},
					{
						value: "standard",
						label: "Standard (within a week)",
					},
					{
						value: "non_urgent",
						label: "Non-urgent (next scheduled visit)",
					},
				],
			},
		},
		{
			key: "request_source",
			label: "Source of request",
			fieldType: "select",
			isRequired: false,
			config: {
				options: [
					{ value: "tenant_self_serve", label: "Tenant self-service portal" },
					{ value: "phone_call", label: "Phone call / text" },
					{ value: "inspection_finding", label: "Inspection finding" },
					{ value: "pm_observed", label: "PM-observed during walk-through" },
					{ value: "owner_directed", label: "Owner-directed" },
				],
			},
		},
		{
			key: "access_instructions",
			label: "Access instructions",
			fieldType: "textarea",
			isRequired: false,
		},
		{
			key: "photo_r2_keys",
			label: "Issue photos",
			fieldType: "file",
			isRequired: false,
			config: { multiple: true },
		},
	],
	sections: [
		{
			manifestKey: "sec-triage",
			title: "Triage",
			steps: [
				{
					manifestKey: "step-acknowledge",
					title: "Acknowledge request",
					description:
						"Log the request receipt time. Send a tenant acknowledgement ('we received your request, here's the next step') if the request came in through self-service or phone. Set the internal SLA based on severity: emergency = same-day, urgent = 48h, standard = 1 week, non-urgent = next scheduled visit.",
					roleManifestKey: "property-manager",
					dueOffsetDays: 0,
					fields: [
						{
							key: "tenant_acknowledged_at",
							label: "Tenant acknowledged at",
							fieldType: "date",
							isRequired: false,
						},
					],
				},
				{
					manifestKey: "step-classify",
					title: "Classify vendor category",
					description:
						"Pick the vendor category that should handle this WO (pest-control / HVAC / plumbing / electrical / landscaping / cleaning / pool-spa / locksmith / appliance-repair / general-contractor). Drives the candidate vendor list in the next step.",
					roleManifestKey: "property-manager",
					dueOffsetDays: 0,
					fields: [
						{
							key: "vendor_category",
							label: "Vendor category",
							fieldType: "select",
							isRequired: true,
							config: {
								options: [
									{ value: "pest-control", label: "Pest Control" },
									{ value: "hvac", label: "HVAC" },
									{ value: "plumbing", label: "Plumbing" },
									{ value: "electrical", label: "Electrical" },
									{ value: "landscaping", label: "Landscaping & Grounds" },
									{ value: "cleaning", label: "Cleaning" },
									{ value: "pool-spa", label: "Pool & Spa" },
									{ value: "locksmith", label: "Locksmith" },
									{
										value: "appliance-repair",
										label: "Appliance Repair",
									},
									{
										value: "general-contractor",
										label: "General Contractor",
									},
								],
							},
						},
					],
				},
				{
					manifestKey: "step-confirm-severity",
					title: "Confirm severity",
					description:
						"Review the reporter-supplied severity in light of any photos or detail you have. Adjust if the reporter under- or over-stated (e.g. 'water everywhere' might be a slow drip, not a burst pipe). The confirmed severity drives owner-approval requirements + vendor SLA expectations.",
					roleManifestKey: "property-manager",
					dueOffsetDays: 0,
					fields: [
						{
							key: "confirmed_severity",
							label: "Confirmed severity",
							fieldType: "select",
							isRequired: true,
							config: {
								options: [
									{ value: "emergency", label: "Emergency" },
									{ value: "urgent", label: "Urgent" },
									{ value: "standard", label: "Standard" },
									{ value: "non_urgent", label: "Non-urgent" },
								],
							},
						},
					],
				},
			],
		},
		{
			manifestKey: "sec-dispatch",
			title: "Vendor selection + dispatch",
			steps: [
				{
					manifestKey: "step-select-vendor",
					title: "Select vendor + contact",
					description:
						"Pick from the preferred vendor list for the chosen category. For emergencies, check vendor on-call availability before selecting. For non-urgent: bundle with other open WOs at the same property if possible to reduce trip charges.",
					roleManifestKey: "property-manager",
					dueOffsetDays: 0,
				},
				{
					manifestKey: "step-send-wo",
					title: "Send work order",
					description:
						"Issue the work order with scope, issue photos, severity, access instructions, and authorization cap. Include the lease/booking reference so the vendor can address any tenant questions correctly.",
					roleManifestKey: "property-manager",
					dueOffsetDays: 0,
					fields: [
						{
							key: "authorization_cap_usd",
							label: "Authorization cap (USD)",
							fieldType: "number",
							isRequired: false,
						},
					],
				},
				{
					manifestKey: "step-confirm-accepted",
					title: "Confirm vendor accepted",
					description:
						"Wait for vendor acknowledgement of the WO + ETA. Re-route to a different vendor if no response within the severity-appropriate window (15 minutes for emergencies, 4 hours for urgent, 24 hours for standard).",
					roleManifestKey: "property-manager",
					dueOffsetDays: 0,
				},
				{
					manifestKey: "step-notify-tenant",
					title: "Notify tenant of scheduling",
					description:
						"Tell the tenant when the vendor will arrive and what to expect (need access? pets need to be secured? water shutoff scheduled?). Skip when there's no tenant in residence (vacant unit, STR between guests).",
					roleManifestKey: "property-manager",
					dueOffsetDays: 0,
					isRequired: false,
				},
			],
		},
		{
			manifestKey: "sec-work",
			title: "Vendor work + verification",
			steps: [
				{
					manifestKey: "step-arrival",
					title: "Track on-site arrival",
					description:
						"Log when the vendor actually arrives. Compare to the promised ETA; flag for future-vendor-scoring if significantly late without notice.",
					roleManifestKey: "property-manager",
					dueOffsetDays: 0,
					fields: [
						{
							key: "vendor_arrived_at",
							label: "Vendor arrived at",
							fieldType: "date",
							isRequired: false,
						},
					],
				},
				{
					manifestKey: "step-completion-notice",
					title: "Receive completion notice",
					description:
						"Vendor reports work complete (via text, email, or vendor portal once Phase 17+ ships). Capture the work-performed summary + any deviations from the original scope.",
					roleManifestKey: "property-manager",
					dueOffsetDays: 0,
					fields: [
						{
							key: "work_performed_summary",
							label: "Work performed (vendor's summary)",
							fieldType: "textarea",
							isRequired: true,
						},
					],
				},
				{
					manifestKey: "step-review-photos",
					title: "Review completion photos",
					description:
						"Verify before/after photos demonstrate the issue is resolved. Required for any WO exceeding the inspection threshold OR any cosmetic/visible repair. Flag for revisit if photos are missing, blurry, or inconclusive.",
					roleManifestKey: "inspector",
					dueOffsetDays: 0,
					fields: [
						{
							key: "completion_photos",
							label: "Completion photos (before / after)",
							fieldType: "file",
							isRequired: false,
							config: { multiple: true },
						},
					],
				},
				{
					manifestKey: "step-tenant-confirm",
					title: "Tenant follow-up confirmation",
					description:
						"Check with the tenant within 24 hours: is the issue actually resolved from their perspective? Catches the 'vendor fixed something but not what the tenant meant' miscommunication. Skip when the unit is vacant.",
					roleManifestKey: "property-manager",
					dueOffsetDays: 0,
					isRequired: false,
					fields: [
						{
							key: "tenant_confirmation",
							label: "Tenant confirmation",
							fieldType: "select",
							isRequired: false,
							config: {
								options: [
									{ value: "resolved", label: "Resolved — tenant satisfied" },
									{
										value: "partial",
										label: "Partial — additional work needed",
									},
									{
										value: "not_resolved",
										label: "Not resolved — re-open WO",
									},
									{ value: "vacant", label: "N/A — unit vacant" },
								],
							},
						},
					],
				},
			],
		},
		{
			manifestKey: "sec-close",
			title: "Close-out",
			steps: [
				{
					manifestKey: "step-reconcile-invoice",
					title: "Reconcile vendor invoice",
					description:
						"Match the vendor invoice against the WO scope + authorization cap. Flag any line items not pre-approved. Dispute with vendor before paying if the invoice exceeds authorization without prior change-order approval.",
					roleManifestKey: "property-manager",
					dueOffsetDays: 0,
					fields: [
						{
							key: "invoice_total_usd",
							label: "Invoice total (USD)",
							fieldType: "number",
							isRequired: false,
						},
						{
							key: "invoice_attachment",
							label: "Invoice attachment",
							fieldType: "file",
							isRequired: false,
						},
					],
				},
				{
					manifestKey: "step-owner-approval",
					title: "Owner notification + approval",
					description:
						"Required when the final cost exceeds the owner's standing-authorization threshold OR the work was non-emergency capital expenditure. Skip for routine repairs within the standing limit. (Phase 6 visibility rules will auto-reveal this step based on invoice total when shipped; today the operator includes/skips by judgment.)",
					roleManifestKey: "owner",
					dueOffsetDays: 0,
					isRequired: false,
				},
				{
					manifestKey: "step-file-record",
					title: "File work order record",
					description:
						"Compile the WO record: original request + photos, severity classification, vendor + invoice, completion photos, tenant confirmation, owner approval (if applicable). File under the property + the lease (if LTR). This is the durable record auditors and owners reference.",
					roleManifestKey: "property-manager",
					dueOffsetDays: 0,
				},
				{
					manifestKey: "step-close",
					title: "Mark work order closed",
					description:
						"Final gate -- the WO is officially closed only when the record is filed. Blocks until the previous step completes so a hurried close can't bypass the record-keeping.",
					roleManifestKey: "property-manager",
					dueOffsetDays: 0,
					isStopTask: true,
					dependsOn: ["step-file-record"],
				},
			],
		},
	],
};

// ---------------------------------------------------------------------------
// Workflow template: Vendor Onboarding (Phase 17d)
// ---------------------------------------------------------------------------
//
// End-to-end intake of a new vendor into the org's preferred-vendor list.
// Covers initial intake, documentation collection (W-9, COI, license),
// references, insurance verification, scope agreement, and system
// activation. Stop-task on the final activation gate ensures the vendor
// can't be marked active in the launcher until everything upstream is
// signed off.
//
// The workflow's natural caller is the PM bringing on a vendor in a new
// service category (e.g. setting up a plumber relationship for a new
// property), or formalizing an existing ad-hoc relationship.
//
// Insurance-verification steps are written for U.S. commercial-liability
// norms (GL + WC + auto coverage minimums + additional-insured
// endorsement). When the vendor sync surface eventually feeds licensed-
// vendor databases (post-v1), the license-verification step can auto-
// fill from that source.

export const VENDOR_ONBOARDING_WORKFLOW: WorkflowSeed = {
	slug: "vendor-onboarding",
	title: "Vendor Onboarding",
	description:
		"Bring a new vendor into the preferred-vendor list. Covers intake, documentation (W-9, COI, license), references, insurance verification, scope agreement, and system activation. Stop-task on the final activation gate so the vendor can't appear in launcher pickers until everything upstream is signed off.",
	type: "procedure",
	kickoffFields: [
		{
			key: "vendor_business_name",
			label: "Vendor business name",
			fieldType: "text",
			isRequired: true,
		},
		{
			key: "vendor_contact_name",
			label: "Primary contact name",
			fieldType: "text",
			isRequired: true,
		},
		{
			key: "vendor_phone",
			label: "Primary contact phone",
			fieldType: "text",
			isRequired: false,
		},
		{
			key: "vendor_email",
			label: "Primary contact email",
			fieldType: "text",
			isRequired: false,
		},
		{
			key: "vendor_category",
			label: "Service category",
			fieldType: "select",
			isRequired: true,
			config: {
				options: [
					{ value: "pest-control", label: "Pest Control" },
					{ value: "hvac", label: "HVAC" },
					{ value: "plumbing", label: "Plumbing" },
					{ value: "electrical", label: "Electrical" },
					{ value: "landscaping", label: "Landscaping & Grounds" },
					{ value: "cleaning", label: "Cleaning" },
					{ value: "pool-spa", label: "Pool & Spa" },
					{ value: "locksmith", label: "Locksmith" },
					{ value: "appliance-repair", label: "Appliance Repair" },
					{ value: "general-contractor", label: "General Contractor" },
				],
			},
		},
		{
			key: "vendor_referral_source",
			label: "How were they referred?",
			fieldType: "text",
			isRequired: false,
		},
		{
			key: "intended_property_scope",
			label: "Properties they'll serve",
			fieldType: "textarea",
			isRequired: false,
		},
		{
			key: "urgency",
			label: "Onboarding urgency",
			fieldType: "select",
			isRequired: false,
			config: {
				options: [
					{
						value: "emergency_replacement",
						label: "Emergency replacement — same-week activation",
					},
					{
						value: "standard",
						label: "Standard (within 2-3 weeks)",
					},
					{
						value: "wait_listed",
						label: "Wait-listed (backup vendor; activate when current vendor lapses)",
					},
				],
			},
		},
	],
	sections: [
		{
			manifestKey: "sec-intake",
			title: "Initial intake",
			steps: [
				{
					manifestKey: "step-initial-call",
					title: "Initial call",
					description:
						"Capture services offered, business form (sole proprietor / LLC / corp), years in business, service area + coverage hours. Note whether they're licensed + insured + bonded before sending the onboarding packet.",
					roleManifestKey: "property-manager",
					dueOffsetDays: 0,
					fields: [
						{
							key: "intake_call_notes",
							label: "Intake call notes",
							fieldType: "textarea",
							isRequired: false,
						},
					],
				},
				{
					manifestKey: "step-send-packet",
					title: "Send onboarding packet",
					description:
						"Email the vendor: W-9 form, insurance requirements (GL + WC + auto if applicable), reference request form, scope-of-work template, and the additional-insured endorsement language. Include 7-day turnaround target.",
					roleManifestKey: "property-manager",
					dueOffsetDays: 0,
				},
				{
					manifestKey: "step-receive-packet",
					title: "Receive completed packet",
					description:
						"Log receipt of W-9 + COI + license docs + references. If any document is missing, follow up before proceeding to verification (the verification steps assume the documents are in hand).",
					roleManifestKey: "property-manager",
					dueOffsetDays: 0,
					fields: [
						{
							key: "packet_received_at",
							label: "Packet received (date)",
							fieldType: "date",
							isRequired: false,
						},
						{
							key: "packet_attachments",
							label: "Submitted documents",
							fieldType: "file",
							isRequired: false,
							config: { multiple: true },
						},
					],
				},
			],
		},
		{
			manifestKey: "sec-documents",
			title: "Documentation verification",
			steps: [
				{
					manifestKey: "step-verify-w9",
					title: "Verify W-9",
					description:
						"Name on W-9 matches the legal business name. EIN (or SSN for sole proprietors) is filled. Business address matches what they gave on the intake call. Box checked for tax classification.",
					roleManifestKey: "property-manager",
					dueOffsetDays: 0,
				},
				{
					manifestKey: "step-verify-license",
					title: "Verify license",
					description:
						"Look up the license number against the state licensing board. Confirm: license is current (not expired), classification covers the category (e.g. plumber license for plumbing vendor), no recent disciplinary actions. Skip for categories that don't require licensing in your state (e.g. general cleaning often doesn't).",
					roleManifestKey: "property-manager",
					dueOffsetDays: 0,
					isRequired: false,
					fields: [
						{
							key: "license_number",
							label: "License number",
							fieldType: "text",
							isRequired: false,
						},
						{
							key: "license_expiration",
							label: "License expiration date",
							fieldType: "date",
							isRequired: false,
						},
					],
				},
				{
					manifestKey: "step-insurance-baseline",
					title: "Insurance baseline check",
					description:
						"Vendor carries General Liability AND (if they have employees) Workers Compensation AND (if they drive to job sites in marked vehicles) commercial auto. Skip baseline coverage types not applicable to this vendor's category (e.g. WC waived for sole-proprietor categories per state rules).",
					roleManifestKey: "property-manager",
					dueOffsetDays: 0,
					fields: [
						{
							key: "carries_gl",
							label: "General Liability",
							fieldType: "select",
							isRequired: true,
							config: {
								options: [
									{ value: "yes", label: "Yes" },
									{ value: "no", label: "No (deal-breaker)" },
								],
							},
						},
						{
							key: "carries_wc",
							label: "Workers Compensation",
							fieldType: "select",
							isRequired: false,
							config: {
								options: [
									{ value: "yes", label: "Yes" },
									{ value: "waived", label: "Waived (sole proprietor)" },
									{ value: "no", label: "No (deal-breaker if has employees)" },
								],
							},
						},
					],
				},
			],
		},
		{
			manifestKey: "sec-references",
			title: "References",
			steps: [
				{
					manifestKey: "step-reference-1",
					title: "Call reference 1",
					description:
						"Reach the first reference. Confirm they've actually worked with this vendor. Ask: scope + duration of the relationship, quality of work, communication / responsiveness, any issues, would they hire again.",
					roleManifestKey: "property-manager",
					dueOffsetDays: 0,
					fields: [
						{
							key: "reference_1_notes",
							label: "Reference 1 notes",
							fieldType: "textarea",
							isRequired: false,
						},
					],
				},
				{
					manifestKey: "step-reference-2",
					title: "Call reference 2",
					description:
						"Second reference, same questions. If reference 1 was lukewarm or you couldn't reach them, prioritize getting a strong reference 2 before moving forward. If 2/2 references are weak, decline the vendor at this gate -- the agreement-signing step downstream is much harder to reverse.",
					roleManifestKey: "property-manager",
					dueOffsetDays: 0,
					fields: [
						{
							key: "reference_2_notes",
							label: "Reference 2 notes",
							fieldType: "textarea",
							isRequired: false,
						},
					],
				},
			],
		},
		{
			manifestKey: "sec-insurance",
			title: "Insurance verification",
			steps: [
				{
					manifestKey: "step-coi-limits",
					title: "COI matches required limits",
					description:
						"Check the Certificate of Insurance against your minimum coverage requirements. Typical baseline for residential property work: GL $1M/$2M, WC statutory, auto $1M CSL. Note the policy expiration date and set a calendar reminder for renewal verification 30 days out.",
					roleManifestKey: "property-manager",
					dueOffsetDays: 0,
					fields: [
						{
							key: "coi_policy_expiration",
							label: "Policy expiration date",
							fieldType: "date",
							isRequired: true,
						},
						{
							key: "coi_attachment",
							label: "COI document",
							fieldType: "file",
							isRequired: false,
						},
					],
				},
				{
					manifestKey: "step-additional-insured",
					title: "Additional insured endorsement",
					description:
						"For categories with elevated liability exposure (general contractor, electrical, plumbing, pool/spa), require the vendor to add your management entity as an additional insured on their GL policy. Verify the endorsement is attached to the COI. Skip for low-exposure categories (cleaning, landscaping) unless your owners require it.",
					roleManifestKey: "property-manager",
					dueOffsetDays: 0,
					isRequired: false,
				},
			],
		},
		{
			manifestKey: "sec-activation",
			title: "Agreement + activation",
			steps: [
				{
					manifestKey: "step-scope-agreement",
					title: "Scope of work agreement",
					description:
						"Sign the scope-of-work agreement: services covered, pricing model (flat rate / T&M / per visit), dispatch protocol (how WOs are received, ETAs for each severity), invoicing cadence + payment terms, authorization cap for non-emergency work without prior PM approval.",
					roleManifestKey: "property-manager",
					dueOffsetDays: 0,
					fields: [
						{
							key: "agreement_signed_at",
							label: "Agreement signed (date)",
							fieldType: "date",
							isRequired: false,
						},
						{
							key: "agreement_attachment",
							label: "Signed agreement",
							fieldType: "file",
							isRequired: false,
						},
						{
							key: "authorization_cap_usd",
							label: "Default authorization cap (USD)",
							fieldType: "number",
							isRequired: false,
						},
					],
				},
				{
					manifestKey: "step-add-to-system",
					title: "Add vendor to system",
					description:
						"Create the vendor record in Virn: business name, primary contact, category, status='approved'. If they're a backup vendor (urgency='wait_listed'), set status='approved' but flag in notes -- the launcher picker still surfaces them but the PM can prefer-sort accordingly.",
					roleManifestKey: "property-manager",
					dueOffsetDays: 0,
				},
				{
					manifestKey: "step-test-dispatch",
					title: "Test dispatch (optional)",
					description:
						"For higher-stakes categories (general contractor, HVAC, plumbing for emergency response), send a low-stakes test WO to validate the dispatch flow + their responsiveness before relying on them for emergencies. Skip for lower-stakes categories or when urgency='emergency_replacement'.",
					roleManifestKey: "property-manager",
					dueOffsetDays: 0,
					isRequired: false,
				},
				{
					manifestKey: "step-activate",
					title: "Mark vendor active in launcher",
					description:
						"Final gate. Flip the vendor's isActive flag to true so they appear in the launcher's vendor picker for new runs. Blocks until the vendor's been added to the system above -- the activation gate exists so a half-onboarded vendor can't surface in pickers and accidentally get dispatched.",
					roleManifestKey: "property-manager",
					dueOffsetDays: 0,
					isStopTask: true,
					dependsOn: ["step-add-to-system"],
				},
			],
		},
	],
};

// ---------------------------------------------------------------------------
// Workflow template: Tenant Onboarding (Phase 17e)
// ---------------------------------------------------------------------------
//
// One workflow serves both LTR move-in AND STR guest pre-arrival via a
// `tenancy_type` kickoff selector. Most steps apply to both modes; a few
// are marked `isRequired: false` so the operator skips them when the
// tenancy_type doesn't apply (e.g. STR guests don't sign a residential
// lease; LTR move-ins don't need check-in/check-out timestamps).
//
// The PM judgment is the gate today; when Phase 6 visibility rules ship,
// the optional steps auto-show/hide based on tenancy_type. Until then,
// the step descriptions explicitly call out when each step is or isn't
// applicable.
//
// Stop-task on the final filing gate ensures the onboarding record is
// complete + filed before the run is marked done.

export const TENANT_ONBOARDING_WORKFLOW: WorkflowSeed = {
	slug: "tenant-onboarding",
	title: "Tenant Onboarding",
	description:
		"Bring a new tenant or guest in. One workflow serves both long-term residential move-in (LTR) and short-term guest pre-arrival (STR) via the tenancy_type kickoff selector. Covers pre-arrival prep, documents + payment, key handoff, orientation, and post-arrival check-in. Stop-task on the final filing gate so the onboarding record is complete before the run closes.",
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
			key: "tenancy_type",
			label: "Tenancy type",
			fieldType: "select",
			isRequired: true,
			config: {
				options: [
					{
						value: "long_term_lease",
						label: "Long-term residential lease (LTR)",
					},
					{
						value: "short_term_guest",
						label: "Short-term guest (STR)",
					},
					{
						value: "corporate_furnished",
						label: "Corporate / furnished mid-term (30+ days)",
					},
				],
			},
		},
		{
			key: "tenant_display_name",
			label: "Tenant / guest name",
			fieldType: "text",
			isRequired: true,
		},
		{
			key: "lease_id",
			label: "Lease / booking reference",
			fieldType: "text",
			isRequired: false,
		},
		{
			key: "move_in_date",
			label: "Move-in / check-in date",
			fieldType: "date",
			isRequired: true,
		},
		{
			key: "lease_term_months",
			label: "Lease term (months, LTR only)",
			fieldType: "number",
			isRequired: false,
		},
		{
			key: "monthly_rent_usd",
			label: "Monthly rent / nightly rate (USD)",
			fieldType: "number",
			isRequired: false,
		},
		{
			key: "security_deposit_usd",
			label: "Security deposit (USD, LTR only)",
			fieldType: "number",
			isRequired: false,
		},
		{
			key: "party_size",
			label: "Party size (STR only)",
			fieldType: "number",
			isRequired: false,
		},
		{
			key: "pet_disclosed",
			label: "Pet disclosed?",
			fieldType: "select",
			isRequired: false,
			config: {
				options: [
					{ value: "no", label: "No" },
					{ value: "yes_approved", label: "Yes — approved" },
					{ value: "yes_pending", label: "Yes — pending review" },
					{ value: "not_disclosed", label: "Not disclosed (LTR concern)" },
				],
			},
		},
		{
			key: "special_accommodations",
			label: "Special accommodations / requests",
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
					manifestKey: "step-confirm-details",
					title: "Confirm lease / booking details",
					description:
						"Pull the lease (LTR) or booking record (STR) and verify: dates, rate, occupants, pets, parking, any special accommodations. Reconcile against the kickoff data -- mismatches are common when intake came in via multiple channels.",
					roleManifestKey: "property-manager",
					dueOffsetDays: 0,
				},
				{
					manifestKey: "step-schedule-walkthrough",
					title: "Schedule move-in walkthrough (LTR) OR confirm cleaning complete (STR)",
					description:
						"LTR: schedule the move-in walkthrough with the tenant -- ideally same day as the lease starts. STR: confirm the turnover from the previous guest is fully complete (cleaning, inspection, restock) -- block the guest from arriving early if anything's outstanding.",
					roleManifestKey: "property-manager",
					dueOffsetDays: 0,
				},
				{
					manifestKey: "step-prepare-welcome",
					title: "Prepare welcome packet",
					description:
						"LTR: keys, parking pass, building access fobs, building rules summary, emergency contact card, WiFi credentials, vendor contact info, lease addenda. STR: keys (or smart-lock code timing), WiFi credentials, house rules, local recommendations, emergency contact card, departure instructions.",
					roleManifestKey: "property-manager",
					dueOffsetDays: 0,
					fields: [
						{
							key: "welcome_packet_items_pending",
							label: "Welcome packet items still pending",
							fieldType: "textarea",
							isRequired: false,
						},
					],
				},
			],
		},
		{
			manifestKey: "sec-documents",
			title: "Documents + payment",
			steps: [
				{
					manifestKey: "step-verify-payment",
					title: "Verify deposit + first payment received",
					description:
						"LTR: confirm security deposit + first month's rent (or pro-rated first month) cleared. STR: confirm the booking payment cleared, including any cleaning fees and taxes. Block proceeding to key handoff until payment is verified -- post-handoff collection is painful.",
					roleManifestKey: "property-manager",
					dueOffsetDays: 0,
					fields: [
						{
							key: "payment_verified_at",
							label: "Payment verified (date)",
							fieldType: "date",
							isRequired: false,
						},
					],
				},
				{
					manifestKey: "step-lease-signed",
					title: "Lease signed by all parties",
					description:
						"LTR: verify the lease is signed by all listed tenants AND the property owner / management entity, with all addenda (pet, parking, smoking, HOA rules). STR: skip -- short-term bookings are governed by the platform's terms + house rules acknowledgment.",
					roleManifestKey: "property-manager",
					dueOffsetDays: 0,
					isRequired: false,
					fields: [
						{
							key: "lease_attachment",
							label: "Fully-executed lease",
							fieldType: "file",
							isRequired: false,
						},
					],
				},
				{
					manifestKey: "step-renters-insurance",
					title: "Verify renters insurance (LTR optional)",
					description:
						"If the lease requires renters insurance, confirm the tenant has a policy listing the management entity as an additional interested party. Cap the move-in if it's a strict requirement; defer + remind if it's a soft-requirement carrying a deadline. Skip for STR -- short-term guests don't carry renters insurance.",
					roleManifestKey: "property-manager",
					dueOffsetDays: 0,
					isRequired: false,
				},
			],
		},
		{
			manifestKey: "sec-handoff",
			title: "Move-in / check-in",
			steps: [
				{
					manifestKey: "step-move-in-inspection",
					title: "Move-in inspection (LTR) / Cleaning acceptance (STR)",
					description:
						"LTR: walk the unit with the tenant. Document existing condition with photos for every room -- this is the baseline for the eventual move-out inspection. Have the tenant initial each room or sign the inspection form. STR: guest doesn't typically participate in an inspection; instead, confirm the post-cleaning inspection from Phase 17a's STR turnover ran clean.",
					roleManifestKey: "inspector",
					dueOffsetDays: 0,
					fields: [
						{
							key: "move_in_inspection_photos",
							label: "Move-in inspection photos",
							fieldType: "file",
							isRequired: false,
							config: { multiple: true },
						},
						{
							key: "tenant_initialed_inspection",
							label: "Tenant initialed inspection form (LTR)",
							fieldType: "select",
							isRequired: false,
							config: {
								options: [
									{ value: "yes", label: "Yes" },
									{ value: "no", label: "No — flagged for follow-up" },
									{ value: "na", label: "N/A (STR)" },
								],
							},
						},
					],
				},
				{
					manifestKey: "step-welcome-delivered",
					title: "Welcome package delivered",
					description:
						"Hand off the welcome packet (LTR: at the walkthrough; STR: leave in the unit or send via the booking platform message). Confirm the tenant / guest knows where everything is and how to reach you for issues.",
					roleManifestKey: "property-manager",
					dueOffsetDays: 0,
				},
				{
					manifestKey: "step-key-handoff",
					title: "Key / smart-lock handoff",
					description:
						"LTR: physical keys handed over + tenant signs receipt. If the property has a smart lock, also walk them through changing the code to one they choose. STR: smart-lock code window timed to check-in/check-out per the booking; verify the code rotated correctly + the guest received it via the platform.",
					roleManifestKey: "property-manager",
					dueOffsetDays: 0,
				},
				{
					manifestKey: "step-building-access",
					title: "Building access setup (LTR)",
					description:
						"For multi-unit buildings: program the tenant's key fob / building access card, share the gate / garage code, register them with building management or HOA if required, set up mail key access. Skip entirely for STR or single-family LTR rentals.",
					roleManifestKey: "property-manager",
					dueOffsetDays: 0,
					isRequired: false,
				},
			],
		},
		{
			manifestKey: "sec-orientation",
			title: "Orientation",
			steps: [
				{
					manifestKey: "step-house-rules",
					title: "House rules + emergency contacts review",
					description:
						"Walk through (or send a recap of): quiet hours, smoking policy, pets, guests, trash pickup days, recycling rules, parking rules, what to do if the power goes out, what to do in a fire / gas leak, after-hours emergency contact.",
					roleManifestKey: "property-manager",
					dueOffsetDays: 0,
				},
				{
					manifestKey: "step-vendor-contacts",
					title: "Vendor contact card (LTR)",
					description:
						"Provide the LTR tenant with the maintenance request channel (portal URL, phone number, or email). For minor self-fix items (changing furnace filters, GFCI reset), give them basic guidance. STR guests should NOT have direct vendor contact -- they route through the PM.",
					roleManifestKey: "property-manager",
					dueOffsetDays: 0,
					isRequired: false,
				},
				{
					manifestKey: "step-amenity-orientation",
					title: "Parking + amenity orientation",
					description:
						"Pool / gym / laundry / clubhouse access codes. Pool hours, gym etiquette, laundry room operation. Parking spot location and any visitor parking rules. STR: applies if the unit has shared amenities; skip if standalone.",
					roleManifestKey: "property-manager",
					dueOffsetDays: 0,
					isRequired: false,
				},
			],
		},
		{
			manifestKey: "sec-followup",
			title: "Post-arrival follow-up",
			steps: [
				{
					manifestKey: "step-24h-check",
					title: "24-hour check-in",
					description:
						"Within 24 hours of move-in / check-in, ping the tenant / guest: anything not working? Any questions on the rules or amenities? Catches the small fixes early and signals attentive management. LTR + STR both benefit; STR especially because reviews are heavily weighted by first-impressions.",
					roleManifestKey: "property-manager",
					dueOffsetDays: 1,
				},
				{
					manifestKey: "step-30-day-check",
					title: "30-day check-in (LTR)",
					description:
						"At 30 days, schedule a brief check-in: any issues with the unit, any neighbor concerns, any rent-payment changes coming up. For STRs that converted to extended stays (corporate / mid-term), the same applies. Skip for short stays under 30 days.",
					roleManifestKey: "property-manager",
					dueOffsetDays: 30,
					isRequired: false,
				},
				{
					manifestKey: "step-file-record",
					title: "File completed onboarding record",
					description:
						"Compile: signed lease (LTR) or booking confirmation (STR), move-in inspection photos + form, payment verification, all welcome-packet acknowledgments, any pet / vehicle / accommodation addenda. File under the tenant or booking reference for the eventual move-out / departure cross-reference.",
					roleManifestKey: "property-manager",
					dueOffsetDays: 0,
				},
				{
					manifestKey: "step-close",
					title: "Mark onboarding complete",
					description:
						"Final gate. The onboarding run closes only when the record is filed -- the operator can't slip past the record-keeping by completing this step early.",
					roleManifestKey: "property-manager",
					dueOffsetDays: 0,
					isStopTask: true,
					dependsOn: ["step-file-record"],
				},
			],
		},
	],
};

export const PROPERTY_OPS_WORKFLOWS: readonly WorkflowSeed[] = [
	STR_TURNOVER_WORKFLOW,
	PROPERTY_INSPECTION_WORKFLOW,
	MAINTENANCE_ROUTING_WORKFLOW,
	VENDOR_ONBOARDING_WORKFLOW,
	TENANT_ONBOARDING_WORKFLOW,
];
