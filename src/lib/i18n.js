const LANG_KEY = 'og_lang';

/** Normalize legacy `zh` and browser locales to BCP-47 zh-CN. */
export function normalizeLang(raw) {
    if (!raw) return 'en';
    const lower = String(raw).toLowerCase();
    if (lower === 'zh' || lower.startsWith('zh-') || lower.startsWith('zh_')) return 'zh-CN';
    return lower === 'zh-cn' ? 'zh-CN' : 'en';
}

/** Detect browser locale on first visit; migrates stored `zh` → `zh-CN`. */
export function initLocale() {
    if (typeof localStorage === 'undefined') return 'en';
    const stored = localStorage.getItem(LANG_KEY);
    if (stored) {
        const normalized = normalizeLang(stored);
        if (normalized !== stored) localStorage.setItem(LANG_KEY, normalized);
        return normalized;
    }
    const detected = typeof navigator !== 'undefined' ? navigator.language : 'en';
    const lang = normalizeLang(detected);
    localStorage.setItem(LANG_KEY, lang);
    return lang;
}

export function getLang() {
    if (typeof localStorage === 'undefined') return 'en';
    const stored = localStorage.getItem(LANG_KEY);
    if (!stored) return initLocale();
    const normalized = normalizeLang(stored);
    if (normalized !== stored) localStorage.setItem(LANG_KEY, normalized);
    return normalized;
}

export function setLang(lang, { reload = true } = {}) {
    const normalized = normalizeLang(lang);
    localStorage.setItem(LANG_KEY, normalized);
    if (reload && typeof location !== 'undefined') {
        location.reload();
    } else if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('og_lang_change', { detail: normalized }));
    }
}

function dictFor(lang) {
    const key = normalizeLang(lang);
    if (key === 'zh-CN') return translations['zh-CN'] || translations.zh;
    return translations.en;
}

