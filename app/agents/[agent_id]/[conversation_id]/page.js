import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import AgentChatClient from "../AgentChatClient";

/**
 * Server component — fetches both agentDetails and initialHistory
 * from the /api/agents proxy using the muapi_key cookie, then renders
 * the client chat component with existing conversation messages pre-loaded.
 *
 * URL: /agents/[agent_id]/[conversation_id]
 */
export async function generateMetadata() {
  return {
    title: 'Agent chat — Creator Agency',
  };
}

const BASE_URL = 'https://api.muapi.ai';

async function fetchAgentDetails(agentId, apiKey) {
  if (!apiKey) return { status: 'error' };

  // Try fetching by slug first, then by direct ID (if it looks like a UUID).
  // 'missing' = every lookup we tried said 404; anything else is 'error'.
  try {
    const res = await fetch(
      `${BASE_URL}/agents/by-slug/${agentId}`,
      {
        cache: "no-store",
        headers: { "x-api-key": apiKey },
      }
    );
    if (res.ok) return { status: 'ok', data: await res.json() };
    if (res.status !== 404) {
      console.warn(`[AgentPage] Agent lookup failed with ${res.status}`);
      return { status: 'error' };
    }

    if (agentId.length > 20) {
      const resId = await fetch(
        `${BASE_URL}/agents/${agentId}`,
        {
          cache: "no-store",
          headers: { "x-api-key": apiKey },
        }
      );
      if (resId.ok) return { status: 'ok', data: await resId.json() };
      if (resId.status !== 404) {
        console.warn(`[AgentPage] Agent lookup by ID failed with ${resId.status}`);
        return { status: 'error' };
      }
    }

    return { status: 'missing' };
  } catch (error) {
    console.error("[AgentPage] Fetch error:", error?.message || error);
    return { status: 'error' };
  }
}

async function fetchHistory(agentId, conversationId, apiKey) {
  if (!apiKey) return null;
  try {
    // Try by slug first
    const res = await fetch(
      `${BASE_URL}/agents/by-slug/${agentId}/${conversationId}`,
      {
        cache: "no-store",
        headers: { "x-api-key": apiKey },
      }
    );
    if (res.ok) return await res.json();
    
    // Fallback to direct agent ID if needed
    if (agentId.length > 20) {
      const resId = await fetch(
        `${BASE_URL}/agents/${agentId}/${conversationId}`,
        {
          cache: "no-store",
          headers: { "x-api-key": apiKey },
        }
      );
      if (resId.ok) return await resId.json();
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchUserData(apiKey) {
  if (!apiKey) return null;
  try {
    const res = await fetch(`${BASE_URL}/api/v1/account/balance`, {
      cache: "no-store",
      headers: { "x-api-key": apiKey },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export default async function AgentConversationPage({ params }) {
  const { agent_id, conversation_id } = await params;
  const cookieStore = await cookies();
  const apiKey = cookieStore.get("muapi_key")?.value;

  // No key yet: the studio shows the key screen and sets the cookie.
  if (!apiKey) redirect('/studio/agents');

  const [agentResult, initialHistory, userData] = await Promise.all([
    fetchAgentDetails(agent_id, apiKey),
    fetchHistory(agent_id, conversation_id, apiKey),
    fetchUserData(apiKey)
  ]);

  if (agentResult.status === 'missing') notFound();

  return (
    <AgentChatClient
      agentDetails={agentResult.status === 'ok' ? agentResult.data : null}
      loadError={agentResult.status === 'error'}
      initialHistory={initialHistory}
      userData={userData}
    />
  );
}
