import { headers } from "next/headers";
import { pageTitle } from "@/lib/locales";
import AgentCreateClient from "./AgentCreateClient";
import { requireAgentsViewer } from "../pageData";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const locale = (await headers()).get("x-locale") === "zh" ? "zh" : "en";
  return { title: pageTitle(locale, "createAgent") };
}

export default async function CreateAgentPage() {
  const { locale } = await requireAgentsViewer();
  return <AgentCreateClient locale={locale} />;
}
