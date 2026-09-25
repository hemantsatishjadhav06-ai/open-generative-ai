import AgentCreateClient from "./AgentCreateClient";
import { requireAgentsViewer } from "../pageData";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Create an agent — Aquora",
};

export default async function CreateAgentPage() {
  const { locale } = await requireAgentsViewer();
  return <AgentCreateClient locale={locale} />;
}
