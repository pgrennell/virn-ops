import { db, verification } from "@virn/database";
import { desc } from "drizzle-orm";

async function main() {
	console.log("Fetching latest verification records...");
	const rows = await db
		.select()
		.from(verification)
		.orderBy(desc(verification.createdAt))
		.limit(10);
	
	console.log(JSON.stringify(rows, null, 2));
}

main().catch(console.error);
