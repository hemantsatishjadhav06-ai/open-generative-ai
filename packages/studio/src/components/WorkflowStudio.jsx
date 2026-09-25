"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import {
  getTemplateWorkflows,
  getUserWorkflows,
  createWorkflow,
  updateWorkflowName,
  deleteWorkflow,
  getWorkflowInputs,
  executeWorkflow,
  getAllNodeSchemas,
  getWorkflowData,
  uploadFile,
} from "../gateway.js";
import dynamic from "next/dynamic";
import { notifyError } from "../utils/notify.js";
import { formatErrorMessage } from "../utils/formatError.js";
import { localeRoot, resolveCopy } from "../i18nUtils";

// Copy lives here (en + zh) because this studio has no message bundle of its
// own yet; the shape mirrors the other studios' messages/<locale>/*.json.
const COPY = {
  en: {
    loadingBuilder: "Loading builder…",
    title: "Workflows",
    subtitle: "Chain steps together — script → voice → video.",
    create: "Create workflow",
    tabs: { templates: "Templates", mine: "My workflows" },
    tabsLabel: "Workflow lists",
    general: "General",
    untitled: "Untitled workflow",
    options: "Options for {name}",
    rename: "Rename",
    delete: "Delete",
    deleteConfirm: "Delete this workflow? This can't be undone.",
    deleteFailed: "Couldn't delete the workflow.",
    renameFailed: "Couldn't rename the workflow.",
    createFailed: "Couldn't create a workflow.",
    loadFailed: "Couldn't load workflows.",
    retry: "Retry",
    empty: "No workflows here yet.",
    emptyMine: "Workflows you create or duplicate from a template appear here.",
    allWorkflows: "All workflows",
    backToAll: "Back to all workflows",
    playground: "Playground",
    builder: "Full workflow",
    play: "Play",
    builderShort: "Builder",
    zen: "Enter focus mode",
    exitZen: "Exit focus",
    configuration: "Inputs",
    noInputs: "This workflow has no input steps. Open the builder to add one, or run it as it is.",
    run: "Run workflow",
    running: "Running…",
    saveFirst: "Save your workflow first to enable runs.",
    errorTitle: "Run failed",
    idle: "Fill in the inputs and run the workflow to see results.",
    pipeline: "Running workflow",
    processing: "Running each step and generating files…",
    results: "Results",
    completed: "Completed",
    open: "Open {id} in a new tab",
    upload: "Upload",
    uploading: "Uploading… {pct}%",
    replace: "Replace",
    remove: "Remove",
    pasteLink: "or paste a public link",
    uploadFailed: "Upload failed: {message}",
    runFailed: "Workflow failed",
    loadDetailsFailed: "Couldn't load this workflow.",
    renameTitle: "Rename workflow",
    renameHelp: "Give your workflow a descriptive name.",
    nameLabel: "Workflow name",
    namePlaceholder: "e.g. Cinematic video flow",
    cancel: "Cancel",
    save: "Save name",
    template: "Template",
  },
  zh: {
    loadingBuilder: "正在加载编辑器…",
    title: "工作流",
    subtitle: "把步骤串联起来 —— 脚本 → 配音 → 视频。",
    create: "新建工作流",
    tabs: { templates: "模板", mine: "我的工作流" },
    tabsLabel: "工作流列表",
    general: "通用",
    untitled: "未命名工作流",
    options: "{name} 的选项",
    rename: "重命名",
    delete: "删除",
    deleteConfirm: "确定删除这个工作流吗？此操作无法撤销。",
    deleteFailed: "无法删除工作流。",
    renameFailed: "无法重命名工作流。",
    createFailed: "无法新建工作流。",
    loadFailed: "无法加载工作流。",
    retry: "重试",
    empty: "这里还没有工作流。",
    emptyMine: "你新建或从模板复制的工作流会显示在这里。",
    allWorkflows: "全部工作流",
    backToAll: "返回全部工作流",
    playground: "试运行",
    builder: "完整工作流",
    play: "试运行",
    builderShort: "编辑器",
    zen: "进入专注模式",
    exitZen: "退出专注",
    configuration: "输入",
    noInputs: "这个工作流没有输入步骤。可以打开编辑器添加，或直接运行。",
    run: "运行工作流",
    running: "运行中…",
    saveFirst: "请先保存工作流再运行。",
    errorTitle: "运行失败",
    idle: "填写输入后运行工作流即可查看结果。",
    pipeline: "工作流运行中",
    processing: "正在逐步运行并生成文件…",
    results: "结果",
    completed: "已完成",
    open: "在新标签页打开 {id}",
    upload: "上传",
    uploading: "上传中… {pct}%",
    replace: "替换",
    remove: "移除",
    pasteLink: "或粘贴公开链接",
    uploadFailed: "上传失败：{message}",
    runFailed: "工作流运行失败",
    loadDetailsFailed: "无法加载这个工作流。",
    renameTitle: "重命名工作流",
    renameHelp: "给工作流起一个清楚的名字。",
    nameLabel: "工作流名称",
    namePlaceholder: "例如：电影感视频流程",
    cancel: "取消",
    save: "保存名称",
    template: "模板",
  },
};

