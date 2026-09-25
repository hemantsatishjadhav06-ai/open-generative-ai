"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  FiSend, FiImage, FiTerminal, FiUpload, FiPlus, FiCheck, FiX, FiEdit2,
  FiArrowLeft, FiAlertCircle, FiCopy, FiSquare, FiLayout,
} from "react-icons/fi";
import { BiLoaderAlt } from "react-icons/bi";
import { RiRobot2Line, RiSparklingLine } from "react-icons/ri";
import { useTheme } from "next-themes";
import dynamic from "next/dynamic";
import Link from "next/link";
import toast, { Toaster } from "react-hot-toast";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { GoBook } from "react-icons/go";
import { VscLayoutSidebarLeftOff } from "react-icons/vsc";
import { HiOutlineArrowUpTray, HiOutlineTrash } from "react-icons/hi2";
import { oneLight, oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

import { UPLOAD_LIMITS_MB, createApiClient, fileKind, uploadFile } from "./api";
import { fill, getCopy } from "./i18n";

const CanvasArea = dynamic(() => import("./CanvasArea"), { ssr: false });
const SyntaxHighlighter = dynamic(
  () => import("react-syntax-highlighter").then((mod) => mod.Prism),
  { ssr: false }
);

// Tools whose results land on the canvas (a loader is shown while they run).
const MEDIA_TOOLS = ["generate_image", "generate_video", "image_to_video", "edit_image", "edit_video", "enhance_image"];
const POLL_INTERVAL_MS = 1200;
const MAX_DEAD_AIR_MS = 6 * 60 * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const formatTime = (dateStr, locale) => {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleTimeString(locale || [], { hour: "2-digit", minute: "2-digit" });
};

const formatDateHeader = (dateStr, t, locale) => {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return t.today;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return t.yesterday;
  return d.toLocaleDateString(locale || [], { weekday: "long", month: "short", day: "numeric" });
};

const TypingDots = () => (
  <div className="typing-dots py-1.5 px-1" aria-hidden="true">
    <span></span>
    <span></span>
    <span></span>
  </div>
);

// Server event → the flat shape kept in the transcript.
function flattenEvent(ev) {
  const p = ev.payload || {};
  switch (ev.type) {
    case "text": return { type: "text", content: p.content };
    case "info": return { type: "info", content: p.content };
    case "error": return { type: "error", message: p.message };
    case "tool_call": return { type: "tool_call", name: p.name, args: p.args };
    case "tool_result": return { type: "tool_result", name: p.name, result: p.result, asset: p.asset };
    default: return null;
  }
}

export default function CreativeCanvas({
  theme: forcedTheme,
  locale = "en",
  // Host-app integration: where the back arrow goes, and an optional brand
  // mark rendered next to it.
  backHref = "/",
  brandSlot = null,
  // Host callbacks: 401 (show sign-in), 402 (refresh the budget display) and
  // the generation lifecycle the host uses for notifications.
  onAuthRequired,
  onBudgetExceeded,
  onGenerationStart,
  onGenerationEnd,
  onGenerationComplete,
  onGenerationError,
}) {
  const t = useMemo(() => getCopy(locale), [locale]);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session");

  const hostRef = useRef({});
  hostRef.current = { onAuthRequired, onBudgetExceeded, onGenerationStart, onGenerationEnd, onGenerationComplete, onGenerationError };
  const api = useMemo(() => createApiClient({
    onAuthRequired: (...args) => hostRef.current.onAuthRequired?.(...args),
    onBudgetExceeded: (...args) => hostRef.current.onBudgetExceeded?.(...args),
  }), []);

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [assets, setAssets] = useState([]);
  const [activeTasks, setActiveTasks] = useState([]);
  const [busy, setBusy] = useState(false);
  const [activeJobId, setActiveJobId] = useState(null);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const [sessions, setSessions] = useState([]);
  const [currentSessionName, setCurrentSessionName] = useState(t.sessions.newName);
  const [skills, setSkills] = useState([]);
  const [activeSkill, setActiveSkill] = useState(null);
  const [showSkillsMenu, setShowSkillsMenu] = useState(false);
  const [showAssetsMenu, setShowAssetsMenu] = useState(false);
  const [showMentionPopup, setShowMentionPopup] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionCursorPos, setMentionCursorPos] = useState(0);
  const [hoveredAsset, setHoveredAsset] = useState(null);

  // Left Sidebar and Session Management
  const [showLeftSidebar, setShowLeftSidebar] = useState(true);
  const [editingSessionId, setEditingSessionId] = useState(null);
  const [editingSessionName, setEditingSessionName] = useState("");
  const [hoveredSessionId, setHoveredSessionId] = useState(null);

  // Layout resizing
  const [sidebarWidth, setSidebarWidth] = useState(350);
  const [showChat, setShowChat] = useState(true);
  const [prevWidth, setPrevWidth] = useState(350);
  const isResizing = useRef(false);

  const handleToggleSidebar = () => {
    if (showChat) {
      setPrevWidth(sidebarWidth);
      setSidebarWidth(0);
      setShowChat(false);
    } else {
      setSidebarWidth(prevWidth || 350);
      setShowChat(true);
    }
  };

  // Theme handling: Use props if provided, otherwise fallback to useTheme hook
  const { resolvedTheme: nextResolvedTheme } = useTheme();
  const resolvedTheme = forcedTheme || nextResolvedTheme;
  const [mounted, setMounted] = useState(false);

  const canvasRef = useRef(null);
  const chatEndRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const syncedUrlsRef = useRef(new Set());
  const justCreatedSessionRef = useRef(false);
  const initialHandoffProcessed = useRef(false);

  const runErrorMessage = useCallback((err) => {
    if (err?.status === 401) return t.run.session;
    if (err?.status === 402 || err?.code === "budget_exceeded") return t.run.budget;
    if (err?.status === 429) return t.run.busy;
    return err?.message || t.run.failed;
  }, [t]);

  // Initialize
  useEffect(() => {
    setMounted(true);
    // Phones: the chat takes the full width; "Hide chat" shows the canvas.
    if (typeof window !== "undefined" && window.innerWidth < 640) {
      setSidebarWidth(window.innerWidth);
      setPrevWidth(window.innerWidth);
    }
    fetchSessions();
    fetchSkills();
  }, []);

  // Handle initial query and skill from URL (Fallback only)
  useEffect(() => {
    if (!mounted || busy || initialHandoffProcessed.current) return;

    const q = searchParams.get("q");
    const skillName = searchParams.get("skill");
    const a = searchParams.get("a");

    if (!q && !skillName && !a) {
      initialHandoffProcessed.current = true;
      return;
    }

    const isNewSession = messages.length === 1 && messages[0].role === "assistant";
    const clearHandoff = () => {
      const newParams = new URLSearchParams(searchParams.toString());
      newParams.delete("q");
      newParams.delete("skill");
      newParams.delete("a");
      const query = newParams.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    };

    if (isNewSession) {
      initialHandoffProcessed.current = true;
      const initialAtts = a ? a.split(",").map((label) => ({ asset_label: label, kind: "image" })) : null;
      if (skillName && !activeSkill) {
        const found = skills.find((s) => s.id === skillName || s.name === skillName);
        if (found) {
          setActiveSkill(found);
          if (q) setTimeout(() => sendMessage(q, found, initialAtts), 10);
        }
      } else if (q) {
        sendMessage(q, null, initialAtts);
      }
      clearHandoff();
    } else if (messages.length > 1 || (messages.length === 1 && messages[0].role === "user")) {
      initialHandoffProcessed.current = true;
      clearHandoff();
    }
  }, [mounted, busy, messages, skills.length, searchParams]);

  useEffect(() => {
    if (justCreatedSessionRef.current) {
      justCreatedSessionRef.current = false;
      return;
    }
    // Clear the sync-tracking set whenever the session changes so assets from
    // the new session are always painted to canvas (prevents stale URL leakage).
    syncedUrlsRef.current.clear();
    if (sessionId) {
      loadHistory();
      loadAssets();
      const current = sessions.find((s) => s.id === sessionId);
      if (current) setCurrentSessionName(current.name);
      else {
        // The name arrives with the list; don't flash "New canvas" meanwhile.
        setCurrentSessionName("");
        fetchSessions();
      }
    } else {
      setMessages([{ role: "assistant", content: t.greetingNew, timestamp: new Date().toISOString() }]);
      setAssets([]);
      setCurrentSessionName(t.sessions.newName);
    }
  }, [sessionId]); // sessions is intentionally not a dependency (fetchSessions updates it)

  const fetchSessions = async () => {
    try {
      const data = await api.get("/sessions");
      setSessions(Array.isArray(data) ? data : []);
      if (sessionId && Array.isArray(data)) {
        const current = data.find((s) => s.id === sessionId);
        if (current) setCurrentSessionName(current.name);
      }
    } catch {
      // the list stays as it was
    }
  };

  const fetchSkills = async () => {
    try {
      const data = await api.get("/agent-skills");
      setSkills(Array.isArray(data) ? data : []);
    } catch {
      setSkills([]);
    }
  };

  // Retries a layout until the files it names have landed on the canvas
  // (new images load asynchronously).
  const applyLayout = useCallback((args, attempt = 0) => {
    const c = canvasRef.current;
    const ids = Array.isArray(args?.asset_ids) ? args.asset_ids : [];
    if (c && typeof c.layoutNodes === "function" && ids.length) {
      const placed = c.layoutNodes(ids, args.layout);
      if (placed < ids.length && attempt < 12) setTimeout(() => applyLayout(args, attempt + 1), 500);
      return;
    }
    if (c && typeof c.arrangeNodes === "function") c.arrangeNodes(args?.moves || []);
  }, []);

  const pushLocalEvent = (msgIdx, event) => {
    setMessages((prev) => {
      const arr = [...prev];
      if (msgIdx < 0 || msgIdx >= arr.length) return arr;
      arr[msgIdx] = { ...arr[msgIdx], events: [...(arr[msgIdx].events || []), event] };
      return arr;
    });
  };

  const processEvent = (ev, msgIdx) => {
    const p = ev.payload || {};

    // The run stopped at the daily budget: let the host refresh its display.
    if (ev.type === "budget") {
      hostRef.current.onBudgetExceeded?.(p);
      return;
    }

    // Canvas mutation events — apply directly to the live canvas, don't push
    // them into the chat transcript.
    if (ev.type === "canvas_op") {
      const args = p.args || {};
      const c = canvasRef.current;
      if (!c) return;
      if (p.op === "move" && typeof c.moveNode === "function") c.moveNode(args.asset_id, args.x, args.y);
      else if (p.op === "layout") applyLayout(args);
      else if (p.op === "arrange" && typeof c.arrangeNodes === "function") c.arrangeNodes(args.moves || []);
      return;
    }

    const flat = flattenEvent(ev);
    if (!flat) return;
    flat.job_id = ev.job_id || p.job_id;

    setMessages((prev) => {
      const arr = [...prev];
      if (msgIdx < 0 || msgIdx >= arr.length) return arr;
      const m = { ...arr[msgIdx], events: [...(arr[msgIdx].events || [])] };
      if (m.events.find((e) => e.id === ev.id && e.job_id === flat.job_id)) return arr;
      m.events.push({ ...flat, id: ev.id });
      if (flat.type === "text") m.content = (m.content || "") + (flat.content || "");
      arr[msgIdx] = m;
      return arr;
    });

    if (flat.type === "tool_call" && MEDIA_TOOLS.includes(flat.name)) {
      // For edit-style tools, spawn the loader at the same spot the result
      // will land at — beside the source asset (32px to its right).
      let x, y;
      const a = flat.args || {};
      const srcLabel = a.image || a.video || a.audio;
      if (srcLabel && typeof srcLabel === "string" && srcLabel.startsWith("asset_")) {
        try {
          const cs = canvasRef.current?.getCanvasState?.();
          const srcNode = cs?.nodes?.find((n) => n.asset_id === srcLabel);
          if (srcNode) {
            x = srcNode.x + (srcNode.w || 200) + 32;
            y = srcNode.y;
          }
        } catch {
          // default placement
        }
      }
      setActiveTasks((prev) => [...prev, {
        taskId: `task-${Date.now()}-${Math.random()}`,
        modelName: flat.name,
        status: "processing",
        x, y,
      }]);
    }

    if (flat.type === "tool_result" || flat.type === "error") {
      setActiveTasks((prev) => {
        const idx = prev.findIndex((task) => task.modelName === flat.name);
        if (idx === -1) return flat.type === "error" ? [] : prev;
        const next = [...prev];
        next.splice(idx, 1);
        return next;
      });

      if (flat.asset) {
        setAssets((pa) => {
          const idx = pa.findIndex((a) =>
            (flat.asset.asset_label && a.asset_label === flat.asset.asset_label) ||
            (a.url === flat.asset.url)
          );
          if (idx !== -1) {
            const next = [...pa];
            next[idx] = { ...next[idx], ...flat.asset };
            return next;
          }
          return [...pa, flat.asset];
        });

        // Side-by-side placement: a derived asset lands just to the right
        // of its source so both stay visible.
        const srcLabel = flat.result?.source_asset_id;
        const newLabel = flat.asset.asset_label;
        const newUrl = flat.asset.url;
        const newKind = flat.asset.kind || "image";
        const place = canvasRef.current?.placeNextToSource || canvasRef.current?.replaceAt;
        if (srcLabel && newLabel && newUrl && place) {
          place(srcLabel, newUrl, newKind, newLabel);
          syncedUrlsRef.current?.add?.(`${newLabel}-${newUrl}`);
        }
      }
    }
  };

  // Polls a run's event log until it ends → {status, error, assets:[…]}.
  const resumePolling = async (jobId, assistantIdx) => {
    let cursor = 0;
    let lastProgress = Date.now();
    const created = [];
    let outcome = { status: "failed", error: t.run.interrupted };

    setBusy(true);
    setActiveJobId(jobId);
    try {
      for (;;) {
        let data;
        try {
          data = await api.get(`/jobs/${encodeURIComponent(jobId)}/events?since=${cursor}`);
        } catch (err) {
          if (err?.status === 401 || err?.status === 404) {
            outcome = { status: "failed", error: err.status === 401 ? t.run.session : t.run.interrupted };
            break;
          }
          if (Date.now() - lastProgress > MAX_DEAD_AIR_MS) break;
          await sleep(POLL_INTERVAL_MS * 2);
          continue;
        }
        if (data?.events?.length) {
          data.events.forEach((ev) => {
            if (ev.type === "tool_result" && ev.payload?.asset?.url) created.push(ev.payload.asset);
            processEvent(ev, assistantIdx);
          });
          cursor = data.cursor || cursor;
          lastProgress = Date.now();
        }
        if (data?.done) {
          outcome = { status: data.status || "completed", error: data.error || null };
          break;
        }
        if (Date.now() - lastProgress > MAX_DEAD_AIR_MS) break;
        await sleep(POLL_INTERVAL_MS);
      }
    } finally {
      setBusy(false);
      setActiveJobId(null);
      setActiveTasks([]);
    }

    if (outcome.status === "cancelled") {
      pushLocalEvent(assistantIdx, { type: "info", content: t.run.stopped, job_id: jobId });
    } else if (outcome.status !== "completed" && outcome.error === t.run.interrupted) {
      // The server could not tell us what happened (restart, lost job).
      pushLocalEvent(assistantIdx, { type: "error", message: outcome.error, job_id: jobId });
    }
    return { ...outcome, assets: created };
  };

  const saveTranscript = (targetSessionId) => {
    if (!targetSessionId) return;
    setMessages((prev) => {
      api.patch(`/sessions/${encodeURIComponent(targetSessionId)}/messages`, { messages: prev }).catch(() => {});
      return prev;
    });
  };

  const stopRun = async () => {
    if (!activeJobId) return;
    try {
      await api.post(`/jobs/${encodeURIComponent(activeJobId)}/cancel`, {});
    } catch {
      toast.error(t.run.stopFailed);
    }
  };

  const loadHistory = async () => {
    try {
      const data = await api.get(`/sessions/${encodeURIComponent(sessionId)}/messages`);
      if (Array.isArray(data) && data.length > 0) {
        setMessages(data);
        checkActiveJobs(data);
      } else {
        setMessages([{ role: "assistant", content: t.greetingReady, timestamp: new Date().toISOString() }]);
      }
    } catch {
      setMessages([{ role: "assistant", content: t.greetingReady, timestamp: new Date().toISOString() }]);
    }
  };

  // After a reload, re-attach to a run that is still going.
  const checkActiveJobs = async (currentMessages) => {
    if (!sessionId) return;
    try {
      const data = await api.get(`/sessions/${encodeURIComponent(sessionId)}/jobs`);
      const active = Array.isArray(data) ? data.find((j) => j.status === "processing" && j.id) : null;
      if (!active) return;
      let aIdx = currentMessages.findIndex((m) => m.role === "assistant" && m.job_id === active.id);
      if (aIdx === -1) {
        aIdx = currentMessages.length;
        setMessages((prev) => [...prev, { role: "assistant", content: "", events: [], job_id: active.id, timestamp: new Date().toISOString() }]);
      }
      const targetSession = sessionId;
      const outcome = await resumePolling(active.id, aIdx);
      await loadAssets();
      if (outcome.status === "completed") saveTranscript(targetSession);
    } catch {
      // nothing to resume
    }
  };

  const loadAssets = async () => {
    if (!sessionId) return;
    try {
      const data = await api.get(`/sessions/${encodeURIComponent(sessionId)}/assets`);
      if (Array.isArray(data)) setAssets(data);
    } catch {
      // keep what is shown
    }
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  const ensureSession = async () => {
    if (sessionId) return sessionId;
    const data = await api.post("/sessions", {});
    justCreatedSessionRef.current = true;
    router.replace(`${pathname}?session=${encodeURIComponent(data.id)}`, { scroll: false });
    fetchSessions();
    return data.id;
  };

  const processFile = async (file) => {
    if (!file) return;
    const kind = fileKind(file);
    if (!kind) {
      toast.error(t.upload.unsupported);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    const limitMb = UPLOAD_LIMITS_MB[kind];
    if (file.size > limitMb * 1024 * 1024) {
      toast.error(fill(t.upload.tooLarge, { mb: limitMb, kind }));
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    try {
      // Uploaded files belong to a canvas, so make sure there is one.
      const activeSessionId = await ensureSession();
      const uploadedUrl = await uploadFile(file, {
        onProgress: setUploadProgress,
        onAuthRequired: (...args) => hostRef.current.onAuthRequired?.(...args),
        onBudgetExceeded: (...args) => hostRef.current.onBudgetExceeded?.(...args),
      });
      // Register it so the agent can address it as asset_N.
      const registered = await api.post(`/sessions/${encodeURIComponent(activeSessionId)}/assets`, { url: uploadedUrl, kind, source_tool: "upload" });
      const att = { asset_label: registered.asset_label, url: registered.url || uploadedUrl, kind };
      setAttachments((prev) => (prev.some((x) => x.asset_label === att.asset_label) ? prev : [...prev, att]));
      setAssets((prev) => (prev.some((x) => x.asset_label === att.asset_label) ? prev : [...prev, {
        ...att, source_tool: "upload", model: null, prompt: null,
      }]));
      toast.success(fill(t.upload.done, { label: registered.asset_label }));
    } catch (err) {
      toast.error(err?.status === 413 || err?.status === 400 || err?.status === 415 ? (err.message || t.upload.failed) : runErrorMessage(err) || t.upload.failed);
    } finally {
      setUploading(false);
      setUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleFileUpload = (e) => {
    processFile(e.target.files?.[0]);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    if (busy || uploading) return;
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (busy || uploading) return;
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  const removeAttachment = (label) => {
    setAttachments((prev) => prev.filter((a) => a.asset_label !== label));
    setHoveredAsset(null);
  };

  const sendMessage = async (textOverride = null, skillOverride = null, attachmentsOverride = null) => {
    const typed = (typeof textOverride === "string" ? textOverride : input).trim();
    const currentAttachments = attachmentsOverride || attachments;
    if ((!typed && currentAttachments.length === 0) || busy) return;

    const currentSkill = skillOverride || activeSkill;

    let activeSessionId;
    try {
      activeSessionId = await ensureSession();
    } catch (err) {
      toast.error(err?.status === 401 ? t.run.session : (err?.message || t.sessions.createFailed));
      return;
    }

    const msgAttachments = currentAttachments.map((a) => ({ asset_label: a.asset_label, url: a.url, kind: a.kind || "image" }));
    if (!attachmentsOverride) setAttachments([]);
    setHoveredAsset(null);
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "24px";

    const userMsg = {
      role: "user",
      content: typed,
      attachments: msgAttachments,
      timestamp: new Date().toISOString(),
      ...(currentSkill ? { skill_name: currentSkill.name } : {}),
    };
    const updatedMessages = [...messages, userMsg];
    setMessages([...updatedMessages, { role: "assistant", content: "", events: [], timestamp: new Date().toISOString() }]);
    setBusy(true);
    const aIdx = updatedMessages.length;

    let canvasState = null;
    try {
      canvasState = canvasRef.current?.getCanvasState?.() || null;
    } catch {
      canvasState = null;
    }
    const labels = msgAttachments.map((a) => a.asset_label).filter(Boolean);

    let endpoint = `/sessions/${encodeURIComponent(activeSessionId)}/chat`;
    let payload = { message: typed, attachments: labels, canvas_state: canvasState };
    if (currentSkill) {
      endpoint = `/sessions/${encodeURIComponent(activeSessionId)}/run-skill`;
      const primaryInputKey = currentSkill.inputs?.[0] || "premise";
      payload = {
        skill_id: currentSkill.id,
        skill_name: currentSkill.name,
        inputs: { [primaryInputKey]: typed },
        attachments: labels,
        canvas_state: canvasState,
      };
      if (!skillOverride) setActiveSkill(null);
    }

    hostRef.current.onGenerationStart?.();
    let outcome = null;
    try {
      const started = await api.post(endpoint, payload);
      setMessages((prev) => {
        const arr = [...prev];
        if (arr[aIdx]) arr[aIdx] = { ...arr[aIdx], job_id: started.job_id };
        return arr;
      });
      outcome = await resumePolling(started.job_id, aIdx);
      if (outcome.status === "completed" && outcome.assets.length) {
        const first = outcome.assets[0];
        hostRef.current.onGenerationComplete?.({ url: first.url, model: "design-agent", type: first.kind || "image" });
      } else if (outcome.status === "failed" && outcome.error) {
        hostRef.current.onGenerationError?.(outcome.error);
      }
    } catch (err) {
      pushLocalEvent(aIdx, { type: "error", message: runErrorMessage(err) });
      hostRef.current.onGenerationError?.(err);
      setBusy(false);
    } finally {
      hostRef.current.onGenerationEnd?.();
      await loadAssets();
      if (outcome) saveTranscript(activeSessionId);
      fetchSessions();
    }
  };

  const markdownComponents = useMemo(() => ({
    a: ({ node, ...props }) => {
      const isMedia = props.href?.match(/\.(jpeg|jpg|gif|png|webp|avif)$/i);
      const isVideo = props.href?.match(/\.(mp4|webm|mov)$/i);
      if (isMedia) {
        return (
          <span className="block mt-2 mb-1">
            <a href={props.href} target="_blank" rel="noreferrer" className="block relative group overflow-hidden rounded border border-divider shadow-sm">
              <img src={props.href} alt="" className="w-full h-auto object-cover transition-transform group-hover:scale-105" />
              <span className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
            </a>
          </span>
        );
      }
      if (isVideo) {
        return (
          <span className="block mt-2 mb-1">
            <video src={props.href} controls className="w-full rounded border border-divider shadow-sm" />
          </span>
        );
      }
      return <a {...props} className="text-primary hover:underline underline-offset-4 font-bold" target="_blank" rel="noreferrer" />;
    },
    div: ({ node, ...props }) => <div {...props} />,
    p: ({ node, ...props }) => <div className="mb-2 last:mb-0" {...props} />,
    pre: ({ node, ...props }) => <div className="my-3 overflow-x-auto rounded border border-divider" {...props} />,
    code: ({ node, inline, className, children, ...props }) => {
      const match = /language-(\w+)/.exec(className || "");
      return !inline && match ? (
        <SyntaxHighlighter
          style={resolvedTheme === "dark" ? oneDark : oneLight}
          language={match[1]}
          showLineNumbers
          PreTag="div"
          className="scrollbar-subtle !m-0 !p-3 text-[12px]"
          {...props}
        >
          {String(children).replace(/\n$/, "")}
        </SyntaxHighlighter>
      ) : (
        <code className="bg-primary/10 text-primary px-1.5 py-0.5 rounded text-[12px] font-mono" {...props}>
          {children}
        </code>
      );
    },
  }), [resolvedTheme]);

  // Sync assets to canvas once ref is ready — only push URLs not yet synced
  useEffect(() => {
    if (!sessionId || assets.length === 0) return;

    const newAssets = assets.filter((a) => !syncedUrlsRef.current.has(`${a.asset_label || "no-label"}-${a.url}`));
    if (newAssets.length === 0) return;

    let attempts = 0;
    const sync = () => {
      if (!canvasRef.current) return false;
      newAssets.forEach((a) => {
        const syncKey = `${a.asset_label || "no-label"}-${a.url}`;
        if (!a.url || syncedUrlsRef.current.has(syncKey)) return;
        syncedUrlsRef.current.add(syncKey);
        const kind = a.kind || (a.url.match(/\.(mp4|webm|mov)$/i) ? "video" : a.url.match(/\.(mp3|wav|ogg|m4a)$/i) ? "audio" : "image");
        const label = a.asset_label || null;
        if (kind === "image") canvasRef.current.addImage(a.url, undefined, undefined, undefined, undefined, undefined, label);
        else if (kind === "video") canvasRef.current.addVideo(a.url, undefined, undefined, undefined, undefined, undefined, label);
        else if (kind === "audio") canvasRef.current.addAudio(a.url, undefined, undefined, undefined, label);
      });
      return true;
    };

    if (!sync()) {
      const timer = setInterval(() => {
        attempts++;
        if (sync() || attempts > 20) clearInterval(timer);
      }, 500);
      return () => clearInterval(timer);
    }
  }, [assets, sessionId]);

  const renameSession = async (id = null, name = null) => {
    const targetId = id || sessionId;
    const targetName = String(name ?? "").trim();
    const currentName = sessions.find((s) => s.id === targetId)?.name || currentSessionName;

    if (!targetId || !targetName || targetName === currentName) {
      setEditingSessionId(null);
      return;
    }
    try {
      const updated = await api.patch(`/sessions/${encodeURIComponent(targetId)}`, { name: targetName });
      if (targetId === sessionId) setCurrentSessionName(updated?.name || targetName);
      setEditingSessionId(null);
      fetchSessions();
      toast.success(t.sessions.renamed);
    } catch {
      toast.error(t.sessions.renameFailed);
      setEditingSessionId(null);
    }
  };

  const deleteSession = async (id) => {
    if (!window.confirm(t.sessions.confirmDelete)) return;
    try {
      await api.del(`/sessions/${encodeURIComponent(id)}`);
      toast.success(t.sessions.deleted);
      fetchSessions();
      if (id === sessionId) router.push(pathname);
    } catch {
      toast.error(t.sessions.deleteFailed);
    }
  };

  const handleMouseMove = useCallback((e) => {
    if (!isResizing.current) return;
    const newWidth = window.innerWidth - e.clientX;
    if (newWidth > 300 && newWidth < 800) {
      setSidebarWidth(newWidth);
    }
  }, []);

  const stopResizing = useCallback(() => {
    isResizing.current = false;
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", stopResizing);
    document.body.style.cursor = "default";
    document.body.style.userSelect = "auto";
  }, [handleMouseMove]);

  const startResizing = useCallback(() => {
    isResizing.current = true;
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", stopResizing);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [handleMouseMove, stopResizing]);

  const selectMention = (item, type) => {
    const before = input.substring(0, mentionCursorPos);
    // mentionCursorPos is where @ is. query is after @.
    const after = input.substring(textareaRef.current.selectionStart);

    if (type === "skill") {
      setActiveSkill(item);
      setInput(before + after);
    } else {
      setInput(`${before}@${item.asset_label} ${after}`);
    }

    setShowMentionPopup(false);
    setTimeout(() => textareaRef.current?.focus(), 10);
  };

  const copyToClipboard = async (text) => {
    if (!text) return;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        toast.success(t.copy.copied);
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        try {
          document.execCommand("copy");
          toast.success(t.copy.copied);
        } catch {
          toast.error(t.copy.failed);
        }
        document.body.removeChild(textArea);
      }
    } catch {
      toast.error(t.copy.failed);
    }
  };

  const handleKey = (e) => {
    if (e.key === "Escape" && showMentionPopup) {
      setShowMentionPopup(false);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const filteredSkills = skills.filter((s) => s.name.toLowerCase().includes(mentionQuery.toLowerCase()));
  const filteredAssets = assets.filter((a) => (a.asset_label || "").toLowerCase().includes(mentionQuery.toLowerCase()));
  const skillPlaceholder = activeSkill
    ? fill(t.composer.skillPlaceholder, { skill: activeSkill.name, input: (activeSkill.inputs?.[0] || "idea").replace(/_/g, " ") })
    : t.composer.placeholder;

  if (!mounted) return null;

  return (
    <div className="h-dvh w-full text-sm flex flex-col bg-bg-page text-primary-text overflow-hidden" style={{ fontFamily: "'Inter', sans-serif" }}>
      <Toaster
        position="bottom-center"
        reverseOrder={false}
        toastOptions={{ style: { background: "var(--bg-elevated, #0f1c2e)", color: "var(--text-primary, #eef6ff)", border: "1px solid var(--border-default, rgba(148,197,255,0.16))", fontSize: "13px" } }}
      />
      <main className="flex h-full w-full overflow-hidden">
        {/* Left Sidebar: canvas list. `showLeftSidebar` true means the list is
            collapsed; `inert` keeps the zero-width list out of the tab order. */}
        <nav
          aria-label={t.sessions.total}
          inert={showLeftSidebar}
          aria-hidden={showLeftSidebar ? true : undefined}
          className={`flex-shrink-0 flex flex-col bg-bg-card border-r border-divider shadow-[4px_0_12px_rgba(0,0,0,0.05)] z-20 transition-all duration-300 ${showLeftSidebar ? "overflow-hidden w-0" : "w-64"}`}
        >
          <div className="p-3 border-b border-divider flex items-center justify-between bg-bg-card/50">
            <div className="flex items-center gap-2 overflow-hidden">
              <Link
                href={backHref}
                className="p-2 hover:bg-bg-page rounded text-secondary-text hover:text-primary transition-colors"
                title={t.nav.back}
                aria-label={t.nav.back}
              >
                <FiArrowLeft size={16} />
              </Link>
              <span className="font-display font-bold text-lg truncate">{t.studioTitle}</span>
            </div>
            <button
              type="button"
              onClick={() => setShowLeftSidebar(!showLeftSidebar)}
              className={`p-1.5 rounded transition-colors ${showLeftSidebar ? "bg-primary/10 text-primary" : "hover:bg-bg-card text-secondary-text hover:text-primary"}`}
              title={t.nav.toggleSessions}
              aria-label={t.nav.toggleSessions}
              aria-expanded={!showLeftSidebar}
            >
              <VscLayoutSidebarLeftOff size={16} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-subtle">
            {sessions.length === 0 ? (
              <div className="px-4 py-8 text-center text-secondary-text italic text-[11px]">{t.sessions.empty}</div>
            ) : (
              <ul>
                {sessions.map((s) => (
                  <li
                    key={s.id}
                    onMouseEnter={() => setHoveredSessionId(s.id)}
                    onMouseLeave={() => setHoveredSessionId(null)}
                    onFocus={() => setHoveredSessionId(s.id)}
                    className={`relative w-full flex items-center gap-3 px-4 py-3.5 transition-all border-l-2 group
                      ${sessionId === s.id ? "border-primary bg-primary/5" : "border-transparent hover:bg-bg-card-hover"}`}
                  >
                    <div className="flex-1 min-w-0 pr-12">
                      {editingSessionId === s.id ? (
                        <input
                          autoFocus
                          aria-label={t.sessions.renameLabel}
                          className="bg-bg-card border border-primary px-2 py-1 rounded text-xs focus:outline-none w-full"
                          value={editingSessionName}
                          maxLength={80}
                          onChange={(e) => setEditingSessionName(e.target.value)}
                          onBlur={() => renameSession(s.id, editingSessionName)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") renameSession(s.id, editingSessionName);
                            if (e.key === "Escape") setEditingSessionId(null);
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => { router.push(`${pathname}?session=${encodeURIComponent(s.id)}`); setShowLeftSidebar(true); }}
                          aria-current={sessionId === s.id ? "page" : undefined}
                          className={`w-full flex items-center gap-2 text-left text-[13px] font-semibold transition-colors ${sessionId === s.id ? "text-primary" : "text-primary-text"}`}
                        >
                          <span className="truncate flex-1">{s.name}</span>
                          <span className="flex items-center gap-1 text-[10px] text-secondary-text opacity-70" title={fill((s.asset_count || 0) === 1 ? t.sessions.filesOne : t.sessions.files, { count: s.asset_count || 0 })}>
                            <FiImage size={10} aria-hidden="true" /> {s.asset_count || 0}
                          </span>
                        </button>
                      )}
                    </div>

                    {(hoveredSessionId === s.id || sessionId === s.id) && editingSessionId !== s.id && (
                      <div className="flex items-center gap-0.5 animate-fade-in absolute right-2 top-1/2 -translate-y-1/2 bg-bg-card/90 backdrop-blur-sm pl-2 py-1 rounded-l shadow-[-12px_0_12px_rgba(0,0,0,0.1)]">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingSessionId(s.id);
                            setEditingSessionName(s.name);
                          }}
                          className="p-1.5 hover:bg-bg-page rounded text-secondary-text hover:text-primary transition-colors"
                          title={t.sessions.rename}
                          aria-label={`${t.sessions.rename}: ${s.name}`}
                        >
                          <FiEdit2 size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteSession(s.id)}
                          className="p-1.5 hover:bg-red-500/10 rounded text-secondary-text hover:text-red-500 transition-colors"
                          title={t.sessions.delete}
                          aria-label={`${t.sessions.delete}: ${s.name}`}
                        >
                          <HiOutlineTrash size={14} />
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="p-3 border-t border-divider bg-bg-page/30">
            <div className="flex items-center justify-between text-[10px] text-secondary-text font-medium px-1">
              <span>{t.sessions.total}</span>
              <span>{sessions.length}</span>
            </div>
          </div>
        </nav>
        <div className="flex flex-col relative bg-bg-page flex-1 overflow-hidden">
          {/* Canvas Top Bar */}
          <div className="flex justify-between items-center z-10 p-2 border-b border-divider bg-bg-page">
            <div className="relative flex items-center gap-1 min-w-0">
              {showLeftSidebar && (
                <button
                  type="button"
                  onClick={() => setShowLeftSidebar(false)}
                  className="p-2 hover:bg-bg-card rounded transition-colors text-primary"
                  title={t.nav.toggleSessions}
                  aria-label={t.nav.toggleSessions}
                  aria-expanded={false}
                >
                  <VscLayoutSidebarLeftOff size={18} />
                </button>
              )}

              {showLeftSidebar && (
                <Link
                  href={backHref}
                  className="p-1.5 hover:bg-bg-card rounded text-secondary-text hover:text-primary transition-colors"
                  title={t.nav.back}
                  aria-label={t.nav.back}
                >
                  <FiArrowLeft size={16} />
                </Link>
              )}

              {brandSlot}

              <div className="flex items-center gap-2 text-primary-text p-1.5 min-w-0">
                <h1 className="font-medium text-sm max-w-[200px] truncate">
                  {currentSessionName}
                </h1>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {!showChat && (
                <button
                  type="button"
                  onClick={handleToggleSidebar}
                  className="w-8 h-8 rounded-full rotate-270 hover:bg-bg-page hover:text-primary-text transition-all flex items-center justify-center text-secondary-text z-[60]"
                  title={t.nav.openChat}
                  aria-label={t.nav.openChat}
                >
                  <HiOutlineArrowUpTray size={18} />
                </button>
              )}
            </div>
          </div>

          {/* Main Canvas View */}
          <div className="flex-1 relative overflow-hidden bg-bg-page/50 w-full">
            <CanvasArea
              ref={canvasRef}
              theme={resolvedTheme}
              activeTasks={activeTasks}
              setActiveTasks={setActiveTasks}
              onZoomChange={setZoomLevel}
            />

            {/* Floating Toolbar */}
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-bg-card border border-divider shadow-2xl px-2 py-1.5 rounded z-20">
              <div className="flex items-center gap-3 px-3">
                <span className="text-[10px] font-bold text-secondary-text uppercase tracking-widest" aria-live="polite">{zoomLevel}%</span>
                <div className="flex items-center gap-1">
                  <button type="button" aria-label={t.canvas.zoomOut} title={t.canvas.zoomOut} onClick={() => canvasRef.current?.zoomOut()} className="w-5 h-5 rounded border border-divider flex items-center justify-center text-secondary-text hover:text-primary-text hover:border-primary transition-all">-</button>
                  <button type="button" aria-label={t.canvas.zoomIn} title={t.canvas.zoomIn} onClick={() => canvasRef.current?.zoomIn()} className="w-5 h-5 rounded border border-divider flex items-center justify-center text-secondary-text hover:text-primary-text hover:border-primary transition-all">+</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Resizer Handle */}
        <div
          className="h-full cursor-col-resize hover:bg-primary w-1 transition-all z-10 group relative hidden sm:flex items-center justify-center"
          onMouseDown={startResizing}
          aria-hidden="true"
        >
          <div className="z-10 w-3 h-8 rounded-full bg-bg-card border border-divider shadow-sm flex flex-col items-center justify-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity translate-x-[-0.5px]">
            <div className="w-0.5 h-0.5 rounded-full bg-primary-text" />
            <div className="w-0.5 h-0.5 rounded-full bg-primary-text" />
            <div className="w-0.5 h-0.5 rounded-full bg-primary-text" />
          </div>
        </div>

        {/* Right Panel: Chat Sidebar */}
        <aside
          aria-label={t.title}
          inert={!showChat}
          className={`flex-shrink-0 flex flex-col bg-bg-card border-l border-divider shadow-[-10px_0_20px_rgba(0,0,0,0.02)] z-20 transition-all duration-300 ${!showChat ? "overflow-hidden" : ""}`}
          style={{ width: sidebarWidth }}
        >
          {/* Sidebar Header */}
          <div className="p-4 flex items-center justify-between border-b border-divider bg-bg-card">
            <div className="flex flex-col min-w-0">
              <h2 className="font-display font-bold text-[13px] text-primary-text uppercase tracking-widest leading-none flex items-center gap-2">
                <RiSparklingLine className="text-primary" aria-hidden="true" /> {t.title}
              </h2>
              <span className="text-[10px] text-secondary-text mt-1.5 truncate">{t.subtitle}</span>
            </div>
            <div className="flex items-center gap-1">
              {sessionId && (
                <button
                  type="button"
                  onClick={() => router.push(pathname)}
                  className="p-1.5 hover:bg-bg-page hover:text-primary-text transition-colors rounded text-secondary-text"
                  title={t.nav.newSession}
                  aria-label={t.nav.newSession}
                >
                  <FiPlus size={16} />
                </button>
              )}
              <button
                type="button"
                onClick={handleToggleSidebar}
                className="w-8 h-8 rounded-full transition-all flex items-center justify-center shrink-0 bg-primary/10 text-primary"
                title={t.nav.hideChat}
                aria-label={t.nav.hideChat}
              >
                <FiLayout size={16} />
              </button>
            </div>
          </div>
          {/* Chat History */}
          <div className="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-subtle" aria-live="polite" aria-busy={busy}>
            {messages.map((msg, idx) => {
              if (!msg) return null;
              const prevMsg = idx > 0 ? messages[idx - 1] : null;
              const showDateHeader = msg.timestamp && (
                !prevMsg ||
                !prevMsg.timestamp ||
                new Date(msg.timestamp).toDateString() !== new Date(prevMsg.timestamp).toDateString()
              );

              return (
                <React.Fragment key={idx}>
                  {showDateHeader && msg.timestamp && (
                    <div className="flex justify-center my-4">
                      <span className="px-2 py-1 bg-bg-page border border-divider rounded text-[10px] font-medium text-secondary-text shadow-sm">
                        {formatDateHeader(msg.timestamp, t, locale)}
                      </span>
                    </div>
                  )}
                  <div className={`flex flex-col gap-2 ${msg.role === "user" ? "items-end" : "items-start"} animate-fade-in-up group`}>
                    <div className="flex items-center gap-2">
                      {msg.role === "assistant" && (
                        <div className="flex items-center gap-1.5 text-[10px] font-medium text-secondary-text ml-1">
                          <RiRobot2Line aria-hidden="true" /> {t.agentLabel}
                        </div>
                      )}
                      <div className="flex items-center justify-end gap-2 text-[9px] text-secondary-text">
                        {msg.timestamp && <span>{formatTime(msg.timestamp, locale)}</span>}
                      </div>
                      {msg.role === "user" && msg.skill_name && (
                        <div className="flex items-center gap-1.5 text-xs font-medium text-primary bg-primary/10 px-2 py-0.5 rounded border border-primary w-fit ml-auto">
                          <RiSparklingLine size={10} aria-hidden="true" /> {msg.skill_name}
                        </div>
                      )}
                    </div>
                    <div className={`max-w-[90%] space-y-2 ${msg.role === "user" ? "text-right" : "text-left"}`}>
                      <div className="relative">
                        <div className={`px-3 py-2 text-[13px] leading-relaxed break-words relative
                          ${msg.role === "user" ? "bg-bg-card-hover text-primary-text rounded-md rounded-tr-none shadow-sm border border-divider" : "text-primary-text bg-bg-page rounded-md rounded-tl-none shadow-sm border border-divider"}`}>

                          {msg.content ? (
                            msg.role === "assistant" ? (
                              <div className="prose dark:prose-invert max-w-none prose-p:leading-relaxed prose-pre:bg-black/30">
                                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                                  {msg.content}
                                </ReactMarkdown>
                              </div>
                            ) : (
                              <div className="prose dark:prose-invert max-w-none text-primary-text prose-p:leading-relaxed">
                                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                                  {msg.content}
                                </ReactMarkdown>
                              </div>
                            )
                          ) : (msg.role === "assistant" && busy && idx === messages.length - 1) && (
                            <TypingDots />
                          )}

                          {msg.role === "user" && msg.attachments && msg.attachments.length > 0 && (
                            <div className="flex flex-col gap-2 mt-2 w-full">
                              {msg.attachments.map((att) => (
                                <div key={att.asset_label || att.url} className="relative w-full rounded border border-white/20 overflow-hidden shadow-sm bg-black/10">
                                  {att.kind === "image" && att.url && (
                                    <img src={att.url} alt={att.asset_label || ""} className="w-full max-h-64 object-contain" />
                                  )}
                                  {att.kind === "video" && att.url && (
                                    <video src={att.url} controls className="w-full max-h-64 object-contain" />
                                  )}
                                  {att.kind === "audio" && att.url && (
                                    <div className="p-2">
                                      <audio src={att.url} controls className="w-full" />
                                    </div>
                                  )}
                                  <div className="px-2 py-1 text-[10px] text-secondary-text text-left">{att.asset_label}</div>
                                </div>
                              ))}
                            </div>
                          )}

                          {(msg.events || []).filter((e) => e && ["tool_call", "tool_result", "error", "info"].includes(e.type)).map((ev, i) => (
                            <EventPill key={i} event={ev} t={t} />
                          ))}
                        </div>

                        {msg.content && (
                          <button
                            type="button"
                            onClick={() => copyToClipboard(msg.content)}
                            className={`absolute top-0 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity p-1.5 rounded bg-bg-card border border-divider shadow-md hover:text-primary z-10
                              ${msg.role === "user" ? "right-full mr-2" : "left-full ml-2"}`}
                            title={t.composer.copyMessage}
                            aria-label={t.composer.copyMessage}
                          >
                            <FiCopy size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </React.Fragment>
              );
            })}

            <div ref={chatEndRef} />
          </div>

          {/* Chat Input Area */}
          <div className="p-2 bg-bg-card">
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`rounded border bg-bg-card shadow-sm flex flex-col transition-all relative
                ${isDragging ? "border-dashed border-primary bg-primary/5 ring-4 ring-primary/10" : ""}
                ${busy ? "border-primary ring-1 ring-primary/20" : "border-divider focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary"}`}
            >
              {activeSkill && (
                <div className="flex items-center gap-2 p-1 animate-fade-in-up">
                  <button
                    type="button"
                    onClick={() => setActiveSkill(null)}
                    aria-label={fill(t.composer.removeSkill, { skill: activeSkill.name })}
                    className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-bg-page border border-divider text-xs hover:bg-red-500 hover:text-white transition-colors"
                  >
                    <FiX size={12} aria-hidden="true" />
                    <span>{activeSkill.name}</span>
                  </button>
                </div>
              )}
              {isDragging && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-primary/5 backdrop-blur-[1px] pointer-events-none rounded">
                  <div className="bg-primary/10 p-4 rounded-full border-2 border-primary animate-pulse">
                    <FiUpload className="text-primary" size={32} />
                  </div>
                </div>
              )}
              {showMentionPopup && (
                <div className="absolute bottom-full left-0 mb-2 flex items-end gap-3 z-50">
                  <div className="w-72 bg-bg-card border border-divider rounded shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-200">
                    <div className="p-2 border-b border-divider text-[10px] font-bold text-secondary-text uppercase tracking-widest bg-bg-page/50">
                      {t.composer.mentions}
                    </div>
                    <div className="max-h-60 overflow-y-auto scrollbar-subtle py-1">
                      {filteredAssets.length > 0 && (
                        <div className="px-3 py-1.5 mt-1 text-[9px] font-bold text-green-500 uppercase opacity-60">{t.composer.mentionAssets}</div>
                      )}
                      <div className="grid grid-cols-2 gap-2">
                        {filteredAssets.map((asset) => (
                          <button
                            type="button"
                            key={asset.asset_label}
                            onClick={() => selectMention(asset, "asset")}
                            className="w-full text-left px-3 py-2 hover:bg-bg-page transition-colors flex items-center gap-2 group rounded"
                          >
                            {asset.kind === "image" && <img src={asset.url} alt="" className="w-7 h-7 rounded border border-divider object-cover shadow-sm" />}
                            {asset.kind === "video" && <video src={asset.url} className="w-7 h-7 rounded border border-divider object-cover shadow-sm" muted />}
                            {asset.kind === "audio" && <div className="w-7 h-7 rounded flex items-center justify-center bg-primary/5 text-primary text-[8px] font-bold uppercase tracking-tight">♪</div>}
                            <div className="flex flex-col">
                              <span className="text-xs font-medium text-primary-text">{asset.asset_label}</span>
                              <span className="text-[9px] text-secondary-text truncate max-w-[200px]">{asset.kind}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                      {filteredSkills.length > 0 && (
                        <div className="px-3 py-1.5 text-[9px] font-bold text-primary uppercase opacity-60">{t.composer.mentionSkills}</div>
                      )}
                      {filteredSkills.map((skill) => (
                        <button
                          type="button"
                          key={skill.id || skill.name}
                          onClick={() => selectMention(skill, "skill")}
                          className="w-full text-left px-3 py-2 hover:bg-bg-page transition-colors flex items-center gap-2 group"
                        >
                          <RiSparklingLine size={12} className="text-primary opacity-50 group-hover:opacity-100" aria-hidden="true" />
                          <span className="text-xs font-medium text-primary-text">{skill.name}</span>
                        </button>
                      ))}
                      {filteredSkills.length === 0 && filteredAssets.length === 0 && (
                        <div className="px-4 py-8 text-center text-secondary-text text-xs italic opacity-50">{t.composer.noMatches}</div>
                      )}
                    </div>
                  </div>
                </div>
              )}
              <textarea
                ref={textareaRef}
                value={input}
                autoFocus
                aria-label={t.composer.label}
                onChange={(e) => {
                  const val = e.target.value;
                  const pos = e.target.selectionStart;
                  setInput(val);

                  // Simple mention detection: an @ at the start or after a space.
                  const lastAtPos = val.lastIndexOf("@", pos - 1);
                  if (lastAtPos !== -1 && (lastAtPos === 0 || val[lastAtPos - 1] === " ")) {
                    const query = val.substring(lastAtPos + 1, pos);
                    if (!query.includes(" ")) {
                      setMentionQuery(query);
                      setMentionCursorPos(lastAtPos);
                      setShowMentionPopup(true);
                    } else {
                      setShowMentionPopup(false);
                    }
                  } else {
                    setShowMentionPopup(false);
                  }
                }}
                onKeyDown={handleKey}
                onInput={(e) => { e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px"; }}
                placeholder={skillPlaceholder}
                className="w-full bg-transparent px-3 py-3 text-[13px] resize-none focus:outline-none min-h-[50px] max-h-[120px] scrollbar-subtle"
                rows={1}
                maxLength={8000}
                disabled={busy}
              />

              {(uploading || attachments.length > 0 || input.includes("@")) && (
                <div className="flex flex-wrap gap-2 border-b px-3 py-1 border-divider bg-bg-page/20">
                  {attachments.map((att) => (
                    <div
                      key={att.asset_label}
                      className="relative group flex items-center gap-2 px-2 py-1 bg-bg-card border border-divider rounded-lg shadow-sm transition-all hover:border-primary"
                      onMouseEnter={() => setHoveredAsset(att)}
                      onMouseLeave={() => setHoveredAsset(null)}
                    >
                      <div className="w-5 h-5 rounded overflow-hidden">
                        {att.kind === "image" ? <img src={att.url} alt="" className="w-full h-full object-cover" /> : <FiTerminal size={10} aria-hidden="true" />}
                      </div>
                      <span className="text-[10px] font-bold text-secondary-text">{att.asset_label}</span>
                      <button
                        type="button"
                        onClick={() => removeAttachment(att.asset_label)}
                        className="text-secondary-text hover:text-red-500"
                        aria-label={fill(t.composer.removeAttachment, { label: att.asset_label })}
                        title={fill(t.composer.removeAttachment, { label: att.asset_label })}
                      >
                        <FiX size={10} />
                      </button>
                    </div>
                  ))}

                  {/* Mentioned assets (not attached but named in the text) */}
                  {assets.filter((a) => input.includes(`@${a.asset_label}`) && !attachments.find((att) => att.asset_label === a.asset_label)).map((a) => (
                    <div
                      key={a.asset_label}
                      className="relative group flex items-center gap-2 px-2 py-1 bg-primary/5 border border-primary rounded-lg shadow-sm transition-all hover:border-primary"
                      onMouseEnter={() => setHoveredAsset(a)}
                      onMouseLeave={() => setHoveredAsset(null)}
                    >
                      <div className="w-5 h-5 rounded overflow-hidden bg-primary/10 flex items-center justify-center text-primary">
                        {a.kind === "image" ? (
                          <img src={a.url} alt="" className="w-full h-full object-cover" />
                        ) : a.kind === "video" ? (
                          <video src={a.url} className="w-full h-full object-cover" muted />
                        ) : (
                          <RiSparklingLine size={10} aria-hidden="true" />
                        )}
                      </div>
                      <span className="text-[10px] font-bold text-primary">{a.asset_label}</span>
                    </div>
                  ))}
                  {uploading && (
                    <div className="flex items-center gap-2 px-2 py-1 bg-bg-page border border-divider border-dashed rounded-lg" role="status">
                      <div className="w-4 h-4 border-2 border-t-transparent border-primary rounded-full animate-spin" aria-hidden="true" />
                      <span className="text-[10px] font-bold text-secondary-text">{t.upload.uploading} {uploadProgress}%</span>
                    </div>
                  )}
                </div>
              )}

              {hoveredAsset && (
                <div className="absolute bottom-full left-4 w-72 aspect-square bg-bg-card border border-divider rounded-md shadow-[0_32px_64px_-12px_rgba(0,0,0,0.2)] overflow-hidden z-[110] animate-in fade-in zoom-in-95 duration-200 pointer-events-none">
                  {hoveredAsset.kind === "image" ? (
                    <img src={hoveredAsset.url} alt="" className="w-full h-full object-cover" />
                  ) : hoveredAsset.kind === "video" ? (
                    <video src={hoveredAsset.url} className="w-full h-full object-cover" autoPlay muted loop />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-bg-page">
                      <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
                        <FiTerminal size={32} />
                      </div>
                      <span className="text-xs font-bold text-secondary-text uppercase tracking-widest">{hoveredAsset.kind}</span>
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 p-5 bg-gradient-to-t from-black/90 via-black/40 to-transparent">
                    <div className="text-sm font-bold text-white tracking-tight">{hoveredAsset.asset_label}</div>
                    <div className="text-[10px] text-white/70 mt-1 uppercase tracking-widest font-bold">{hoveredAsset.kind}</div>
                  </div>
                </div>
              )}

              <div className="px-3 pb-2 flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <input
                    type="file"
                    className="hidden"
                    ref={fileInputRef}
                    accept="image/*,video/*,audio/*"
                    onChange={handleFileUpload}
                    tabIndex={-1}
                    aria-hidden="true"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading || busy}
                    className="p-1.5 rounded hover:bg-bg-page text-secondary-text transition-all disabled:opacity-40"
                    title={t.composer.upload}
                    aria-label={t.composer.upload}
                  >
                    <FiUpload size={16} />
                  </button>

                  {skills.length > 0 && (
                    <div
                      className="relative"
                      onBlur={(e) => {
                        if (!e.currentTarget.contains(e.relatedTarget)) setShowSkillsMenu(false);
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => setShowSkillsMenu(!showSkillsMenu)}
                        aria-expanded={showSkillsMenu}
                        aria-haspopup="true"
                        className={`p-1.5 rounded hover:bg-bg-page transition-all flex items-center gap-1.5
                          ${showSkillsMenu ? "bg-bg-page text-primary shadow-inner" : "text-secondary-text"}`}
                        title={t.composer.skills}
                        aria-label={t.composer.skills}
                      >
                        <GoBook size={16} />
                      </button>

                      {showSkillsMenu && (
                        <div className="absolute bottom-full -left-8 sm:left-1/2 sm:-translate-x-1/2 mb-3 w-[320px] max-w-[85vw] bg-bg-card border border-divider rounded shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-200">
                          <div className="px-4 py-3 border-b border-divider bg-bg-page/30">
                            <h3 className="text-[12px] font-bold text-primary-text uppercase tracking-tight">{t.composer.skillsTitle}</h3>
                            <p className="text-[10px] text-secondary-text mt-0.5">{t.composer.skillsHint}</p>
                          </div>
                          <div className="max-h-80 overflow-y-auto p-1.5 scrollbar-subtle">
                            {skills.map((skill) => (
                              <button
                                type="button"
                                key={skill.id || skill.name}
                                onClick={() => {
                                  setActiveSkill(skill);
                                  setShowSkillsMenu(false);
                                  textareaRef.current?.focus();
                                }}
                                aria-pressed={activeSkill?.id === skill.id}
                                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded hover:bg-bg-page transition-all text-left group ${activeSkill?.id === skill.id ? "bg-primary/5 border border-primary" : "border border-transparent"}`}
                              >
                                <div className={`w-8 h-8 rounded flex items-center justify-center transition-colors shadow-sm ${activeSkill?.id === skill.id ? "bg-primary text-white" : "bg-bg-page text-primary border border-divider group-hover:bg-primary group-hover:text-white"}`}>
                                  <RiSparklingLine size={16} aria-hidden="true" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className={`font-bold text-[12px] transition-colors ${activeSkill?.id === skill.id ? "text-primary" : "text-primary-text group-hover:text-primary"}`}>
                                    {skill.name}
                                  </div>
                                  <div className="text-[10px] text-secondary-text mt-0.5 line-clamp-2 opacity-80">{skill.description}</div>
                                </div>
                              </button>
                            ))}
                          </div>
                          <div className="p-2.5 bg-bg-page/50 border-t border-divider text-center">
                            <button
                              type="button"
                              onClick={() => setShowSkillsMenu(false)}
                              className="text-[10px] font-bold text-secondary-text hover:text-primary-text transition-colors"
                            >
                              {t.composer.dismiss}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div
                    className="relative"
                    onBlur={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget)) setShowAssetsMenu(false);
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setShowAssetsMenu(!showAssetsMenu)}
                      aria-expanded={showAssetsMenu}
                      aria-haspopup="true"
                      className={`p-1.5 rounded hover:bg-bg-page transition-all flex items-center gap-1.5
                        ${showAssetsMenu ? "bg-bg-page text-primary shadow-inner" : "text-secondary-text"}`}
                      title={t.composer.assets}
                      aria-label={t.composer.assets}
                    >
                      <FiImage size={16} />
                    </button>

                    {showAssetsMenu && (
                      <div className="absolute bottom-full right-0 mb-2 w-72 max-w-[85vw] bg-bg-card border border-divider rounded shadow-2xl z-30 animate-fade-in-up">
                        <div className="p-2 mb-2 border-b border-divider text-[10px] font-bold text-secondary-text flex items-center justify-between">
                          <span>{t.composer.assets}</span>
                          <span>{fill(assets.length === 1 ? t.composer.assetsCountOne : t.composer.assetsCount, { count: assets.length })}</span>
                        </div>
                        <div className="max-h-80 overflow-y-auto scrollbar-subtle p-2 grid grid-cols-3 gap-2">
                          {assets.length === 0 ? (
                            <div className="col-span-3 py-8 text-center text-secondary-text text-[10px] italic">{t.composer.noAssets}</div>
                          ) : (
                            assets.map((asset, i) => (
                              <button
                                type="button"
                                key={asset.asset_label || i}
                                onClick={() => {
                                  setInput((prev) => `${prev}${prev && !prev.endsWith(" ") ? " " : ""}@${asset.asset_label} `);
                                  setShowAssetsMenu(false);
                                  textareaRef.current?.focus();
                                }}
                                aria-label={`${asset.asset_label} (${asset.kind})`}
                                className="group relative aspect-square rounded border border-divider overflow-hidden bg-bg-page/50 hover:border-primary transition-all cursor-pointer"
                              >
                                {asset.kind === "image" && <img src={asset.url} alt="" className="w-full h-full object-cover" />}
                                {asset.kind === "video" && <video src={asset.url} className="w-full h-full object-cover" muted />}
                                {asset.kind === "audio" && <div className="w-full h-full flex items-center justify-center bg-primary/5 text-primary text-[8px] font-bold uppercase tracking-tight">♪</div>}

                                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 group-focus:opacity-100 transition-opacity flex flex-col items-center justify-center p-1 text-center">
                                  <span className="text-[10px] text-white font-bold truncate w-full mb-1">{asset.asset_label}</span>
                                </div>
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {busy && activeJobId ? (
                    <button
                      type="button"
                      onClick={stopRun}
                      className="h-8 px-3 rounded-full flex items-center justify-center gap-1.5 transition-all shadow-sm ml-1 border border-divider text-secondary-text hover:text-primary-text hover:border-primary text-[11px] font-semibold"
                      title={t.composer.stop}
                    >
                      <FiSquare size={11} aria-hidden="true" />
                      {t.composer.stop}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => sendMessage()}
                      disabled={busy || (!input.trim() && attachments.length === 0)}
                      aria-label={t.composer.send}
                      title={t.composer.send}
                      className={`w-8 h-8 rounded-full flex items-center justify-center transition-all shadow-sm ml-1
                        ${busy || (!input.trim() && attachments.length === 0)
                          ? "bg-[var(--bg-card-hover)] text-[var(--text-muted)] cursor-not-allowed"
                          : "bg-primary text-white hover:scale-105"}`}
                    >
                      {busy ? <BiLoaderAlt size={14} className="animate-spin" /> : <FiSend size={14} />}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}

// ── Event pills ────────────────────────────────────────────────────────────────
const TOOL_ICONS = {
  generate_image: "🎨", edit_image: "✏️", generate_video: "🎬",
  image_to_video: "🎥", edit_video: "🎞️", enhance_image: "✨", arrange_canvas: "🧩",
};

function EventPill({ event, t }) {
  if (event.type === "tool_call") return (
    <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-primary/10 border border-primary text-primary text-[11px] mt-1 shadow-sm">
      <span aria-hidden="true">{TOOL_ICONS[event.name] || "🔧"}</span>
      <span className="font-semibold">{t.tools[event.name] || event.name}</span>
    </div>
  );

  if (event.type === "tool_result") {
    const ok = event.result?.ok !== false;
    const model = event.result?.model;
    const kind = event.asset?.kind;
    const label = ok
      ? (kind === "video" ? t.pills.generatedVideo : kind === "audio" ? t.pills.generatedAudio : kind ? t.pills.generatedImage : (event.name === "arrange_canvas" ? t.pills.arranged : t.pills.done))
      : t.pills.failed;
    return (
      <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] border mt-1 shadow-sm ${
        ok
          ? "bg-[var(--color-success-bg)] text-[var(--color-success)] border-[var(--color-success)]"
          : "bg-[var(--color-error-bg)] text-[var(--color-error)] border-[var(--color-error)]"
      }`}>
        {ok ? <FiCheck size={11} aria-hidden="true" /> : <FiX size={11} aria-hidden="true" />}
        <div className="flex items-center gap-2 flex-1 min-w-0 flex-wrap">
          <span className="font-semibold">{label}</span>
          {ok && event.asset?.asset_label && (
            <span className="text-[9px] font-bold tracking-tight opacity-80">{event.asset.asset_label}</span>
          )}
          {ok && model && (
            <span className="text-[9px] font-bold uppercase tracking-tight opacity-80">{model}</span>
          )}
          {!ok && event.result?.error && (
            <span className="text-[10px] opacity-80 break-words">
              {String(event.result.error).replace(/^\w+Error:\s*/i, "").substring(0, 160)}
            </span>
          )}
        </div>
      </div>
    );
  }

  if (event.type === "info") return (
    <div className="px-3 py-2 rounded border text-[11px] mt-1 shadow-sm flex items-center gap-2 bg-bg-page border-divider text-secondary-text">
      <FiTerminal size={12} className="opacity-50" aria-hidden="true" />
      <span className="flex-1">{event.content}</span>
    </div>
  );

  if (event.type === "error") return (
    <div role="alert" className="px-2.5 py-1.5 rounded bg-[var(--color-error-bg)] text-[var(--color-error)] border border-[var(--color-error)] text-[11px] mt-1 shadow-sm flex items-start gap-1.5">
      <FiAlertCircle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>{event.message}</span>
    </div>
  );

  return null;
}
