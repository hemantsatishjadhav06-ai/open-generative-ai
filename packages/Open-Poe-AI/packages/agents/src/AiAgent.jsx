"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import axios from "axios";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { IoSend, IoChevronBack, IoColorPalette, IoAdd } from "react-icons/io5";
import { HiLightBulb } from "react-icons/hi2";
import { MdTerminal, MdPerson, MdClose, MdEdit, MdContentCopy, MdCheck, MdFullscreen, MdFileDownload } from "react-icons/md";
import { RiRobot2Fill } from "react-icons/ri";
import { HiOutlinePencilAlt } from "react-icons/hi";
import { BiLoaderAlt } from "react-icons/bi";
import { themes } from "./components/themes";
import { FaAngleRight } from "react-icons/fa6";
import { getAgentCopy } from "./i18n";
import { AGENTS_API as BASE_URL, errorMessage, isSessionError, newConversationId, uploadImage } from "./utils/api";

const POLL_INTERVAL_MS = 1000;
const MAX_POLL_NETWORK_ERRORS = 5;

const noUser = () => ({});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Generated media arrives as message.media [{type:'image'|'video'|'audio', url}].
const mediaOf = (msg) => (Array.isArray(msg?.media) ? msg.media.filter((item) => item && typeof item.url === "string") : []);

const formatMessageTime = (date) => {
  if (!date) return "";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(date));
};

const getDateHeader = (date) => {
  const d = new Date(date);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (d.toDateString() === now.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";

  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
};

const parseMessageContent = (text) => {
  if (!text) return [];
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = [];
  let lastIndex = 0;
  let match;

  while ((match = urlRegex.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    const url = match[0];

    if (start > lastIndex) {
      parts.push({ type: "text", content: text.substring(lastIndex, start) });
    }

    const cleanUrl = url.split("?")[0].toLowerCase();
    const isImage = /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(cleanUrl);
    const isVideo = /\.(mp4|webm|mov|ogg)$/i.test(cleanUrl);
    const isAudio = /\.(mp3|wav|mpeg)$/i.test(cleanUrl);

    if (isImage) {
      parts.push({ type: "image", url });
    } else if (isVideo) {
      parts.push({ type: "video", url });
    } else if (isAudio) {
      parts.push({ type: "audio", url });
    } else {
      parts.push({ type: "text", content: url });
    }

    lastIndex = end;
  }

  if (lastIndex < text.length) {
    parts.push({ type: "text", content: text.substring(lastIndex) });
  }

  return parts;
};

const CopyButton = ({ text }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy text: ", err);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className="p-1.5 rounded-lg border transition-all group relative border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--component-hover)]"
      title="Copy to clipboard"
      type="button"
    >
      {copied ? (
        <MdCheck className="w-3.5 h-3.5 text-green-400" />
      ) : (
        <MdContentCopy className="w-3.5 h-3.5" />
      )}
      <span
        className={`absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-slate-800 text-white text-[10px] rounded pointer-events-none transition-opacity duration-200 ${copied ? "opacity-100" : "opacity-0"
          }`}
      >
        Copied!
      </span>
    </button>
  );
};

