// Phase 16 -- suggestions module. Submit is open to any member; list +
// decide are admin-only (triage surface).

import { decideSuggestionProc } from "./procedures/decide-suggestion";
import { listSuggestionsProc } from "./procedures/list-suggestions";
import { submitSuggestionProc } from "./procedures/submit-suggestion";

export const suggestionsRouter = {
	submit: submitSuggestionProc,
	list: listSuggestionsProc,
	decide: decideSuggestionProc,
};
