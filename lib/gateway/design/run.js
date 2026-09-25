// One design-agent turn = one 'design-agent-run' pipeline job. The canvas
// polls its event log at GET /api/v1/creative-agent/jobs/<id>/events. The
// job:
//   1. runs an OpenRouter tool-calling loop (OPENROUTER_MODEL_AGENT) with the
//      session's asset registry, the canvas snapshot and (for a pinned skill)
//      the skill's recipe in the system prompt,
//   2. runs each tool call (tools.js) — media through the catalog on fal.ai,
//      layout as a canvas_op — and registers every new file as asset_N,
//   3. emits the typed events the canvas renders:
//        text{content}  tool_call{name,args}  canvas_op{op,args}
//        tool_result{name, result{ok, model?, source_asset_id?, error?}, asset?{asset_label,url,kind}}
//        error{message}  (added by the pipeline runner when a run fails)
//        budget{scope, spentUsd, capUsd}  (the run stopped at the daily budget)
//   4. stores the reply in the session's transcript and model history.

import { getCatalog } from '../catalogLoader.js';
import { GatewayError, errors, toGatewayError } from '../errors.js';
import { register, startPipelineJob } from '../pipelines/index.js';
import { shared } from '../state.js';
import { addAsset, appendHistory, appendTurn, autoNameSession, completeTurn, getSessionDoc, recordJob } from './store.js';
import { designTools, displayArgs, getDesignTool, parseToolArguments, runDesignTool } from './tools.js';
import { LIMITS, cleanText, mentionedLabels } from './validate.js';

export const PIPELINE = 'design-agent-run';
const MAX_ROUNDS = 8;
const MAX_TOOL_CALLS = 8;
const MAX_VIDEO_CALLS = 2;
const MAX_IMAGE_PARTS = 4;
const REPLY_MAX_TOKENS = 2_000;
const REGISTRY_LINES = 60;

// Inputs built by startDesignRun(). The pipeline refuses anything else, so
// POST /api/v1/design-agent-run cannot start a run around the route.
const trustedInputs = () => shared('designRunInputs', () => new WeakSet());

function today() {
    return new Date().toISOString().slice(0, 10);
}

function registryLines(assets) {
    if (!assets.length) return ['(no files yet)'];
    return assets.slice(-REGISTRY_LINES).map((asset) => {
        const origin = asset.source_tool && asset.source_tool !== 'upload' ? asset.source_tool : 'uploaded by the user';
        const prompt = asset.prompt ? ` — "${asset.prompt.replace(/\s+/g, ' ').slice(0, 160)}"` : '';
        const derived = asset.source_asset_id ? ` (from ${asset.source_asset_id})` : '';
        return `${asset.asset_label} — ${asset.kind} — ${origin}${derived}${prompt}`;
    });
}

function canvasLines(canvas) {
    if (!canvas?.nodes?.length) return ['(the canvas is empty)'];
    const lines = canvas.nodes.slice(0, 60).map((node) => `${node.asset_id} (${node.kind}) at x=${node.x}, y=${node.y}, ${node.w}×${node.h}`);
    if (canvas.selected) lines.push(`Selected by the user: ${canvas.selected}`);
    return lines;
}

export function designSystemPrompt({ assets = [], canvas = null, skill = null } = {}) {
    const lines = [
        'You are the Design Agent inside Aquora, an AI studio for creators. You work with the user on an infinite canvas: you plan visuals, create images and short videos with your tools, and the results appear on the canvas.',
        '',
        'How to work:',
        '- When the user wants visuals, call the tools instead of only describing them. Write rich, specific prompts (subject, setting, style, lighting, composition).',
        '- Every generation spends the workspace\'s shared daily budget: make one version at a time unless the user asks for several, and ask one short question first when a request is too vague to produce something good.',
        '- Files are named by asset labels (asset_1, asset_2, …). Use only labels listed below or returned by a tool. To change or reuse a file, pass its label (edit_image, image_to_video, enhance_image) and keep what the user did not ask to change.',
        '- "@asset_3" in a message means asset_3. "this", "the selected one" usually means the selected canvas file.',
        '- New files appear on the canvas automatically. Never paste links or Markdown images; refer to files by label.',
        '- Reply briefly (one to four sentences) in the language the user writes in. Use Markdown sparingly; never HTML.',
        '- You cannot browse the web, create audio or edit existing videos. Say so in one sentence if asked.',
        '',
        'Files in this session (oldest first):',
        ...registryLines(assets),
        '',
        'On the canvas now:',
        ...canvasLines(canvas),
    ];
    if (skill) {
        lines.push('', `The user pinned the skill "${skill.name}". Follow this recipe:`, skill.instructions);
    }
    lines.push('', `Today's date is ${today()}.`);
    return lines.join('\n');
}