const ChatPage = ({
  initialAgentDetails,
  useUser,
  initialHistory = null,
  // true when the host passed the server-loaded history (even if null)
  historyPreloaded = false,
  locale = "en",
}) => {
  const copy = getAgentCopy(locale);
  const { id: routeAgentId, agent_id, agent_name, conversation_id: routeConversationId } = useParams();
  const effectiveAgentId = agent_id || agent_name || routeAgentId;
  const lowerAgentSlug = effectiveAgentId?.toLowerCase();
  
  const effectiveConversationId = routeConversationId;
  const router = useRouter();
  
  // Optional host hook → {user:{username|name, profile_photo}}.
  const userContext = (useUser || noUser)();
  const userName = userContext?.user?.username || userContext?.user?.name || copy.you;
  const userProfile = userContext?.user?.profile_photo || null;

  const [messages, setMessages] = useState(() => {
    if (initialHistory && initialHistory.history) {
      return initialHistory.history.map((msg, i) => {
        let ts = msg.timestamp || initialHistory.created_at || new Date();
        if (typeof ts === 'string' && ts.includes('T') && !ts.endsWith('Z') && !ts.includes('+')) {
          ts += 'Z';
        }
        return {
          ...msg,
          id: msg.id || `${msg.role}_${Date.now()}_${i}`,
          timestamp: ts
        };
      });
    }
    return [];
  });
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(() => {
    if (typeof window !== 'undefined' && effectiveConversationId) {
      return !!sessionStorage.getItem('pending_first_msg');
    }
    return false;
  });
  const [agentDetails, setAgentDetails] = useState(initialAgentDetails || null);
  const [error, setError] = useState(null);
  const [sessionEnded, setSessionEnded] = useState(false);
  const conversationIdRef = useRef(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showThemeDropdown, setShowThemeDropdown] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState(null);
  const [downloadingUrl, setDownloadingUrl] = useState(null);
  const [currentTheme, setCurrentTheme] = useState(() => {
    const themeData = initialAgentDetails?.theme;
    if (typeof themeData === 'string' && themes[themeData]) {
      return themes[themeData];
    }
    if (themeData && typeof themeData === 'object' && themeData.colors) {
      return themeData;
    }
    return themes.cosmic;
  });
  const textareaRef = useRef(null);
  const scrollRef = useRef(null);
  const [attachments, setAttachments] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);
  const currentAssistantMsgRef = useRef({
    content: "",
    thoughts: "",
    status: [],
    suggestions: [],
    media: [],
  });
  const [showCustomColorPanel, setShowCustomColorPanel] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    const fetchHistory = async () => {
      // The host already loaded this chat's history on the server (null for
      // a chat that doesn't exist yet), so there is nothing to fetch.
      if (messages.length > 0 || historyPreloaded) {
        conversationIdRef.current = effectiveConversationId;
        return;
      }

      if (effectiveConversationId && lowerAgentSlug) {
        const pending = sessionStorage.getItem('pending_first_msg');
        if (pending) {
          try {
            const { convId } = JSON.parse(pending);
            if (convId === effectiveConversationId) {
              return;
            }
          } catch (e) {}
        }

        try {
          let endpoint = `${BASE_URL}/by-slug/${lowerAgentSlug}/${effectiveConversationId}`;
          const res = await axios.get(endpoint);
          if (res.data && res.data.history) {
            const hydratedMessages = res.data.history.map((msg, i) => {
              let ts = msg.timestamp || res.data.created_at || new Date();
              if (typeof ts === 'string' && ts.includes('T') && !ts.endsWith('Z') && !ts.includes('+')) {
                ts += 'Z';
              }
              return {
                ...msg,
                id: msg.id || `${msg.role}_${Date.now()}_${i}`,
                timestamp: ts
              };
            });

            // Never replace messages sent while this request was in flight.
            if (hydratedMessages.length > 0) {
              setMessages((prev) => (prev.length ? prev : hydratedMessages));
            }
            conversationIdRef.current = effectiveConversationId;
          }
        } catch (err) {
          if (isSessionError(err)) {
            setSessionEnded(true);
            setError(copy.errors.sessionEnded);
          }
        }
      }
    };
    fetchHistory();
  }, [effectiveConversationId, lowerAgentSlug]);

  const handleCustomColorChange = (part, color) => {
    const updatedTheme = {
      ...currentTheme,
      id: 'custom',
      name: 'Custom Theme',
      colors: {
        ...currentTheme.colors,
        [part]: color
      }
    };
    setCurrentTheme(updatedTheme);
  };

  const handleThemeSync = async (theme) => {
    try {
      await axios.put(`${BASE_URL}/by-slug/${lowerAgentSlug}`, { theme: theme });
    } catch (err) {
      setError(errorMessage(err, copy));
      if (isSessionError(err)) setSessionEnded(true);
    }
    setShowCustomColorPanel(false);
  };

  const generateCssVariables = (theme) => {
    const c = theme?.colors || themes.cosmic.colors;
    return {
      "--bg-primary": c.background,
      "--text-primary": c.foreground,
      "--text-secondary": c.muted,
      "--border-color": c.border,
      "--component-bg": c.componentBg,
      "--component-hover": c.componentHover,
      "--header-bg": c.headerBg,
      "--user-bubble": c.userBubble,
      "--user-text": c.userText,
      "--agent-bubble": c.agentBubble,
      "--agent-text": c.agentText,
      "--input-bg": c.inputBg,
      "--accent": c.accent,
      "--accent-text": c.accentText,
      // Inter is self-hosted by the host app (next/font → --font-inter).
      "--font-family": "var(--font-inter, 'Inter'), -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    };
  };

  // Saves a generated file. Media hosts that don't allow cross-origin reads
  // get the file opened in a new tab instead (the browser can save it there).
  const handleDownloadFile = async (file_url, filename = "download") => {
    if (!file_url) return;
    setDownloadingUrl(file_url);
    try {
      const fetchResponse = await fetch(file_url, { mode: "cors", credentials: "omit" });
      if (!fetchResponse.ok) throw new Error(`HTTP ${fetchResponse.status}`);
      const blob = await fetchResponse.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch {
      window.open(file_url, "_blank", "noopener,noreferrer");
    } finally {
      setDownloadingUrl(null);
    }
  };

  useEffect(() => {
    if (agentDetails?.theme && themes[agentDetails.theme]) {
      setCurrentTheme(themes[agentDetails.theme]);
    }
  }, [agentDetails]);

  useEffect(() => {
    if (initialAgentDetails) setAgentDetails(initialAgentDetails);
  }, [lowerAgentSlug, initialAgentDetails]);

  useEffect(() => {
    const checkPendingMessage = async () => {
      if (effectiveConversationId) {
        const pending = sessionStorage.getItem('pending_first_msg');
        if (pending) {
          try {
            const { convId, text, attachments: pendingAttachments } = JSON.parse(pending);
            if (convId === effectiveConversationId) {
              sessionStorage.removeItem('pending_first_msg');
              setTimeout(() => {
                handleSendMessage(null, text, pendingAttachments);
              }, 100);
            }
          } catch (e) {
            console.error("Failed to parse pending message", e);
          }
        }
      }
    };
    checkPendingMessage();
  }, [effectiveConversationId]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [input]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [messages]);

  const uploadFile = async (file) => {
    if (!file) return;
    try {
      setUploadProgress(0);
      setIsUploading(true);
      setError(null);
      const uploadedUrl = await uploadImage(file, { copy, onProgress: setUploadProgress });
      setAttachments(prev => (prev.includes(uploadedUrl) ? prev : [...prev, uploadedUrl].slice(-4)));
    } catch (err) {
      setError(err?.message || copy.errors.uploadFailed);
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    uploadFile(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) {
      uploadFile(file);
    } else if (file) {
      setError(copy.errors.imagesOnly);
    }
  };

  const removeAttachment = (url) => {
    setAttachments(prev => prev.filter(item => item !== url));
  };

  const handleThemeChange = async (theme) => {
    setCurrentTheme(theme);
    handleThemeSync(theme);
  };

  const handleNewChat = () => {
    if (lowerAgentSlug) {
      router.push(`/agents/${lowerAgentSlug}`);
    }
  };

  // Applies one poll answer ({messages, suggestions}) to the pending reply.
  const applyTurnUpdate = (assistantMsgId, data) => {
    let content = "";
    let thoughts = "";
    let media = [];
    const status = [];
    for (const msg of Array.isArray(data?.messages) ? data.messages : []) {
      if (msg?.role === "assistant") {
        if (msg.content) content = msg.content;
        if (msg.thoughts) thoughts = msg.thoughts;
        if (mediaOf(msg).length) media = mediaOf(msg);
      }
      if (msg?.type === "pulse" && msg.content) status.push(msg.content);
    }
    const suggestions = Array.isArray(data?.suggestions) ? data.suggestions : [];
    currentAssistantMsgRef.current = { ...currentAssistantMsgRef.current, content, thoughts, status, suggestions, media };
    setMessages((prev) => prev.map((m) => (m.id === assistantMsgId ? { ...m, content, thoughts, status, suggestions, media } : m)));
  };

  // Polls the turn until it is complete. A failed turn is HTTP 400
  // {detail:{error}} (or status:'failed'); 401/402/404 end polling at once.
  const pollTurn = async (requestId, assistantMsgId) => {
    let networkErrors = 0;
    for (;;) {
      await sleep(POLL_INTERVAL_MS);
      let data;
      try {
        const res = await axios.get(`/api/v1/predictions/${encodeURIComponent(requestId)}/result`);
        data = res.data;
        networkErrors = 0;
      } catch (err) {
        const status = err?.response?.status;
        if (status === 400 || status === 401 || status === 402 || status === 403 || status === 404) throw err;
        networkErrors += 1;
        if (networkErrors >= MAX_POLL_NETWORK_ERRORS) throw new Error(copy.errors.lostConnection);
        await sleep(POLL_INTERVAL_MS * 2);
        continue;
      }
      if (data?.conversation_id) conversationIdRef.current = data.conversation_id;
      applyTurnUpdate(assistantMsgId, data);
      if (data?.status === "failed" || data?.status === "cancelled") throw new Error(data.error || copy.errors.turnFailed);
      if (data?.is_complete || data?.status === "completed") return data;
    }
  };

  const handleSendMessage = async (e, overrideText = null, overrideAttachments = null) => {
    if (e) e.preventDefault();

    const userText = overrideText || input;
    const currentAttachments = overrideAttachments || (overrideText ? [] : attachments);

    if (!userText.trim()) return;
    if (isStreaming && !overrideText) return;
    if (isUploading) return;

    if (overrideText) setIsStreaming(false);

    const userMessage = {
      role: "user",
      content: userText,
      attachments: [...currentAttachments],
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);

    if (!overrideText) {
      setAttachments([]);
      setInput("");
    }

    setIsStreaming(true);
    setError(null);

    const assistantMsgId = `asst_${Date.now()}`;
    currentAssistantMsgRef.current = {
      id: assistantMsgId,
      role: "assistant",
      content: "",
      thoughts: "",
      status: [],
      suggestions: [],
      media: [],
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, { ...currentAssistantMsgRef.current }]);

    try {
      const currentConvId = conversationIdRef.current || effectiveConversationId;

      // First message of a new chat: move to the chat's own URL, which sends
      // the pending message once it mounts.
      if (!currentConvId && !overrideText) {
        const newConvId = newConversationId();
        conversationIdRef.current = newConvId;
        sessionStorage.setItem('pending_first_msg', JSON.stringify({
          convId: newConvId,
          text: userText,
          attachments: currentAttachments,
          timestamp: new Date().toISOString()
        }));
        if (lowerAgentSlug) {
          router.replace(`/agents/${lowerAgentSlug}/${newConvId}`);
        }
        return;
      }

      const initialRes = await axios.post(`${BASE_URL}/by-slug/${lowerAgentSlug}/chat`, {
        message: userText,
        stream: false,
        conversation_id: currentConvId,
        attachments: userMessage.attachments,
      });

      const { request_id } = initialRes.data || {};
      if (!request_id) throw new Error(copy.errors.turnFailed);
      if (initialRes.data.conversation_id) conversationIdRef.current = initialRes.data.conversation_id;
      await pollTurn(request_id, assistantMsgId);
    } catch (err) {
      if (isSessionError(err)) setSessionEnded(true);
      setError(err?.response ? errorMessage(err, copy, copy.errors.turnFailed) : (err?.message || copy.errors.turnFailed));
      const pending = currentAssistantMsgRef.current;
      if (!pending.content && !mediaOf(pending).length) {
        setMessages((prev) => prev.filter((m) => m.id !== assistantMsgId));
      }
    } finally {
      setIsStreaming(false);
    }
  };

  const mediaLabel = (type) => (type === "video" ? copy.generatedVideo : type === "audio" ? copy.generatedAudio : copy.generatedImage);

  // One generated file (image / video / audio) with full-screen + download.
  const renderMedia = (item) => {
    const { type, url } = item;
    const ext = type === "video" ? "mp4" : type === "audio" ? "mp3" : "png";
    const actionClass = "p-2 rounded-lg bg-black/60 hover:bg-black/80 text-white backdrop-blur-md border border-white/20 transition-all hover:scale-105 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-white";
    const downloadButton = (
      <button
        type="button"
        onClick={() => handleDownloadFile(url, `${type}-${Date.now()}.${ext}`)}
        className={actionClass}
        title={copy.download}
        aria-label={`${copy.download}: ${mediaLabel(type)}`}
        disabled={downloadingUrl === url}
      >
        {downloadingUrl === url ? <BiLoaderAlt aria-hidden="true" className="w-5 h-5 animate-spin" /> : <MdFileDownload aria-hidden="true" className="w-5 h-5" />}
      </button>
    );
    if (type === "audio") {
      return (
        <div className="my-3 flex items-center gap-3 p-3 rounded-xl border backdrop-blur-sm bg-[var(--component-bg)] border-[var(--border-color)] min-w-[260px]">
          <audio src={url} controls preload="metadata" aria-label={mediaLabel(type)} className="w-full h-8" />
          {downloadButton}
        </div>
      );
    }
    return (
      <div className="my-3 rounded-xl overflow-hidden border shadow-lg relative w-fit max-w-full group/media bg-[var(--component-bg)] border-[var(--border-color)]">
        {type === "video" ? (
          <video src={url} controls playsInline preload="metadata" aria-label={mediaLabel(type)} className="w-full h-auto max-h-[320px]" />
        ) : (
          <img src={url} alt={mediaLabel(type)} loading="lazy" className="w-full h-auto max-h-[320px] object-contain" />
        )}
        <div className="absolute top-3 right-3 flex gap-2 opacity-0 group-hover/media:opacity-100 focus-within:opacity-100 transition-opacity duration-300 z-10">
          <button
            type="button"
            onClick={() => setSelectedMedia({ type, url })}
            className={actionClass}
            title={copy.viewFullScreen}
            aria-label={`${copy.viewFullScreen}: ${mediaLabel(type)}`}
          >
            <MdFullscreen aria-hidden="true" className="w-5 h-5" />
          </button>
          {downloadButton}
        </div>
      </div>
    );
  };

  return (
    <main
      className="h-dvh flex flex-col selection:bg-blue-500/30 relative"
      style={{
        ...generateCssVariables(currentTheme),
        background: "var(--bg-primary)",
        color: "var(--text-primary)",
        fontFamily: "var(--font-family)",
      }}
    >
      {isMounted && (
        <style dangerouslySetInnerHTML={{ __html: `
          main {
            font-family: var(--font-family) !important;
          }
          
          .prose, .prose p, .prose h1, .prose h2, .prose h3, .prose h4, .prose li {
            font-family: var(--font-family) !important;
          }
        ` }} />
      )}
      <header className="flex-shrink-0 border-b backdrop-blur-2xl px-6 py-4 flex items-center justify-center z-10 shadow-lg transition-colors duration-300 bg-[var(--header-bg)] border-[var(--border-color)]">
        <div className="flex items-center justify-between gap-4 w-full lg:max-w-[80%]">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => window.history.back()}
              aria-label={copy.back}
              title={copy.back}
              className="flex items-center justify-center transition-all group"
            >
              <IoChevronBack className="w-5 h-5 text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors" />
            </button>
            <div className="flex items-center gap-3">
              {agentDetails?.icon_url ? (
                <img
                  src={agentDetails.icon_url}
                  alt=""
                  className="w-9 h-9 rounded-lg object-cover border border-[var(--border-color)]"
                />
              ) : (
                <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: 'var(--accent)', color: 'var(--accent-text)' }}>
                  <RiRobot2Fill className="w-5 h-5" />
                </div>
              )}
              <div className="relative min-w-0">
                {!agentDetails?.is_owner ? (
                  <div className="px-2 py-1 min-w-0">
                    <h1 className="font-display text-base font-semibold text-[var(--text-primary)] truncate">
                      {agentDetails?.name || copy.agentFallbackName}
                    </h1>
                  </div>
                ) : (
                <button
                  type="button"
                  onClick={() => setShowDropdown(!showDropdown)}
                  aria-haspopup="menu"
                  aria-expanded={showDropdown}
                  aria-label={`${agentDetails?.name || copy.agentFallbackName} — ${copy.agentMenu}`}
                  className="flex items-center gap-2 px-2 py-1 rounded-lg transition-all hover:bg-[var(--component-hover)] min-w-0"
                >
                  <div className="flex flex-col items-start leading-tight min-w-0">
                    <h1 className="font-display text-base font-semibold text-[var(--text-primary)] truncate">
                      {agentDetails?.name || copy.agentFallbackName}
                    </h1>
                  </div>
                  <IoChevronBack
                    aria-hidden="true"
                    className={`w-4 h-4 text-[var(--text-secondary)] transition-transform ${showDropdown ? "rotate-90" : "-rotate-180"
                      }`}
                  />
                </button>
                )}
                {showDropdown && agentDetails?.is_owner && (
                  <div role="menu" className="absolute top-10 left-0 border rounded-lg shadow-xl z-50 animate-in fade-in slide-in-from-top-2 duration-200 min-w-[200px] bg-[var(--header-bg)] border-[var(--border-color)]">
                      <>
                        <button
                          role="menuitem"
                          onClick={() => {
                            setShowDropdown(false);
                            router.push(`/agents/edit/${agent_id}`);
                          }}
                          type="button"
                          className="w-full flex items-center gap-3 px-3 py-2 transition-all hover:bg-[var(--component-hover)] rounded-t-lg"
                        >
                          <MdEdit size={16} className="text-[var(--text-secondary)]" />
                          <span className="text-sm text-[var(--text-primary)]">Edit agent</span>
                        </button>
                        <div className="relative group/submenu">
                          <button
                            role="menuitem"
                            aria-haspopup="menu"
                            aria-expanded={showThemeDropdown}
                            onMouseEnter={() => setShowThemeDropdown(true)}
                            onClick={() => setShowThemeDropdown(!showThemeDropdown)}
                            type="button"
                            className={`w-full flex items-center gap-3 px-3 py-2 transition-all hover:bg-[var(--component-hover)] border-t border-[var(--border-color)] rounded-b-lg ${showThemeDropdown ? 'bg-[var(--component-hover)]' : ''}`}
                          >
                            <IoColorPalette size={16} className="text-[var(--text-secondary)]" />
                            <span className="text-sm text-[var(--text-primary)]">Themes</span>
                            <FaAngleRight size={14} className="ml-auto text-[var(--text-secondary)]" />
                          </button>
                          {showThemeDropdown && (
                            <div
                              className="md:absolute relative md:left-full left-0 md:top-0 top-0 md:ml-1 ml-0 md:border border-none md:rounded-xl rounded-none md:shadow-2xl shadow-none overflow-hidden z-[60] animate-in fade-in md:slide-in-from-left-2 slide-in-from-top-2 duration-200 min-w-[200px] bg-[var(--header-bg)] md:border-[var(--border-color)] p-2"
                              onMouseEnter={() => setShowThemeDropdown(true)}
                              onMouseLeave={() => setShowThemeDropdown(false)}
                            >
                              <div className="text-[10px] font-bold text-[var(--text-secondary)] mb-2 px-2 uppercase tracking-[0.2em]">Select Theme</div>
                              <div className="space-y-1 max-h-80 overflow-y-auto custom-scrollbar pr-1">
                                {Object.values(themes).map((theme) => (
                                  <button
                                    key={theme.id}
                                    onClick={() => {
                                      handleThemeChange(theme);
                                      setShowThemeDropdown(false);
                                      setShowDropdown(false);
                                    }}
                                    type="button"
                                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all group/theme ${currentTheme.id === theme.id
                                        ? "bg-[var(--accent)] text-[var(--accent-text)] shadow-md"
                                        : "text-[var(--text-secondary)] hover:bg-[var(--component-hover)]"
                                      }`}
                                  >
                                    <div
                                      className="w-4 h-4 rounded-full border border-white/20 shadow-inner flex-shrink-0"
                                      style={{ background: theme.colors.background }}
                                    ></div>
                                    <span className="font-medium">{theme.name}</span>
                                    {currentTheme.id === theme.id && (
                                      <MdCheck className="ml-auto w-4 h-4" />
                                    )}
                                  </button>
                                ))}
                                <button
                                  onClick={() => {
                                    setShowCustomColorPanel(true);
                                    setShowThemeDropdown(false);
                                    setShowDropdown(false);
                                  }}
                                  type="button"
                                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-[var(--text-secondary)] hover:bg-[var(--component-hover)] border-t border-[var(--border-color)] mt-1"
                                >
                                  <MdEdit className="w-4 h-4" />
                                  <span className="font-medium">Customize Colors</span>
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {effectiveConversationId && (
              <button
                type="button"
                onClick={handleNewChat}
                aria-label={copy.newChat}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--component-hover)]"
                title={copy.newChat}
              >
                <HiOutlinePencilAlt aria-hidden="true" className="w-4 h-4" />
                <span className="text-xs hidden md:flex font-semibold">{copy.newChat}</span>
              </button>
            )}
          </div>
        </div>
      </header>
      <div className="flex-1 flex overflow-y-auto">
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-4 py-8 custom-scrollbar"
        >
          <div className="max-w-3xl mx-auto space-y-6">
            {messages.length === 0 && agentDetails && (
              <div className="space-y-6">
                <div className="flex justify-center">
                  <div className="px-4 py-1.5 rounded-full border text-[10px] uppercase tracking-widest font-bold bg-[var(--component-bg)] border-[var(--border-color)] text-[var(--text-secondary)]">
                    Today
                  </div>
                </div>
                <div className="flex flex-col items-start animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div className="flex items-center gap-2 mb-1 ml-11">
                    <div className="text-xs font-bold text-[var(--text-primary)]">
                      {agentDetails?.name}
                    </div>
                  </div>

                  <div className="flex gap-3 items-end max-w-[85%] group/msg">
                    {agentDetails?.icon_url ? (
                      <img
                        src={agentDetails.icon_url}
                        alt={agentDetails.name}
                        className="w-8 h-8 rounded-full object-cover border flex-shrink-0 border-[var(--border-color)] transition-all duration-500 ease-in-out"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-500 ease-in-out" style={{ background: 'var(--accent)', color: 'var(--accent-text)' }}>
                        <RiRobot2Fill className="w-4 h-4" />
                      </div>
                    )}
                    <div className="flex-1 space-y-3">
                      <div className="flex items-end gap-2">
                        <div
                          className="backdrop-blur-sm rounded-2xl rounded-tl-md px-4 py-3 shadow-xl border inline-block"
                          style={{
                            background: 'var(--agent-bubble)',
                            color: 'var(--agent-text)',
                            borderColor: 'var(--border-color)'
                          }}
                        >
                          <div className="prose prose-sm max-w-none" style={{ color: 'var(--agent-text)' }}>
                            <p>
                              {agentDetails.welcome_message ||
                                `Hello! I am ${agentDetails.name}. ${agentDetails.description ||
                                "How can I assist you today?"
                                }`}
                            </p>
                          </div>
                        </div>
                        <div className="opacity-0 group-hover/msg:opacity-100 transition-opacity">
                          <CopyButton text={agentDetails?.welcome_message || `Hello! I am ${agentDetails.name}. ${agentDetails.description || "How can I assist you today?"}`} />
                        </div>
                      </div>
                      {agentDetails.initial_suggestions?.length > 0 && (
                        <div className="flex flex-wrap gap-2 pt-2">
                          {agentDetails.initial_suggestions.map((sug, i) => (
                            <button
                              key={i}
                              type="button"
                              onClick={() => {
                                setInput(sug.prompt);
                                if (textareaRef.current) {
                                  textareaRef.current.focus();
                                }
                              }}
                              className="flex items-center gap-2 text-xs font-medium border px-3 py-2 rounded-lg transition-all group hover:opacity-80"
                              style={{
                                background: 'var(--component-bg)',
                                borderColor: 'var(--border-color)',
                                color: 'var(--text-primary)'
                              }}
                            >
                              <HiLightBulb className="w-3.5 h-3.5 text-yellow-500 group-hover:scale-110 transition-transform" />
                              {sug.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
            {messages.map((msg, idx) => {
              const prevMsg = messages[idx - 1];
              const showDateHeader =
                !prevMsg ||
                new Date(msg.timestamp).toDateString() !==
                new Date(prevMsg.timestamp).toDateString();

              return (
                <div key={idx} className="space-y-6">
                  {showDateHeader && msg.timestamp && (
                    <div className="flex justify-center">
                      <div className="px-4 py-1.5 rounded-full border text-[10px] uppercase tracking-widest font-bold bg-[var(--component-bg)] border-[var(--border-color)] text-[var(--text-secondary)]">
                        {getDateHeader(msg.timestamp)}
                      </div>
                    </div>
                  )}
                  <div
                    className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"
                      } animate-in fade-in slide-in-from-bottom-2 duration-300`}
                  >
                    {msg.role === "user" ? (
                      <div className="flex flex-col items-end max-w-[80%] group/msg">
                        <div className="flex items-center gap-2 mb-1 mr-11">
                          {msg.timestamp && (
                            <div className="text-[10px] font-medium text-[var(--text-secondary)]">
                              {formatMessageTime(msg.timestamp)}
                            </div>
                          )}
                          <div className="text-xs font-bold text-[var(--text-primary)]">
                            {userName}
                          </div>
                        </div>

                        <div className="flex gap-3 items-end w-full justify-end">
                          <div className="flex-1 space-y-1 text-right">
                            <div className="flex items-end justify-end gap-2">
                              <div className="opacity-0 group-hover/msg:opacity-100 transition-opacity">
                                <CopyButton text={msg.content} />
                              </div>
                              <div
                                className="px-4 py-3 rounded-2xl rounded-tr-md shadow-xl inline-block text-left"
                                style={{
                                  background: 'var(--user-bubble)',
                                  color: 'var(--user-text)',
                                }}
                              >
                                {msg.attachments?.length > 0 && (
                                  <div className="mb-3 flex flex-wrap justify-end gap-2">
                                    {msg.attachments.map((url, i) => (
                                      <div key={i} className="relative group/user-att">
                                        <button
                                          type="button"
                                          onClick={() => setSelectedMedia({ type: "image", url })}
                                          aria-label={`${copy.attachmentPreview} — ${copy.viewFullScreen}`}
                                          className="block rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                                        >
                                          <img
                                            src={url}
                                            alt={copy.attachmentPreview}
                                            className="w-24 h-24 sm:w-32 sm:h-32 rounded-xl object-cover border border-white/20 shadow-md cursor-pointer hover:scale-[1.02] transition-transform"
                                          />
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                <p className="text-sm leading-relaxed font-medium whitespace-pre-wrap">
                                  {msg.content}
                                </p>
                              </div>
                            </div>
                          </div>
                          {userProfile ? (
                            <img
                              src={userProfile}
                              alt={userName}
                              className="w-8 h-8 rounded-full object-cover border flex-shrink-0 border-[var(--border-color)] transition-all duration-500 ease-in-out"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-500 ease-in-out" style={{ background: 'var(--accent)', color: 'var(--accent-text)' }}>
                              <MdPerson className="w-4 h-4" />
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-start max-w-[85%] group/msg">
                        <div className="flex items-center gap-2 mb-1 ml-11">
                          <div className="text-xs font-bold text-[var(--text-primary)]">
                            {agentDetails?.name}
                          </div>
                          {msg.timestamp && (
                            <div className="text-[10px] font-medium text-[var(--text-secondary)]">
                              {formatMessageTime(msg.timestamp)}
                            </div>
                          )}
                        </div>

                        <div className="flex gap-3 items-end w-full">
                          {agentDetails?.icon_url ? (
                            <img
                              src={agentDetails.icon_url}
                              alt={agentDetails.name}
                              className="w-8 h-8 rounded-full object-cover border flex-shrink-0 border-[var(--border-color)] transition-all duration-500 ease-in-out"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-500 ease-in-out" style={{ background: 'var(--accent)', color: 'var(--accent-text)' }}>
                              <RiRobot2Fill className="w-4 h-4" />
                            </div>
                          )}

                          <div className="flex-1 space-y-3">
                            {msg.status?.length > 0 && (
                              <div className="flex flex-wrap gap-2">
                                {msg.status.map((st, i) => (
                                  <div
                                    key={i}
                                    className="flex items-center gap-1.5 text-xs px-3 py-1 rounded-full border"
                                    style={{
                                      background: 'var(--component-bg)',
                                      borderColor: 'var(--border-color)',
                                      color: 'var(--accent)'
                                    }}
                                  >
                                    <MdTerminal className="w-3 h-3" />
                                    <span>{st}</span>
                                  </div>
                                ))}
                              </div>
                            )}

                            {msg.thoughts && (
                              <div className="border rounded-xl p-4 space-y-2 bg-[var(--component-bg)] border-[var(--border-color)]">
                                <div className="flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)]">
                                  <RiRobot2Fill className="w-3.5 h-3.5" />
                                  <span>Thinking process</span>
                                </div>
                                <p className="text-xs leading-relaxed italic text-[var(--text-secondary)]">
                                  {msg.thoughts}
                                </p>
                              </div>
                            )}

                            {(msg.content || (isStreaming && idx === messages.length - 1)) && (
                              <div className="flex items-end gap-2">
                                <div
                                  className="backdrop-blur-sm rounded-2xl rounded-tl-md px-4 py-3 shadow-xl border inline-block"
                                  style={{
                                    background: 'var(--agent-bubble)',
                                    color: 'var(--agent-text)',
                                    borderColor: 'var(--border-color)',
                                  }}
                                >
                                  <div className="prose prose-sm max-w-none" style={{ color: 'var(--agent-text)' }}>
                                    {parseMessageContent(msg.content || " ").map((part, i) => (
                                      <div key={i}>
                                        {part.type === "text" && (
                                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                            {part.content}
                                          </ReactMarkdown>
                                        )}
                                        {part.type !== "text" && renderMedia(part)}
                                      </div>
                                    ))}
                                  </div>
                                  {isStreaming && idx === messages.length - 1 && (
                                    <div className="flex gap-1 mt-2">
                                      <div
                                        className="w-2 h-2 rounded-full animate-bounce"
                                        style={{ background: 'var(--accent)', animationDelay: "0ms" }}
                                      ></div>
                                      <div
                                        className="w-2 h-2 rounded-full animate-bounce"
                                        style={{ background: 'var(--accent)', animationDelay: "150ms" }}
                                      ></div>
                                      <div
                                        className="w-2 h-2 rounded-full animate-bounce"
                                        style={{ background: 'var(--accent)', animationDelay: "300ms" }}
                                      ></div>
                                    </div>
                                  )}
                                </div>
                                <div className="opacity-0 group-hover/msg:opacity-100 transition-opacity">
                                  <CopyButton text={msg.content} />
                                </div>
                              </div>
                            )}

                            {mediaOf(msg).length > 0 && (
                              <div className="flex flex-wrap gap-3">
                                {mediaOf(msg).map((item) => (
                                  <div key={item.url} className="max-w-full">
                                    {renderMedia(item)}
                                  </div>
                                ))}
                              </div>
                            )}

                            {msg.suggestions?.length > 0 && (
                              <div className="flex flex-wrap gap-2">
                                {msg.suggestions.map((sug, i) => (
                                  <button
                                    key={i}
                                    type="button"
                                    onClick={() => {
                                      setInput(sug.prompt);
                                      textareaRef.current?.focus();
                                    }}
                                    className="flex items-center gap-2 text-xs font-medium border px-3 py-2 rounded-lg transition-all hover:opacity-80"
                                    style={{
                                      background: 'var(--component-bg)',
                                      borderColor: 'var(--border-color)',
                                      color: 'var(--text-primary)'
                                    }}
                                  >
                                    <HiLightBulb className="w-3.5 h-3.5 text-yellow-500" />
                                    {sug.label}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <footer className="flex-shrink-0 p-4">
        <div className="max-w-3xl mx-auto">
          {error && (
            <div role="alert" className="mb-3 p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center justify-between gap-3">
              <span className="text-xs text-red-400 font-medium">
                {error}
                {sessionEnded && (
                  <>
                    {" "}
                    <Link href="/studio/agents" className="underline font-semibold text-red-300 hover:text-red-200">
                      {copy.openStudio}
                    </Link>
                  </>
                )}
              </span>
              <button
                type="button"
                onClick={() => setError(null)}
                aria-label={copy.dismiss}
                title={copy.dismiss}
                className="text-red-400 hover:text-red-300 flex-shrink-0"
              >
                <MdClose aria-hidden="true" className="w-4 h-4" />
              </button>
            </div>
          )}
          <form
            onSubmit={handleSendMessage}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`relative border rounded-2xl flex items-end gap-2 p-2 transition-all shadow-inner focus-within:border-[var(--accent)] ${
              isDragging ? "ring-2 ring-[var(--accent)] border-[var(--accent)] bg-[var(--accent)]/5" : ""
            }`}
            style={{
              background: 'var(--input-bg)',
              borderColor: 'var(--border-color)'
            }}
          >
            {isDragging && (
              <div className="absolute inset-0 z-50 flex items-center justify-center bg-[var(--accent)]/10 backdrop-blur-[2px] rounded-2xl pointer-events-none border-2 border-dashed border-[var(--accent)] animate-in fade-in duration-200">
                <div className="flex items-center justify-center gap-2 text-[var(--accent)]">
                  <IoAdd className="w-8 h-8 animate-bounce" />
                  <span className="text-sm font-bold uppercase tracking-wider">Drop image to upload</span>
                </div>
              </div>
            )}
            {attachments.length > 0 && (
              <div className="absolute bottom-full left-0 right-0 mb-2 flex flex-wrap gap-2 animate-in slide-in-from-bottom-2">
                {attachments.map((url, i) => (
                  <div key={i} className="relative group/att">
                    <img
                      src={url}
                      className="w-16 h-16 rounded-xl object-cover border-2 border-[var(--border-color)] shadow-lg"
                      alt={copy.attachmentPreview}
                    />
                    <button
                      onClick={() => removeAttachment(url)}
                      type="button"
                      aria-label={copy.removeAttachment}
                      title={copy.removeAttachment}
                      className="absolute -top-1.5 -right-1.5 p-1 bg-red-500 text-white rounded-full shadow-lg opacity-0 group-hover/att:opacity-100 focus:opacity-100 transition-opacity"
                    >
                      <MdClose aria-hidden="true" className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              className="hidden"
              accept="image/png,image/jpeg,image/webp,image/gif"
              tabIndex={-1}
              aria-hidden="true"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              type="button"
              disabled={isUploading || isStreaming || attachments.length >= 4}
              className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-all bg-[var(--component-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50 shadow-sm relative overflow-hidden"
              title={copy.attachImage}
              aria-label={copy.attachImage}
            >
              {isUploading ? (
                <>
                  <BiLoaderAlt className="w-4 h-4 animate-spin opacity-20" />
                  <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-[var(--accent)]">
                    {uploadProgress}%
                  </span>
                </>
              ) : (
                <IoAdd className="w-5 h-5" />
              )}
            </button>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              disabled={isStreaming}
              aria-label={copy.messageInput}
              placeholder={isStreaming ? "Agent is thinking..." : "Type here or drop an image..."}
              className="flex-1 bg-transparent px-3 py-2.5 text-sm focus:outline-none resize-none max-h-32 placeholder:text-gray-500 custom-scrollbar text-[var(--text-primary)]"
              rows={1}
            />
            <button
              type="submit"
              disabled={!input.trim() || isStreaming || isUploading}
              aria-label={copy.sendMessage}
              title={copy.sendMessage}
              className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
              style={{
                background: 'var(--accent)',
                color: 'var(--accent-text)'
              }}
            >
              {isStreaming ? (
                <BiLoaderAlt className="w-4 h-4 animate-spin" />
              ) : (
                <IoSend className="w-4 h-4" />
              )}
            </button>
          </form>
        </div>
      </footer>
      {selectedMedia && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-sm animate-in fade-in duration-300"
          onClick={() => setSelectedMedia(null)}
        >
          <button
            type="button"
            className="absolute top-6 right-6 p-2 rounded-full bg-white/5 hover:bg-white/10 text-white transition-all border border-white/10 z-[110]"
            onClick={() => setSelectedMedia(null)}
            aria-label={copy.close}
            title={copy.close}
          >
            <MdClose aria-hidden="true" className="w-6 h-6" />
          </button>
          <div
            className="max-w-[90vw] max-h-[90vh] relative animate-in zoom-in-95 duration-300"
            onClick={(e) => e.stopPropagation()}
          >
            {selectedMedia.type === "image" ? (
              <img
                src={selectedMedia.url}
                alt={mediaLabel(selectedMedia.type)}
                className="w-full h-auto max-h-[90vh] object-contain rounded-lg shadow-2xl border border-white/10"
              />
            ) : (
              <video
                src={selectedMedia.url}
                controls
                autoPlay
                className="w-full h-auto max-h-[90vh] rounded-lg shadow-2xl border border-white/10"
              />
            )}
            <div className="flex justify-center">
              <button
                onClick={() =>
                  handleDownloadFile(
                    selectedMedia.url,
                    `${selectedMedia.type}-${Date.now()}.${selectedMedia.type === "image" ? "png" : "mp4"
                    }`
                  )
                }
                type="button"
                className="flex items-center gap-2 px-6 py-2.5 rounded-full bg-blue-600 hover:bg-blue-700 text-white font-medium transition-all shadow-lg shadow-blue-500/20 disabled:opacity-50"
                disabled={downloadingUrl === selectedMedia.url}
              >
                {downloadingUrl === selectedMedia.url ? (
                  <>
                    <BiLoaderAlt aria-hidden="true" className="w-5 h-5 animate-spin" />
                    {copy.preparing}
                  </>
                ) : (
                  <>
                    <MdFileDownload aria-hidden="true" className="w-5 h-5" />
                    {copy.download}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      {showCustomColorPanel && (
        <div className="absolute inset-0 z-[100] flex items-center justify-center p-4">
          <div 
            className="absolute inset-0 bg-black/10 backdrop-blur-sm transition-opacity"
            onClick={() => setShowCustomColorPanel(false)}
          />
          <div className="relative w-full max-w-md bg-[var(--header-bg)] border border-[var(--border-color)] rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)]">
              <div className="flex items-center gap-2">
                <IoColorPalette className="w-5 h-5 text-[var(--accent)]" />
                <h3 className="font-bold text-[var(--text-primary)]">Customize Theme</h3>
              </div>
              <button 
                onClick={() => setShowCustomColorPanel(false)}
                className="p-1 rounded-lg hover:bg-[var(--component-hover)] text-[var(--text-secondary)] transition-colors"
              >
                <MdClose className="w-6 h-6" />
              </button>
            </div>
            
            <div className="p-6 max-h-[70vh] overflow-y-auto custom-scrollbar space-y-4">
              {[
                { label: 'Background', key: 'background' },
                { label: 'Text Primary', key: 'foreground' },
                { label: 'Text Secondary', key: 'muted' },
                { label: 'Border Color', key: 'border' },
                { label: 'Panel Background', key: 'componentBg' },
                { label: 'Header Background', key: 'headerBg' },
                { label: 'User Bubble', key: 'userBubble' },
                { label: 'User Text', key: 'userText' },
                { label: 'Agent Bubble', key: 'agentBubble' },
                { label: 'Agent Text', key: 'agentText' },
                { label: 'Input Background', key: 'inputBg' },
                { label: 'Accent Color', key: 'accent' },
                { label: 'Accent Text', key: 'accentText' },
              ].map((item) => (
                <div key={item.key} className="flex items-center justify-between p-3 rounded-xl border border-[var(--border-color)] bg-[var(--component-bg)]/50">
                  <span className="text-sm font-medium text-[var(--text-primary)]">{item.label}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-mono text-[var(--text-secondary)] uppercase">
                      {currentTheme.colors[item.key]}
                    </span>
                    <input 
                      type="color" 
                      value={currentTheme.colors[item.key]?.startsWith('#') ? currentTheme.colors[item.key] : '#000000'} 
                      onChange={(e) => handleCustomColorChange(item.key, e.target.value)}
                      className="w-10 h-10 rounded-lg cursor-pointer border-none bg-transparent"
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="p-4 bg-[var(--component-bg)]/50 border-t border-[var(--border-color)]">
              <button 
                onClick={() => handleThemeSync(currentTheme)}
                className="w-full py-3 rounded-xl font-bold transition-all shadow-lg active:scale-95"
                style={{ background: 'var(--accent)', color: 'var(--accent-text)' }}
              >
                Apply Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
};

export default ChatPage;
