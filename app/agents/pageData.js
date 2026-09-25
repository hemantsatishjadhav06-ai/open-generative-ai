import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { workspaceFromCookies } from "@/lib/gateway/agents/viewer";
import { loadRevocations } from "@/lib/gateway/session";

// Server-side guard shared by the /agents pages: resolves the visitor's
// workspace from the session cookie, or sends them to the studio, whose
// shell shows the access-code screen (or the "not set up yet" notice).
export async function requireAgentsViewer() {
  const requestHeaders = await headers();
  await loadRevocations();
  const viewer = workspaceFromCookies(requestHeaders.get("cookie"));
  if (viewer.state === "setup_required") redirect("/studio");
  if (viewer.state !== "ok") redirect("/studio/agents");
  const locale = requestHeaders.get("x-locale") === "zh" ? "zh" : "en";
  return { cid: viewer.cid, locale };
}
