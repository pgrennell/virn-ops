// Shared launcher types. LaunchMode mirrors the server's enum in
// packages/api/modules/runs/lib/launch-run.ts. Kept in lib (not components) so both
// LauncherForm and LaunchModePicker can import without a circular dep.

export type LaunchMode = "human" | "ai_assisted" | "automated";
