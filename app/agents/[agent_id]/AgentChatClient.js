"use client";

import { AiAgent } from "ai-agent";
import "ai-agent/dist/tailwind.css";
import { useCallback, useEffect, useRef } from "react";
import axios from "axios";
import Link from "next/link";
import { useRouter } from "next/navigation";

const STORAGE_KEY = "muapi_key";

/**
 * AgentChatClient — mirrors muapiapp's AgentClient.js.
 * Renders the AiAgent library component with server-fetched agent details
 * and optional initial history.
 *
 * IMPORTANT: StandaloneShell is NOT in the tree on /agents/* pages, so we
 * must set up our own axios interceptor here to inject the API key into
 * all requests made by the AiAgent library.
 */
export default function AgentChatClient({ agentDetails, initialHistory, userData, loadError = false }) {
  const interceptorRef = useRef(null);
  const router = useRouter();

  useEffect(() => {
    const getKey = () => {
      if (typeof window === "undefined") return null;
      const fromStorage = localStorage.getItem(STORAGE_KEY);
      if (fromStorage) return fromStorage;
      const match = document.cookie.match(/muapi_key=([^;]+)/);
      return match ? match[1] : null;
    };

    const apiKey = getKey();
    if (!apiKey) return;

    interceptorRef.current = axios.interceptors.request.use((config) => {
      // Only same-origin requests (relative URLs or our own origin) get the
      // key; third-party hosts such as S3 never do.
      const url = typeof config.url === "string" ? config.url : "";
      const isAbsolute = /^https?:\/\//i.test(url);
      const isSameOrigin = isAbsolute && url.startsWith(`${window.location.origin}/`);
      if (!isAbsolute || isSameOrigin) {
        config.headers = config.headers || {};
        config.headers["x-api-key"] = apiKey;
      }
      return config;
    });

    return () => {
      if (interceptorRef.current !== null) {
        axios.interceptors.request.eject(interceptorRef.current);
      }
    };
  }, []);

  const useUser = useCallback(
    () => ({
      user: {
        username: userData?.email?.split("@")[0] || "Studio User",
        name: userData?.email?.split("@")[0] || "Studio User",
        email: userData?.email || null,
        profile_photo: null,
        balance: userData?.balance || 0,
      },
      isAuthorized: !!userData,
    }),
    [userData]
  );

  if (loadError || !agentDetails) {
    return (
      <div className="h-screen w-full bg-surface-app flex items-center justify-center px-4 text-white">
        <div className="w-full max-w-sm text-center">
          <h1 className="font-display text-2xl font-bold tracking-tight">Couldn&apos;t load this agent</h1>
          <p className="mt-2 text-sm text-secondary">
            It may not exist, or your API key can&apos;t access it.
          </p>
          <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
            <button
              type="button"
              onClick={() => router.refresh()}
              className="h-10 px-5 rounded-xl bg-brand text-surface-app text-sm font-semibold hover:bg-brand-hover transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              Try again
            </button>
            <Link
              href="/studio/agents"
              className="h-10 px-5 inline-flex items-center justify-center rounded-xl border border-white/10 bg-surface-card text-sm font-semibold text-white/80 hover:text-white hover:border-white/20 transition-colors"
            >
              Back to agents
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
        useUser={useUser}
        usedIn="muapiapp"
      />
    </div>
  );
}
