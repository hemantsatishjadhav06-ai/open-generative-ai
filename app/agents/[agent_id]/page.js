import { notFound } from "next/navigation";
import AgentChatClient from "./AgentChatClient";
import { requireAgentsViewer } from "../pageData";
import { loadAgentForPage } from "@/lib/gateway/agents/viewer";

/**
 * New chat with an agent: /agents/[agent_id]
 * The agent (a built-in template or one from the visitor's workspace) is
 * read straight from the gateway store on the server; the chat itself runs
 * through /api/agents/* from the browser.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }) {
  const { agent_id } = await params;
  const { cid, locale } = await requireAgentsViewer();
  const result = await loadAgentForPage(cid, agent_id, { locale });
  return { title: result.status === "ok" ? `${result.agent.name} — Aquora` : "Agent chat — Aquora" };
}

export default async function AgentPage({ params }) {
  const { agent_id } = await params;
  const { cid, locale } = await requireAgentsViewer();
  const result = await loadAgentForPage(cid, agent_id, { locale });
  if (result.status === "missing") notFound();

  return (
    <AgentChatClient
      agentDetails={result.status === "ok" ? result.agent : null}
      loadError={result.status === "error"}
      initialHistory={null}
      locale={locale}
    />
  );
}
