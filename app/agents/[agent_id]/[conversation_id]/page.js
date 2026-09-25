import { notFound } from "next/navigation";
import { pageTitle } from "@/lib/locales";
import AgentChatClient from "../AgentChatClient";
import { requireAgentsViewer } from "../../pageData";
import { loadAgentForPage, loadConversationForPage } from "@/lib/gateway/agents/viewer";

/**
 * An existing (or just-started) chat: /agents/[agent_id]/[conversation_id]
 * Loads the agent and, when it already exists, the conversation history
 * from the visitor's workspace. A brand-new chat id has no history yet: the
 * chat UI sends the pending first message after this page mounts.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }) {
  const { agent_id } = await params;
  const { cid, locale } = await requireAgentsViewer();
  const result = await loadAgentForPage(cid, agent_id, { locale });
  return { title: result.status === "ok" ? pageTitle(locale, "agentNamed", { name: result.agent.name }) : pageTitle(locale, "agentChat") };
}

export default async function AgentConversationPage({ params }) {
  const { agent_id, conversation_id } = await params;
  const { cid, locale } = await requireAgentsViewer();
  const result = await loadAgentForPage(cid, agent_id, { locale });
  if (result.status === "missing") notFound();
  const initialHistory = result.status === "ok"
    ? await loadConversationForPage(cid, result.agent.agent_id, conversation_id)
    : null;

  return (
    <AgentChatClient
      agentDetails={result.status === "ok" ? result.agent : null}
      loadError={result.status === "error"}
      initialHistory={initialHistory}
      locale={locale}
    />
  );
}
