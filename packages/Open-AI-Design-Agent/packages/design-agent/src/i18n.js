// UI copy for the design agent canvas (English + Simplified Chinese).
// getCopy(locale) returns the bundle for a locale, falling back to English
// key by key, so a partial translation still renders.

const en = {
  title: "Design Agent",
  studioTitle: "Design Agent Studio",
  subtitle: "Plans, generates and arranges on your canvas",
  greetingNew: "What are we making today?",
  greetingReady: "Ready. What's the idea?",
  agentLabel: "Agent",
  today: "Today",
  yesterday: "Yesterday",
  nav: {
    back: "Back to studio",
    home: "Home",
    toggleSessions: "Toggle canvases",
    newSession: "New canvas",
    hideChat: "Hide chat",
    openChat: "Open chat",
  },
  sessions: {
    empty: "No canvases yet",
    total: "Canvases",
    rename: "Rename",
    delete: "Delete",
    renameLabel: "Canvas name",
    confirmDelete: "Delete this canvas and its chat? Files you downloaded are not affected.",
    renamed: "Canvas renamed",
    renameFailed: "Couldn't rename the canvas",
    deleted: "Canvas deleted",
    deleteFailed: "Couldn't delete the canvas",
    createFailed: "Couldn't start a canvas. Try again.",
    untitled: "Untitled canvas",
    newName: "New canvas",
    files: "{count} files",
    filesOne: "1 file",
  },
  composer: {
    placeholder: "Describe what to make, or mention files with @…",
    skillPlaceholder: "{skill}: start with your {input}",
    label: "Message the design agent",
    upload: "Upload an image, video or audio file",
    skills: "Expert skills",
    skillsTitle: "Expert skills",
    skillsHint: "Pin a recipe, then describe what you need.",
    dismiss: "Dismiss",
    removeSkill: "Remove skill {skill}",
    assets: "Canvas files",
    assetsCount: "{count} files",
    assetsCountOne: "1 file",
    noAssets: "No files yet",
    mentions: "Mentions",
    mentionAssets: "Files",
    mentionSkills: "Skills",
    noMatches: "No matches found",
    send: "Send",
    stop: "Stop",
    removeAttachment: "Remove {label}",
    copyMessage: "Copy message",
  },
  upload: {
    uploading: "Uploading…",
    done: "Uploaded as {label}",
    failed: "Upload failed. Try again.",
    tooLarge: "That file is too large (max {mb} MB for {kind}).",
    unsupported: "Only images, videos and audio files can be added.",
  },
  run: {
    stopped: "Stopped.",
    interrupted: "This run is no longer available (the server may have restarted). Try again.",
    failed: "Something went wrong. Try again.",
    budget: "Today's AI budget is used up. It resets at 00:00 UTC.",
    session: "Your session ended. Sign in again to continue.",
    busy: "Too many requests. Wait a moment and try again.",
    stopFailed: "Couldn't stop the run",
    nothingToApprove: "This run isn't waiting for approval.",
  },
  pills: {
    generatedImage: "Generated an image",
    generatedVideo: "Generated a video",
    generatedAudio: "Generated audio",
    arranged: "Arranged the canvas",
    done: "Done",
    failed: "Failed",
    replyToContinue: "Reply to continue.",
    approve: "Approve",
    approveRun: "Approve & run",
    reject: "Reject",
    cancel: "Cancel",
    steps: "{count} steps",
  },
  tools: {
    generate_image: "Creating an image",
    edit_image: "Editing an image",
    generate_video: "Creating a video",
    image_to_video: "Animating an image",
    enhance_image: "Upscaling an image",
    arrange_canvas: "Arranging the canvas",
  },
  copy: {
    copied: "Copied to clipboard",
    failed: "Couldn't copy",
  },
  canvas: {
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
  },
};

