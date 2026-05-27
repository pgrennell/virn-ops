import { create } from "./procedures/create";
import { get } from "./procedures/get";
import { list } from "./procedures/list";
import { softDelete } from "./procedures/soft-delete";
import { update } from "./procedures/update";

export const listingsRouter = {
	list,
	get,
	create,
	update,
	softDelete,
};
