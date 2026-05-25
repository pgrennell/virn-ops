import type { Session } from "@virn/auth";
import React from "react";

export const SessionContext = React.createContext<
	| {
			session: Session["session"] | null;
			user: Session["user"] | null;
			loaded: boolean;
			reloadSession: () => Promise<void>;
	  }
	| undefined
>(undefined);
