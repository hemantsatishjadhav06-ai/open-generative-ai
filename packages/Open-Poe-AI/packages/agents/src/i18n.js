// UI copy for the agent pages (en + zh). Components take a `locale` prop
// (default "en"); a missing zh key falls back to English.

const en = {
  you: "You",
  agentFallbackName: "Agent",
  back: "Back",
  backToAgents: "Back to agents",
  openStudio: "Open studio",
  dismiss: "Dismiss",
  close: "Close",
  download: "Download",
  preparing: "Preparing…",
  viewFullScreen: "View full screen",
  agentMenu: "Agent options",
  newChat: "New chat",
  attachImage: "Attach image",
  removeAttachment: "Remove attachment",
  attachmentPreview: "Attached image",
  sendMessage: "Send message",
  messageInput: "Message",
  generatedImage: "Generated image",
  generatedVideo: "Generated video",
  generatedAudio: "Generated audio",
  errors: {
    sessionEnded: "Your session ended. Sign in again from the studio to keep going.",
    turnFailed: "The agent couldn't finish this reply. Try again.",
    lostConnection: "Lost connection to the agent. Check your connection and try again.",
    generic: "Something went wrong. Try again.",
    imagesOnly: "Only images can be attached.",
    imageTooLarge: "That image is too large (max 25 MB).",
    uploadFailed: "Couldn't upload the image. Try again.",
    iconFailed: "Couldn't generate the icon. Try again.",
    createFailed: "Couldn't create the agent. Try again.",
    loadFailed: "Couldn't load this agent.",
    templateReadOnly: "Built-in templates can't be edited. Create your own agent to customise one.",
  },
  chatError: {
    title: "Couldn't load this agent",
    body: "It may have been deleted, or it belongs to a different workspace.",
    retry: "Try again",
  },
};

const zh = {
  you: "你",
  agentFallbackName: "智能体",
  back: "返回",
  backToAgents: "返回智能体列表",
  openStudio: "打开工作室",
  dismiss: "关闭提示",
  close: "关闭",
  download: "下载",
  preparing: "准备中…",
  viewFullScreen: "全屏查看",
  agentMenu: "智能体选项",
  newChat: "新对话",
  attachImage: "添加图片",
  removeAttachment: "移除附件",
  attachmentPreview: "已添加的图片",
  sendMessage: "发送消息",
  messageInput: "消息",
  generatedImage: "生成的图片",
  generatedVideo: "生成的视频",
  generatedAudio: "生成的音频",
  errors: {
    sessionEnded: "会话已结束。请在工作室重新登录后继续。",
    turnFailed: "智能体未能完成这条回复，请重试。",
    lostConnection: "与智能体的连接已断开。请检查网络后重试。",
    generic: "出了点问题，请重试。",
    imagesOnly: "只能添加图片。",
    imageTooLarge: "图片太大（最大 25 MB）。",
    uploadFailed: "图片上传失败，请重试。",
    iconFailed: "图标生成失败，请重试。",
    createFailed: "无法创建智能体，请重试。",
    loadFailed: "无法加载这个智能体。",
    templateReadOnly: "内置模板无法编辑。请创建你自己的智能体来定制。",
  },
  chatError: {
    title: "无法加载这个智能体",
    body: "它可能已被删除，或属于其他工作区。",
    retry: "重试",
  },
};

const BUNDLES = { en, zh };

function merge(base, override) {
  const out = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    out[key] = value && typeof value === "object" && !Array.isArray(value) ? merge(base[key] || {}, value) : value;
  }
  return out;
}

export function getAgentCopy(locale = "en") {
  if (!locale || locale === "en" || !BUNDLES[locale]) return en;
  return merge(en, BUNDLES[locale]);
}
