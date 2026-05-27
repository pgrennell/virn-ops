// packages/api/modules/entities/adapters/index.ts
//
// Layer-1 EntityAdapter registry (D-034 / PRD_WORKFLOW_SOP_BUILDER.md §6.1, §8.2). A thin
// TS interface that fronts entity reads for the workflow engine, entity-set picker UIs,
// and the AI authoring system prompt. In v1.5 there's exactly one implementation
// (`ListingAdapter`); future packs add entries to the registry without changes to the
// callers that consume it.
//
// Why an adapter (not direct query imports):
//   1. The AI authoring system prompt needs a structured description of each entity's
//      schema (`schemaForAI()`) to ground generated workflows in the tenant's real
//      world. Centralizing the schema description here keeps the prompt-cacheable
//      block stable.
//   2. The workflow-engine launcher filters available workflows by entity-set
//      intersection. The adapter's `getById` lets that code path resolve an entity
//      without coupling to a specific table.
//   3. Phase 12 AI authoring's validator cross-checks entity references in generated
//      output against the live adapter registry -- "is this a real entity type the
//      tenant has?" without enumerating tables.
//
// What this is NOT:
//   - It is NOT a per-tenant ORM/repository abstraction. Heavy reads still go through
//     `@virn/database` queries directly. The adapter surface is intentionally narrow.
//   - It is NOT a place to put org-scoping logic. Callers pass `organizationId`
//     explicitly; adapter implementations enforce it via the underlying queries.

import {
	getListingForOrg,
	listListingsForOrg,
} from "@virn/database";

/**
 * The set of polymorphic entity types the workflow engine knows about. In v1.5 only
 * `'listing'` is wired through; the union widens as adapters land.
 *
 * Kept in lockstep with `entitySetMember.entity_type` in the schema -- adding a value here
 * means registering an adapter implementation below AND extending the schema enum.
 */
export type EntityType = "listing";

/**
 * Reference shape the workflow engine and entity-set picker UIs consume. Lightweight on
 * purpose: name + id + a few display hints. Adapters can attach `extra` for type-specific
 * affordances (a listing's address; a vendor's primary contact) without forcing a wider
 * interface.
 */
export interface EntityRef {
	type: EntityType;
	id: string;
	name: string;
	subtitle?: string | null; // e.g. listing.propertyType, vendor.category.name
	extra?: Record<string, unknown>;
}

/**
 * Structured schema description fed into the Phase 12 AI authoring system prompt. Kept
 * minimal in v1.5 (name + fields with type hints); the AI consumer only needs enough to
 * reference fields when emitting structured workflow JSON. Expand as authoring quality
 * dogfooding reveals what the model actually needs.
 */
export interface EntitySchemaForAI {
	type: EntityType;
	label: string;
	description: string;
	fields: Array<{
		key: string;
		label: string;
		dataType: "text" | "number" | "boolean" | "date" | "json";
		nullable: boolean;
		description?: string;
	}>;
	/** Common cohort dimensions an author might filter on. The AI uses these to suggest
	 * entity-set memberships in generated workflows ("create a set for STR penthouses"). */
	commonCohortDimensions?: string[];
}

/**
 * The adapter surface. Implementations are pure read-only — writes live in the
 * domain-specific query helpers (createListing, etc.) and stay out of the adapter so the
 * adapter can be type-narrowed to "things the workflow engine needs to know."
 */
export interface EntityAdapter<T extends EntityType> {
	readonly type: T;
	/** All non-soft-deleted entities of this type in the org, ordered for display. */
	listForOrg(organizationId: string): Promise<EntityRef[]>;
	/** Resolve a single entity by id, scoped to the org. Returns null if missing,
	 * cross-org, or soft-deleted. */
	getById(organizationId: string, id: string): Promise<EntityRef | null>;
	/** Schema description for the AI authoring system prompt. Pure (no DB I/O) so it can
	 * be invoked synchronously while assembling a prompt; the description should be
	 * stable across requests and safe to embed in a cacheable system-prompt block. */
	schemaForAI(): EntitySchemaForAI;
}

// ---------------------------------------------------------------------------
// ListingAdapter -- the only registered adapter in v1.5
// ---------------------------------------------------------------------------

export const ListingAdapter: EntityAdapter<"listing"> = {
	type: "listing",

	async listForOrg(organizationId) {
		const rows = await listListingsForOrg(organizationId);
		return rows.map((l) => ({
			type: "listing" as const,
			id: l.id,
			name: l.name,
			subtitle: l.propertyType,
			extra: {
				externalListingId: l.externalListingId,
				address: l.address,
			},
		}));
	},

	async getById(organizationId, id) {
		const l = await getListingForOrg(organizationId, id);
		if (!l) return null;
		return {
			type: "listing" as const,
			id: l.id,
			name: l.name,
			subtitle: l.propertyType,
			extra: {
				externalListingId: l.externalListingId,
				address: l.address,
			},
		};
	},

	schemaForAI() {
		return {
			type: "listing",
			label: "Listing",
			description:
				"A single unit a property-ops org manages — vacation rental, leased apartment, commercial suite, multifamily unit. Cohort membership via entity sets is the canonical categorization; property_type is a convenience hint.",
			fields: [
				{ key: "name", label: "Name", dataType: "text", nullable: false },
				{
					key: "property_type",
					label: "Property type",
					dataType: "text",
					nullable: true,
					description:
						"Free-text hint; common values: 'str' | 'ltr' | 'commercial' | 'multifamily' | 'mixed_use'.",
				},
				{
					key: "address",
					label: "Address",
					dataType: "json",
					nullable: true,
					description: "Optional structured address: { street, city, region, postal, country }.",
				},
				{
					key: "external_listing_id",
					label: "External listing id",
					dataType: "text",
					nullable: true,
					description: "Cross-system sync identifier (Hospitable, Guesty, AppFolio, etc.).",
				},
			],
			commonCohortDimensions: [
				"property type (str / ltr / commercial / multifamily)",
				"city / region",
				"size or capacity (when available)",
				"ownership grouping",
			],
		};
	},
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** The adapter registry. Keys are `EntityType`; values are the concrete adapters. The
 * mapped-type signature guarantees an adapter exists for every value in the union, so
 * adding a new entity type without registering an adapter is a compile error. */
export const adapters: { [K in EntityType]: EntityAdapter<K> } = {
	listing: ListingAdapter,
};

/** Convenience lookup; returns undefined if `type` isn't a registered value (e.g. when a
 * caller passes user input through). Prefer `adapters[type]` when the type is statically
 * known. */
export function getAdapter(type: string): EntityAdapter<EntityType> | undefined {
	if (type in adapters) {
		return adapters[type as EntityType];
	}
	return undefined;
}

/** All registered entity types. Useful for UI dropdowns ("which type does this set hold?")
 * and for the AI authoring layer (enumerate every entity to embed in the system prompt). */
export const REGISTERED_ENTITY_TYPES: ReadonlyArray<EntityType> = Object.keys(
	adapters,
) as EntityType[];
