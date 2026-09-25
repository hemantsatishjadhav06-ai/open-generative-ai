import React, { useState } from "react";
import Link from "next/link";
import axios from "axios";
import { BiLoaderAlt } from "react-icons/bi";
import { IoArrowBackOutline } from "react-icons/io5";
import { useRouter } from "next/navigation";
import { getAgentCopy } from "../i18n";
import { AGENTS_API as BASE_URL, errorMessage } from "../utils/api";

const CreateAgent = ({ locale = "en" }) => {
  const copy = getAgentCopy(locale);
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleArchitectAgent = async (e) => {
    e.preventDefault();
    if (!prompt.trim()) return;

    try {
      setLoading(true);
      setError(null);

      const suggestResponse = await axios.post(`${BASE_URL}/suggest`, {
        prompt,
      });
      const suggestion = suggestResponse.data;
      const createPayload = {
        name: suggestion.name || "Unnamed Agent",
        description: suggestion.description || "",
        system_prompt: suggestion.system_prompt || "",
        skill_ids: suggestion.recommended_skill_ids || [],
        welcome_message: suggestion.welcome_message || "",
        initial_suggestions: suggestion.initial_suggestions || [],
      };

      const createResponse = await axios.post(`${BASE_URL}`, createPayload);
      if (createResponse.status === 200 || createResponse.status === 201) {
        const createdAgent = createResponse.data;
        router.push(`/agents/edit/${createdAgent.agent_id}`);
      }
    } catch (err) {
      setError(errorMessage(err, copy, copy.errors.createFailed));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col gap-8 items-center w-full max-w-[95%] sm:max-w-[90%] lg:max-w-[80%] relative pb-12">
      <div className="flex items-start gap-2 w-full">
        <Link
          href="/agents"
          aria-label={copy.backToAgents}
          title={copy.backToAgents}
          className="p-2 hover:bg-gray-100 dark:hover:bg-secondary-bg rounded-full transition-colors group"
        >
          <IoArrowBackOutline aria-hidden="true" className="w-4 h-4 text-gray-800 dark:text-primary-text group-hover:scale-110 transition-transform" />
        </Link>
        <div className="flex flex-col gap-2 w-full">
          <h1 className="text-2xl font-bold text-black dark:text-white">
            Prompt Any Assistant
          </h1>
          <p className="text-gray-500 dark:text-secondary-text text-sm font-medium">
            Use this to prompt up an assistant to help you with any topic!
          </p>
        </div>
      </div>
      <form onSubmit={handleArchitectAgent} className="space-y-8 w-full">
        <div className="space-y-4">
          <label htmlFor="agent-idea" className="text-lg font-semibold text-black dark:text-white block">
            What should your assistant be able to do and be knowledgeable in?
          </label>
          <div className="relative">
            <textarea
              id="agent-idea"
              value={prompt}
              autoFocus
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Ex: A helpful travel agent that finds the best destinations in Italy..."
              className="w-full bg-white dark:bg-secondary-bg border border-gray-200 dark:border-divider rounded-xl p-4 text-gray-900 dark:text-primary-text text-sm focus:outline-none focus:ring-2 focus:ring-black/10 dark:focus:ring-primary/10 focus:border-gray-400 dark:focus:border-primary transition-all resize-none min-h-[140px] shadow-sm"
              disabled={loading}
            />
          </div>
        </div>
        
        <div className="flex items-center gap-6">
        </div>

        <div className="flex flex-col gap-4">
          <button
            type="submit"
            disabled={loading || !prompt.trim()}
            className="w-full py-3 bg-brand text-on-brand hover:bg-brand-hover disabled:bg-divider disabled:text-secondary-text disabled:cursor-not-allowed text-base font-semibold rounded-xl transition-all flex items-center justify-center gap-3 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
          >
            {loading ? (
              <>
                <BiLoaderAlt className="w-6 h-6 animate-spin" />
                <span>Creating agent...</span>
              </>
            ) : (
              "Create agent"
            )}
          </button>
          {loading && (
            <p className="text-center text-gray-400 dark:text-secondary-text text-sm animate-pulse">
              Analyzing prompt and building capabilities...
            </p>
          )}
          {error && (
            <div role="alert" className="p-4 bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30 rounded-xl text-red-600 dark:text-red-400 text-sm flex items-center gap-3 animate-in fade-in duration-300">
              <svg
                className="w-5 h-5 flex-shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              {error}
            </div>
          )}
        </div>
      </form>
    </div>
  )
};

export default CreateAgent;
