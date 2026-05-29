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

export const PROPERTY_OPS_WORKFLOWS: readonly WorkflowSeed[] = [
	STR_TURNOVER_WORKFLOW,
	PROPERTY_INSPECTION_WORKFLOW,
	MAINTENANCE_ROUTING_WORKFLOW,
];
