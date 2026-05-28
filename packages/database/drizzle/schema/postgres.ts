// packages/database/drizzle/schema/postgres.ts
//
// Barrel for the Postgres schema. Per CLAUDE.md / ARCHITECTURE.md §6: "One file per domain
// group; each file exports its pgTable(s) and relations(), all re-exported from
// schema/postgres.ts." Add new domain files here as they land.

export * from "./auth";
export * from "./_shared";
export * from "./config";
export * from "./agents";
export * from "./vendors";
export * from "./listings";
export * from "./entitysets";
export * from "./workflows";
export * from "./runs";
export * from "./automation";
export * from "./governance";
export * from "./library";
export * from "./packs";
export * from "./fields";
export * from "./entitlements";
export * from "./rbac";
export * from "./audit";
export * from "./activity";
export * from "./collab";
export * from "./datasets";
export * from "./ai_authoring";
export * from "./integrations";