const zh = {
  title: "设计智能体",
  studioTitle: "设计智能体工作室",
  subtitle: "在画布上规划、生成并排版",
  greetingNew: "今天想做点什么？",
  greetingReady: "准备好了。你的想法是？",
  agentLabel: "智能体",
  today: "今天",
  yesterday: "昨天",
  nav: {
    back: "返回工作室",
    home: "首页",
    toggleSessions: "显示/隐藏画布列表",
    newSession: "新建画布",
    hideChat: "隐藏对话",
    openChat: "打开对话",
  },
  sessions: {
    empty: "还没有画布",
    total: "画布数",
    rename: "重命名",
    delete: "删除",
    renameLabel: "画布名称",
    confirmDelete: "删除这个画布及其对话？已下载的文件不受影响。",
    renamed: "画布已重命名",
    renameFailed: "无法重命名画布",
    deleted: "画布已删除",
    deleteFailed: "无法删除画布",
    createFailed: "无法创建画布，请重试。",
    untitled: "未命名画布",
    newName: "新画布",
    files: "{count} 个文件",
    filesOne: "1 个文件",
  },
  composer: {
    placeholder: "描述你想做的内容，或用 @ 引用文件…",
    skillPlaceholder: "{skill}：先告诉我你的 {input}",
    label: "给设计智能体发消息",
    upload: "上传图片、视频或音频文件",
    skills: "专家技能",
    skillsTitle: "专家技能",
    skillsHint: "选择一个流程，然后描述你的需求。",
    dismiss: "关闭",
    removeSkill: "移除技能 {skill}",
    assets: "画布文件",
    assetsCount: "{count} 个文件",
    assetsCountOne: "1 个文件",
    noAssets: "还没有文件",
    mentions: "引用",
    mentionAssets: "文件",
    mentionSkills: "技能",
    noMatches: "没有匹配项",
    send: "发送",
    stop: "停止",
    removeAttachment: "移除 {label}",
    copyMessage: "复制消息",
  },
  upload: {
    uploading: "上传中…",
    done: "已上传为 {label}",
    failed: "上传失败，请重试。",
    tooLarge: "文件太大（{kind}最大 {mb} MB）。",
    unsupported: "只能添加图片、视频和音频文件。",
  },
  run: {
    stopped: "已停止。",
    interrupted: "这次运行已不可用（服务器可能已重启），请重试。",
    failed: "出了点问题，请重试。",
    budget: "今日 AI 额度已用完，将于 UTC 00:00 重置。",
    session: "会话已结束，请重新登录后继续。",
    busy: "请求过于频繁，请稍后再试。",
    stopFailed: "无法停止运行",
    nothingToApprove: "这次运行无需审批。",
  },
  pills: {
    generatedImage: "已生成图片",
    generatedVideo: "已生成视频",
    generatedAudio: "已生成音频",
    arranged: "已整理画布",
    done: "完成",
    failed: "失败",
    replyToContinue: "回复以继续。",
    approve: "批准",
    approveRun: "批准并运行",
    reject: "拒绝",
    cancel: "取消",
    steps: "{count} 个步骤",
  },
  tools: {
    generate_image: "正在生成图片",
    edit_image: "正在编辑图片",
    generate_video: "正在生成视频",
    image_to_video: "正在让图片动起来",
    enhance_image: "正在放大图片",
    arrange_canvas: "正在整理画布",
  },
  copy: {
    copied: "已复制到剪贴板",
    failed: "复制失败",
  },
  canvas: {
    zoomIn: "放大",
    zoomOut: "缩小",
  },
};

const BUNDLES = { en, zh };

function merge(base, override) {
  if (!override) return base;
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) {
    out[key] = value && typeof value === "object" && !Array.isArray(value) ? merge(base[key] || {}, value) : value;
  }
  return out;
}

export function getCopy(locale = "en") {
  const code = String(locale || "en").toLowerCase().split("-")[0];
  return merge(en, BUNDLES[code]);
}

// "{count} files" + {count: 3} → "3 files"
export function fill(template, values = {}) {
  return String(template || "").replace(/\{(\w+)\}/g, (match, key) => (values[key] !== undefined ? String(values[key]) : match));
}
