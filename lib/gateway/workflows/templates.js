// Built-in workflow templates (the Templates tab and the builder's "Select a
// Workflow" picker mirror these). Stored in the same shape as a saved
// workflow; params are derived from input_params + edges at run time, so a
// template only lists the values a person would type. No demo media: steps
// that need a file start empty and the Playground asks for an upload.

const HANDLES = {
    textToImage: { sourceHandle: 'textOutput', targetHandle: 'imageInput' },
    imageToImageList: { sourceHandle: 'imageOutput', targetHandle: 'imageInput2' },
    textToVideo: { sourceHandle: 'textOutput', targetHandle: 'videoInput' },
    imageToVideoImage: { sourceHandle: 'imageOutput', targetHandle: 'videoInput2' },
    audioToVideoAudio: { sourceHandle: 'audioOutput', targetHandle: 'videoInput5' },
    textToAudio: { sourceHandle: 'textOutput', targetHandle: 'audioInput2' },
    imageToTextImage: { sourceHandle: 'imageOutput', targetHandle: 'textInput2' },
    textToText: { sourceHandle: 'textOutput', targetHandle: 'textInput' },
};

function node(id, category, model, inputParams, position) {
    return {
        id,
        category,
        model,
        input_params: inputParams,
        output_params: { resultUrl: null, outputs: [] },
        params: {},
        position,
    };
}

function edge(id, source, target, handles) {
    return { id, source, target, ...handles };
}

