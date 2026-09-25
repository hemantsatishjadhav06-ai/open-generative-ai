"use client";

import { AiAgent, getAgentCopy } from "ai-agent";
import "ai-agent/dist/tailwind.css";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { localizeStudioPath } from "@/lib/locales";

/**
 * AgentChatClient — renders the agent chat with the server-loaded agent and
 * optional history. Every request the chat makes goes to this site's
 * /api/agents and /api/v1 routes and is authenticated by the HttpOnly
 * session cookie, so nothing is injected here.
 */
export default function AgentChatClient({ agentDetails, initialHistory, loadError = false, locale = "en" }) {
  const router = useRouter();
  const copy = getAgentCopy(locale);

  if (loadError || !agentDetails) {
    return (
      <div className="h-screen w-full bg-surface-app flex items-center justify-center px-4 text-white">
        <div className="w-full max-w-sm text-center" role="alert">
          <h1 className="font-display text-2xl font-bold tracking-tight">{copy.chatError.title}</h1>
          <p className="mt-2 text-sm text-secondary">{copy.chatError.body}</p>
          <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
            <button
              type="button"
              onClick={() => router.refresh()}
              className="h-10 px-5 rounded-xl bg-brand text-on-brand text-sm font-semibold hover:bg-brand-hover transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              {copy.chatError.retry}
            </button>
            <Link
              href={localizeStudioPath(locale, "agents")}
              className="h-10 px-5 inline-flex items-center justify-center rounded-xl border border-white/10 bg-surface-card text-sm font-semibold text-white/80 hover:text-white hover:border-white/20 transition-colors"
            >
              {copy.backToAgents}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-full bg-surface-app">
      <AiAgent
        initialAgentDetails={agentDetails}
        initialHistory={initialHistory}
        historyPreloaded
        locale={locale}
      />
    </div>
  );
}
