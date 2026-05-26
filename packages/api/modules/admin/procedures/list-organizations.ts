import { countAllOrganizations, getOrganizations } from "@virn/database";
import { z } from "zod";

import { adminProcedure } from "../../../orpc/procedures";

export const listOrganizations = adminProcedure
	.route({
		method: "GET",
		path: "/admin/organizations",
		tags: ["Administration"],
		summary: "List organizations",
	})
	.input(
		z.object({
			query: z.string().optional(),
			limit: z.number().min(1).max(100).default(10),
			offset: z.number().min(0).default(0),
		}),
	)
	.handler(async ({ input: { query, limit, offset } }) => {
		// Parallelize — the page query and the count query are independent.
		const [organizations, total] = await Promise.all([
			getOrganizations({ limit, offset, query }),
			countAllOrganizations({ query }),
		]);

		return { organizations, total };
	});
