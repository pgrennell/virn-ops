// tooling/scripts/src/issue-guest-token.ts
//
// Standalone script to issue a participant token for a guest.

import { issueParticipantToken, getOrganizationBySlug, getUserByEmail } from "@virn/database";
import { logger } from "@virn/logs";

async function main() {
	const participantId = "nhqr1p5mowoh7pechah6p98f";
	const orgSlug = "virn";
	const adminEmail = "pgrennell@gmail.com";

	logger.info(`Issuing participant token for guest participant: ${participantId}`);

	const org = await getOrganizationBySlug(orgSlug);
	if (!org) {
		logger.error(`No org with slug "${orgSlug}".`);
		process.exit(1);
	}

	const user = await getUserByEmail(adminEmail);
	if (!user) {
		logger.error(`No user with email "${adminEmail}".`);
		process.exit(1);
	}

	const token = await issueParticipantToken({
		organizationId: org.id,
		participantId,
		issuedByUserId: user.id,
	});

	console.log("\n=== Token Issued Successfully ===");
	console.log(`Token ID:   ${token.tokenId}`);
	console.log(`Plaintext:  ${token.plaintext}`);
	console.log(`Expires At: ${token.expiresAt.toISOString()}`);
	console.log(`Guest URL:  http://localhost:3000/run-guest/#token=${token.plaintext}`);
	console.log("=================================\n");
}

main().catch((err) => {
	logger.error(err);
	process.exit(1);
});
