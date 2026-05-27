// One-shot verification that the D-022 migration landed cleanly. Reads the schema state via
// information_schema + pg_catalog and prints a green/red report per expected element.
// Deletable after the commit lands — kept as a script for now in case Paul wants to re-run.

import { db } from "@virn/database";
import { sql } from "drizzle-orm";

interface Check {
	label: string;
	query: string;
	expect: (rows: Array<Record<string, unknown>>) => boolean;
}

const checks: Check[] = [
	{
		label: "enum participant_kind has user/guest/agent",
		query: `SELECT unnest(enum_range(NULL::participant_kind))::text AS v ORDER BY v;`,
		expect: (r) => {
			const vs = r.map((x) => x.v).sort();
			return JSON.stringify(vs) === JSON.stringify(["agent", "guest", "user"]);
		},
	},
	{
		label: "enum actor_kind has user/guest/agent",
		query: `SELECT unnest(enum_range(NULL::actor_kind))::text AS v ORDER BY v;`,
		expect: (r) => {
			const vs = r.map((x) => x.v).sort();
			return JSON.stringify(vs) === JSON.stringify(["agent", "guest", "user"]);
		},
	},
	{
		label: "table agent exists with 12 cols",
		query: `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'agent';`,
		expect: (r) => r[0]?.n === 12,
	},
	{
		label: "table agent_capability exists with 4 cols",
		query: `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'agent_capability';`,
		expect: (r) => r[0]?.n === 4,
	},
	{
		label: "participant.kind is NOT NULL",
		query: `SELECT is_nullable FROM information_schema.columns WHERE table_name='participant' AND column_name='kind';`,
		expect: (r) => r[0]?.is_nullable === "NO",
	},
	{
		label: "participant.agent_id exists (nullable)",
		query: `SELECT is_nullable FROM information_schema.columns WHERE table_name='participant' AND column_name='agent_id';`,
		expect: (r) => r[0]?.is_nullable === "YES",
	},
	{
		label: "audit_log.actor_kind is NOT NULL",
		query: `SELECT is_nullable FROM information_schema.columns WHERE table_name='audit_log' AND column_name='actor_kind';`,
		expect: (r) => r[0]?.is_nullable === "NO",
	},
	{
		label: "audit_log.actor_participant_id exists (nullable)",
		query: `SELECT is_nullable FROM information_schema.columns WHERE table_name='audit_log' AND column_name='actor_participant_id';`,
		expect: (r) => r[0]?.is_nullable === "YES",
	},
	{
		label: "activity_event.actor_kind is NOT NULL",
		query: `SELECT is_nullable FROM information_schema.columns WHERE table_name='activity_event' AND column_name='actor_kind';`,
		expect: (r) => r[0]?.is_nullable === "NO",
	},
	{
		label: "activity_event.actor_participant_id exists (nullable)",
		query: `SELECT is_nullable FROM information_schema.columns WHERE table_name='activity_event' AND column_name='actor_participant_id';`,
		expect: (r) => r[0]?.is_nullable === "YES",
	},
	{
		label: "participant_identity CHECK exists on participant",
		query: `SELECT count(*)::int AS n FROM pg_constraint WHERE conname='participant_identity' AND contype='c';`,
		expect: (r) => r[0]?.n === 1,
	},
	{
		label: "backfill: all participant rows have kind set",
		query: `SELECT count(*)::int AS n FROM participant WHERE kind IS NULL;`,
		expect: (r) => r[0]?.n === 0,
	},
	{
		label: "backfill: all audit_log rows have actor_kind set",
		query: `SELECT count(*)::int AS n FROM audit_log WHERE actor_kind IS NULL;`,
		expect: (r) => r[0]?.n === 0,
	},
	{
		label: "backfill: all activity_event rows have actor_kind set",
		query: `SELECT count(*)::int AS n FROM activity_event WHERE actor_kind IS NULL;`,
		expect: (r) => r[0]?.n === 0,
	},
];

async function main() {
	let fails = 0;
	for (const c of checks) {
		try {
			const result = await db.execute(sql.raw(c.query));
			const rows = (result as { rows?: unknown[] }).rows ?? (result as unknown as unknown[]);
			const ok = c.expect(rows as Array<Record<string, unknown>>);
			console.log(`${ok ? "✓" : "✗"} ${c.label}`);
			if (!ok) {
				console.log(`   rows: ${JSON.stringify(rows)}`);
				fails++;
			}
		} catch (e) {
			console.log(`✗ ${c.label} — ${(e as Error).message}`);
			fails++;
		}
	}
	console.log(fails === 0 ? "\nAll D-022 checks pass." : `\n${fails} failure(s).`);
	process.exit(fails === 0 ? 0 : 1);
}

void main();
