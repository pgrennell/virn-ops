// Phase 10 / v1.5c (PRD §6.4 / R5 cont.) -- unit tests for the verb -> sentence
// mapping in RunTimeline. The renderer itself is a thin presentation layer
// over `renderSentence`; pinning the sentence shapes here protects readability
// of the run timeline against future verb additions.

import { describe, expect, it } from "vitest";

import { renderSentence } from "./RunTimeline";

const BASE = {
	id: "evt_1",
	verb: "launched",
	actorKind: "user" as const,
	actorUserId: "usr_1",
	actorUserName: "Sam",
	actorParticipantId: null,
	crossProductOrigin: null,
	data: null,
	createdAt: new Date("2026-05-29T15:00:00Z"),
};

describe("renderSentence -- well-known verbs", () => {
	it("renders launched", () => {
		expect(renderSentence({ ...BASE, verb: "launched" })).toBe("Sam launched the run.");
	});

	it("renders completed_step with subject", () => {
		expect(
			renderSentence({
				...BASE,
				verb: "completed_step",
				data: { stepTitle: "Inspect HVAC" },
			}),
		).toBe('Sam completed step "Inspect HVAC".');
	});

	it("renders completed_step without subject", () => {
		expect(renderSentence({ ...BASE, verb: "completed_step" })).toBe(
			"Sam completed a step.",
		);
	});

	it("renders set_field_value with field label", () => {
		expect(
			renderSentence({
				...BASE,
				verb: "set_field_value",
				data: { fieldLabel: "Move-in date" },
			}),
		).toBe('Sam updated "Move-in date".');
	});
});

describe("renderSentence -- actor fallback for non-user actors", () => {
	it("uses \"An agent\" when the actor is an agent with no user name", () => {
		expect(
			renderSentence({
				...BASE,
				actorKind: "agent",
				actorUserName: null,
				verb: "completed_step",
				data: { stepTitle: "Verify ID" },
			}),
		).toBe('An agent completed step "Verify ID".');
	});

	it("uses \"A vendor\" when the actor is a vendor", () => {
		expect(
			renderSentence({
				...BASE,
				actorKind: "vendor",
				actorUserName: null,
				verb: "completed_step",
			}),
		).toBe("A vendor completed a step.");
	});

	it("uses \"A guest\" when the actor is a guest", () => {
		expect(
			renderSentence({
				...BASE,
				actorKind: "guest",
				actorUserName: null,
				verb: "set_field_value",
				data: { fieldLabel: "Access notes" },
			}),
		).toBe('A guest updated "Access notes".');
	});

	it("uses \"A teammate\" for a user-kind actor with no name", () => {
		// Edge case: user actor whose row was deleted (actor_user_id SET NULL on
		// delete) ends up with no name. Should still render readably.
		expect(
			renderSentence({
				...BASE,
				actorUserName: null,
				verb: "launched",
			}),
		).toBe("A teammate launched the run.");
	});
});

describe("renderSentence -- unknown verbs", () => {
	it("falls back to raw verb when not in the well-known set", () => {
		expect(
			renderSentence({
				...BASE,
				verb: "rotated_credential",
			}),
		).toBe("Sam rotated_credential.");
	});

	it("includes a subject in the fallback when data carries one", () => {
		expect(
			renderSentence({
				...BASE,
				verb: "rotated_credential",
				data: { title: "API key" },
			}),
		).toBe('Sam rotated_credential "API key".');
	});
});
