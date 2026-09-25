"use client";

import { CreateAgentPage } from "ai-agent";
import "ai-agent/dist/tailwind.css";

// Requests go to this site's /api/agents with the HttpOnly session cookie;
// nothing needs to be injected here.
export default function AgentCreateClient({ locale = "en" }) {
  return <CreateAgentPage locale={locale} />;
}
