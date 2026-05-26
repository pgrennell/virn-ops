import { getSignedUploadUrl } from "@virn/storage";
import z from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";

// Logo upload is strictly an org-admin gesture: the upload path overwrites the
// canonical `${orgId}.png` object in the avatars bucket. The org id is now
// read from session context (adminOrgProcedure) — never from input — so a
// non-admin member can't overwrite their own org's logo, and no member of one
// org can write to another org's bucket key. See AUTH_CONTRACT.md §3.1.

export const createLogoUploadUrl = adminOrgProcedure
	.route({
		method: "POST",
		path: "/organizations/logo-upload-url",
		tags: ["Organizations"],
		summary: "Create logo upload URL",
		description: "Create a signed upload URL to upload a logo image to the storage bucket",
	})
	.input(z.object({}))
	.handler(async ({ context: { organization } }) => {
		const path = `${organization.id}.png`;
		const signedUploadUrl = await getSignedUploadUrl(path, {
			bucket: "avatars",
		});

		return { signedUploadUrl, path };
	});
