import { ORPCError } from "@orpc/client";
import { getOrganizationBySlug } from "@virn/database";
import slugify from "@sindresorhus/slugify";
import { nanoid } from "nanoid";
import { z } from "zod";

import { protectedProcedure } from "../../../orpc/procedures";

// Gated behind protectedProcedure: this endpoint exposes whether an org slug is
// already taken, which would enumerate customer namespaces if left public. All
// call sites today are inside the authenticated app shell (create-org and
// update-org flows). See AUTH_CONTRACT.md §7.3.
export const generateOrganizationSlug = protectedProcedure
	.route({
		method: "GET",
		path: "/organizations/generate-slug",
		tags: ["Organizations"],
		summary: "Generate organization slug",
		description: "Generate a unique slug from an organization name",
	})
	.input(
		z.object({
			name: z.string(),
		}),
	)
	.handler(async ({ input: { name } }) => {
		const baseSlug = slugify(name, {
			lowercase: true,
		});

		let slug = baseSlug;
		let hasAvailableSlug = false;

		for (let i = 0; i < 3; i++) {
			const existing = await getOrganizationBySlug(slug);

			if (!existing) {
				hasAvailableSlug = true;
				break;
			}

			slug = `${baseSlug}-${nanoid(5)}`;
		}

		if (!hasAvailableSlug) {
			throw new ORPCError("INTERNAL_SERVER_ERROR");
		}

		return { slug };
	});
