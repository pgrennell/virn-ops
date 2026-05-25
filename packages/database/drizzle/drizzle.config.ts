import { defineConfig } from "drizzle-kit";

// Migrations use the DIRECT (unpooled) Neon URL; the app runtime uses the pooled
// DATABASE_URL via drizzle/client.ts (see agents.md house rule on Neon connection split).
// Fall back to DATABASE_URL only if DIRECT_URL is unset, to keep local Docker-Compose dev
// working without two env vars — but warn loudly so production setups don't silently run
// DDL through PgBouncer.
const migrationUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;

if (!migrationUrl) {
	throw new Error(
		"drizzle-kit needs a Postgres URL. Set DIRECT_URL (Neon unpooled, preferred for migrations) " +
			"or DATABASE_URL (acceptable for local Docker dev) in your .env.local. " +
			"See .env.local.example for details.",
	);
}

if (!process.env.DIRECT_URL && process.env.NODE_ENV === "production") {
	throw new Error(
		"DIRECT_URL is required for migrations in production. Running drizzle-kit against the " +
			"pooled DATABASE_URL (PgBouncer in transaction mode) will break DDL — Neon explicitly " +
			"requires the direct/unpooled URL for schema changes. Set DIRECT_URL in your deploy env.",
	);
}

export default defineConfig({
	dialect: "postgresql",
	schema: "./drizzle/schema/postgres.ts",
	out: "./drizzle/migrations",
	dbCredentials: {
		url: migrationUrl,
	},
});
