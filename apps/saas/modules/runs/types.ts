// Shared types for the Run view + future Workflow Builder canvas.
// "complete" mode is what the operator sees; "view" mode is read-only for non-assignees
// and admins observing a run they're not on. "author" mode is reserved for the Workflow
// Builder — RunStepList / RunStepPanel are structurally compatible but author-mode
// affordances haven't been added yet.

export type RunViewMode = "complete" | "view" | "author";

export type StepType = "task" | "approval" | "heading" | "one_off" | "code" | "ai";

export type FieldType =
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

export type RunStepStatus = "pending" | "completed" | "skipped" | "not_applicable";

export type RunStatus = "active" | "completed" | "archived";

/** Per-field save state surfaced near the input. */
export type FieldSaveState = "idle" | "saving" | "saved" | "error";