function historyMessages(history) {
    const out = (history || [])
        .filter((entry) => (entry.role === 'user' || entry.role === 'assistant') && entry.content)
        .map((entry) => ({ role: entry.role, content: entry.content }));
    while (out.length && out[0].role !== 'user') out.shift();
    return out;
}

// The user's turn: text, a line naming attached files, and (for vision
// models) the attached/mentioned images themselves.
export function userTurn({ text, attachments, assetsByLabel }) {
    const attached = attachments.map((label) => assetsByLabel.get(label)).filter(Boolean);
    const lines = [text || '(no text)'];
    if (attached.length) lines.push(`[Attached: ${attached.map((a) => `${a.asset_label} (${a.kind})`).join(', ')}]`);
    const content = lines.join('\n\n');
    const seen = new Set();
    const images = [];
    for (const label of [...attachments, ...mentionedLabels(text)]) {
        const asset = assetsByLabel.get(label);
        if (!asset || asset.kind !== 'image' || seen.has(label) || !/^https:\/\//i.test(asset.url)) continue;
        seen.add(label);
        images.push(asset);
        if (images.length >= MAX_IMAGE_PARTS) break;
    }
    const message = images.length
        ? { role: 'user', content: [{ type: 'text', text: content }, ...images.flatMap((asset) => [{ type: 'text', text: `${asset.asset_label}:` }, { type: 'image_url', image_url: { url: asset.url } }])] }
        : { role: 'user', content };
    return { message, historyText: content };
}

function withoutImageParts(messages) {
    return messages.map((message) => (Array.isArray(message.content)
        ? { ...message, content: message.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n') }
        : message));
}

// Event payload → the flat shape the canvas keeps in its transcript.
function flatten(event) {
    const p = event.payload || {};
    const base = { id: event.id, job_id: event.job_id, type: event.type };
    switch (event.type) {
        case 'text':
        case 'info':
            return { ...base, content: p.content };
        case 'error':
            return { ...base, message: p.message };
        case 'tool_call':
            return { ...base, name: p.name, args: p.args };
        case 'tool_result':
            return { ...base, name: p.name, result: p.result, ...(p.asset ? { asset: p.asset } : {}) };
        default:
            return null;
    }
}

function toolMessage(outcome, created) {
    if (!outcome.ok) return JSON.stringify({ ok: false, error: outcome.error });
    if (outcome.canvasOp) return JSON.stringify({ ok: true, arranged: outcome.arranged });
    return JSON.stringify({
        ok: true,
        created: created.map((asset) => ({ asset_label: asset.asset_label, kind: asset.kind })),
        model: outcome.model,
        note: 'Already shown on the canvas. Refer to it by its label; do not paste links.',
    });
}

async function runDesign(ctx) {
    const { session_id: sessionId, text, attachments, skill, canvas } = ctx.input;
    const session = { sid: ctx.sid, cid: ctx.cid };
    const doc = await getSessionDoc(ctx.cid, sessionId);
    const assets = new Map((doc.assets || []).map((asset) => [asset.asset_label, asset]));
    const catalog = await getCatalog();

    const emitted = [];
    const emit = (type, payload) => {
        const event = ctx.emit(type, payload);
        if (event) emitted.push(event);
        return event;
    };
    let textSoFar = '';
    const say = (content) => {
        const chunk = String(content || '').trim();
        if (!chunk) return;
        const piece = textSoFar ? `\n\n${chunk}` : chunk;
        textSoFar += piece;
        emit('text', { content: piece });
    };

    const { message: userMessage, historyText } = userTurn({ text, attachments, assetsByLabel: assets });
    const messages = [
        { role: 'system', content: designSystemPrompt({ assets: [...assets.values()], canvas, skill }) },
        ...historyMessages(doc.history),
        userMessage,
    ];
    const tools = designTools();
    const toolEnv = { session, signal: ctx.signal, catalog, assets, canvas: canvas ? structuredClone(canvas) : { nodes: [] } };
    const created = [];
    let toolCalls = 0;
    let videoCalls = 0;
    let visionFallback = false;
    let interrupted = null;

    const finish = async (failure) => {
        const content = textSoFar;
        // The route writes the user message + placeholder right after the
        // job starts; the reply must land after it.
        await Promise.race([ctx.input.ready, new Promise((resolve) => setTimeout(resolve, 5_000).unref?.())]);
        await completeTurn(ctx.cid, sessionId, {
            jobId: ctx.jobId,
            content,
            events: [...emitted.map(flatten).filter(Boolean), ...(failure ? [{ type: 'error', job_id: ctx.jobId, message: failure.message }] : [])],
        }).catch(() => {});
        const made = created.length ? `\n\n[Created: ${created.map((a) => `${a.asset_label} (${a.kind})`).join(', ')}]` : '';
        await appendHistory(ctx.cid, sessionId, [
            { role: 'user', content: historyText },
            { role: 'assistant', content: `${content || (failure ? `(The run stopped: ${failure.message})` : '(no reply)')}${made}` },
        ]).catch(() => {});
    };

    try {
        for (let round = 0; round < MAX_ROUNDS; round++) {
            const lastRound = round === MAX_ROUNDS - 1 || toolCalls >= MAX_TOOL_CALLS;
            const request = () => ctx.llm({
                purpose: 'agent',
                messages,
                max_tokens: REPLY_MAX_TOKENS,
                temperature: 0.7,
                // The last round must answer in text; the tools stay declared
                // because the conversation already contains tool calls.
                tools,
                tool_choice: lastRound ? 'none' : 'auto',
            });
            let result;
            try {
                try {
                    result = await request();
                } catch (error) {
                    // A text-only agent model rejects image parts: retry once
                    // with the files named in text only.
                    const hasImages = messages.some((m) => Array.isArray(m.content));
                    if (visionFallback || !hasImages || error?.code !== 'invalid_request') throw error;
                    visionFallback = true;
                    messages.splice(0, messages.length, ...withoutImageParts(messages));
                    result = await request();
                }
            } catch (error) {
                // Files already made (and paid for) stay on the canvas.
                if (created.length && !ctx.signal.aborted) {
                    interrupted = error;
                    break;
                }
                throw error;
            }
            const calls = Array.isArray(result.tool_calls) ? result.tool_calls.filter((call) => call?.function?.name) : [];
            const reply = typeof result.content === 'string' ? result.content : '';
            say(reply);
            if (!calls.length || lastRound) break;

            messages.push({
                role: 'assistant',
                content: reply || null,
                tool_calls: calls.map((call) => ({
                    id: String(call.id || ''),
                    type: 'function',
                    function: { name: call.function.name, arguments: typeof call.function.arguments === 'string' ? call.function.arguments : JSON.stringify(call.function.arguments || {}) },
                })),
            });
            for (const call of calls) {
                const tool = getDesignTool(call.function.name);
                let args = {};
                try {
                    args = parseToolArguments(call.function.arguments);
                } catch {
                    args = {};
                }
                let outcome;
                const made = [];
                if (tool && !tool.free && toolCalls >= MAX_TOOL_CALLS) {
                    outcome = { ok: false, error: `Limit reached: at most ${MAX_TOOL_CALLS} generations per message. Ask the user to continue in a new message.` };
                } else if (tool?.video && videoCalls >= MAX_VIDEO_CALLS) {
                    outcome = { ok: false, error: `Limit reached: at most ${MAX_VIDEO_CALLS} videos per message.` };
                } else {
                    if (tool && !tool.free) toolCalls += 1;
                    if (tool?.video) videoCalls += 1;
                    emit('tool_call', { name: call.function.name, args: displayArgs(args) });
                    ctx.progress(Math.min(90, 10 + toolCalls * 10), call.function.name);
                    outcome = await runDesignTool(call, toolEnv);
                    if (outcome.ok && outcome.canvasOp) {
                        emit('canvas_op', outcome.canvasOp);
                        emit('tool_result', { name: call.function.name, result: { ok: true, arranged: outcome.arranged } });
                    } else if (outcome.ok) {
                        for (const output of outcome.outputs) {
                            const asset = await addAsset(ctx.cid, sessionId, {
                                url: output.url,
                                kind: output.kind,
                                source_tool: call.function.name,
                                model: outcome.model,
                                prompt: outcome.prompt,
                                source_asset_id: outcome.source,
                            });
                            assets.set(asset.asset_label, asset);
                            made.push(asset);
                            created.push(asset);
                            emit('tool_result', {
                                name: call.function.name,
                                result: { ok: true, model: outcome.model, ...(outcome.source ? { source_asset_id: outcome.source } : {}) },
                                asset: { asset_label: asset.asset_label, url: asset.url, kind: asset.kind },
                            });
                        }
                    } else {
                        emit('tool_result', { name: call.function.name, result: { ok: false, error: outcome.error } });
                    }
                }
                messages.push({ role: 'tool', tool_call_id: String(call.id || ''), content: toolMessage(outcome, made) });
            }
        }
    } catch (error) {
        const err = toGatewayError(error);
        // Lets the canvas refresh the host's budget display.
        if (err.code === 'budget_exceeded') emit('budget', { ...(err.extra || {}) });
        await finish(err);
        throw err;
    }

    if (interrupted) say(created.length === 1
        ? `I made ${created[0].asset_label} but couldn't finish my reply. Ask me to continue.`
        : `I made ${created.map((a) => a.asset_label).join(', ')} but couldn't finish my reply. Ask me to continue.`);
    if (!textSoFar && !created.length) throw new GatewayError(502, 'empty_reply', "The design agent didn't reply. Try again.");
    await finish(null);
    ctx.progress(100);
    const urls = created.map((asset) => asset.url);
    return {
        session_id: sessionId,
        content: textSoFar,
        assets: created.map((asset) => ({ asset_label: asset.asset_label, url: asset.url, kind: asset.kind })),
        outputs: urls,
        url: urls[0] || null,
    };
}

register(PIPELINE, runDesign, {
    // Up to two video generations per turn, each can take several minutes.
    timeoutMs: 20 * 60_000,
    estimateUsd: () => 0.05,
    validate(input) {
        if (!input || typeof input !== 'object' || !trustedInputs().has(input)) {
            throw new GatewayError(404, 'unknown_model', "This feature isn't available.");
        }
        return input;
    },
});

// Starts a turn in a design session.
//   text          what the user typed (for a skill: the skill's input)
//   attachments   asset labels the user attached
//   skill         skillForRun() result or null
//   canvas        cleanCanvasState() result or null
// → {jobId, token, body}
export async function startDesignRun({ session, sessionId, text, attachments = [], skill = null, canvas = null }) {
    if (!session?.sid || !session?.cid) throw errors.unauthorized();
    const doc = await getSessionDoc(session.cid, sessionId);
    const assetsByLabel = new Map((doc.assets || []).map((asset) => [asset.asset_label, asset]));
    const known = attachments.filter((label) => assetsByLabel.has(label));
    const input = {
        session_id: sessionId,
        text: cleanText(text, { field: 'message', max: LIMITS.message, required: !known.length }),
        attachments: known,
        skill,
        canvas,
    };
    let markReady;
    Object.defineProperty(input, 'ready', { value: new Promise((resolve) => { markReady = resolve; }), enumerable: false });
    trustedInputs().add(input);
    const { token, job, body } = await startPipelineJob({ name: PIPELINE, input, session });
    try {
        await recordJob(session.cid, sessionId, { jobId: job.id, sid: session.sid, kind: skill ? 'skill' : 'chat' });
        await appendTurn(session.cid, sessionId, {
            jobId: job.id,
            user: {
                role: 'user',
                content: input.text,
                attachments: known.map((label) => {
                    const asset = assetsByLabel.get(label);
                    return { asset_label: label, url: asset.url, kind: asset.kind };
                }),
                timestamp: new Date().toISOString(),
                ...(skill ? { skill_name: skill.name } : {}),
            },
        });
    } catch {
        // the transcript is display data; the run itself is unaffected
    } finally {
        markReady();
    }
    if (input.text) autoNameSession(session.cid, sessionId, input.text).catch(() => {});
    return { jobId: job.id, token, body };
}
