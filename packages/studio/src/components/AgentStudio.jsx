"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  getTemplateAgents,
  getUserAgents,
  getUserConversations,
} from "../gateway.js";
import en from "../messages/en/agentStudio.json";
import zh from "../messages/zh/agentStudio.json";
import { resolveCopy } from "../i18nUtils";

// Agents tab: browse built-in templates, the workspace's own agents and past
// chats. Chatting, creating and editing happen on the full-screen /agents/*
// pages (the agent chat UI), which this list links into.

// ─── Helpers ────────────────────────────────────────────────────────────────
function timeAgo(dateStr, copy) {
  if (!dateStr) return "";
  const utcStr =
    dateStr.endsWith("Z") || dateStr.includes("+") ? dateStr : dateStr + "Z";
  const diff = Math.floor((Date.now() - new Date(utcStr)) / 1000);
  if (diff < 60) return copy.time.justNow;
  if (diff < 3600) return copy.time.minutesAgo.replace("{n}", Math.floor(diff / 60));
  if (diff < 86400) return copy.time.hoursAgo.replace("{n}", Math.floor(diff / 3600));
  if (diff < 604800) return copy.time.daysAgo.replace("{n}", Math.floor(diff / 86400));
  return new Date(utcStr).toLocaleDateString();
}

// ─── Agent Card (grid) ───────────────────────────────────────────────────────
function AgentCard({ agent, onClick, copy }) {
  const name = agent.name || copy.card.unnamedAgent;
  return (
    <button
      type="button"
      onClick={() => onClick(agent)}
      title={agent.description || name}
      className="group relative aspect-[4/5] rounded-xl text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
    >
      <span className="absolute inset-0 rounded-xl overflow-hidden border border-white/5 bg-[#0a1422] transition-all group-hover:border-brand/30 group-hover:scale-[1.02] shadow-2xl">
        {agent.icon_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- agent icons come from any host (or are inline SVG)
          <img
            src={agent.icon_url}
            alt=""
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
          />
        ) : (
          <span className="absolute inset-0 bg-gradient-to-br from-brand/10 to-pop/10 flex items-center justify-center">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1" className="opacity-20" aria-hidden="true">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
          </span>
        )}
        <span className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
        <span className="absolute inset-x-0 bottom-0 p-4 block">
          <span className="block text-[10px] font-bold text-brand uppercase tracking-wider mb-1">
            {agent.category || copy.card.defaultCategory}
          </span>
          <span className="block font-display text-sm font-bold text-white truncate group-hover:text-brand transition-colors">
            {name}
          </span>
          {agent.description && (
            <span className="block text-[11px] leading-snug text-white/70 mt-1 line-clamp-2">
              {agent.description}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

// ─── Conversation Card (My Chats) ────────────────────────────────────────────
function ConversationCard({ conv, onClick, copy }) {
  const displayTitle = conv.title || copy.card.newChat;
  const agentSlug = conv.agent_slug || conv.agent_id;
  return (
    <button
      type="button"
      onClick={() => onClick(agentSlug, conv.id)}
      className="group flex flex-col gap-3 text-left bg-white/[0.03] border border-white/5 rounded-xl p-4 hover:border-brand/20 hover:bg-white/5 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
    >
      <span className="flex items-center gap-3 w-full">
        <span className="relative w-10 h-10 rounded-xl overflow-hidden bg-white/5 border border-white/5 shrink-0">
          {conv.agent_icon_url ? (
            // eslint-disable-next-line @next/next/no-img-element -- agent icons come from any host (or are inline SVG)
            <img src={conv.agent_icon_url} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="w-full h-full flex items-center justify-center text-white/20">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
            </span>
          )}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[10px] font-black text-brand uppercase tracking-wider truncate">
            {conv.agent_name || copy.card.unknownAgent}
          </span>
          <span className="block text-sm font-bold text-white truncate" title={displayTitle}>
            {displayTitle}
          </span>
        </span>
      </span>
      <span className="flex items-center justify-between w-full pt-2 border-t border-white/5 mt-auto text-[10px] text-white/50 font-medium">
        <span>{timeAgo(conv.updated_at, copy)}</span>
        {conv.message_count != null && <span>{conv.message_count} {copy.card.msgsSuffix}</span>}
      </span>
    </button>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────
const TABS = ["templates", "my-agents", "my-chats"];

export default function AgentStudio({ apiKey, locale = "en" }) {
  const router = useRouter();
  const copy = resolveCopy(en, zh, locale);
  const loadFailedCopy = copy.errors.loadFailed;

  const [activeMainTab, setActiveMainTab] = useState("templates");
  const [agents, setAgents] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reloadTick, setReloadTick] = useState(0);
  const [error, setError] = useState(null);

  // Chat, create and edit live on the full-screen /agents/* pages.
  const handleSelectAgent = useCallback(
    (agent) => {
      router.push(`/agents/${encodeURIComponent(agent.agent_id || agent.id)}`);
    },
    [router]
  );

  const handleCreateAgent = useCallback(() => {
    router.push("/agents/create");
  }, [router]);

  const handleOpenConversation = useCallback(
    (agentSlug, convId) => {
      router.push(`/agents/${encodeURIComponent(agentSlug)}/${encodeURIComponent(convId)}`);
    },
    [router]
  );

  // `apiKey` is the signed-in workspace id (the shell sets it once the
  // session is known); the gateway itself authenticates with the cookie.
  useEffect(() => {
    if (!apiKey) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setAgents([]);
      setConversations([]);
      try {
        if (activeMainTab === "templates") {
          const data = await getTemplateAgents();
          if (!cancelled) setAgents(data);
        } else if (activeMainTab === "my-agents") {
          const data = await getUserAgents();
          if (!cancelled) setAgents(data);
        } else if (activeMainTab === "my-chats") {
          const data = await getUserConversations();
          if (!cancelled) setConversations(data);
        }
      } catch (err) {
        // The budget message is already friendly; anything else gets a
        // plain sentence (a 401 also opens the shell's access-code dialog).
        if (!cancelled) setError(err?.status === 402 && err.message ? err.message : loadFailedCopy);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [apiKey, activeMainTab, reloadTick, loadFailedCopy]);

  return (
    <div className="h-full flex flex-col bg-[#050b14] text-white">
      {/* Header */}
      <div className="flex-shrink-0 min-h-16 border-b border-white/5 flex flex-wrap items-center justify-between gap-3 px-4 sm:px-8 py-3 bg-black/40">
        <div className="flex flex-wrap items-center gap-4 sm:gap-8">
          <h2 className="font-display text-sm font-black uppercase tracking-[0.2em] text-brand">
            {copy.headings.agents}
          </h2>
          <div className="flex gap-1 bg-white/5 p-1 rounded-xl" role="group" aria-label={copy.headings.agents}>
            {TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveMainTab(tab)}
                aria-pressed={activeMainTab === tab}
                className={`px-3 sm:px-4 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 ${
                  activeMainTab === tab
                    ? "bg-white text-black shadow-xl"
                    : "text-white/60 hover:text-white hover:bg-white/5"
                }`}
              >
                {copy.tabs[tab] || tab.replace(/-/g, " ")}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={handleCreateAgent}
          className="px-6 py-2 bg-brand text-on-brand text-[10px] font-black uppercase tracking-widest rounded-lg hover:bg-brand-hover transition-all active:scale-95 flex items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
        >
          <span className="text-sm" aria-hidden="true">+</span>
          {copy.buttons.create}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-8">
        {loading ? (
          <div className="h-full flex items-center justify-center" aria-busy="true">
            <div className="w-10 h-10 border-2 border-white/5 border-t-brand rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="h-full flex flex-col items-center justify-center text-white/30 gap-4">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <p className="text-sm text-white/60 text-center max-w-sm" role="alert">{error}</p>
            <button
              type="button"
              onClick={() => setReloadTick((t) => t + 1)}
              className="text-[11px] font-semibold text-on-brand bg-brand hover:bg-brand-hover px-4 py-2 rounded-lg transition-colors"
            >
              {copy.buttons.retry}
            </button>
          </div>
        ) : activeMainTab === "my-chats" ? (
          // ── My Chats view ─────────────────────────────────────────────────
          conversations.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-white/50 gap-4">
              <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="0.5" aria-hidden="true">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <p className="text-[10px] font-black uppercase tracking-[0.3em]">{copy.empty.noChats}</p>
              <button
                type="button"
                onClick={() => setActiveMainTab("templates")}
                className="text-[10px] text-brand hover:text-white border border-brand/20 hover:border-white/20 px-4 py-2 rounded-lg transition-colors"
              >
                {copy.buttons.browseTemplates}
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 max-w-[1600px] mx-auto">
              {conversations.map((conv) => (
                <ConversationCard
                  key={conv.id}
                  conv={conv}
                  onClick={handleOpenConversation}
                  copy={copy}
                />
              ))}
            </div>
          )
        ) : (
          // ── Agents grid (templates / my-agents) ───────────────────────────
          agents.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-white/50 gap-4">
              <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="0.5" aria-hidden="true">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
              <p className="text-[10px] font-black uppercase tracking-[0.3em]">{copy.empty.noAgents}</p>
              {activeMainTab === "my-agents" && (
                <button
                  type="button"
                  onClick={handleCreateAgent}
                  className="text-[10px] text-brand hover:text-white border border-brand/20 hover:border-white/20 px-4 py-2 rounded-lg transition-colors"
                >
                  {copy.buttons.createAgentSubmit}
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4 sm:gap-6 max-w-[1600px] mx-auto">
              {agents.map((agent) => (
                <AgentCard
                  key={agent.agent_id || agent.id}
                  agent={agent}
                  onClick={handleSelectAgent}
                  copy={copy}
                />
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}
