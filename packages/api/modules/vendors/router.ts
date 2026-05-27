import { create } from "./procedures/create";
import { createContact } from "./procedures/create-contact";
import { get } from "./procedures/get";
import { list } from "./procedures/list";
import { listForLauncher } from "./procedures/list-for-launcher";
import { softDelete } from "./procedures/soft-delete";
import { update } from "./procedures/update";
import { updateContact } from "./procedures/update-contact";

export const vendorsRouter = {
	list,
	listForLauncher,
	get,
	create,
	update,
	softDelete,
	createContact,
	updateContact,
};
