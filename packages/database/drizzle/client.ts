import { drizzle } from "drizzle-orm/node-postgres";

import * as schema from "./schema/postgres";

// Check the drizzle documentation for more information on how to connect to your preferred database provider
// https://orm.drizzle.team/docs/get-started-postgresql

const databaseUrl = process.env.DATABASE_URL as string;

if (!databaseUrl) {
	throw new Error("DATABASE_URL is not set");
}

export const db = drizzle(databaseUrl, {
	schema,
});

/**
 * Either the top-level Drizzle client (`db`) or the transaction handle passed to a
 * `db.transaction` callback. Query helpers that may participate in a larger transaction
 * accept this as an optional final parameter, defaulting to `db`.
 *
 * Why this matters: multi-step mutations in the run engine and elsewhere need atomicity
 * — a crash between `markRunStepCompleted` and the audit-log insert would leave history
 * desynced. Each mutation helper that takes `executor: DbExecutor = db` can be called
 * either standalone or inside `withTransaction(...)` for atomic composition.
 */
export type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Run `fn` inside a Drizzle transaction. The `tx` handle has the same query API as `db`
 * but routes all writes through a single Postgres transaction; pass it to mutation
 * helpers that accept `DbExecutor` for atomic multi-step writes.
 */
export function withTransaction<T>(
	fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
	return db.transaction(fn);
}
