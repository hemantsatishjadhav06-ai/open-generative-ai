// POST /api/llm/chat {purpose:'fast'|'agent'|'vision', messages, response_format?, stream?}
// → {content} (JSON) or the OpenRouter SSE stream when stream:true.
// The model is chosen server-side by purpose (an explicit `model` must be on
// the allowlist). A worst-case amount is reserved on the workspace's daily
// budget before the call and settled to usage.cost afterwards (llmBudget.js);
// an aborted request keeps its reservation because OpenRouter still bills it.
import { isLlmConfigured } from '../../../../lib/gateway/config.js';
import { errors } from '../../../../lib/gateway/errors.js';
import { json, readJson, route } from '../../../../lib/gateway/http.js';
import { meteredChat } from '../../../../lib/gateway/llmBudget.js';
import { endUserId, parseJsonReply } from '../../../../lib/gateway/openrouter.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const PURPOSES = new Set(['fast', 'agent', 'vision']);

export const POST = route('llm-chat', async (request, { session }) => {
    if (!isLlmConfigured()) throw errors.notConfigured('The AI text service');
    const body = await readJson(request, { maxBytes: 8 * 1024 * 1024 });
    const purpose = body.purpose === undefined ? 'fast' : body.purpose;
    if (!PURPOSES.has(purpose)) throw errors.badRequest("purpose must be 'fast', 'agent' or 'vision'.", 'purpose');
    const options = {
        cid: session.cid,
        purpose,
        model: body.model,
        messages: body.messages,
        response_format: body.response_format,
        temperature: body.temperature,
        max_tokens: body.max_tokens,
        user: endUserId(session.cid),
    };

    if (body.stream === true) {
        // Streams follow the client: a disconnect stops generation upstream.
        const { stream, model } = await meteredChat({ ...options, stream: true, signal: request.signal });
        return new Response(stream, {
            status: 200,
            headers: {
                'Content-Type': 'text/event-stream; charset=utf-8',
                'Cache-Control': 'no-cache, no-transform',
                'X-Accel-Buffering': 'no',
                'x-aquora-model': model,
            },
        });
    }

    // Not tied to request.signal: aborting would not stop OpenRouter billing,
    // and letting the call finish settles the reservation to its real cost.
    const result = await meteredChat(options);
    const reply = {
        content: typeof result.content === 'string' ? result.content : '',
        model: result.model,
        finish_reason: result.finish_reason,
        cost: result.usage?.cost || 0,
    };
    if (body.response_format && body.response_format.type !== 'text') reply.json = parseJsonReply(reply.content);
    return json(reply);
}, { session: true, rate: 'llm' });
