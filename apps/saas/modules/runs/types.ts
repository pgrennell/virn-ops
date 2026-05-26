// Shared types for the Run view + Workflow Builder canvas.
//
//   complete  the operator surface -- live inputs + Complete action.
//   view      read-only -- non-assignees, admins observing a run they're not on,
//             completed/archived runs.
//   author    the Workflow Builder canvas -- edit-template affordances composed in.
//   preview   a no-side-effect dry render of the draft. Looks like complete but every
//             interactive callback is a no-op (Pass 2 of the Builder).

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

export type RunViewMode = "complete" | "view" | "author" | "preview";

/** Per-field save state surfaced near the input. */
export type FieldSaveState = "idle" | "saving" | "saved" | "error";
