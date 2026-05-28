import { createLogoUploadUrl } from "./procedures/create-logo-upload-url";
import { generateOrganizationSlug } from "./procedures/generate-organization-slug";
import { listMembers } from "./procedures/list-members";
import { updateConciergeReview } from "./procedures/update-concierge-review";

export const organizationsRouter = {
	generateSlug: generateOrganizationSlug,
	createLogoUploadUrl,
	listMembers,
	updateConciergeReview, // Phase 9.5g
};
