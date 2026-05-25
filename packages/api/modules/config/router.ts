import { publicProcedure } from "../../orpc/procedures";

import { applyProfile } from "./procedures/apply-profile";
import { clearCapability } from "./procedures/clear-capability";
import { clearSetting } from "./procedures/clear-setting";
import { listCapabilities } from "./procedures/list-capabilities";
import { listSettings } from "./procedures/list-settings";
import { setCapabilityEnabled } from "./procedures/set-capability-enabled";
import { setSetting } from "./procedures/set-setting";

export const configRouter = publicProcedure.router({
	listCapabilities,
	setCapabilityEnabled,
	clearCapability,
	listSettings,
	setSetting,
	clearSetting,
	applyProfile,
});