const translations = {
    en: {
        // Navigation
        'nav.image': 'Image',
        'nav.video': 'Video',
        'nav.lipsync': 'Lip Sync',
        'nav.cinema': 'Cinema Studio',
        'nav.workflows': 'Workflows',
        'nav.agents': 'Agents',
        'nav.settings': 'Settings',

        // Sidebar
        'sidebar.canvas': 'Canvas',
        'sidebar.video': 'Video',
        'sidebar.library': 'Library',
        'sidebar.settings': 'Settings',

        // Common
        'common.generate': 'Generate ✨',
        'common.generating': 'Generating...',
        'common.download': '↓ Download',
        'common.cancel': 'Cancel',
        'common.save': 'Save',
        'common.history': 'History',
        'common.advanced': 'Advanced',
        'common.less': 'Less',
        'common.tools': 'Tools',
        'common.copy': 'Copy',
        'common.copied': 'Copied!',
        'common.searchModels': 'Search models...',
        'common.retry': 'Retry',
        'common.loading': 'Loading...',
        'common.noResults': 'No local models match',
        'common.regenerate': '↻ Regenerate',
        'common.newItem': '+ New',
        'common.useInGenerator': 'Use in Generator',
        'common.randomize': 'Randomize',

        // Settings Modal
        'settings.title': 'Settings',
        'settings.account': 'Account',
        'settings.localModels': 'Local Models',
        'settings.accountNote': "Cloud models run on Aquora's own AI backend (fal.ai + OpenRouter). The provider keys stay on the server; this app never holds one.",
        'settings.workspace': 'Workspace',
        'settings.server': 'Server',
        'settings.budgetToday': "Today's AI budget",
        'settings.noBudgetCap': 'No daily cap',
        'settings.signedOut': "You're signed out. Sign in with your access code to use cloud models.",
        'settings.openAccess': "This server doesn't need an access code.",
        'settings.setupRequired': "This Aquora server isn't set up yet, so cloud models are unavailable.",
        'settings.checking': 'Checking…',
        'settings.offline': "Couldn't reach Aquora. Check your connection and try again.",
        'settings.signIn': 'Sign in',
        'settings.signOut': 'Sign out',
        'settings.signingOut': 'Signing out…',
        'settings.close': 'Close',

        // Access-code dialog
        'auth.title': 'Enter your access code',
        'auth.subtitle': "Cloud models run on Aquora's own AI backend. Enter your access code to use them.",
        'auth.sessionEndedTitle': 'Your session ended',
        'auth.sessionEndedSubtitle': 'Enter your access code to pick up where you left off.',
        'auth.label': 'Access code',
        'auth.placeholder': 'Enter your access code',
        'auth.showCode': 'Show code',
        'auth.hideCode': 'Hide code',
        'auth.submit': "Let's go",
        'auth.checking': 'Checking…',
        'auth.missingCode': 'Enter your access code first.',
        'auth.invalidCode': "That access code isn't valid. Check it and try again.",
        'auth.rateLimited': (seconds) => `Too many tries. Wait ${seconds}s and try again.`,
        'auth.setupRequired': "This Aquora server isn't set up yet. The site owner needs to add access codes and a session secret on the server.",
        'auth.unavailable': "Couldn't reach Aquora. Check your connection and try again.",
        'auth.genericError': 'Something went wrong. Try again.',
        'auth.setupTitle': 'Almost ready',
        'auth.helpSummary': 'Where do I get one?',
        'auth.help': 'Access codes come from whoever runs this Aquora. Ask them for yours.',
        'auth.note': 'You stay signed in on this device for 30 days.',
        'auth.close': 'Close',

        // Budget + gateway
        'budget.pill': (spent, cap) => `Today: ${spent} of ${cap}`,
        'budget.pillTitle': 'Estimated AI spend today. Resets at 00:00 UTC.',
        'gateway.modelUnavailable': "This model isn't available on Aquora right now. Pick another one.",

        // Image Studio
        'image.title': 'Image Studio',
        'image.subtitle': 'Transform images with AI — upscale, stylize, animate and more',
        'image.placeholder': 'Describe the image you want to create',
        'image.placeholderTransform': 'Describe how to transform this image (optional)',
        'image.generateTooltip': 'Generate AI image from prompt',
        'image.modelTooltip': 'Select AI generation model',
        'image.arTooltip': 'Change aspect ratio',
        'image.qualityTooltip': 'Set output quality',
        'image.advancedTooltip': 'Show advanced options',
        'image.toolsTooltip': 'Quick starters & prompt enhancer',
        'image.local': '⚡ Local',
        'image.api': '☁ API',
        'image.generatingLocally': 'Generating locally...',
        'image.quickTools': 'Quick Tools',
        'image.quickStarters': 'Quick Starters',
        'image.promptEnhancer': 'Prompt Enhancer',
        'image.basePromptPlaceholder': 'Enter base prompt...',
        'image.enhancementTags': 'Enhancement Tags',
        'image.enhancedPrompt': 'Enhanced Prompt',
        'image.enhancedPlaceholder': 'Your enhanced prompt will appear here...',
        'image.advancedOptions': 'Advanced Options',
        'image.stylePreset': 'Style Preset',
        'image.negPromptLabel': 'Negative Prompt',
        'image.negPromptPlaceholder': 'What to exclude from the image (e.g., blurry, distorted, watermark)',
        'image.guidanceScale': 'Guidance Scale',
        'image.steps': 'Steps',
        'image.seed': 'Seed',
        'image.seedPlaceholder': '-1 for random',
        'image.batchCount': 'Batch Count',
        'image.width': 'Width',
        'image.height': 'Height',
        'image.widthPlaceholder': 'Auto',
        'image.heightPlaceholder': 'Auto',
        'image.refStrength': 'Reference Strength',
        'image.refStrengthNote': 'How much to preserve the reference image characteristics',
        'image.lora': 'LoRA Model (Optional)',
        'image.loraPlaceholder': 'e.g., civitai:1642876@1864626',
        'image.loraWeight': 'LoRA Weight:',
        'image.loraNote': 'Enter a LoRA model ID from Civitai (format: civitai:id@version)',

        // Video Studio
        'video.title': 'Video Studio',
        'video.subtitle': 'Animate images into stunning AI videos with motion effects',
        'video.placeholder': 'Describe the video you want to create',
        'video.generateTooltip': 'Generate AI video',
        'video.history': 'History',
        'video.regenerate': '↻ Regenerate',
        'video.download': '↓ Download',
        'video.extend': '↗ Extend',
        'video.v2vReady': 'Video ready — pick a video tool and click Generate',
        'video.new': '+ New',
        'video.videoTools': 'Video Tools',

        // Lip Sync Studio
        'lipsync.title': 'Lip Sync',
        'lipsync.subtitle': 'Animate portraits or sync lips to audio with AI',
        'lipsync.input': 'Input:',
        'lipsync.portraitImage': '🖼 Portrait Image',
        'lipsync.video': '🎬 Video',
        'lipsync.noImage': 'No image',
        'lipsync.noVideo': 'No video',
        'lipsync.noAudio': 'No audio',
        'lipsync.imageReady': '✓ Image ready',
        'lipsync.videoReady': '✓ Video ready',
        'lipsync.promptPlaceholder': 'Optional: describe the talking style or motion...',
        'lipsync.regenerate': '↻ Regenerate',
        'lipsync.download': '↓ Download',
        'lipsync.new': '+ New',
        'lipsync.history': 'History',
        'lipsync.noAudioAlert': 'Please upload an audio file first.',
        'lipsync.noImageAlert': 'Please upload a portrait image first.',
        'lipsync.noVideoAlert': 'Please upload a source video first.',

        // Cinema Studio
        'cinema.tagline': 'Cinema Studio 2.0',
        'cinema.headline': 'What would you shoot<br>with infinite budget?',
        'cinema.placeholder': 'Describe your scene - use @ to add characters & props',
        'cinema.builderTooltip': 'Quick camera builder',
        'cinema.cameraSettings': 'Open camera settings',
        'cinema.generateBtn': 'GENERATE ✨',
        'cinema.shooting': 'SHOOTING...',
        'cinema.history': 'History',
        'cinema.load': 'Load',
        'cinema.regenerate': '↻ Regenerate',
        'cinema.download': '↓ Download',
        'cinema.newShot': '+ New Shot',
        'cinema.cameraBuilder': 'Camera Builder',
        'cinema.camera': 'Camera',
        'cinema.lens': 'Lens',
        'cinema.focal': 'Focal',
        'cinema.aperture': 'Aperture',
        'cinema.preview': 'Preview',
        'cinema.useSetup': 'Use This Setup',
        'cinema.selectSettings': 'Select camera settings to see preview...',
        'cinema.generationFailed': 'Generation Failed: ',

        // Agent Studio
        'agents.title': 'Agent Studio',
        'agents.webOnly': 'Available in the Aquora web app',

        // Workflow Studio
        'workflows.title': 'Workflow Studio',
        'workflows.webOnly': 'Available in the Aquora web app',

        // Local Model Manager
        'localModels.title': 'Local Models',
        'localModels.webOnly': 'Local model inference is only available in the desktop app (Electron build). Use npm run electron:build to build.',
        'localModels.inferenceEngine': 'Inference Engine',
        'localModels.checking': 'Checking...',
        'localModels.installed': 'Installed and ready',
        'localModels.notInstalled': 'Not installed — required for local generation',
        'localModels.installEngine': 'Install Engine',
        'localModels.downloading': 'Downloading...',
        'localModels.extracting': 'Extracting...',
        'localModels.storedIn': 'Stored in',
        'localModels.storedDefault': 'Stored in your app data folder',
        'localModels.checkingStorage': 'Checking storage...',
        'localModels.loading': 'Loading...',
        'localModels.featured': '⚡ Featured',
        'localModels.download': 'Download',
        'localModels.requiredComponents': 'Required components',
        'localModels.ready': 'Ready',
        'localModels.available': 'Available',
        'localModels.offline': 'Unavailable',
        'localModels.starting': 'Starting...',
        'localModels.complete': 'Complete!',
        'localModels.preparing': 'Preparing...',
        'localModels.get': 'Get',
        'localModels.notConfigured': 'Not configured',
        'localModels.notConfiguredNote': 'Not configured (Wan2GP models will appear offline)',
        'localModels.probing': 'Probing...',
        'localModels.errorLoading': 'Error loading models: ',
        'localModels.deleteConfirm': (name) => `Delete "${name}"? You'll need to re-download it to use it again.`,

        // Web shell
        'web.settingsTitle': 'Settings — account, local models, preferences',
        'web.switchToEn': 'Switch to English',
        'web.switchToZh': '切换为中文',

    },
    zh: {
        // Navigation
        'nav.image': '图像',
        'nav.video': '视频',
        'nav.lipsync': '唇语同步',
        'nav.cinema': '电影工作室',
        'nav.workflows': '工作流',
        'nav.agents': '智能体',
        'nav.settings': '设置',

        // Sidebar
        'sidebar.canvas': '画布',
        'sidebar.video': '视频',
        'sidebar.library': '素材库',
        'sidebar.settings': '设置',

        // Common
        'common.generate': '生成 ✨',
        'common.generating': '生成中...',
        'common.download': '↓ 下载',
        'common.cancel': '取消',
        'common.save': '保存',
        'common.history': '历史记录',
        'common.advanced': '高级',
        'common.less': '收起',
        'common.tools': '工具',
        'common.copy': '复制',
        'common.copied': '已复制！',
        'common.searchModels': '搜索模型...',
        'common.retry': '重试',
        'common.loading': '加载中...',
        'common.noResults': '未找到本地模型',
        'common.regenerate': '↻ 重新生成',
        'common.newItem': '+ 新建',
        'common.useInGenerator': '用于生成器',
        'common.randomize': '随机',

        // Settings Modal
        'settings.title': '设置',
        'settings.account': '账户',
        'settings.localModels': '本地模型',
        'settings.accountNote': '云端模型运行在 Aquora 自己的 AI 后端（fal.ai + OpenRouter）上。服务密钥只保存在服务器上，这个应用不会持有任何密钥。',
        'settings.workspace': '工作区',
        'settings.server': '服务器',
        'settings.budgetToday': '今日 AI 预算',
        'settings.noBudgetCap': '没有每日上限',
        'settings.signedOut': '你已退出登录。输入访问码即可使用云端模型。',
        'settings.openAccess': '这个服务器不需要访问码。',
        'settings.setupRequired': '这个 Aquora 服务器还没有配置完成，暂时无法使用云端模型。',
        'settings.checking': '正在检查…',
        'settings.offline': '连不上 Aquora，请检查网络后重试。',
        'settings.signIn': '登录',
        'settings.signOut': '退出登录',
        'settings.signingOut': '正在退出…',
        'settings.close': '关闭',

        // Access-code dialog
        'auth.title': '输入你的访问码',
        'auth.subtitle': '云端模型运行在 Aquora 自己的 AI 后端上。输入访问码即可使用。',
        'auth.sessionEndedTitle': '登录已过期',
        'auth.sessionEndedSubtitle': '输入访问码，从刚才的地方继续。',
        'auth.label': '访问码',
        'auth.placeholder': '输入你的访问码',
        'auth.showCode': '显示访问码',
        'auth.hideCode': '隐藏访问码',
        'auth.submit': '开始吧',
        'auth.checking': '正在检查…',
        'auth.missingCode': '请先输入访问码。',
        'auth.invalidCode': '这个访问码无效，检查一下再试。',
        'auth.rateLimited': (seconds) => `尝试次数太多，请等 ${seconds} 秒后再试。`,
        'auth.setupRequired': '这个 Aquora 还没有配置完成。站点所有者需要在服务器上添加访问码和会话密钥。',
        'auth.unavailable': '连不上 Aquora，请检查网络后重试。',
        'auth.genericError': '出了点问题，请重试。',
        'auth.setupTitle': '马上就好',
        'auth.helpSummary': '去哪里获取访问码？',
        'auth.help': '访问码由运营这个 Aquora 的人发放，向他们索取即可。',
        'auth.note': '登录后此设备保持 30 天。',
        'auth.close': '关闭',

        // Budget + gateway
        'budget.pill': (spent, cap) => `今日：${spent} / ${cap}`,
        'budget.pillTitle': '今日预估 AI 花费，每天 00:00 UTC 重置。',
        'gateway.modelUnavailable': '这个模型目前在 Aquora 上不可用，请换一个。',

        // Image Studio
        'image.title': '图像工作室',
        'image.subtitle': '用 AI 转换图像 — 超分辨率、风格化、动画等更多功能',
        'image.placeholder': '描述您想创建的图像',
        'image.placeholderTransform': '描述您想如何转换此图像（可选）',
        'image.generateTooltip': '根据提示词生成 AI 图像',
        'image.modelTooltip': '选择 AI 生成模型',
        'image.arTooltip': '更改宽高比',
        'image.qualityTooltip': '设置输出质量',
        'image.advancedTooltip': '显示高级选项',
        'image.toolsTooltip': '快速启动器与提示词增强器',
        'image.local': '⚡ 本地',
        'image.api': '☁ API',
        'image.generatingLocally': '本地生成中...',
        'image.quickTools': '快速工具',
        'image.quickStarters': '快速启动',
        'image.promptEnhancer': '提示词增强器',
        'image.basePromptPlaceholder': '输入基础提示词...',
        'image.enhancementTags': '增强标签',
        'image.enhancedPrompt': '增强后的提示词',
        'image.enhancedPlaceholder': '增强后的提示词将显示在这里...',
        'image.advancedOptions': '高级选项',
        'image.stylePreset': '风格预设',
        'image.negPromptLabel': '反向提示词',
        'image.negPromptPlaceholder': '图像中要排除的内容（如：模糊、失真、水印）',
        'image.guidanceScale': '引导系数',
        'image.steps': '步数',
        'image.seed': '随机种子',
        'image.seedPlaceholder': '-1 表示随机',
        'image.batchCount': '批量数量',
        'image.width': '宽度',
        'image.height': '高度',
        'image.widthPlaceholder': '自动',
        'image.heightPlaceholder': '自动',
        'image.refStrength': '参考强度',
        'image.refStrengthNote': '保留参考图像特征的程度',
        'image.lora': 'LoRA 模型（可选）',
        'image.loraPlaceholder': '例如：civitai:1642876@1864626',
        'image.loraWeight': 'LoRA 权重：',
        'image.loraNote': '输入来自 Civitai 的 LoRA 模型 ID（格式：civitai:id@version）',

        // Video Studio
        'video.title': '视频工作室',
        'video.subtitle': '用 AI 将图像动态化为精彩视频，配合运动效果',
        'video.placeholder': '描述您想创建的视频',
        'video.generateTooltip': '生成 AI 视频',
        'video.history': '历史记录',
        'video.regenerate': '↻ 重新生成',
        'video.download': '↓ 下载',
        'video.extend': '↗ 延伸',
        'video.v2vReady': '视频已就绪 — 选择一个视频工具，然后点击生成',
        'video.new': '+ 新建',
        'video.videoTools': '视频工具',

        // Lip Sync Studio
        'lipsync.title': '唇语同步',
        'lipsync.subtitle': '用 AI 为人像制作动画或将音频与唇语同步',
        'lipsync.input': '输入：',
        'lipsync.portraitImage': '🖼 人像图',
        'lipsync.video': '🎬 视频',
        'lipsync.noImage': '无图像',
        'lipsync.noVideo': '无视频',
        'lipsync.noAudio': '无音频',
        'lipsync.imageReady': '✓ 图像已就绪',
        'lipsync.videoReady': '✓ 视频已就绪',
        'lipsync.promptPlaceholder': '可选：描述说话风格或动作...',
        'lipsync.regenerate': '↻ 重新生成',
        'lipsync.download': '↓ 下载',
        'lipsync.new': '+ 新建',
        'lipsync.history': '历史记录',
        'lipsync.noAudioAlert': '请先上传音频文件。',
        'lipsync.noImageAlert': '请先上传人像图片。',
        'lipsync.noVideoAlert': '请先上传源视频。',

        // Cinema Studio
        'cinema.tagline': '电影工作室 2.0',
        'cinema.headline': '如果预算无限，<br>你会拍什么？',
        'cinema.placeholder': '描述您的场景 - 使用 @ 添加角色和道具',
        'cinema.builderTooltip': '快速摄像机设置',
        'cinema.cameraSettings': '打开摄像机设置',
        'cinema.generateBtn': '生成 ✨',
        'cinema.shooting': '拍摄中...',
        'cinema.history': '历史记录',
        'cinema.load': '加载',
        'cinema.regenerate': '↻ 重新生成',
        'cinema.download': '↓ 下载',
        'cinema.newShot': '+ 新镜头',
        'cinema.cameraBuilder': '摄像机设置',
        'cinema.camera': '摄像机',
        'cinema.lens': '镜头',
        'cinema.focal': '焦距',
        'cinema.aperture': '光圈',
        'cinema.preview': '预览',
        'cinema.useSetup': '使用此设置',
        'cinema.selectSettings': '选择摄像机设置以查看预览...',
        'cinema.generationFailed': '生成失败：',

        // Agent Studio
        'agents.title': '智能体工作室',
        'agents.webOnly': '在 Aquora 网页版中可用',

        // Workflow Studio
        'workflows.title': '工作流工作室',
        'workflows.webOnly': '在 Aquora 网页版中可用',

        // Local Model Manager
        'localModels.title': '本地模型',
        'localModels.webOnly': '本地模型推理仅在桌面应用（Electron 构建版）中可用。使用 npm run electron:build 进行构建。',
        'localModels.inferenceEngine': '推理引擎',
        'localModels.checking': '检查中...',
        'localModels.installed': '已安装，可以使用',
        'localModels.notInstalled': '未安装 — 本地生成所必需',
        'localModels.installEngine': '安装引擎',
        'localModels.downloading': '下载中...',
        'localModels.extracting': '解压中...',
        'localModels.storedIn': '存储于',
        'localModels.storedDefault': '存储在应用数据文件夹中',
        'localModels.checkingStorage': '检查存储...',
        'localModels.loading': '加载中...',
        'localModels.featured': '⚡ 推荐',
        'localModels.download': '下载',
        'localModels.requiredComponents': '所需组件',
        'localModels.ready': '已就绪',
        'localModels.available': '可用',
        'localModels.offline': '不可用',
        'localModels.starting': '启动中...',
        'localModels.complete': '完成！',
        'localModels.preparing': '准备中...',
        'localModels.get': '获取',
        'localModels.notConfigured': '未配置',
        'localModels.notConfiguredNote': '未配置（Wan2GP 模型将显示为离线）',
        'localModels.probing': '探测中...',
        'localModels.errorLoading': '加载模型时出错：',
        'localModels.deleteConfirm': (name) => `删除"${name}"？您需要重新下载才能再次使用。`,

        // Web shell
        'web.settingsTitle': '设置 — 账户、本地模型、偏好',
        'web.switchToEn': 'Switch to English',
        'web.switchToZh': '切换为中文',

    },
};

translations['zh-CN'] = translations.zh;

export function t(key) {
    const lang = getLang();
    const dict = dictFor(lang);
    const val = dict[key] !== undefined ? dict[key] : (translations.en[key] !== undefined ? translations.en[key] : key);
    return typeof val === 'function' ? val : val;
}

export function tf(key, ...args) {
    const lang = getLang();
    const dict = dictFor(lang);
    const val = dict[key] !== undefined ? dict[key] : (translations.en[key] !== undefined ? translations.en[key] : key);
    return typeof val === 'function' ? val(...args) : val;
}
