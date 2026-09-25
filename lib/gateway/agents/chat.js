// One agent chat turn = one 'agent-chat' pipeline job, polled by the chat UI
// at GET /api/v1/predictions/<token>/result. The job:
//   1. appends the user's message to the conversation (workspace store),
//   2. runs an OpenRouter tool-calling loop (OPENROUTER_MODEL_AGENT) with the
//      agent's system prompt, recent history and the agent's skills as tools,
//   3. runs each tool call through the catalog on fal.ai (budget applies),
//   4. stores the reply (+ generated media) and drafts follow-up suggestions.
// While it runs, the poll answer carries progress "pulses" ("Generating an
// image…") and the reply as soon as it is written.
//
// Result shape (what AiAgent.jsx / the studio client read):
//   {conversation_id, status, is_complete, messages:[{role:'assistant', content,
//    media:[{type,url}]}, {type:'pulse', content}], suggestions:[{label,prompt}],
//    outputs:[urls], url}
// A failed turn is HTTP 400 {detail:{error}} (see pipelines/index.js).

import crypto from 'node:crypto';
import { GatewayError, errors } from '../errors.js';
import { parseJsonReply } from '../openrouter.js';
import { register, startPipelineJob } from '../pipelines/index.js';
import { assertPublicMediaUrl } from '../ssrf.js';
import { shared } from '../state.js';
import { appendMessages, getConversation } from './store.js';
import { getSkill, normalizeSkillIds, runToolCall, toolsForSkills } from './skills.js';
import { cleanAttachments, cleanConversationId, cleanText, LIMITS } from './validate.js';

export const PIPELINE = 'agent-chat';
const MAX_ROUNDS = 6;
const MAX_TOOL_CALLS = 4;
const MAX_VIDEO_CALLS = 2;
const HISTORY_MESSAGES = 24;
const HISTORY_CHARS = 60_000;
const REPLY_MAX_TOKENS = 2_000;

// Inputs built by startAgentTurn(). The pipeline refuses anything else, so
// POST /api/v1/agent-chat cannot start a turn around the agents route.
const trustedInputs = () => shared('agentChatInputs', () => new WeakSet());

// ── Prompt assembly ─────────────────────────────────────────────────────────
function today() {
    return new Date().toISOString().slice(0, 10);
}

export function systemPromptFor(agent) {
    const skills = normalizeSkillIds(agent.skill_ids);
    const lines = [
        agent.system_prompt?.trim() || `You are ${agent.name}, a helpful assistant for content creators.`,
        '',
        '---',
        `You are "${agent.name}", an agent inside Aquora, an AI studio for creators. Reply in the language the user writes in. Use Markdown (short paragraphs, lists, tables when useful); never HTML.`,
    ];
    if (skills.length) {
        lines.push(
            `You can create media with these tools: ${skills.join(', ')}. When the user asks for something you can make, call the tool instead of only describing it.`,
            'Generated files are shown to the user automatically under your reply: never paste their links and never use Markdown image syntax; refer to them in words ("the first image").',
            'Every generation costs money from a shared daily budget, so make one version at a time unless the user asks for several, and ask one short question first when a request is too vague to produce something good.',
            'To edit or animate an image, pass its exact link from the conversation (lines like "[Attached image: …]" or "[Generated image: …]").',
        );
    } else {
        lines.push("You can't create images, video or audio in this chat. If asked, say so in one sentence and offer a detailed prompt the user can paste into Aquora's Image, Video or Audio studio.");
    }
    lines.push(`Today's date is ${today()}.`);
    return lines.join('\n');
}

function mediaLines(message) {
    const out = [];
    for (const url of message.attachments || []) out.push(`[Attached image: ${url}]`);
    for (const item of message.media || []) out.push(`[Generated ${item.type || 'file'}: ${item.url}]`);
    return out;
}

// History → OpenRouter messages (text only; media become link lines so the
// model can refer back to them). Newest messages win the character budget.
export function historyMessages(history) {
    const picked = [];
    let chars = 0;
    for (const message of [...(history || [])].reverse()) {
        if (message.role !== 'user' && message.role !== 'assistant') continue;
        const content = [String(message.content || ''), ...mediaLines(message)].filter(Boolean).join('\n\n');
        if (!content) continue;
        if (picked.length >= HISTORY_MESSAGES || chars + content.length > HISTORY_CHARS) break;
        chars += content.length;
        picked.push({ role: message.role, content });
    }
    picked.reverse();
    // A conversation must not open with an assistant message for some models.
    while (picked.length && picked[0].role !== 'user') picked.shift();
    return picked;
}

