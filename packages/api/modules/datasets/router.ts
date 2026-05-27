import { archive } from "./procedures/archive";
import { create } from "./procedures/create";
import { createRecord } from "./procedures/create-record";
import { deleteRecord } from "./procedures/delete-record";
import { get } from "./procedures/get";
import { getByKey } from "./procedures/get-by-key";
import { list } from "./procedures/list";
import { update } from "./procedures/update";
import { updateRecord } from "./procedures/update-record";

export const datasetsRouter = {
	list,
	get,
	getByKey,
	create,
	update,
	archive,
	createRecord,
	updateRecord,
	deleteRecord,
};
