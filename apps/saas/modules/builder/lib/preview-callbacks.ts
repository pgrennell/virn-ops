// apps/saas/modules/builder/lib/preview-callbacks.ts
//
// The preview-mode neutralizers. RunStepPanel accepts mutation callbacks (Complete,
// SetFieldValue) that, in run mode, call the run engine. In preview mode, BuilderView
// passes THESE functions instead -- they're explicit no-ops, and the test below
// proves they don't reach any mutation.
//
// Extracted into a separate module so the no-side-effect guarantee is enforced by
// import: the BuilderView preview branch must reach for these, and only these.

export const PREVIEW_NOOP_SET_FIELD: (fieldKey: string, value: unknown) => void = (
	_fieldKey,
	_value,
) => {
	// Intentional no-op. Preview mode does NOT call runs.setFieldValue.
};

export const PREVIEW_NOOP_COMPLETE: () => void = () => {
	// Intentional no-op. Preview mode does NOT call runs.completeStep.
};
