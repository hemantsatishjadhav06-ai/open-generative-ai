// Copy for the strings Aquora added to the workflow builder (English and
// Chinese). The locale follows the page: `<html lang="zh-…">` or a /zh/ path.
const MESSAGES = {
  en: {
    networkError: "Couldn't reach Aquora. Check your connection and try again.",
    uploadFailed: "Upload failed.",
    uploadNoUrl: "The upload finished without a file link. Try again.",
    uploadInvalidType: "Please upload a valid {kind} file.",
    unsupportedFileType: "Unsupported file type",
    saveFailed: "Couldn't save the workflow.",
    runFailed: "Couldn't start the run.",
    stepFailed: "Step {id} failed",
    statusFailed: "Couldn't get the run status.",
    workflowFailed: "The workflow stopped: {message}",
    workflowStopped: "The run was stopped.",
    generationFailed: "Generation failed",
    skipped: "Skipped because an earlier step failed.",
    categoryFailed: "Couldn't update the category.",
    categoryUpdated: "Category updated",
    duplicateFailed: "Couldn't duplicate the workflow.",
    thumbnailFailed: "Couldn't save the cover image.",
    historyDeleteFailed: "Couldn't delete this result.",
    architectFailed: "Sorry, I couldn't update your workflow: {message}",
    architectError: "Sorry, something went wrong. Try again in a moment.",
    settings: "Settings",
    kind_image: "image",
    kind_video: "video",
    kind_audio: "audio",
    schemasFailed: "Couldn't load the models. Reload the page to try again.",
    stop: "Stop",
    readOnly: "This workflow is read-only. Duplicate it to edit.",
    addStep: "Add a step",
    utilitySteps: "Utility steps",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    fitView: "Fit to screen",
    selectMode: "Select several steps",
    closePanel: "Close properties",
    assistant: "AI assistant",
    closeAssistant: "Close the assistant",
    send: "Send",
    stepOptions: "Options for {id}",
    stopFailed: "Couldn't stop the run.",
  },
  zh: {
    networkError: "无法连接 Aquora，请检查网络后重试。",
    uploadFailed: "上传失败。",
    uploadNoUrl: "上传已完成但没有返回文件链接，请重试。",
    uploadInvalidType: "请上传有效的{kind}文件。",
    unsupportedFileType: "不支持的文件类型",
    saveFailed: "无法保存工作流。",
    runFailed: "无法开始运行。",
    stepFailed: "步骤 {id} 失败",
    statusFailed: "无法获取运行状态。",
    workflowFailed: "工作流已停止：{message}",
    workflowStopped: "运行已停止。",
    generationFailed: "生成失败",
    skipped: "由于前一步失败而跳过。",
    categoryFailed: "无法更新分类。",
    categoryUpdated: "分类已更新",
    duplicateFailed: "无法复制工作流。",
    thumbnailFailed: "无法保存封面图。",
    historyDeleteFailed: "无法删除此结果。",
    architectFailed: "抱歉，无法更新你的工作流：{message}",
    architectError: "抱歉，出了点问题，请稍后重试。",
    settings: "设置",
    kind_image: "图片",
    kind_video: "视频",
    kind_audio: "音频",
    schemasFailed: "无法加载模型，请刷新页面重试。",
    stop: "停止",
    readOnly: "此工作流为只读，复制后即可编辑。",
    addStep: "添加步骤",
    utilitySteps: "工具步骤",
    zoomIn: "放大",
    zoomOut: "缩小",
    fitView: "适应屏幕",
    selectMode: "框选多个步骤",
    closePanel: "关闭属性面板",
    assistant: "AI 助手",
    closeAssistant: "关闭助手",
    send: "发送",
    stepOptions: "{id} 的选项",
    stopFailed: "无法停止运行。",
  },
};

export function currentLocale() {
  if (typeof document !== "undefined") {
    const lang = document.documentElement?.lang || "";
    if (/^zh/i.test(lang)) return "zh";
  }
  if (typeof window !== "undefined" && /^\/zh(\/|$)/.test(window.location?.pathname || "")) return "zh";
  return "en";
}

export function t(key, values = {}) {
  const table = MESSAGES[currentLocale()] || MESSAGES.en;
  const template = table[key] ?? MESSAGES.en[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, name) => (values[name] !== undefined ? String(values[name]) : `{${name}}`));
}
