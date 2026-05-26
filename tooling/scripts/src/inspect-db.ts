import { db } from "@virn/database";
import { logger } from "@virn/logs";

async function main() {
	const users = await db.query.user.findMany();
	console.log(`Users in database: ${users.length}`);
	for (const u of users) {
		console.log(`  - ${u.name} <${u.email}> (${u.role})`);
	}

	const orgs = await db.query.organization.findMany();
	console.log(`Organizations in database: ${orgs.length}`);
	for (const o of orgs) {
		console.log(`  - ${o.name} [slug: ${o.slug}] (${o.id})`);
	}

	const runs = await db.query.run.findMany();
	console.log(`Runs in database: ${runs.length}`);
	for (const r of runs) {
		console.log(`  - Run: ${r.title} (${r.id})`);
	}

	const participants = await db.query.participant.findMany();
	console.log(`Participants in database: ${participants.length}`);
	for (const p of participants) {
		console.log(`  - Participant: ${p.id} | Run: ${p.runId} | User: ${p.userId} | GuestEmail: ${p.guestEmail} | GuestName: ${p.guestName}`);
	}
}

main().catch(console.error);