const fill = (template, values) => template.replace(/\{(\w+)\}/g, (_, key) => (values[key] !== undefined ? String(values[key]) : `{${key}}`));

const isHttpUrl = (value) => typeof value === "string" && /^https?:\/\//i.test(value.trim());

const WorkflowUI = dynamic(() => import("./WorkflowUI"), {
  ssr: false,
  loading: () => <BuilderLoading />,
});

function BuilderLoading({ label = "…" }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center" role="status">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 border-4 border-white/5 border-t-brand rounded-full animate-spin" aria-hidden="true" />
        <div className="text-[10px] font-black text-white/40 uppercase tracking-widest">{label}</div>
      </div>
    </div>
  );
}

function WorkflowCard({ workflow, onOpen, canEdit, onRename, onDelete, t }) {
  const [showOptions, setShowOptions] = useState(false);
  const name = workflow.name || t.untitled;

  return (
    <div className="group relative aspect-[3/4] rounded-lg overflow-hidden border border-white/5 bg-surface-panel transition-all hover:border-brand/30 hover:scale-[1.02] focus-within:border-brand/40 shadow-2xl">
      <button
        type="button"
        onClick={() => onOpen(workflow)}
        className="absolute inset-0 w-full h-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 rounded-lg"
        aria-label={name}
      >
        {isHttpUrl(workflow.thumbnail) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={workflow.thumbnail}
            alt=""
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-brand/10 to-pop-500/10 flex items-center justify-center" aria-hidden="true">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="opacity-20">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" aria-hidden="true" />
        <div className="absolute inset-x-0 bottom-0 p-4">
          <div className="text-[10px] font-bold text-brand uppercase tracking-wider mb-1 opacity-80">
            {workflow.category || t.general}
          </div>
          <h3 className="font-display text-sm font-bold text-white truncate group-hover:text-brand transition-colors">
            {name}
          </h3>
          {workflow.description && (
            <p className="mt-1 text-[11px] leading-snug text-white/60 line-clamp-3">{workflow.description}</p>
          )}
        </div>
      </button>

      {canEdit && (
        <div className="absolute top-2 right-2 z-30">
          <button
            type="button"
            onClick={() => setShowOptions((open) => !open)}
            onBlur={() => setTimeout(() => setShowOptions(false), 200)}
            aria-label={fill(t.options, { name })}
            aria-haspopup="menu"
            aria-expanded={showOptions}
            className="w-8 h-8 rounded-full bg-black/40 backdrop-blur-md border border-white/10 flex items-center justify-center text-white/70 hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" />
            </svg>
          </button>

          {showOptions && (
            <div role="menu" className="absolute top-10 right-0 w-36 bg-surface-card border border-white/10 rounded-lg shadow-2xl py-1">
              <button
                type="button"
                role="menuitem"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { setShowOptions(false); onRename(workflow); }}
                className="w-full px-4 py-2 text-left text-[11px] font-bold text-white/80 hover:text-brand hover:bg-white/5 transition-colors flex items-center gap-2"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                  <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
                {t.rename}
              </button>
              <button
                type="button"
                role="menuitem"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { setShowOptions(false); onDelete(workflow.id); }}
                className="w-full px-4 py-2 text-left text-[11px] font-bold text-red-400 hover:bg-red-500/10 transition-colors flex items-center gap-2"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                  <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                </svg>
                {t.delete}
              </button>
            </div>
          )}
        </div>
      )}

      {!canEdit && (
        <span className="absolute top-2 left-2 z-20 px-2 py-0.5 rounded-full bg-black/50 border border-white/10 text-[9px] font-black uppercase tracking-widest text-white/80 pointer-events-none">
          {t.template}
        </span>
      )}
    </div>
  );
}

