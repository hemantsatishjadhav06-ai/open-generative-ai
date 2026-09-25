/**
 * Layout for /agents/* pages.
 * These pages host the agent chat / builder full-screen — no studio chrome.
 * Requests authenticate with the HttpOnly session cookie the studio's
 * access-code screen sets; nothing about the session is readable here.
 * The vendored agent UI styles use Tailwind's class-based dark mode, so the
 * `dark` class keeps these pages on the app's dark theme regardless of the
 * visitor's OS setting.
 */
import { headers } from "next/headers";
import { pageTitle } from "@/lib/locales";

// Shared by /agents/* and /zh/agents/* (x-locale comes from the URL path).
export async function generateMetadata() {
  const locale = (await headers()).get("x-locale") === "zh" ? "zh" : "en";
  return { title: pageTitle(locale, "agentChat") };
}

export default function AgentsLayout({ children }) {
  return (
    <div className="dark h-screen w-full overflow-hidden bg-surface-app text-white">
      {children}
    </div>
  );
}
