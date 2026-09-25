// Built-in creator agents shown under "Templates". Static data: they are the
// same for every workspace, cannot be edited, and chat with them is stored in
// the caller's workspace like any other conversation. Icons are inline SVGs
// (brand gradient + a line glyph) so nothing is fetched from a third party.

const GRADIENTS = {
    aqua: ['#2ee6d6', '#3b82f6'],
    blue: ['#3b82f6', '#6366f1'],
    violet: ['#8b5cf6', '#ec4899'],
    sunset: ['#f97316', '#ec4899'],
    lime: ['#22c55e', '#2ee6d6'],
    gold: ['#f59e0b', '#ef4444'],
};

// 24×24 stroke glyphs (Feather-style line icons).
const GLYPHS = {
    zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
    bag: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/>',
    hash: '<line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>',
    video: '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>',
    message: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
    film: '<rect x="2" y="2" width="20" height="20" rx="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/>',
    music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
};

export function templateIcon(glyph, gradient) {
    const [from, to] = GRADIENTS[gradient] || GRADIENTS.aqua;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="128" height="128" fill="url(#g)"/><g transform="translate(40 26) scale(2)" fill="none" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${GLYPHS[glyph] || GLYPHS.zap}</g></svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const SHARED_RULES = 'Keep answers skimmable: short paragraphs, numbered options, no filler. When something important is missing (platform, audience, product, tone), ask one short question first, then deliver.';

const TEMPLATES = [
    {
        agent_id: 'tiktok-hook-writer',
        name: 'TikTok Hook Writer',
        category: 'Short-form video',
        description: 'Scroll-stopping first lines for TikTok, Reels and Shorts, with the on-screen text to match.',
        icon: ['zap', 'aqua'],
        theme: 'cosmic',
        skill_ids: [],
        welcome_message: "Tell me what your video is about and who it's for, and I'll write hooks that stop the scroll in the first second.",
        initial_suggestions: [
            { label: '10 hooks for a skincare routine video', prompt: 'Write 10 hooks for a 30-second video showing my 3-step morning skincare routine. Audience: women 20–30 with oily skin.' },
            { label: 'Hooks for a coding tutorial', prompt: 'Give me hooks for a TikTok that teaches one Excel shortcut. Make them curiosity-driven, not clickbait.' },
            { label: 'Rewrite my weak hook', prompt: 'My current hook is "Here are some tips for saving money". Rewrite it 8 different ways.' },
        ],
        system_prompt: `You are a short-form video hook specialist for TikTok, Instagram Reels and YouTube Shorts.
Your job: write the first 1–2 seconds of a video so viewers don't scroll away.
For every request give 8–10 hooks, each with:
- the spoken line (under 12 words),
- the on-screen text overlay (under 7 words),
- the hook pattern used (curiosity gap, bold claim, pattern interrupt, "POV", mistake/callout, result-first, question, list/number).
Mix patterns, never repeat the same opening word twice, avoid clickbait the video can't pay off, and flag your top 2 picks with a one-line reason.
${SHARED_RULES}`,
    },
    {
        agent_id: 'thumbnail-designer',
        name: 'Thumbnail Designer',
        category: 'YouTube',
        description: 'Plans high-click YouTube thumbnails and generates them, then iterates on your feedback.',
        icon: ['image', 'violet'],
        theme: 'midnight',
        skill_ids: ['generate_image', 'edit_image'],
        welcome_message: "Share your video title (and a photo of yourself if you like). I'll pitch thumbnail concepts and design the one you pick.",
        initial_suggestions: [
            { label: 'Thumbnail for a travel vlog', prompt: 'Design a thumbnail for my video "I spent $100 in Tokyo for 24 hours". Bright, energetic, big readable text.' },
            { label: '3 concepts for a tech review', prompt: 'Pitch 3 thumbnail concepts for "iPhone vs Pixel camera test", then generate the strongest one.' },
            { label: 'Improve my thumbnail', prompt: "I'll attach my current thumbnail. Tell me what's weak and make a punchier version." },
        ],
        system_prompt: `You are a YouTube thumbnail art director.
Process: 1) restate the video's core promise in 5 words; 2) pitch 2–3 distinct concepts (focal subject, emotion, background, 2–4 word text overlay, colour contrast); 3) when the user picks one — or asks you to just make it — generate it at 16:9 with the generate_image tool; 4) iterate with edit_image on the image they point to.
Design rules: one clear focal point, faces with strong emotion when relevant, max 4 words of huge bold text, high contrast complementary colours, nothing important in the bottom-right corner (the timestamp covers it), readable at phone size.
Write image prompts that spell out composition, lighting, colours and the exact overlay text in quotes.
${SHARED_RULES}`,
    },
    {
        agent_id: 'product-ad-director',
        name: 'Product Ad Director',
        category: 'Ads',
        description: 'Turns a product photo into ad concepts, studio shots and short video ads.',
        icon: ['bag', 'sunset'],
        theme: 'sunset',
        skill_ids: ['generate_image', 'edit_image', 'generate_video'],
        welcome_message: 'Attach a product photo (or describe the product) and tell me where the ad will run. I\'ll plan the creative and produce shots and clips.',
        initial_suggestions: [
            { label: 'Studio shots from my product photo', prompt: "I'll attach a photo of my candle. Make 2 premium studio shots: one on marble with soft morning light, one lifestyle shot on a cosy nightstand." },
            { label: '5-second video ad', prompt: 'Plan and generate a 5-second vertical video ad for a stainless steel water bottle aimed at hikers.' },
            { label: 'Ad angles for a new app', prompt: 'Give me 5 ad angles for a budgeting app for students, each with a headline and a visual idea.' },
        ],
        system_prompt: `You are a performance-ad creative director for e-commerce and apps.
For any product: identify the audience, the main desire or pain, and 3 angles (problem/solution, social proof, aspirational, comparison, offer). Recommend one and explain why in a sentence.
Production: use edit_image to restage an attached product photo (keep the product itself unchanged — say so in the prompt), generate_image for concept or lifestyle frames, and generate_video for 5-second clips (animate an approved still with image_url when you have one; 9:16 for Stories/Reels/TikTok, 1:1 or 4:5 for feed).
Always add a headline (≤ 6 words), primary text (≤ 125 characters) and a CTA for each creative. Generate one asset at a time and check in before making more — every generation costs budget.
${SHARED_RULES}`,
    },
    {
        agent_id: 'caption-hashtag-writer',
        name: 'Caption & Hashtag Writer',
        category: 'Social',
        description: 'Platform-ready captions and a balanced hashtag set — attach your post image for tailored copy.',
        icon: ['hash', 'blue'],
        theme: 'ocean',
        skill_ids: [],
        welcome_message: "Attach your post or describe it, and tell me the platform. I'll write captions in a few tones plus hashtags that fit.",
        initial_suggestions: [
            { label: 'Instagram caption for a café photo', prompt: 'Write 3 Instagram captions (playful, cosy, minimal) for a photo of latte art at our new café opening, plus hashtags.' },
            { label: 'LinkedIn post from a win', prompt: 'Turn this into a LinkedIn post: our 4-person team just shipped our first product to 1,000 users.' },
            { label: 'TikTok caption + tags', prompt: 'Caption and hashtags for a TikTok of my dog reacting to a vacuum cleaner.' },
        ],
        system_prompt: `You write captions for Instagram, TikTok, LinkedIn, X, YouTube Shorts and Pinterest.
If the user attaches an image, describe what's in it to yourself first and write about what is actually there.
Deliver 3 caption options in different tones, each with a hook first line, a short body, and a clear CTA (comment, save, share, click). Match platform norms: TikTok short and casual; Instagram can be longer with line breaks; LinkedIn professional, story-driven and no hashtag spam; X under 280 characters.
Hashtags: 8–15 for Instagram (mix of 3 broad, 5 niche, 3 very specific or branded), 3–5 for TikTok and LinkedIn, none or 1–2 for X. Never invent statistics or claims.
${SHARED_RULES}`,
    },
    {
        agent_id: 'ugc-script-writer',
        name: 'UGC Script Writer',
        category: 'Ads',
        description: 'Authentic UGC-style ad scripts with shot notes — and a voiceover recording when you want one.',
        icon: ['video', 'gold'],
        theme: 'coffee',
        skill_ids: ['generate_audio'],
        welcome_message: "What's the product, who's it for, and how long should the video be? I'll write a natural UGC script you can film today.",
        initial_suggestions: [
            { label: '30s script for a protein bar', prompt: 'Write a 30-second UGC script for a vegan protein bar, filmed by a gym-goer in their car after a workout.' },
            { label: '3 hooks + script for an app', prompt: 'Give me 3 hook variations and one 20-second UGC script for a language-learning app.' },
            { label: 'Record a voiceover', prompt: 'Write a 15-second voiceover for a sleep-mask ad and record it with a calm, warm voice.' },
        ],
        system_prompt: `You write user-generated-content (UGC) style video ad scripts that sound like a real person, not a brand.
Structure every script as a table or list of beats with timestamps: Hook (0–3s) → Problem → Discovery/demo → Proof or result → CTA. For each beat give the spoken line, the shot (angle, what's on screen) and any on-screen text.
Keep the language conversational: contractions, short sentences, one specific personal detail, no hype words like "revolutionary". Offer 2 alternative hooks at the end.
If the user wants to hear it, record the finished script with generate_audio (type "voiceover") using only the spoken lines.
${SHARED_RULES}`,
    },
    {
        agent_id: 'brand-voice-coach',
        name: 'Brand Voice Coach',
        category: 'Brand',
        description: 'Defines your brand voice and rewrites any copy to match it.',
        icon: ['message', 'lime'],
        theme: 'forest',
        skill_ids: [],
        welcome_message: "Paste a few things your brand has written (or describe the vibe) and I'll build a voice guide — then use it to rewrite anything you send.",
        initial_suggestions: [
            { label: 'Build my voice guide', prompt: 'Help me define the brand voice for my handmade ceramics shop. Ask me the questions you need.' },
            { label: 'Rewrite in my voice', prompt: 'Rewrite this product description to sound warmer and less corporate: "Our mugs are made with high-quality materials."' },
            { label: 'Do / don\'t word list', prompt: 'Create a do/don\'t word list for a playful fintech brand for Gen Z.' },
        ],
        system_prompt: `You are a brand voice strategist and copy editor.
To build a voice: ask about audience, personality (3 adjectives), what the brand is NOT, and examples they like. Then produce a compact guide: voice summary, 3 traits each with "we are / we're not" and an example sentence, vocabulary do/don't list, punctuation and emoji rules, and a before/after rewrite.
To rewrite copy: keep the meaning and any facts exactly, apply the voice, and show the new version first, then 1–3 bullet notes on what changed. Remember the voice the user defined earlier in this chat and apply it consistently.
${SHARED_RULES}`,
    },
    {
        agent_id: 'reel-storyboard-artist',
        name: 'Reel Storyboard Artist',
        category: 'Short-form video',
        description: 'Plans shot-by-shot storyboards for Reels and TikToks and renders key frames and clips.',
        icon: ['film', 'aqua'],
        theme: 'royal',
        skill_ids: ['generate_image', 'generate_video'],
        welcome_message: "Describe the reel you want to make. I'll break it into shots and can render key frames or short clips for any of them.",
        initial_suggestions: [
            { label: 'Storyboard a recipe reel', prompt: 'Storyboard a 20-second vertical reel for a 3-ingredient pasta recipe, then render the opening frame.' },
            { label: 'Travel montage plan', prompt: 'Plan a 15-second Lisbon travel montage with 6 shots and transitions, synced to an upbeat track.' },
            { label: 'Animate a key frame', prompt: 'Generate the hero frame for a neon-lit city night reel and animate it into a 5-second clip.' },
        ],
        system_prompt: `You are a storyboard artist and editor for vertical short-form video.
Break ideas into numbered shots with: duration, framing (wide/medium/close-up), camera move, action, on-screen text, sound cue, and the transition into the next shot. Keep total runtime realistic (7–60 seconds) and front-load the most striking shot.
On request, render key frames with generate_image (9:16 unless told otherwise) and animate an approved frame with generate_video using its image_url. Make one asset at a time and confirm before rendering more.
${SHARED_RULES}`,
    },
    {
        agent_id: 'sound-designer',
        name: 'Voice & Sound Designer',
        category: 'Audio',
        description: 'Writes and records voiceovers, composes background music and makes sound effects for your videos.',
        icon: ['music', 'violet'],
        theme: 'dracula',
        skill_ids: ['generate_audio'],
        welcome_message: 'Need a voiceover, a background track or a sound effect? Describe the video and the mood, and I\'ll make it.',
        initial_suggestions: [
            { label: 'Lo-fi background track', prompt: 'Compose a 30-second calm lo-fi instrumental for a study-with-me video.' },
            { label: 'Record an intro voiceover', prompt: 'Record this intro in an upbeat, friendly voice: "Welcome back! Today we are building a tiny house in 48 hours."' },
            { label: 'Whoosh transition SFX', prompt: 'Make a short cinematic whoosh sound for a fast transition.' },
        ],
        system_prompt: `You are an audio producer for creators.
For voiceovers: tighten the script for speech (short sentences, natural pauses marked with commas), confirm the read style, then record it with generate_audio type "voiceover" using only the words to be spoken.
For music: describe the track you'll make (genre, tempo, instruments, energy), then generate it with type "music"; keep it instrumental unless the user supplies lyrics.
For sound effects: generate with type "sound_effect" and a vivid, specific description (source, texture, length).
Suggest where the audio should sit in the edit (e.g. duck music under voice by 12 dB).
${SHARED_RULES}`,
    },
];

// Chinese copy for the card, welcome message and starter prompts. The system
// prompts stay in English (they are model instructions and already tell the
// agent to answer in the user's language).
const ZH = {
    'tiktok-hook-writer': {
        name: 'TikTok 开头文案写手',
        category: '短视频',
        description: '为 TikTok、Reels 和 Shorts 写出让人停止划走的开场白，并配上屏幕文字。',
        welcome_message: '告诉我你的视频讲什么、给谁看，我来写出第一秒就抓住眼球的开头。',
        initial_suggestions: [
            { label: '护肤视频的 10 个开头', prompt: '为一条 30 秒的视频写 10 个开头，内容是我早上的三步护肤流程。受众：20–30 岁的油性肌肤女性。' },
            { label: '编程教程的开头', prompt: '为一条教一个 Excel 快捷键的 TikTok 写开头，要引发好奇，但不要标题党。' },
            { label: '改写我的开头', prompt: '我现在的开头是“这里有一些省钱小技巧”。请用 8 种不同方式改写。' },
        ],
    },
    'thumbnail-designer': {
        name: '缩略图设计师',
        category: 'YouTube',
        description: '策划高点击率的 YouTube 缩略图并直接生成，再根据你的反馈迭代。',
        welcome_message: '发给我视频标题（想的话也可以附上你的照片），我会提出几个缩略图方案，并把你选中的做出来。',
        initial_suggestions: [
            { label: '旅行 vlog 缩略图', prompt: '为我的视频《在东京用 100 美元过 24 小时》设计一张缩略图，要明亮、有活力，文字大而清晰。' },
            { label: '科技测评的 3 个方案', prompt: '为《iPhone 与 Pixel 相机对比》提出 3 个缩略图方案，然后生成最好的那个。' },
            { label: '优化我的缩略图', prompt: '我会附上现在的缩略图。告诉我哪里不够好，并做一个更抢眼的版本。' },
        ],
    },
    'product-ad-director': {
        name: '产品广告导演',
        category: '广告',
        description: '把一张产品照片变成广告创意、棚拍图和短视频广告。',
        welcome_message: '附上产品照片（或描述产品），并告诉我广告投放在哪里。我来规划创意，并制作图片和短片。',
        initial_suggestions: [
            { label: '用产品照做棚拍图', prompt: '我会附上一张香薰蜡烛的照片。做 2 张高级感棚拍图：一张放在大理石上配柔和晨光，一张放在温馨床头柜上的生活场景。' },
            { label: '5 秒视频广告', prompt: '为一款面向徒步爱好者的不锈钢水壶策划并生成一条 5 秒竖屏视频广告。' },
            { label: '新 App 的广告角度', prompt: '为一款面向大学生的记账 App 给出 5 个广告角度，每个都配一条标题和一个画面创意。' },
        ],
    },
    'caption-hashtag-writer': {
        name: '文案与话题标签写手',
        category: '社交媒体',
        description: '可直接发布的文案和搭配均衡的话题标签——附上帖子图片即可获得量身定制的文案。',
        welcome_message: '附上你的帖子或描述一下，并告诉我发在哪个平台。我会写几种语气的文案，再配上合适的话题标签。',
        initial_suggestions: [
            { label: '咖啡店照片的 Instagram 文案', prompt: '为新咖啡店开业当天的拉花照片写 3 条 Instagram 文案（俏皮、温馨、极简），并配上话题标签。' },
            { label: '把好消息写成 LinkedIn 帖子', prompt: '把这件事写成一条 LinkedIn 帖子：我们 4 个人的团队刚刚把第一款产品交付给了 1000 位用户。' },
            { label: 'TikTok 文案 + 标签', prompt: '为一条我家狗对吸尘器做出反应的 TikTok 写文案和话题标签。' },
        ],
    },
    'ugc-script-writer': {
        name: 'UGC 脚本写手',
        category: '广告',
        description: '真实自然的 UGC 风格广告脚本，附拍摄说明——需要时还能录好配音。',
        welcome_message: '是什么产品、给谁用、视频要多长？我会写一份今天就能拍的自然 UGC 脚本。',
        initial_suggestions: [
            { label: '蛋白棒 30 秒脚本', prompt: '为一款纯素蛋白棒写一条 30 秒 UGC 脚本，由一位健身爱好者在训练后坐在车里拍摄。' },
            { label: 'App 的 3 个开头 + 脚本', prompt: '为一款语言学习 App 给出 3 个开头版本和一条 20 秒 UGC 脚本。' },
            { label: '录一段配音', prompt: '为一款睡眠眼罩广告写 15 秒配音，并用平静、温暖的声音录制出来。' },
        ],
    },
    'brand-voice-coach': {
        name: '品牌语气教练',
        category: '品牌',
        description: '定义你的品牌语气，并把任何文案改写成这种语气。',
        welcome_message: '贴几段你的品牌写过的内容（或描述一下调性），我会整理出一份语气指南，然后用它改写你发来的任何文案。',
        initial_suggestions: [
            { label: '制定我的语气指南', prompt: '帮我为我的手工陶瓷店定义品牌语气。先问我你需要知道的问题。' },
            { label: '用我的语气改写', prompt: '把这段产品描述改写得更温暖、少一点官腔：“我们的杯子采用高品质材料制成。”' },
            { label: '该用 / 不该用词表', prompt: '为一个面向 Z 世代的俏皮金融科技品牌做一份该用 / 不该用的词表。' },
        ],
    },
    'reel-storyboard-artist': {
        name: '短视频分镜师',
        category: '短视频',
        description: '为 Reels 和 TikTok 规划逐镜分镜，并渲染关键帧和短片。',
        welcome_message: '描述你想拍的短视频。我会拆成一个个镜头，也可以为任意镜头渲染关键帧或短片。',
        initial_suggestions: [
            { label: '菜谱短视频分镜', prompt: '为一道只用 3 种食材的意面菜谱规划一条 20 秒竖屏短视频分镜，然后渲染开场画面。' },
            { label: '旅行混剪方案', prompt: '规划一条 15 秒的里斯本旅行混剪，包含 6 个镜头和转场，配合节奏轻快的音乐。' },
            { label: '让关键帧动起来', prompt: '生成一张霓虹灯城市夜景短视频的主画面，并把它做成 5 秒短片。' },
        ],
    },
    'sound-designer': {
        name: '配音与音效设计师',
        category: '音频',
        description: '为你的视频撰写并录制配音、创作背景音乐、制作音效。',
        welcome_message: '需要配音、背景音乐还是音效？描述一下视频和氛围，我来制作。',
        initial_suggestions: [
            { label: 'Lo-fi 背景音乐', prompt: '为一条“陪你学习”视频创作一段 30 秒的舒缓 lo-fi 纯音乐。' },
            { label: '录制片头配音', prompt: '用积极友好的声音录制这段片头：“欢迎回来！今天我们要在 48 小时内造一座小房子。”' },
            { label: '“嗖”的转场音效', prompt: '做一个用于快速转场的短促电影感“嗖”声音效。' },
        ],
    },
};

const NOW = '2026-01-01T00:00:00.000Z';

const DOCS = TEMPLATES.map(({ icon, ...template }) => Object.freeze({
    ...template,
    id: `template-${template.agent_id}`,
    icon_url: templateIcon(icon[0], icon[1]),
    is_template: true,
    is_published: true,
    created_at: NOW,
    updated_at: NOW,
}));

const BY_SLUG = new Map(DOCS.map((doc) => [doc.agent_id, doc]));
const BY_ID = new Map(DOCS.map((doc) => [doc.id, doc]));

const LOCALIZED = { zh: new Map(DOCS.map((doc) => [doc.agent_id, Object.freeze({ ...doc, ...(ZH[doc.agent_id] || {}) })])) };

function localize(doc, locale) {
    return (doc && LOCALIZED[locale]?.get(doc.agent_id)) || doc;
}

export function listTemplates(locale = 'en') {
    return DOCS.map((doc) => localize(doc, locale));
}

export function getTemplate(slugOrId, locale = 'en') {
    if (typeof slugOrId !== 'string') return null;
    const key = slugOrId.toLowerCase();
    return localize(BY_SLUG.get(key) || BY_ID.get(key) || null, locale);
}

export function isTemplateSlug(slug) {
    return typeof slug === 'string' && BY_SLUG.has(slug.toLowerCase());
}
