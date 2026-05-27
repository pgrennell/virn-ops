// packages/api/modules/datasets/procedures/get-by-key.ts
//
// Resolve a data set by its stable `key`. The lookup-field run UI (Phase 9b) uses this
// to render the picker from the field's config (`{ dataSetKey: "..." }`); the run
// surface never sees the data set id directly. protectedOrgProcedure -- read access.

import { ORPCError } from "@orpc/server";
import { getDataSetByKey } from "@virn/database";
import { z } from "zod";

import { protectedOrgProcedure } from "../../../orpc/procedures";

export const getByKey = protectedOrgProcedure
	.route({
		method: "GET",
		path: "/data-sets/by-key/{key}",
		tags: ["DataSets"],
		summary: "Resolve a data set by its stable key",
		description:
			"Returns the data set + records keyed by `key` (the stable identifier `lookup` field configs point at). NOT_FOUND if the key doesn't resolve in this org or the set is archived.",
	})
	.input(z.object({ key: z.string().min(1) }))
	.handler(async ({ context, input }) => {
		const dataSet = await getDataSetByKey(context.organization.id, input.key);
		if (!dataSet) {
			throw new ORPCError("NOT_FOUND", { message: "Data set not found." });
		}
		return dataSet;
	});