// The new user message: text plus the attachments as image parts (https) so
// vision models can see them, and as link lines so tools can use them.
export function userMessage(text, attachments) {
    const lines = [text, ...attachments.map((url) => `[Attached image: ${url}]`)].join('\n\n');
    const images = attachments.filter((url) => /^https:\/\//i.test(url));
    if (!images.length) return { role: 'user', content: lines };
    return { role: 'user', content: [{ type: 'text', text: lines }, ...images.map((url) => ({ type: 'image_url', image_url: { url } }))] };
}

// Removes generated-media links the model pasted despite the instructions
// (the UI renders the media itself).
export function stripMediaLinks(content, media) {
    let text = String(content || '');
    for (const { url } of media) {
        const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        text = text
            .replace(new RegExp(`!\\[[^\\]]*\\]\\(${escaped}\\)`, 'g'), '')
            .replace(new RegExp(`\\[([^\\]]*)\\]\\(${escaped}\\)`, 'g'), '$1')
            .replace(new RegExp(escaped, 'g'), '');
    }
    return text.replace(/\n{3,}/g, '\n\n').trim();
}

// Text-only copy of the conversation (image parts dropped; their links stay
// in the text) for agent models that can't take images.
export function withoutImageParts(messages) {
    return messages.map((message) => (Array.isArray(message.content)
        ? { ...message, content: message.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n\n') }
        : message));
}

function knownMediaUrls(history, attachments) {
    const known = new Set(attachments);
    for (const message of history || []) {
        for (const url of message.attachments || []) known.add(url);
        for (const item of message.media || []) if (item?.url) known.add(item.url);
    }
    return known;
}

function toolResultContent(outcome) {
    if (!outcome.ok) return JSON.stringify({ ok: false, error: outcome.error });
    return JSON.stringify({ ok: true, type: outcome.type, model: outcome.model, urls: outcome.media.map((m) => m.url), note: 'Shown to the user automatically. Do not paste these links.' });
}

// ── Suggestions ─────────────────────────────────────────────────────────────
const SUGGESTION_SCHEMA = {
    type: 'object',
    properties: {
        suggestions: {
            type: 'array',
            minItems: 1,
            maxItems: 3,
            items: {
                type: 'object',
                properties: {
                    label: { type: 'string', description: 'Button text, at most 6 words.' },
                    prompt: { type: 'string', description: 'The full message the user would send.' },
                },
                required: ['label', 'prompt'],
                additionalProperties: false,
            },
        },
    },
    required: ['suggestions'],
    additionalProperties: false,
};

async function draftSuggestions(ctx, agent, userText, reply) {
    try {
        const result = await ctx.llm({
            purpose: 'fast',
            max_tokens: 400,
            temperature: 0.7,
            response_format: { type: 'json_schema', json_schema: { name: 'follow_ups', strict: true, schema: SUGGESTION_SCHEMA } },
            messages: [
                { role: 'system', content: `Suggest up to 3 short follow-up requests the user might send next to "${agent.name}" (${agent.description || 'an AI assistant'}). Write them in the user's language, from the user's point of view, specific to the conversation. Return JSON only.` },
                { role: 'user', content: `User: ${userText.slice(0, 2_000)}\n\nAssistant: ${reply.slice(0, 4_000)}` },
            ],
        });
        const parsed = parseJsonReply(result.content);
        const list = Array.isArray(parsed?.suggestions) ? parsed.suggestions : [];
        return list.slice(0, 3).flatMap((item) => {
            const label = cleanText(typeof item?.label === 'string' ? item.label : '', { field: 'suggestions', max: 60, multiline: false, truncate: true });
            const prompt = cleanText(typeof item?.prompt === 'string' ? item.prompt : '', { field: 'suggestions', max: 500, truncate: true });
            return label && prompt ? [{ label, prompt }] : [];
        });
    } catch {
        return [];
    }
}

// ── The turn ────────────────────────────────────────────────────────────────
// Rebuilds the progress lines from the job's event log ('pulse' adds a
// line; 'pulse_update' rewrites or removes the line it names).
export function pulsesFrom(events) {
    const lines = [];
    for (const event of events || []) {
        if (event.type === 'pulse' && event.payload?.content) {
            lines.push({ id: event.id, type: 'pulse', content: String(event.payload.content) });
        } else if (event.type === 'pulse_update') {
            const index = lines.findIndex((line) => line.id === event.payload?.id);
            if (index === -1) continue;
            if (event.payload.content) lines[index] = { ...lines[index], content: String(event.payload.content) };
            else lines.splice(index, 1);
        }
    }
    return lines.map(({ type, content }) => ({ type, content }));
}

async function runTurn(ctx) {
    const { agent, conversation_id: conversationId, message, attachments } = ctx.input;
    const session = { sid: ctx.sid, cid: ctx.cid };
    const previous = await getConversation(ctx.cid, conversationId);
    if (previous && previous.agent_id !== agent.agent_id) {
        throw new GatewayError(409, 'conversation_mismatch', 'This chat belongs to a different agent. Start a new chat.');
    }
    const history = previous?.history || [];
    await appendMessages(ctx.cid, conversationId, agent, [{
        role: 'user',
        content: message,
        ...(attachments.length ? { attachments } : {}),
        timestamp: new Date().toISOString(),
    }]);

    const skillIds = normalizeSkillIds(agent.skill_ids);
    const tools = toolsForSkills(skillIds);
    const toolEnv = { session, signal: ctx.signal, known: knownMediaUrls(history, attachments), allowed: new Set(skillIds) };
    const messages = [
        { role: 'system', content: systemPromptFor(agent) },
        ...historyMessages(history),
        userMessage(message, attachments),
    ];

    const pulses = [];
    // Live progress lines; the stored result says what was done instead.
    const pulse = (content) => {
        const text = String(content || '').trim().slice(0, 200);
        if (!text) return null;
        const item = { type: 'pulse', content: text };
        pulses.push(item);
        item.eventId = ctx.emit('pulse', { content: text })?.id;
        return item;
    };
    const finishPulse = (item, content) => {
        if (!item) return;
        if (content) item.content = content;
        else pulses.splice(pulses.indexOf(item), 1);
        ctx.emit('pulse_update', { id: item.eventId, content: content || null });
    };
    const media = [];
    let toolCalls = 0;
    let videoCalls = 0;
    let reply = '';
    let interrupted = null;
    let visionFallback = false;
    for (let round = 0; round < MAX_ROUNDS; round++) {
        const lastRound = round === MAX_ROUNDS - 1 || toolCalls >= MAX_TOOL_CALLS;
        const request = () => ctx.llm({
            purpose: 'agent',
            messages,
            max_tokens: REPLY_MAX_TOKENS,
            temperature: 0.7,
            ...(tools.length && !lastRound ? { tools, tool_choice: 'auto' } : {}),
        });
        let result;
        try {
            try {
                result = await request();
            } catch (error) {
                // A text-only agent model rejects image parts: retry once
                // with the attachments as links only.
                const hasImages = messages.some((m) => Array.isArray(m.content));
                if (visionFallback || !hasImages || error?.code !== 'invalid_request') throw error;
                visionFallback = true;
                messages.splice(0, messages.length, ...withoutImageParts(messages));
                result = await request();
            }
        } catch (error) {
            // Media already paid for is never thrown away: keep it and say so.
            if (media.length && !ctx.signal.aborted) {
                interrupted = error;
                break;
            }
            throw error;
        }
        const calls = Array.isArray(result.tool_calls) ? result.tool_calls.filter((call) => call?.function?.name) : [];
        const text = typeof result.content === 'string' ? result.content : '';
        if (!calls.length || lastRound) {
            reply = text;
            break;
        }
        if (text.trim()) pulse(text);
        messages.push({ role: 'assistant', content: text || null, tool_calls: calls.map((call) => ({ id: String(call.id || ''), type: 'function', function: { name: call.function.name, arguments: typeof call.function.arguments === 'string' ? call.function.arguments : JSON.stringify(call.function.arguments || {}) } })) });
        for (const call of calls) {
            const skill = getSkill(call.function.name);
            let outcome;
            if (toolCalls >= MAX_TOOL_CALLS) {
                outcome = { ok: false, error: `Limit reached: at most ${MAX_TOOL_CALLS} generations per message. Ask the user to continue in a new message.` };
            } else if (skill?.video && videoCalls >= MAX_VIDEO_CALLS) {
                outcome = { ok: false, error: `Limit reached: at most ${MAX_VIDEO_CALLS} videos per message.` };
            } else {
                toolCalls += 1;
                if (skill?.video) videoCalls += 1;
                const progressLine = pulse(skill?.pulse || 'Working…');
                ctx.progress(Math.min(90, 15 + toolCalls * 18), skill?.pulse);
                outcome = await runToolCall(call, toolEnv);
                finishPulse(progressLine, outcome.ok ? (skill?.done || progressLine?.content) : null);
                if (outcome.ok) {
                    for (const item of outcome.media) {
                        media.push(item);
                        toolEnv.known.add(item.url);
                    }
                    ctx.emit('tool_result', { media: outcome.media });
                } else {
                    pulse(`Couldn't finish: ${outcome.error}`);
                }
            }
            messages.push({ role: 'tool', tool_call_id: String(call.id || ''), content: toolResultContent(outcome) });
        }
    }

    const content = interrupted
        ? "Here's what I made. I couldn't finish writing my reply — ask me to continue."
        : stripMediaLinks(reply, media);
    if (!content && !media.length) throw new GatewayError(502, 'empty_reply', "The agent didn't reply. Try again.");
    const assistant = { role: 'assistant', content, ...(media.length ? { media } : {}), timestamp: new Date().toISOString() };
    await appendMessages(ctx.cid, conversationId, agent, [assistant]);
    ctx.emit('assistant', { content, media });
    ctx.progress(95);

    const suggestions = interrupted || ctx.signal.aborted ? [] : await draftSuggestions(ctx, agent, message, content);
    const urls = media.map((item) => item.url);
    return {
        conversation_id: conversationId,
        messages: [{ role: 'assistant', content, ...(media.length ? { media } : {}) }, ...pulses.map(({ type, content: line }) => ({ type, content: line }))],
        suggestions,
        outputs: urls,
        url: urls[0] || null,
    };
}

// Poll answers: while running, the pulses so far (and the reply once
// written); when done, the stored result.
function format(job, token) {
    const conversationId = job.result?.conversation_id || job.input?.conversation_id || null;
    if (job.status === 'completed') {
        const result = job.result && typeof job.result === 'object' ? job.result : {};
        return {
            status: 200,
            body: {
                ...result,
                messages: Array.isArray(result.messages) ? result.messages : [],
                suggestions: Array.isArray(result.suggestions) ? result.suggestions : [],
                request_id: token,
                id: token,
                conversation_id: conversationId,
                status: 'completed',
                is_complete: true,
            },
        };
    }
    if (job.status !== 'processing') return null;
    const events = job.events || [];
    const written = [...events].reverse().find((event) => event.type === 'assistant');
    const messages = [
        ...(written ? [{ role: 'assistant', content: String(written.payload?.content || ''), ...(written.payload?.media?.length ? { media: written.payload.media } : {}) }] : []),
        ...pulsesFrom(events),
    ];
    return {
        status: 200,
        body: {
            request_id: token,
            id: token,
            conversation_id: conversationId,
            status: 'processing',
            is_complete: false,
            messages,
            suggestions: [],
            ...(job.progress ? { progress: job.progress } : {}),
        },
    };
}

register(PIPELINE, runTurn, {
    kind: 'agent',
    timeoutMs: 12 * 60_000,
    estimateUsd: () => 0.02,
    validate(input) {
        if (!input || typeof input !== 'object' || !trustedInputs().has(input)) {
            throw new GatewayError(404, 'unknown_model', "This feature isn't available.");
        }
        return input;
    },
    format,
});

// Starts a turn for `agent` (a stored or template agent document).
// body: {message, conversation_id?, attachments?} → {token, body}
export async function startAgentTurn({ session, agent, body }) {
    const message = cleanText(body?.message, { field: 'message', max: LIMITS.message, required: true });
    const attachments = cleanAttachments(body?.attachments);
    await Promise.all(attachments.map((url) => assertPublicMediaUrl(url, { field: 'attachments' })));
    const conversationId = cleanConversationId(body?.conversation_id) || crypto.randomUUID();
    const existing = await getConversation(session.cid, conversationId);
    if (existing && existing.agent_id !== agent.agent_id) {
        throw new GatewayError(409, 'conversation_mismatch', 'This chat belongs to a different agent. Start a new chat.');
    }
    const input = {
        agent: {
            agent_id: agent.agent_id,
            name: agent.name,
            description: agent.description || '',
            system_prompt: agent.system_prompt || '',
            icon_url: agent.icon_url || null,
            skill_ids: normalizeSkillIds(agent.skill_ids),
        },
        conversation_id: conversationId,
        message,
        attachments,
    };
    if (!session?.sid || !session?.cid) throw errors.unauthorized();
    trustedInputs().add(input);
    const { token, body: reply } = await startPipelineJob({ name: PIPELINE, input, session });
    return { token, body: { ...reply, conversation_id: conversationId, messages: [], suggestions: [] } };
}