// One Playground input: a text box, or an upload (plus a link box) for media.
function InputField({ id, prop, value, onChange, t }) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const fileRef = useRef(null);
  const kind = ["image", "video", "audio"].includes(prop.field) ? prop.field : null;
  const label = prop.title || id;
  const inputId = `wf-input-${id}`;

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(true);
    setProgress(0);
    try {
      const url = await uploadFile(null, file, setProgress);
      onChange(url);
    } catch (error) {
      notifyError(fill(t.uploadFailed, { message: formatErrorMessage(error) }));
    } finally {
      setUploading(false);
    }
  };

  if (!kind) {
    return (
      <div className="space-y-2">
        <label htmlFor={inputId} className="block text-[11px] font-bold text-white/80 uppercase tracking-wider">{label}</label>
        <textarea
          id={inputId}
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-white/5 border border-white/10 rounded-lg p-3 text-sm text-white focus:outline-none focus:border-brand/50 transition-colors min-h-[96px] resize-y"
          placeholder={prop.description || ""}
        />
      </div>
    );
  }

  const accept = `${kind}/*`;
  return (
    <div className="space-y-2">
      <label htmlFor={inputId} className="block text-[11px] font-bold text-white/80 uppercase tracking-wider">{label}</label>
      {isHttpUrl(value) && (
        <div className="relative rounded-lg overflow-hidden border border-white/10 bg-black/30">
          {kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="" className="w-full max-h-48 object-contain" />
          ) : kind === "video" ? (
            <video src={value} controls className="w-full max-h-48" />
          ) : (
            <audio src={value} controls className="w-full" />
          )}
        </div>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-[11px] font-bold text-white transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
        >
          {uploading ? fill(t.uploading, { pct: progress }) : isHttpUrl(value) ? t.replace : t.upload}
        </button>
        {isHttpUrl(value) && !uploading && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="px-3 py-2 rounded-lg text-[11px] font-bold text-white/60 hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
          >
            {t.remove}
          </button>
        )}
        <input ref={fileRef} type="file" accept={accept} className="hidden" onChange={handleFile} aria-hidden="true" tabIndex={-1} />
      </div>
      <input
        id={inputId}
        type="url"
        inputMode="url"
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-brand/50 transition-colors"
        placeholder={t.pasteLink}
      />
      {prop.description && <p className="text-[10px] text-white/50">{prop.description}</p>}
    </div>
  );
}

function ResultCard({ out, t }) {
  const media = ["image_url", "video_url", "audio_url"].includes(out.type) && isHttpUrl(out.value);
  return (
    <div className="group relative bg-white/5 border border-white/10 rounded-2xl overflow-hidden hover:border-brand/30 transition-all shadow-2xl">
      {out.type === "image_url" && media ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={out.value} className="w-full aspect-square object-cover" alt={out.id} />
      ) : out.type === "video_url" && media ? (
        <video src={out.value} controls className="w-full aspect-square object-cover" />
      ) : out.type === "audio_url" && media ? (
        <div className="p-6 min-h-[160px] flex items-center justify-center">
          <audio src={out.value} controls className="w-full" />
        </div>
      ) : (
        <div className="p-6 min-h-[200px] whitespace-pre-wrap text-sm text-white/80 leading-relaxed">
          {typeof out.value === "string" ? out.value : ""}
        </div>
      )}
      <div className="flex items-center justify-between px-4 py-3 border-t border-white/5">
        <span className="text-[10px] font-black text-brand uppercase tracking-widest">{out.id}</span>
        {media && (
          <a
            href={out.value}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={fill(t.open, { id: out.id })}
            className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center hover:bg-brand hover:text-on-brand transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
            </svg>
          </a>
        )}
      </div>
    </div>
  );
}

// Playground input value → the api-execute shape the gateway expects.
function inputPayload(prop, value) {
  if (prop.field === "image") return { image_url: value };
  if (prop.field === "video") return { video_url: value };
  if (prop.field === "audio") return { audio_url: value };
  return { prompt: value };
}

