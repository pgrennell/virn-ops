// packages/api/modules/datasets/procedures/get.ts
//
// Single data set fetch scoped to active org, INCLUDING all non-soft-deleted records.
// protectedOrgProcedure (read access for any member). NOT_FOUND for missing /
// archived / cross-org -- uniform response prevents cross-org existence probing.

import { ORPCError } from "@orpc/server";
import { getDataSetForOrg } from "@virn/database";
import { z } from "zod";

import { protectedOrgProcedure } from "../../../orpc/procedures";

export const get = protectedOrgProcedure
	.route({
		method: "GET",
		path: "/data-sets/{id}",
		tags: ["DataSets"],
		summary: "Get a single data set by id (with records)",
		description:
			"Returns the data set + its non-deleted records, scoped to the active org. NOT_FOUND if missing, archived, or in another org.",
	})
	.input(z.object({ id: z.string().min(1) }))
	.handler(async ({ context, input }) => {
		const dataSet = await getDataSetForOrg(context.organization.id, input.id);
		if (!dataSet) {
			throw new ORPCError("NOT_FOUND", { message: "Data set not found." });
		}
		return dataSet;
	});