const TEMPLATES = [
    {
        id: 'tpl-image-editor',
        icon: 'image',
        category: { en: 'Image', zh: '图片' },
        name: { en: 'Image generator & editor', zh: '图片生成与编辑' },
        description: {
            en: 'Generate an image from a prompt, then refine it with an edit instruction (Wan 2.5).',
            zh: '先用提示词生成图片，再用编辑指令优化（Wan 2.5）。',
        },
        nodes: [
            node('text1', 'text', 'text-passthrough', {
                prompt: 'Ultra-detailed cinematic portrait of a futuristic engineer inside a holographic command center, floating translucent UI panels, blue and violet light, shallow depth of field, photorealistic.',
            }, { x: -69, y: 22 }),
            node('image1', 'image', 'wan2.5-text-to-image', { width: 1024, height: 1024 }, { x: 370, y: 250 }),
            node('text2', 'text', 'text-passthrough', {
                prompt: 'Make the lighting more cinematic with a stronger rim light and soft volumetric fog; keep the subject and the photorealistic style.',
            }, { x: 390, y: -235 }),
            node('image2', 'image', 'wan2.5-image-edit', { width: 2048, height: 2048, make_output: true }, { x: 835, y: 25 }),
        ],
        edges: [
            edge('e1-1', 'text1', 'image1', HANDLES.textToImage),
            edge('e1-2', 'image1', 'image2', HANDLES.imageToImageList),
            edge('e1-3', 'text2', 'image2', HANDLES.textToImage),
        ],
    },
    {
        id: 'tpl-image-to-video',
        icon: 'video',
        category: { en: 'Video', zh: '视频' },
        name: { en: 'Scene to video', zh: '场景转视频' },
        description: {
            en: 'Design a still with Seedream 4.5, then animate it with Seedance Lite.',
            zh: '用 Seedream 4.5 生成画面，再用 Seedance Lite 让它动起来。',
        },
        nodes: [
            node('text1', 'text', 'text-passthrough', {
                prompt: 'Wide cinematic shot of a glowing futuristic city built from floating geometric shapes, neon blue and purple light, soft volumetric fog, dramatic sky.',
            }, { x: -14, y: -426 }),
            node('image1', 'image', 'bytedance-seedream-v4.5', { aspect_ratio: '16:9' }, { x: 330, y: -420 }),
            node('text2', 'text', 'text-passthrough', {
                prompt: 'Slow cinematic push-in with subtle parallax; holographic elements gently pulse, light rays drift through the fog.',
            }, { x: -9, y: 30 }),
            node('video1', 'video', 'seedance-lite-i2v', { resolution: '720p', duration: 5, make_output: true }, { x: 760, y: -154 }),
        ],
        edges: [
            edge('e2-1', 'text1', 'image1', HANDLES.textToImage),
            edge('e2-2', 'text2', 'video1', HANDLES.textToVideo),
            edge('e2-3', 'image1', 'video1', HANDLES.imageToVideoImage),
        ],
    },
    {
        id: 'tpl-voiceover',
        icon: 'audio',
        category: { en: 'Audio', zh: '音频' },
        name: { en: 'Script to voiceover', zh: '脚本转配音' },
        description: {
            en: 'Turn a script into a natural voiceover with MiniMax Speech.',
            zh: '用 MiniMax Speech 把脚本变成自然的配音。',
        },
        nodes: [
            node('text1', 'text', 'text-passthrough', {
                prompt: 'Three tips for better phone videos: shoot in daylight, keep the camera steady, and get closer to your subject.',
            }, { x: -9, y: 30 }),
            node('audio1', 'audio', 'minimax-speech-2.6-hd', { voice_id: 'Friendly_Person', make_output: true }, { x: 400, y: 100 }),
        ],
        edges: [
            edge('e3-1', 'text1', 'audio1', HANDLES.textToAudio),
        ],
    },
    {
        id: 'tpl-talking-avatar',
        icon: 'video',
        category: { en: 'Video', zh: '视频' },
        name: { en: 'Script → voice → talking video', zh: '脚本 → 配音 → 口播视频' },
        description: {
            en: 'Write a script, voice it, and lip-sync a portrait you upload (OmniHuman 1.5).',
            zh: '写脚本、生成配音，再让你上传的人像对口型说话（OmniHuman 1.5）。',
        },
        nodes: [
            node('text1', 'text', 'text-passthrough', {
                prompt: 'Hi! Today I will show you the one editing trick that makes every video feel more professional.',
            }, { x: -20, y: -120 }),
            node('audio1', 'audio', 'minimax-speech-2.6-turbo', { voice_id: 'Friendly_Person' }, { x: 380, y: -160 }),
            node('image1', 'image', 'image-passthrough', {}, { x: -20, y: 260 }),
            node('video1', 'video', 'omnihuman-1-5', { make_output: true }, { x: 800, y: 60 }),
        ],
        edges: [
            edge('e4-1', 'text1', 'audio1', HANDLES.textToAudio),
            edge('e4-2', 'audio1', 'video1', HANDLES.audioToVideoAudio),
            edge('e4-3', 'image1', 'video1', HANDLES.imageToVideoImage),
        ],
    },
    {
        id: 'tpl-image-caption',
        icon: 'text',
        needsLlm: true,
        category: { en: 'Text', zh: '文本' },
        name: { en: 'Describe an image', zh: '图片描述' },
        description: {
            en: 'Upload an image and get a detailed prompt you can reuse in any image model.',
            zh: '上传一张图片，得到可在任意图片模型中复用的详细提示词。',
        },
        nodes: [
            node('image1', 'image', 'image-passthrough', {}, { x: 0, y: 100 }),
            node('text2', 'text', 'text-passthrough', {
                prompt: 'Describe this image as a detailed prompt: subject, setting, colours, textures, lighting, camera and mood.',
            }, { x: -2, y: -335 }),
            node('text1', 'text', 'llm-vision', { make_output: true }, { x: 432, y: -110 }),
        ],
        edges: [
            edge('e5-1', 'image1', 'text1', HANDLES.imageToTextImage),
            edge('e5-2', 'text2', 'text1', HANDLES.textToText),
        ],
    },
];

const BY_ID = new Map(TEMPLATES.map((template) => [template.id, template]));

function pick(copy, locale) {
    return copy?.[locale] || copy?.en || '';
}

export function isTemplateId(id) {
    return BY_ID.has(id);
}

// Card list for the Templates tab.
export function listTemplates({ locale = 'en', llm = true } = {}) {
    return TEMPLATES.filter((template) => llm || !template.needsLlm).map((template) => ({
        id: template.id,
        name: pick(template.name, locale),
        category: pick(template.category, locale),
        description: pick(template.description, locale),
        thumbnail: null,
        icon: template.icon,
        is_template: true,
    }));
}

// A template as a workflow document (deep copy, safe to mutate).
export function getTemplate(id, { locale = 'en' } = {}) {
    const template = BY_ID.get(id);
    if (!template) return null;
    return {
        workflow_id: template.id,
        name: pick(template.name, locale),
        category: pick(template.category, locale),
        description: pick(template.description, locale),
        thumbnail: null,
        is_template: true,
        needs_llm: Boolean(template.needsLlm),
        edges: structuredClone(template.edges),
        data: { nodes: structuredClone(template.nodes) },
    };
}

export function templateIds() {
    return [...BY_ID.keys()];
}
