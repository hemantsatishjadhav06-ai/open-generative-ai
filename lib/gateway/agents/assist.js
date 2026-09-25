// LLM helpers for the agent builder:
//   suggestAgent  POST /api/agents/suggest  {prompt} → a drafted agent (fast model, JSON schema)
//   realignPrompt POST /api/agents/by-slug/<slug>/preview-realign → {proposed_prompt}
// Budgeted like every other LLM call (worst case reserved, settled to usage.cost).

import { isLlmConfigured } from '../config.js';
import { GatewayError, errors } from '../errors.js';
import { meteredChat } from '../llmBudget.js';
import { parseJsonReply } from '../openrouter.js';
import { listSkills, normalizeSkillIds, SKILL_IDS } from './skills.js';
import { cleanSuggestions, cleanText, LIMITS } from './validate.js';

async function metered(cid, options) {
    if (!isLlmConfigured()) throw errors.notConfigured('The AI text service');
    // meteredChat never forwards the signal of a non-streamed call upstream.
    return meteredChat({ cid, ...options });
}

function skillCatalogText() {
    return listSkills().map((skill) => `- ${skill.id}: ${skill.description}`).join('\n');
}

const DRAFT_SCHEMA = {
    type: 'object',
    properties: {
        name: { type: 'string', description: 'Short, memorable agent name (2–4 words).' },
        description: { type: 'string', description: 'One sentence shown on the agent card.' },
        system_prompt: { type: 'string', description: 'Complete instructions for the agent, written in the second person ("You are …").' },
        recommended_skill_ids: { type: 'array', items: { type: 'string', enum: SKILL_IDS } },
        welcome_message: { type: 'string', description: 'First message the agent shows, 1–2 sentences.' },
        initial_suggestions: {
            type: 'array',
            items: {
                type: 'object',
                properties: { label: { type: 'string' }, prompt: { type: 'string' } },
                required: ['label', 'prompt'],
                additionalProperties: false,
            },
        },
    },
    required: ['name', 'description', 'system_prompt', 'recommended_skill_ids', 'welcome_message', 'initial_suggestions'],
    additionalProperties: false,
};

export async function suggestAgent({ cid, prompt, signal }) {
    const idea = cleanText(prompt, { field: 'prompt', max: 4_000, required: true });
    const result = await metered(cid, {
        purpose: 'fast',
        signal,
        temperature: 0.6,
        max_tokens: 2_500,
        response_format: { type: 'json_schema', json_schema: { name: 'agent_draft', strict: true, schema: DRAFT_SCHEMA } },
        messages: [
            {
                role: 'system',
                content: [
                    'You design AI assistants ("agents") for content creators on Aquora, an AI studio.',
                    'From the user\'s idea, draft the agent: a name, a one-sentence description, a thorough system prompt (role, what it helps with, step-by-step process, output format, tone, what to ask when information is missing; 150–400 words), a friendly welcome message, and 3 starter prompts (label ≤ 6 words, prompt = the full message).',
                    'Recommend only the skills the agent really needs (an empty list is fine for writing-only agents). Available skills:',
                    skillCatalogText(),
                    'Write in the same language as the user\'s idea. Return JSON only.',
                ].join('\n'),
            },
            { role: 'user', content: idea },
        ],
    });
    const draft = parseJsonReply(result.content);
    if (!draft || typeof draft !== 'object') {
        throw new GatewayError(502, 'invalid_reply', "Couldn't draft this agent. Try again or describe it differently.");
    }
    const text = (value, field, max, multiline = true) => cleanText(typeof value === 'string' ? value : '', { field, max, multiline, truncate: true });
    const name = text(draft.name, 'name', LIMITS.name, false) || 'New agent';
    return {
        name,
        description: text(draft.description, 'description', LIMITS.description),
        system_prompt: text(draft.system_prompt, 'system_prompt', LIMITS.systemPrompt) || `You are ${name}, a helpful assistant for content creators.`,
        recommended_skill_ids: normalizeSkillIds(draft.recommended_skill_ids),
        welcome_message: text(draft.welcome_message, 'welcome_message', LIMITS.welcomeMessage),
        initial_suggestions: cleanSuggestions(Array.isArray(draft.initial_suggestions) ? draft.initial_suggestions : []).slice(0, 4),
    };
}

export async function realignPrompt({ cid, agent, currentPrompt, skillIds, signal }) {
    const current = cleanText(currentPrompt ?? agent?.system_prompt, { field: 'current_prompt', max: LIMITS.systemPrompt, required: true });
    const skills = normalizeSkillIds(skillIds);
    const catalog = listSkills().filter((skill) => skills.includes(skill.id));
    const result = await metered(cid, {
        purpose: 'agent',
        signal,
        temperature: 0.4,
        max_tokens: 3_000,
        messages: [
            {
                role: 'system',
                content: [
                    'You edit system prompts for AI agents on Aquora, an AI studio for creators.',
                    'Rewrite the agent\'s instructions so they match its current skills: explain when and how to use each enabled skill, and remove promises about abilities it no longer has.',
                    'Keep the agent\'s role, voice, language, process and formatting rules; change only what the skill change requires. Return only the new system prompt text, with no preamble or code fences.',
                ].join('\n'),
            },
            {
                role: 'user',
                content: [
                    `Agent: ${agent?.name || 'Agent'}${agent?.description ? ` — ${agent.description}` : ''}`,
                    `Enabled skills:\n${catalog.length ? catalog.map((s) => `- ${s.id} (${s.name}): ${s.description}`).join('\n') : '- none (text only; it cannot create images, video or audio)'}`,
                    `Current system prompt:\n"""\n${current}\n"""`,
                ].join('\n\n'),
            },
        ],
    });
    const proposed = cleanText(String(result.content || '').replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, ''), {
        field: 'proposed_prompt',
        max: LIMITS.systemPrompt,
        truncate: true,
    });
    if (!proposed) throw new GatewayError(502, 'invalid_reply', "Couldn't rewrite the instructions. Try again.");
    return { proposed_prompt: proposed };
}