export default function WorkflowStudio({
  locale: localeProp,
  isHeaderVisible = true,
  onToggleHeader,
  onGenerationStart,
  onGenerationEnd,
  onGenerationComplete,
  onGenerationError,
}) {
  const params = useParams();
  const router = useRouter();
  const pathname = usePathname() || "";
  const locale = localeProp || (/^\/zh(\/|$)/.test(pathname) ? "zh" : "en");
  const t = resolveCopy(COPY.en, COPY[locale], locale);
  const studioRoot = `${localeRoot(locale)}/studio/workflows`;
  // /workflow/[id]/[tab] is mirrored under /zh/workflow/… (Chinese stays Chinese).
  const workflowRoot = `${localeRoot(locale)}/workflow`;

  const idFromParams = params?.id;     // exists on /workflow/[id]/[tab] route
  const tabFromParams = params?.tab;   // string on /workflow/[id]/[tab]; array on the [[...tab]] catch-all
  const slugParam = params?.slug;

  // Robustly extract ID and Tab from either route structure
  const getWorkflowInfo = useCallback(() => {
    if (idFromParams) {
      return { id: idFromParams, tab: typeof tabFromParams === "string" ? tabFromParams : null };
    }
    const catchAllSegments = Array.isArray(tabFromParams) ? tabFromParams : (Array.isArray(slugParam) ? slugParam : []);
    const wfIndex = catchAllSegments.findIndex(s => s === 'workflows' || s === 'workflow');
    if (wfIndex === -1) return { id: null, tab: null };
    return {
      id: catchAllSegments[wfIndex + 1] || null,
      tab: catchAllSegments[wfIndex + 2] || null
    };
  }, [idFromParams, tabFromParams, slugParam]);

  const { id: urlWorkflowId, tab: urlTab } = getWorkflowInfo();

  const [workflows, setWorkflows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedWorkflow, setSelectedWorkflow] = useState(null);
  const [activeSubTab, setActiveSubTab] = useState("playground"); // 'playground' | 'builder'
  const [activeMainTab, setActiveMainTab] = useState("templates"); // 'templates' | 'my-workflows'
  const [renamingWorkflow, setRenamingWorkflow] = useState(null);
  const [newWorkflowName, setNewWorkflowName] = useState("");
  const [inputSchema, setInputSchema] = useState(null);
  const [nodeSchemas, setNodeSchemas] = useState(null);
  const [workflowDef, setWorkflowDef] = useState(null);
  const [formData, setFormData] = useState({});
  const [isExecuting, setIsExecuting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  // List-fetch failure (separate from `error`, which belongs to the run/detail view).
  const [listError, setListError] = useState(null);
  const [reloadTick, setReloadTick] = useState(0);

  const handleSelectWorkflow = useCallback(
    async (wf, fromUrl = false) => {
      setSelectedWorkflow(wf);
      setResult(null);
      setError(null);

      const targetTab = urlTab || "playground";
      setActiveSubTab(targetTab);

      if (!fromUrl) {
        // Always route to /workflow/[id] so the builder library's useParams().id resolves correctly
        router.push(`${workflowRoot}/${encodeURIComponent(wf.id)}/${targetTab}`);
      }
    },
    [router, urlTab, workflowRoot],
  );

  // Dedicated data fetching effect for the active workflow
  useEffect(() => {
    if (!selectedWorkflow?.id) return;
    let cancelled = false;

    async function loadWorkflowDetails() {
      try {
        setLoading(true);
        const wfId = selectedWorkflow.id;
        const results = await Promise.allSettled([
          getWorkflowInputs(null, wfId),
          getAllNodeSchemas(null, wfId),
          getWorkflowData(null, wfId)
        ]);
        if (cancelled) return;

        if (results[0].status === 'fulfilled') {
          const response = results[0].value;
          const schema = response.input_data || response;
          setInputSchema(schema);
          const initial = {};
          Object.entries(schema.properties || {}).forEach(([key, prop]) => {
            initial[key] = prop.default || (Array.isArray(prop.examples) ? prop.examples[0] : "") || "";
          });
          setFormData(initial);
        } else {
          setInputSchema(null);
          setFormData({});
        }

        const nodes = results[1].status === 'fulfilled' ? results[1].value : null;
        const def = results[2].status === 'fulfilled' ? results[2].value : null;
        setNodeSchemas(nodes || {});
        setWorkflowDef(def || { nodes: [], edges: [] });
        if (def?.name && def.name !== selectedWorkflow.name) {
          setSelectedWorkflow((current) => (current?.id === wfId ? { ...current, name: def.name } : current));
        }
        if (results[2].status === 'rejected') setError(formatErrorMessage(results[2].reason, t.loadDetailsFailed));
      } catch (err) {
        if (cancelled) return;
        setError(formatErrorMessage(err, t.loadDetailsFailed));
        setNodeSchemas({});
        setWorkflowDef({ nodes: [], edges: [] });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadWorkflowDetails();
    return () => { cancelled = true; };
    // Reload only when another workflow is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWorkflow?.id]);

  const handleCreateWorkflow = useCallback(
    async (fromUrl = false) => {
      try {
        setLoading(true);
        if (!fromUrl) {
          const payload = {
            workflow_id: null,
            name: t.untitled,
            edges: [],
            data: { nodes: [] },
          };
          const response = await createWorkflow(null, payload);
          router.push(`${workflowRoot}/${encodeURIComponent(response.workflow_id)}/builder`);
          return;
        }

        setSelectedWorkflow({ id: null, name: t.untitled });
        setNodeSchemas({});
        setWorkflowDef({ nodes: [], edges: [] });
        setActiveSubTab("builder");
      } catch (err) {
        notifyError(formatErrorMessage(err, t.createFailed));
      } finally {
        setLoading(false);
      }
    },
    [router, t.untitled, t.createFailed],
  );

  const handleDeleteWorkflow = async (wfId) => {
    if (!window.confirm(t.deleteConfirm)) return;
    try {
      await deleteWorkflow(null, wfId);
      setWorkflows((prev) => prev.filter((w) => w.id !== wfId));
    } catch (err) {
      notifyError(formatErrorMessage(err, t.deleteFailed));
    }
  };

  const handleRenameWorkflow = async (e) => {
    e?.preventDefault();
    if (!renamingWorkflow || !newWorkflowName.trim()) return;

    const wfId = renamingWorkflow.id;
    try {
      const saved = await updateWorkflowName(null, wfId, newWorkflowName.trim());
      const name = saved?.name || newWorkflowName.trim();
      setWorkflows((prev) => prev.map((w) => (w.id === wfId ? { ...w, name } : w)));
      if (selectedWorkflow?.id === wfId) setSelectedWorkflow({ ...selectedWorkflow, name });
      setRenamingWorkflow(null);
    } catch (err) {
      notifyError(formatErrorMessage(err, t.renameFailed));
    }
  };

  // /studio/workflows/[id] → /workflow/[id] so the builder library's
  // useParams().id resolves correctly.
  useEffect(() => {
    if (typeof window !== 'undefined' && urlWorkflowId && urlWorkflowId !== 'new') {
      const path = window.location.pathname;
      if (/^(\/zh)?\/studio\/workflows?\//.test(path)) {
        const tab = urlTab || 'builder';
        router.replace(`${workflowRoot}/${encodeURIComponent(urlWorkflowId)}/${tab}`);
      }
    }
  }, [urlWorkflowId, urlTab, router, workflowRoot]);

  // Sync state with the URL.
  useEffect(() => {
    if (loading) return;

    if (urlWorkflowId) {
      if (urlWorkflowId === "new") {
        if (!selectedWorkflow || selectedWorkflow.id !== null) {
          handleCreateWorkflow(true);
        }
      } else {
        const found = workflows.find((wf) => wf.id === urlWorkflowId);
        if (found) {
          if (!selectedWorkflow || selectedWorkflow.id !== urlWorkflowId) {
            handleSelectWorkflow(found, true);
          }
        } else if (!selectedWorkflow || selectedWorkflow.id !== urlWorkflowId) {
          // Deep link: open it even if it isn't in the current list.
          handleSelectWorkflow({ id: urlWorkflowId, name: "…" }, true);
        }
      }
    } else if (selectedWorkflow) {
      setSelectedWorkflow(null);
    }
  }, [urlWorkflowId, workflows, loading, selectedWorkflow, handleCreateWorkflow, handleSelectWorkflow]);

  // Reload once when leaving the builder so its canvas styles are dropped.
  useEffect(() => {
    const fromBuilder = sessionStorage.getItem("fromWorkflowBuilder");
    if (fromBuilder && (!urlWorkflowId || activeSubTab !== "builder")) {
      sessionStorage.removeItem("fromWorkflowBuilder");
      window.location.reload();
    }
  }, [urlWorkflowId, activeSubTab]);

  useEffect(() => {
    let cancelled = false;
    async function loadWorkflows() {
      try {
        setListError(null);
        setLoading(true);
        const data = activeMainTab === "my-workflows" ? await getUserWorkflows() : await getTemplateWorkflows();
        if (!cancelled) setWorkflows(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setListError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadWorkflows();
    return () => { cancelled = true; };
  }, [activeMainTab, reloadTick]);

  const handleRun = async (e) => {
    e.preventDefault();
    if (isExecuting) return;

    onGenerationStart?.();
    setIsExecuting(true);
    setError(null);
    setResult(null);

    try {
      const inputs = {};
      Object.entries(inputSchema?.properties || {}).forEach(([key, prop]) => {
        const value = typeof formData[key] === "string" ? formData[key].trim() : "";
        if (!value) return;
        inputs[key] = inputPayload(prop, value);
      });

      const data = await executeWorkflow(null, selectedWorkflow.id, inputs);
      setResult(data);
      const first = Array.isArray(data?.outputs) ? data.outputs.find((out) => isHttpUrl(out?.value)) : null;
      onGenerationComplete?.({ url: first?.value || null, type: "workflow" });
    } catch (err) {
      const message = formatErrorMessage(err, t.runFailed);
      setError(message);
      onGenerationError?.(message);
    } finally {
      setIsExecuting(false);
      onGenerationEnd?.();
    }
  };

  if (loading && !selectedWorkflow) {
    return (
      <div className="h-full flex items-center justify-center" role="status" aria-label={t.loadingBuilder}>
        <div className="w-10 h-10 border-4 border-white/5 border-t-brand rounded-full animate-spin" aria-hidden="true" />
      </div>
    );
  }

  if (selectedWorkflow) {
    const inputEntries = Object.entries(inputSchema?.properties || {});
    const goToTab = (tab) => {
      setActiveSubTab(tab);
      if (selectedWorkflow?.id) router.push(`${workflowRoot}/${encodeURIComponent(selectedWorkflow.id)}/${tab}`);
    };
    const tabClass = (active) => `px-4 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-md transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 ${
      active ? "bg-brand text-on-brand shadow-[0_0_15px_rgba(46,230,214,0.2)]" : "text-white/60 hover:text-white"
    }`;

    return (
      <div className="h-full flex flex-col bg-surface-app text-white">
        {isHeaderVisible ? (
          <div className="flex-shrink-0 min-h-14 border-b border-white/5 flex flex-wrap items-center justify-between gap-2 px-4 sm:px-6 py-2 bg-black/40 z-30">
            <div className="flex items-center gap-4 sm:gap-8 h-full min-w-0">
              <button
                onClick={() => router.push(studioRoot)}
                className="flex items-center gap-2 text-xs font-bold text-white/60 hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 rounded"
                type="button"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
                <span className="hidden sm:inline">{t.allWorkflows}</span>
              </button>

              <div className="h-4 w-[1px] bg-white/10" aria-hidden="true" />

              <div className="flex bg-white/5 p-1 rounded-lg" role="tablist" aria-label={selectedWorkflow.name || t.untitled}>
                <button type="button" role="tab" aria-selected={activeSubTab === "playground"} onClick={() => goToTab("playground")} className={tabClass(activeSubTab === "playground")}>
                  {t.playground}
                </button>
                <button type="button" role="tab" aria-selected={activeSubTab === "builder"} onClick={() => goToTab("builder")} className={tabClass(activeSubTab === "builder")}>
                  {t.builder}
                </button>
              </div>
            </div>

            <div className="flex items-center gap-3 min-w-0">
              <span className="font-display text-[11px] font-black text-brand uppercase tracking-widest truncate max-w-[40vw]">
                {selectedWorkflow.name}
              </span>
              <button
                onClick={() => onToggleHeader?.(false)}
                className="p-1.5 bg-white/5 hover:bg-white/10 rounded-md transition-colors text-white/60 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
                title={t.zen}
                aria-label={t.zen}
                type="button"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                  <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                </svg>
              </button>
            </div>
          </div>
        ) : (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-4 px-4 py-2 bg-black/60 backdrop-blur-xl border border-white/10 rounded-full shadow-2xl">
            <button
              onClick={() => router.push(studioRoot)}
              className="p-1.5 text-white/60 hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 rounded"
              title={t.backToAll}
              aria-label={t.backToAll}
              type="button"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            </button>

            <div className="h-4 w-[1px] bg-white/10" aria-hidden="true" />

            <div className="flex bg-white/5 p-1 rounded-lg" role="tablist">
              <button type="button" role="tab" aria-selected={activeSubTab === "playground"} onClick={() => setActiveSubTab("playground")} className={tabClass(activeSubTab === "playground")}>
                {t.play}
              </button>
              <button type="button" role="tab" aria-selected={activeSubTab === "builder"} onClick={() => setActiveSubTab("builder")} className={tabClass(activeSubTab === "builder")}>
                {t.builderShort}
              </button>
            </div>

            <div className="h-4 w-[1px] bg-white/10" aria-hidden="true" />

            <button
              onClick={() => onToggleHeader?.(true)}
              className="px-3 py-1 bg-white/10 hover:bg-white/20 text-[9px] font-black text-white uppercase tracking-widest rounded-lg transition-colors flex items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
              type="button"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true"><path d="M4 14h6v6M20 10h-6V4M10 20l-7-7M14 4l7 7"/></svg>
              {t.exitZen}
            </button>
          </div>
        )}

        <div className="flex-1 overflow-hidden flex flex-col lg:flex-row">
          {activeSubTab === "playground" ? (
            <>
              <div className="w-full lg:w-[400px] border-b lg:border-b-0 lg:border-r border-white/5 flex flex-col bg-black/20 max-h-[55vh] lg:max-h-none">
                <div className="p-4 sm:p-6 overflow-y-auto flex-1 custom-scrollbar">
                  <form onSubmit={handleRun} className="space-y-6">
                    <div>
                      <h2 className="text-xs font-black text-white/50 uppercase tracking-widest mb-4">{t.configuration}</h2>
                      <div className="space-y-4">
                        {inputEntries.length === 0 && !loading && (
                          <p className="text-xs text-white/50 leading-relaxed">{t.noInputs}</p>
                        )}
                        {inputEntries.map(([key, prop]) => (
                          <InputField
                            key={key}
                            id={key}
                            prop={prop}
                            value={formData[key]}
                            onChange={(value) => setFormData((current) => ({ ...current, [key]: value }))}
                            t={t}
                          />
                        ))}
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={isExecuting || !selectedWorkflow.id}
                      className="w-full py-4 bg-brand text-on-brand text-xs font-black uppercase tracking-[0.2em] rounded-xl hover:bg-brand-hover transition-all active:scale-95 disabled:opacity-50 disabled:grayscale shadow-[0_0_30px_rgba(46,230,214,0.15)] flex items-center justify-center gap-3 mt-8 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                    >
                      {isExecuting ? (
                        <>
                          <div className="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin" aria-hidden="true" />
                          <span>{t.running}</span>
                        </>
                      ) : (
                        <>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
                            <path d="M5 3l14 9-14 9V3z" />
                          </svg>
                          <span>{t.run}</span>
                        </>
                      )}
                    </button>
                    {!selectedWorkflow.id && (
                      <p className="text-[10px] text-white/50 text-center mt-4">{t.saveFirst}</p>
                    )}
                  </form>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 sm:p-8 lg:p-12 bg-surface-app flex items-center justify-center min-h-[320px]" aria-live="polite">
                {error && (
                  <div className="w-full max-w-md p-6 bg-red-500/10 border border-red-500/20 rounded-2xl flex flex-col items-center gap-4" role="alert">
                    <div className="w-12 h-12 bg-red-500/20 rounded-full flex items-center justify-center text-red-400" aria-hidden="true">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                    </div>
                    <div className="text-center">
                      <span className="text-[10px] font-black text-red-400 uppercase tracking-widest block mb-1">{t.errorTitle}</span>
                      <p className="text-white/70 text-sm leading-relaxed">{error}</p>
                    </div>
                  </div>
                )}

                {!isExecuting && !result && !error && (
                  <div className="flex flex-col items-center gap-6 opacity-60">
                    <div className="w-20 h-20 bg-white/5 rounded-3xl flex items-center justify-center text-white/30" aria-hidden="true">
                      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                      </svg>
                    </div>
                    <p className="text-xs text-white/60 max-w-[220px] mx-auto text-center font-medium">{t.idle}</p>
                  </div>
                )}

                {isExecuting && (
                  <div className="flex flex-col items-center gap-6" role="status">
                    <div className="relative" aria-hidden="true">
                      <div className="w-24 h-24 border-[3px] border-white/5 border-t-brand rounded-full animate-spin shadow-[0_0_40px_rgba(46,230,214,0.1)]" />
                      <div className="absolute inset-0 flex items-center justify-center text-brand">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-pulse">
                          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                        </svg>
                      </div>
                    </div>
                    <div className="text-center space-y-2">
                      <div className="text-[10px] font-black text-brand uppercase tracking-[0.3em] animate-pulse">{t.pipeline}</div>
                      <div className="text-[13px] text-white/60 font-medium">{t.processing}</div>
                    </div>
                  </div>
                )}

                {result && (
                  <div className="w-full max-w-4xl space-y-8">
                    <div className="flex items-center justify-between mb-2">
                      <h2 className="text-xs font-black text-white/50 uppercase tracking-widest">{t.results}</h2>
                      <div className="flex items-center gap-2 px-3 py-1 bg-green-500/10 text-green-400 rounded-full text-[10px] font-bold border border-green-500/20">
                        <div className="w-1 h-1 bg-green-400 rounded-full" aria-hidden="true" />
                        {t.completed}
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {(Array.isArray(result.outputs) ? result.outputs : []).map((out, idx) => (
                        <ResultCard key={`${out.id}-${idx}`} out={out} t={t} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 relative bg-surface-app">
              {nodeSchemas && workflowDef && !loading ? (
                <WorkflowUI
                  workflowId={selectedWorkflow?.id}
                  initialNodeSchemas={nodeSchemas}
                  initialWorkflowData={{
                    ...workflowDef,
                    // Inject ID to prevent builder from assuming this is a new unsaved flow
                    workflow_id: selectedWorkflow?.id
                  }}
                  onGenerationStart={onGenerationStart}
                  onGenerationEnd={onGenerationEnd}
                  onGenerationComplete={onGenerationComplete}
                  onGenerationError={onGenerationError}
                />
              ) : (
                <BuilderLoading label={t.loadingBuilder} />
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  const tabs = [
    { id: "templates", label: t.tabs.templates },
    { id: "my-workflows", label: t.tabs.mine },
  ];

  return (
    <div className="h-full w-full flex flex-col p-4 sm:p-8 overflow-y-auto custom-scrollbar">
      <div className="max-w-7xl mx-auto w-full">
        <div className="flex flex-col gap-6 mb-8 sm:mb-12">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="font-display text-3xl font-bold text-white mb-2 tracking-tight">{t.title}</h1>
              <p className="text-white/60 text-sm font-medium">{t.subtitle}</p>
            </div>
            <button
              type="button"
              onClick={() => handleCreateWorkflow()}
              className="px-6 py-3 bg-brand text-on-brand text-xs font-black uppercase tracking-widest rounded-lg hover:bg-brand-hover transition-all active:scale-95 shadow-[0_0_20px_rgba(46,230,214,0.3)] flex items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              {t.create}
            </button>
          </div>

          <div className="flex items-center gap-2 border-b border-white/5 overflow-x-auto" role="tablist" aria-label={t.tabsLabel}>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeMainTab === tab.id}
                onClick={() => setActiveMainTab(tab.id)}
                className={`px-4 sm:px-6 py-4 text-xs font-black uppercase tracking-[0.2em] transition-all border-b-2 whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 ${
                  activeMainTab === tab.id ? "text-brand border-brand" : "text-white/50 border-transparent hover:text-white"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="py-20 flex items-center justify-center" role="status">
            <div className="w-10 h-10 border-4 border-white/5 border-t-brand rounded-full animate-spin" aria-hidden="true" />
          </div>
        ) : listError ? (
          <div className="py-24 text-center border border-pop/30 rounded-2xl bg-pop/5" role="alert">
            <p className="text-sm text-white/70">{t.loadFailed}</p>
            <button
              type="button"
              onClick={() => setReloadTick((tick) => tick + 1)}
              className="mt-4 px-4 py-2 rounded-lg bg-brand text-on-brand text-[11px] font-semibold hover:bg-brand-hover transition-colors"
            >
              {t.retry}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4 sm:gap-6">
            {workflows.map((wf) => (
              <WorkflowCard
                key={wf.id}
                workflow={wf}
                onOpen={handleSelectWorkflow}
                canEdit={activeMainTab === "my-workflows"}
                onRename={(item) => {
                  setRenamingWorkflow(item);
                  setNewWorkflowName(item.name || "");
                }}
                onDelete={handleDeleteWorkflow}
                t={t}
              />
            ))}
            {workflows.length === 0 && (
              <div className="col-span-full py-24 text-center border-2 border-dashed border-white/5 rounded-2xl bg-white/[0.02]">
                <p className="text-white/60 text-sm font-medium">{t.empty}</p>
                {activeMainTab === "my-workflows" && <p className="mt-2 text-white/40 text-xs">{t.emptyMine}</p>}
              </div>
            )}
          </div>
        )}
      </div>

      {renamingWorkflow && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6" onKeyDown={(e) => { if (e.key === "Escape") setRenamingWorkflow(null); }}>
          <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={() => setRenamingWorkflow(null)} aria-hidden="true" />
          <form
            onSubmit={handleRenameWorkflow}
            role="dialog"
            aria-modal="true"
            aria-labelledby="wf-rename-title"
            className="relative w-full max-w-sm bg-surface-panel border border-white/10 rounded-2xl p-8 shadow-2xl"
          >
            <h2 id="wf-rename-title" className="font-display text-xl font-bold text-white mb-2">{t.renameTitle}</h2>
            <p className="text-white/60 text-sm mb-6">{t.renameHelp}</p>

            <div className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="wf-rename-input" className="text-[10px] font-black text-brand uppercase tracking-widest">{t.nameLabel}</label>
                <input
                  id="wf-rename-input"
                  autoFocus
                  type="text"
                  maxLength={120}
                  value={newWorkflowName}
                  onChange={(e) => setNewWorkflowName(e.target.value)}
                  placeholder={t.namePlaceholder}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-brand/50 transition-colors"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setRenamingWorkflow(null)}
                  className="flex-1 px-4 py-3 text-xs font-black text-white/60 uppercase tracking-widest hover:text-white transition-colors"
                >
                  {t.cancel}
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-brand text-on-brand px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-brand-hover transition-all active:scale-95"
                >
                  {t.save}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
