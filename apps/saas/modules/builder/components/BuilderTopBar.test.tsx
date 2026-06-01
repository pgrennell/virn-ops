// @vitest-environment jsdom
//
// BuilderTopBar -- the Workflow Builder header. Fully prop-driven (no data hooks), so the
// value here is its branch logic: the version chip, the concierge-review publish-gate state
// machine (direct Publish vs Submit-for-review vs in-review Approve/Send-back), the
// Enabled/Disabled toggle, the Scope chip label, the AI-authored chip (static vs clickable),
// and the conditional Edit/Discard/Preview actions. Only seam is the AuthoringPromptDialog
// child, stubbed out.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

vi.mock("./AuthoringPromptDialog", () => ({ AuthoringPromptDialog: () => null }));

import { BuilderTopBar } from "./BuilderTopBar";

afterEach(cleanup);

const base = {
	workflowTitle: "Make-ready",
	versionNumber: 2,
	versionStatus: "draft" as const,
	forkedFromVersionNumber: null as number | null,
	previewAvailable: false,
	previewActive: false,
	onTogglePreview: () => {},
	canEdit: false,
	editPending: false,
	onEdit: () => {},
	canPublish: false,
	publishPending: false,
	onPublish: () => {},
	canDiscard: false,
	discardPending: false,
	onDiscard: () => {},
};

function renderBar(overrides: Partial<Parameters<typeof BuilderTopBar>[0]> = {}) {
	return render(<BuilderTopBar {...base} {...overrides} />);
}

describe("BuilderTopBar version chip", () => {
	it("shows the status label + version number", () => {
		renderBar({ versionStatus: "published", versionNumber: 5 });
		expect(screen.getByText("Published")).toBeInTheDocument();
		expect(screen.getByText("v5")).toBeInTheDocument();
	});

	it("notes the fork parent only on a forked draft", () => {
		renderBar({ versionStatus: "draft", forkedFromVersionNumber: 3 });
		expect(screen.getByText(/forked from v3/)).toBeInTheDocument();
	});
});

describe("BuilderTopBar publish-gate state machine", () => {
	it("shows a direct Publish button when allowed and no review gate", () => {
		renderBar({ canPublish: true });
		expect(screen.getByRole("button", { name: "Publish" })).toBeInTheDocument();
	});

	it("replaces Publish with Submit for review on a draft under the review flag", () => {
		renderBar({
			canPublish: true,
			reviewState: "draft",
			requireConciergeReview: true,
			onSubmitForReview: () => {},
		});
		expect(screen.getByRole("button", { name: "Submit for review" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
	});

	it("shows Approve + Send back (no Publish) while in review", () => {
		renderBar({
			canPublish: true,
			canDiscard: true,
			reviewState: "in_review",
			requireConciergeReview: true,
			onApproveReview: () => {},
			onSendBackToDraft: () => {},
		});
		expect(screen.getByText("In review")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /Approve/ })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Send back" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Discard draft" })).not.toBeInTheDocument();
	});
});

describe("BuilderTopBar toggles + chips", () => {
	it("reflects the Enabled/Disabled active state", () => {
		const { rerender } = renderBar({ isActive: true, onToggleActive: () => {} });
		expect(screen.getByText("Enabled")).toBeInTheDocument();
		expect(screen.getByRole("switch", { name: "Enable workflow" })).toBeChecked();

		rerender(<BuilderTopBar {...base} isActive={false} onToggleActive={() => {}} />);
		expect(screen.getByText("Disabled")).toBeInTheDocument();
	});

	it("labels the scope chip by entity-set count", () => {
		const { rerender } = renderBar({ entitySetIdsCount: 0, onConfigureWorkflow: () => {} });
		expect(screen.getByText("All listings")).toBeInTheDocument();

		rerender(
			<BuilderTopBar {...base} entitySetIdsCount={3} onConfigureWorkflow={() => {}} />,
		);
		expect(screen.getByText("3 scoped")).toBeInTheDocument();
	});

	it("renders a static AI-authored chip without a promptId, clickable with one", () => {
		const { rerender } = renderBar({
			aiAuthoring: { model: "claude-sonnet-4-6", createdAt: "2026-05-27" },
		});
		expect(screen.getByText("AI-authored")).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: /AI-authored/ })).not.toBeInTheDocument();

		rerender(
			<BuilderTopBar
				{...base}
				aiAuthoring={{ model: "claude-sonnet-4-6", createdAt: "2026-05-27", promptId: "p1" }}
			/>,
		);
		expect(screen.getByRole("button", { name: /AI-authored/ })).toBeInTheDocument();
	});
});

describe("BuilderTopBar conditional actions", () => {
	it("shows Edit / Discard / Preview only when enabled", () => {
		renderBar({ canEdit: true, canDiscard: true, previewAvailable: true });
		expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Discard draft" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Preview" })).toBeInTheDocument();
	});

	it("flips the preview button label when preview is active", () => {
		renderBar({ previewAvailable: true, previewActive: true });
		expect(screen.getByRole("button", { name: "Editing" })).toBeInTheDocument();
	});
});
