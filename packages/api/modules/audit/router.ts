// Phase 15 -- audit module router. New top-level module; reads from audit_log
// (the rich app-level intent log written by writeAuditAndActivity everywhere).
//
// Today: a single polymorphic reader (listForEntity). Future surfaces likely
// to land here: cross-entity org-wide audit search, retention-policy admin,
// export-for-discovery flows.

import { listForEntityProc } from "./procedures/list-for-entity";

export const auditRouter = {
	listForEntity: listForEntityProc,
};
