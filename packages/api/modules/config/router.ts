import { applyProfile } from "./procedures/apply-profile";
import { clearCapability } from "./procedures/clear-capability";
import { clearSetting } from "./procedures/clear-setting";
import { listCapabilities } from "./procedures/list-capabilities";
import { listSettings } from "./procedures/list-settings";
import { setCapabilityEnabled } from "./procedures/set-capability-enabled";
import { setSetting } from "./procedures/set-setting";

// Plain-object router composition — matches the prevalent style across modules
// (admin, organizations, notifications, payments, users). Each procedure already
// declares its own base (protectedOrgProcedure / adminOrgProcedure / etc.); the
// router is just a grouping. No `publicProcedure.router({...})` wrapper that
// would misleadingly read as "this whole router is public" at the call site.
export const configRouter = {
	listCapabilities,
	setCapabilityEnabled,
	clearCapability,
	listSettings,
	setSetting,
	clearSetting,
	applyProfile,
};
