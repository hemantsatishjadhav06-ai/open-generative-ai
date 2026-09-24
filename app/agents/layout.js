/**
 * Layout for /agents/* pages.
 * These pages host the AiAgent component full-screen — no studio chrome needed.
 * The api key is available via the muapi_key cookie which StandaloneShell sets.
 * The vendored ai-agent styles use Tailwind's class-based dark mode, so the
 * `dark` class keeps these pages on the app's dark theme regardless of the
 * visitor's OS setting.
 */
export const metadata = {
  title: "Agent chat — Aquora",
};

export default function AgentsLayout({ children }) {
  return (
    <div className="dark h-screen w-full overflow-hidden bg-surface-app text-white">
      {children}
    </div>
  );
}
