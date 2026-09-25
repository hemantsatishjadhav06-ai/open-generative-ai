// "Expert skills" for the design agent: pinned recipes the canvas offers in
// its skills menu (GET /api/v1/creative-agent/agent-skills). A skill run is a
// normal design-agent run whose system prompt carries the recipe; the user's
// text fills the skill's single input.

const SKILLS = [
    {
        id: 'product-shots',
        input: 'product',
        en: { name: 'Product shots', description: 'Three studio-quality photos of a product: hero, lifestyle and detail.' },
        zh: { name: '产品图', description: '为产品生成三张棚拍级照片：主图、场景图和细节图。' },
        instructions: 'Make three product photos of the product described (or the attached product image): 1) a hero shot on a clean seamless studio background, 2) a lifestyle scene that shows the product in use, 3) a close-up detail shot. If the user attached a product photo, use edit_image on it for each shot and keep the product itself unchanged; otherwise use generate_image. Use 1:1 unless the user asks otherwise. When all three exist, call arrange_canvas with layout "row" for them.',
    },
    {
        id: 'social-post-set',
        input: 'topic',
        en: { name: 'Social post set', description: 'A matching feed post, portrait post and story for one topic.' },
        zh: { name: '社媒套图', description: '同一主题的方图帖子、竖版帖子和快拍，风格统一。' },
        instructions: 'Create a matching set of three social visuals for the topic in one consistent style: a 1:1 feed post, a 4:5 portrait post and a 9:16 story. Put any short headline text in quotes inside the prompt so it is rendered. Then call arrange_canvas with layout "row".',
    },
    {
        id: 'youtube-thumbnail',
        input: 'video_title',
        en: { name: 'YouTube thumbnail', description: 'Two bold 16:9 thumbnail options for a video title.' },
        zh: { name: 'YouTube 封面', description: '根据视频标题生成两版醒目的 16:9 封面。' },
        instructions: 'Design two different 16:9 YouTube thumbnail options for the video title: high contrast, one clear focal subject, at most four words of large text (in quotes in the prompt). If the user attached a photo of themselves or a product, use edit_image on it so it stays recognisable. Then call arrange_canvas with layout "row".',
    },
    {
        id: 'storyboard',
        input: 'premise',
        en: { name: 'Storyboard', description: 'Four consistent 16:9 frames that tell a short story.' },
        zh: { name: '故事板', description: '四张风格一致的 16:9 画面，讲述一个短故事。' },
        instructions: 'Turn the premise into a four-shot storyboard: write one line per shot, then create each frame with generate_image at 16:9 in the same visual style and with the same characters (repeat the character and style description in every prompt). Then call arrange_canvas with layout "grid". Offer to animate a frame with image_to_video, but do not make videos unless asked.',
    },
    {
        id: 'logo-concepts',
        input: 'brand_name',
        en: { name: 'Logo concepts', description: 'Three distinct logo directions for a brand name.' },
        zh: { name: 'Logo 方案', description: '为品牌名给出三个不同方向的 Logo 概念。' },
        instructions: 'Create three distinct 1:1 logo concepts for the brand on plain white backgrounds: a wordmark, a symbol with the name, and a minimal monogram. Spell the brand name exactly (in quotes in each prompt). Then call arrange_canvas with layout "row" and describe each direction in one sentence.',
    },
    {
        id: 'animate-image',
        input: 'motion',
        en: { name: 'Animate an image', description: 'Turns an image on the canvas into a short video clip.' },
        zh: { name: '让图片动起来', description: '把画布上的图片变成一段短视频。' },
        instructions: 'Animate the image the user attached or mentioned (or the selected canvas asset) with image_to_video, following the requested motion. Use duration 5 unless the user asks for longer. If there is no image to animate, ask the user to attach or select one instead of calling a tool.',
    },
];

const BY_ID = new Map(SKILLS.map((skill) => [skill.id, skill]));

function localized(skill, locale) {
    return skill[locale] || skill.en;
}

export function listDesignSkills(locale = 'en') {
    return SKILLS.map((skill) => {
        const copy = localized(skill, locale);
        return { id: skill.id, name: copy.name, description: copy.description, inputs: [skill.input] };
    });
}

// Resolves a skill by id, or by its display name in any language (older
// transcripts only stored the name).
export function findDesignSkill(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    const wanted = value.trim().toLowerCase();
    if (BY_ID.has(wanted)) return BY_ID.get(wanted);
    return SKILLS.find((skill) => skill.en.name.toLowerCase() === wanted || skill.zh.name === value.trim()) || null;
}

export function skillForRun(skill, locale = 'en') {
    const copy = localized(skill, locale);
    return { id: skill.id, name: copy.name, input: skill.input, instructions: skill.instructions };
}
