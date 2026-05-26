import { db } from "@virn/database";

async function main() {
	console.log("Checking active runs...");
	const runs = await db.query.run.findMany({
		with: {
			steps: {
				with: {
					assignees: {
						with: {
							participant: true,
						}
					}
				}
			}
		}
	});

	console.log(`Found ${runs.length} runs.`);
	for (const run of runs) {
		console.log(`\nRun: ${run.title} (ID: ${run.id}, OrgId: ${run.organizationId}, Status: ${run.status})`);
		for (const step of run.steps) {
			const assignees = step.assignees.map(a => a.participant.userId).join(", ");
			console.log(`  Step: ${step.title} (ID: ${step.id}, Status: ${step.status}, Assignees: [${assignees}])`);
		}
	}
}

main().catch(console.error);
