"use client";

import { EditAgentPage } from "ai-agent";
import "ai-agent/dist/tailwind.css";

// Requests go to this site's /api/agents with the HttpOnly session cookie;
// nothing needs to be injected here.
export default function AgentEditClient({ locale = "en" }) {
  return <EditAgentPage locale={locale} />;
}
