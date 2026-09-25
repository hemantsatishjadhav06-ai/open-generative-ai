import { headers } from "next/headers";
import { pageTitle } from "@/lib/locales";
import AgentEditClient from "./AgentEditClient";
import { requireAgentsViewer } from "../../pageData";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const locale = (await headers()).get("x-locale") === "zh" ? "zh" : "en";
  return { title: pageTitle(locale, "editAgent") };
}

// The editor loads the agent itself (useParams → /api/agents/by-slug/<id>).
export default async function EditAgentPage() {
  const { locale } = await requireAgentsViewer();
  return <AgentEditClient locale={locale} />;
}
