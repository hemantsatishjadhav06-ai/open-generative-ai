"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import HeroCollage from "./HeroCollage";
import useEscapeKey, { useFocusReturn } from "./prompt/useEscapeKey";
import { uploadFile, generateMarketingStudioAd, getMarketingStudioAdModel } from "../gateway.js";
import { usePersistKey } from "../persistKey.js";
import { isModelAvailable } from "../modelAvailability.js";
import useModelAvailability from "../useModelAvailability.js";
import { formatErrorMessage } from "../utils/formatError.js";
import MobileGenerationActions, {
  GenerationCopyButtons,
} from "./MobileGenerationActions.jsx";
import {
  PROMPT_CONTROL_LABEL_CLASS,
  PromptAspectRatioIcon,
  PromptAction,
  PromptChevronIcon,
  PromptComposer,
  PromptControls,
  PromptFooter,
  PromptMenuItem,
  PromptMenuList,
  PromptPopover,
  PromptPopoverHeader,
  PromptDurationIcon,
  PromptQualityIcon,
  PromptTextarea,
  promptControlClassName,
  promptMediaButtonClassName,
} from "./prompt/PromptComposer.jsx";
import en from "../messages/en/marketingStudio.json";
import zh from "../messages/zh/marketingStudio.json";
import { resolveCopy } from "../i18nUtils";
import { friendlyError, notifyError } from "../utils/notify.js";

const SCROLLBAR_STYLE = `
  .custom-scrollbar-thin::-webkit-scrollbar {
    height: 4px;
  }
  .custom-scrollbar-thin::-webkit-scrollbar-track {
    background: transparent;
  }
  .custom-scrollbar-thin::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.1);
    border-radius: 10px;
  }
  .custom-scrollbar-thin::-webkit-scrollbar-thumb:hover {
    background: rgba(46, 230, 214, 0.3);
  }
`;

// ── Icons ────────────────────────────────────────────────────────────────────

const CheckSvg = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2ee6d6" strokeWidth="4">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const PlusSvg = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const CloseSvg = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const ProductIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 8l-2-2H5L3 8v10a2 2 0 002 2h14a2 2 0 002-2V8z" />
    <path d="M3 10h18" />
    <path d="M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2" />
  </svg>
);

const AvatarIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

const RefIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <polyline points="21 15 16 10 5 21" />
  </svg>
);

// Reference clips longer or heavier than this are rejected by the video model.
const MAX_REFERENCE_VIDEO_BYTES = 50 * 1024 * 1024;
// Bumped when the saved state's shape changed (v2: presets removed, the
// reference video is a user upload).
const PERSIST_VERSION = 2;

const VideoIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="2" y="5" width="14" height="14" rx="2" />
    <path d="M16 10l6-3v10l-6-3z" />
  </svg>
);

const OPTIONS = {
  ratio: ["9:16", "3:4", "4:3", "16:9", "1:1"],
  res: ["720p", "1080p"],
  duration: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
};

// ── Components ───────────────────────────────────────────────────────────────

function UploadSlot({ icon, url, progress, label, title, onUpload, onClear, multiple = false, accept = "image/*", isVideo = false, clearLabel = "Remove" }) {
  const inputRef = useRef(null);
  const [isDraggingSlot, setIsDraggingSlot] = useState(false);
  const dragCounterRef = useRef(0);

  const handleSlotDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    if (e.dataTransfer?.items && e.dataTransfer.items.length > 0) {
      setIsDraggingSlot(true);
    }
  };

  const handleSlotDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDraggingSlot(false);
    }
  };

  const handleSlotDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleSlotDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDraggingSlot(false);
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      onUpload(Array.from(files));
    }
  };

  return (
    <div className="relative group/slot flex items-center">
      <div
        role="button"
        tabIndex={0}
        aria-label={title}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragEnter={handleSlotDragEnter}
        onDragLeave={handleSlotDragLeave}
        onDragOver={handleSlotDragOver}
        onDrop={handleSlotDrop}
        title={title}
        className={promptMediaButtonClassName({
          active: Boolean(url) || isDraggingSlot,
          className: `cursor-pointer${isDraggingSlot ? " ring-2 ring-primary ring-offset-1 ring-offset-black/40" : ""}`,
        })}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="hidden"
          tabIndex={-1}
          multiple={multiple}
          onChange={(e) => {
            onUpload(Array.from(e.target.files));
            e.target.value = "";
          }}
        />

        {progress > 0 && progress < 100 ? (
          <div className="absolute inset-0 bg-black/60 rounded-full flex items-center justify-center z-10">
            <span className="text-[8px] font-black text-primary">{progress}%</span>
          </div>
        ) : url ? (
          <div className="w-full h-full rounded-full overflow-hidden border border-black/20">
            {isVideo ? (
              <video src={url} muted playsInline preload="metadata" className="w-full h-full object-cover" aria-label={label} />
            ) : (
              <img src={url} className="w-full h-full object-cover" alt={label} />
            )}
          </div>
        ) : (
          <div className="text-white/40 group-hover:text-primary transition-colors">
            {icon}
          </div>
        )}

      </div>

      {/* Clear Button (Single): a sibling of the slot, not nested inside it */}
      {url && !multiple && (
        <button
          type="button"
          aria-label={`${clearLabel}: ${label}`}
          onClick={onClear}
          className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover/slot:opacity-100 focus-visible:opacity-100 transition-opacity shadow-lg"
        >
          <CloseSvg />
        </button>
      )}
    </div>
  );
}

function SimpleDropdown({ isOpen, title, options, selected, onSelect, onClose }) {
  const ref = useRef(null);
  
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const onEscapeKey = (e) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("click", handler);
    document.addEventListener("keydown", onEscapeKey);
    return () => {
      window.removeEventListener("click", handler);
      document.removeEventListener("keydown", onEscapeKey);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <PromptPopover
      ref={ref}
    >
      <PromptPopoverHeader>{title}</PromptPopoverHeader>
      <PromptMenuList>
      {options.map(opt => (
        <PromptMenuItem
          key={opt}
          selected={selected === opt}
          onClick={() => { onSelect(opt); onClose(); }}
        >
          {opt}
        </PromptMenuItem>
      ))}
      </PromptMenuList>
    </PromptPopover>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function MarketingStudio({
  apiKey,
  droppedFiles,
  onFilesHandled,
  onGenerationStart,
  onGenerationEnd,
  onGenerationComplete,
  onGenerationError,
  historyItems,
  locale = "en",
}) {
  const copy = resolveCopy(en, zh, locale);
  const PERSIST_KEY = usePersistKey("hg_marketing_studio_persistent");
  const availability = useModelAvailability();

  const [prompt, setPrompt] = useState("");
  const [productImage, setProductImage] = useState(null);
  const [avatarImage, setAvatarImage] = useState(null);
  const [additionalImages, setAdditionalImages] = useState([]);
  
  const [params, setParams] = useState({
    ratio: "9:16",
    videoUrl: null,
    res: "1080p",
    duration: 5
  });
  // Resolutions whose model the gateway can run (720p and 1080p use
  // different reference-video endpoints).
  const resolutionOptions = useMemo(
    () => OPTIONS.res.filter((res) => isModelAvailable(getMarketingStudioAdModel(res))),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute when the model list arrives
    [availability],
  );

  const [localHistory, setLocalHistory] = useState([]);
  const history = historyItems ?? localHistory;
  const [isGenerating, setIsGenerating] = useState(false);
  const [dropdown, setDropdown] = useState(null); // 'format' | 'avatar' | 'ratio' | 'res' | 'duration'
  const [uploadProgress, setUploadProgress] = useState({ product: 0, avatar: 0, additional: 0, video: 0 });
  const [fullscreenUrl, setFullscreenUrl] = useState(null);
  const closeFullscreen = useCallback(() => setFullscreenUrl(null), []);
  useEscapeKey(Boolean(fullscreenUrl), closeFullscreen);
  useFocusReturn(Boolean(fullscreenUrl));

  const textareaRef = useRef(null);

  // ── Persistence ───────────────────────────────────────────────────────────

  // PERSIST_KEY is null until the signed-in workspace is known.
  useEffect(() => {
    if (!PERSIST_KEY) return;
    try {
      const stored = localStorage.getItem(PERSIST_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        // Drafts saved before v2 pointed at hosted preset avatars and format
        // videos that no longer exist; keep everything except those.
        const current = data.v === PERSIST_VERSION;
        if (data.prompt) setPrompt(data.prompt);
        if (data.params) {
          setParams((prev) => ({
            ...prev,
            ratio: OPTIONS.ratio.includes(data.params.ratio) ? data.params.ratio : prev.ratio,
            res: OPTIONS.res.includes(data.params.res) ? data.params.res : prev.res,
            duration: OPTIONS.duration.includes(data.params.duration) ? data.params.duration : prev.duration,
            videoUrl: current && typeof data.params.videoUrl === "string" ? data.params.videoUrl : null,
          }));
        }
        if (data.productImage) setProductImage(data.productImage);
        if (current && data.avatarImage) setAvatarImage(data.avatarImage);
        if (data.additionalImages) setAdditionalImages(data.additionalImages);
        if (data.localHistory) setLocalHistory(data.localHistory);
        else if (data.history) setLocalHistory(data.history);
      }
    } catch (err) { console.warn("Failed to load MarketingStudio persistence:", err); }
  }, [PERSIST_KEY]);

  useEffect(() => {
    if (!PERSIST_KEY) return undefined;
    const timer = setTimeout(() => {
      try {
        const state = { v: PERSIST_VERSION, prompt, params, productImage, avatarImage, additionalImages, localHistory };
        localStorage.setItem(PERSIST_KEY, JSON.stringify(state));
      } catch (err) {
        console.warn("Failed to save MarketingStudio persistence:", err);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [prompt, params, productImage, avatarImage, additionalImages, localHistory, PERSIST_KEY]);

  // Keep the resolution on one the gateway can run.
  useEffect(() => {
    if (resolutionOptions.length > 0 && !resolutionOptions.includes(params.res)) {
      setParams((prev) => ({ ...prev, res: resolutionOptions[resolutionOptions.length - 1] }));
    }
  }, [resolutionOptions, params.res]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const downloadFile = async (url, filename) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch {
      window.open(url, "_blank");
    }
  };

  const handleUpload = async (files, target) => {
    if (!files || !files.length) return;
    
    if (target === 'video') {
      const file = files[0];
      if (!file.type.startsWith("video/")) {
        notifyError(copy.errors.referenceVideoType);
        return;
      }
      if (file.size > MAX_REFERENCE_VIDEO_BYTES) {
        notifyError(copy.errors.referenceVideoTooLarge);
        return;
      }
      try {
        const url = await uploadFile(apiKey, file, (pct) => setUploadProgress(p => ({ ...p, video: pct })));
        setParams((prev) => ({ ...prev, videoUrl: url }));
      } catch (err) { notifyError(friendlyError(err)); }
    } else if (target === 'additional') {
      const remaining = 6 - additionalImages.length;
      const toUpload = files.slice(0, remaining);
      for (const file of toUpload) {
        try {
          const url = await uploadFile(apiKey, file, (pct) => setUploadProgress(p => ({ ...p, additional: pct })));
          setAdditionalImages(prev => [...prev, url].slice(0, 6));
        } catch (err) { notifyError(friendlyError(err)); }
      }
    } else {
      const file = files[0];
      try {
        const url = await uploadFile(apiKey, file, (pct) => setUploadProgress(p => ({ ...p, [target]: pct })));
        if (target === 'product') setProductImage(url);
        else setAvatarImage(url);
      } catch (err) { notifyError(friendlyError(err)); }
    }
    setUploadProgress(p => ({ ...p, [target]: 0 }));
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return notifyError(copy.errors.missingScript);
    if (!productImage) return notifyError(copy.errors.missingProductImage);
    if (!isModelAvailable(getMarketingStudioAdModel(params.res))) return notifyError(copy.errors.modelUnavailable);

    onGenerationStart?.();
    setIsGenerating(true);
    try {
      const result = await generateMarketingStudioAd(apiKey, {
        prompt,
        aspect_ratio: params.ratio,
        duration: params.duration,
        resolution: params.res,
        images_list: [productImage, avatarImage, ...additionalImages].filter(Boolean),
        video_files: params.videoUrl ? [params.videoUrl] : []
      });

      if (result?.url) {
        const entry = {
          id: Date.now(),
          url: result.url,
          prompt,
          format: params.videoUrl ? copy.uploadSlots.referenceVideo : null,
          timestamp: new Date().toISOString()
        };
        if (!historyItems) {
          setLocalHistory(prev => [entry, ...prev]);
        }
        setFullscreenUrl(result.url);
        onGenerationComplete?.({ url: result.url, type: "video" });
      }
    } catch (err) {
      const message = formatErrorMessage(err, copy.errors.generationFailed);
      if (onGenerationError) onGenerationError(message);
      else notifyError(message);
    } finally {
      setIsGenerating(false);
      onGenerationEnd?.();
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-app-bg relative overflow-hidden">
      <style>{SCROLLBAR_STYLE}</style>
      
      {/* ── MAIN CONTENT AREA ── */}
      <div className="flex-1 w-full max-w-7xl mx-auto overflow-y-auto custom-scrollbar pb-40 lg:pb-32 px-2">
        {history.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full pt-4 animate-fade-in-up">
            {history.map(entry => (
              <div
                key={entry.id}
                onClick={() => setFullscreenUrl(entry.url)}
                className="relative group rounded-lg overflow-hidden border border-white/10 bg-[#0a1422] shadow-xl hover:border-primary/50 transition-all duration-300 flex flex-col cursor-pointer"
              >
                <video 
                  src={entry.url} 
                  className="w-full aspect-video object-cover hover:opacity-80 transition-opacity" 
                  muted loop onMouseOver={e => e.target.play()} onMouseOut={e => { e.target.pause(); e.target.currentTime = 0; }}
                />
                
                {/* Actions Overlay */}
                <div className="absolute top-2 right-2 hidden md:flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <GenerationCopyButtons
                    prompt={entry.prompt}
                    onCopyError={onGenerationError}
                  />
                   <button
                    onClick={(e) => { e.stopPropagation(); downloadFile(entry.url, `marketing-ad-${entry.id}.mp4`); }}
                    className="p-2 bg-black/60 backdrop-blur-md rounded-full text-white hover:bg-primary hover:text-on-brand transition-all border border-white/10"
                    title={copy.buttons.download}
                   >
                     <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                       <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
                     </svg>
                   </button>
                   <button
                    type="button"
                    title={copy.buttons.delete}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(copy.confirm.deleteItem)) {
                        if (!historyItems) {
                          setLocalHistory(prev => prev.filter(h => h.id !== entry.id));
                        }
                      }
                    }}
                    className="p-2 bg-black/60 backdrop-blur-md rounded-full text-red-400 hover:bg-red-500 hover:text-white transition-all border border-white/10"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                      <line x1="10" y1="11" x2="10" y2="17" />
                      <line x1="14" y1="11" x2="14" y2="17" />
                    </svg>
                   </button>
                </div>
                <MobileGenerationActions
                  prompt={entry.prompt}
                  onCopyError={onGenerationError}
                  actions={[
                    {
                      kind: "download",
                      label: copy.buttons.download,
                      onSelect: () =>
                        downloadFile(entry.url, `marketing-ad-${entry.id}.mp4`),
                    },
                    {
                      kind: "delete",
                      label: copy.buttons.delete,
                      danger: true,
                      onSelect: () => {
                        if (confirm(copy.confirm.deleteItem)) {
                          if (!historyItems) {
                            setLocalHistory((prev) =>
                              prev.filter((item) => item.id !== entry.id),
                            );
                          }
                        }
                      },
                    },
                  ]}
                />

                <div className="p-3 bg-black/80 backdrop-blur-sm border-t border-white/5 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] font-black text-primary px-2 py-0.5 bg-primary/10 rounded border border-primary/20 uppercase tracking-tighter">
                      {copy.history.badge}
                    </span>
                    {entry.format && (
                      <span className="text-[9px] text-white/40 font-bold">{entry.format}</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full animate-fade-in-up transition-all duration-700 min-h-[50vh]">
            {/* Overlapping floating cards */}
            <HeroCollage />

            <h1 className="text-2xl sm:text-4xl md:text-5xl font-extrabold tracking-tight mb-4 text-center px-4 flex flex-col items-center">
              <span className="text-white font-black uppercase text-xl sm:text-3xl tracking-wide mb-1 opacity-90">{copy.empty.titleLine1}</span>
              <span className="text-brand font-black uppercase text-2xl sm:text-4xl sm:mt-1 tracking-tight">
                {copy.empty.titleLine2}
              </span>
            </h1>
            <p className="text-white/65 text-xs sm:text-sm font-medium tracking-wide text-center max-w-lg leading-relaxed px-4">
              {copy.empty.subtitle}
            </p>
          </div>
        )}
      </div>

      {/* ── BOTTOM PROMPT BAR ── */}
      <PromptComposer>
          {additionalImages.length > 0 && (
            <div className="flex items-center gap-1.5">
              {additionalImages.map((img, idx) => (
                <div key={idx} className="relative group/img flex-shrink-0">
                  <img src={img} alt={`${copy.uploadSlots.references} ${idx + 1}`} className="w-9 h-9 rounded-full object-cover border border-white/10" />
                  <button
                    type="button"
                    aria-label={`${copy.buttons.remove}: ${copy.uploadSlots.references} ${idx + 1}`}
                    onClick={() => setAdditionalImages(prev => prev.filter((_, i) => i !== idx))}
                    className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-black/80 text-white rounded-full flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-opacity border border-white/10"
                  >
                    <CloseSvg />
                  </button>
                </div>
              ))}
            </div>
          )}
          {/* Top Row: Full-width Textarea */}
          <div className="w-full relative">
            <PromptTextarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={copy.prompt.placeholder}
            />
          </div>

          {/* Bottom Row: Uploads + Controls + Generate */}
          <PromptFooter>
            <PromptControls>
              
              {/* Asset Uploads Group */}
              <div className="flex items-center gap-1.5 pr-3 border-r border-white/10">
                <UploadSlot
                  label={copy.uploadSlots.product}
                  title={`${copy.uploadSlots.uploadPrefix} ${copy.uploadSlots.product}`}
                  icon={<ProductIcon />}
                  url={productImage}
                  progress={uploadProgress.product}
                  clearLabel={copy.buttons.remove}
                  onUpload={(files) => handleUpload(files, 'product')}
                  onClear={() => setProductImage(null)}
                />
                <UploadSlot
                  label={copy.uploadSlots.avatar}
                  title={`${copy.uploadSlots.uploadPrefix} ${copy.uploadSlots.avatar}`}
                  icon={<AvatarIcon />}
                  url={avatarImage}
                  progress={uploadProgress.avatar}
                  clearLabel={copy.buttons.remove}
                  onUpload={(files) => handleUpload(files, 'avatar')}
                  onClear={() => setAvatarImage(null)}
                />
                <UploadSlot
                  label={copy.uploadSlots.referenceVideo}
                  title={copy.uploadSlots.referenceVideoHint}
                  icon={<VideoIcon />}
                  url={params.videoUrl}
                  progress={uploadProgress.video}
                  accept="video/*"
                  isVideo
                  clearLabel={copy.buttons.remove}
                  onUpload={(files) => handleUpload(files, 'video')}
                  onClear={() => setParams((prev) => ({ ...prev, videoUrl: null }))}
                />
                <UploadSlot
                  label={copy.uploadSlots.references}
                  title={`${copy.uploadSlots.uploadPrefix} ${copy.uploadSlots.references}`}
                  icon={<RefIcon />}
                  url={additionalImages[0]}
                  progress={uploadProgress.additional}
                  multiple
                  clearLabel={copy.buttons.remove}
                  onUpload={(files) => handleUpload(files, 'additional')}
                  onClear={(idx) => {
                    if (idx !== undefined) {
                      setAdditionalImages(prev => prev.filter((_, i) => i !== idx));
                    } else {
                      setAdditionalImages([]);
                    }
                  }} 
                />
              </div>

              {/* Simple Controls */}
              {['ratio', 'res', 'duration'].map(key => (
                <div key={key} className="relative">
                  <button
                    onClick={(e) => { e.stopPropagation(); setDropdown(dropdown === key ? null : key); }}
                    className={promptControlClassName({
                      active: dropdown === key,
                      className:
                        dropdown === key
                          ? "text-xs font-semibold text-brand"
                          : "text-xs font-semibold text-white/70",
                    })}
                  >
                    {key === "ratio" ? (
                      <PromptAspectRatioIcon />
                    ) : key === "res" ? (
                      <PromptQualityIcon />
                    ) : (
                      <PromptDurationIcon />
                    )}
                    <span className={PROMPT_CONTROL_LABEL_CLASS}>
                      {key === "duration" ? `${params[key]}s` : params[key]}
                    </span>
                  </button>
                  <SimpleDropdown 
                    isOpen={dropdown === key} 
                    title={
                      key === "ratio"
                        ? copy.dropdowns.aspectRatio
                        : key === "res"
                          ? copy.dropdowns.resolution
                          : copy.dropdowns.duration
                    }
                    options={key === "res" ? resolutionOptions : OPTIONS[key]}
                    selected={params[key]} 
                    onSelect={(val) => setParams({ ...params, [key]: val })} 
                    onClose={() => setDropdown(null)} 
                  />
                </div>
              ))}
            </PromptControls>

            <PromptAction
              onClick={handleGenerate}
              disabled={isGenerating}
            >
              {isGenerating ? (
                <>
                  <span className="animate-spin inline-block text-black">◌</span>
                  {copy.buttons.generating}
                </>
              ) : (
                <span>{copy.buttons.launch}</span>
              )}
            </PromptAction>
          </PromptFooter>
      </PromptComposer>

      {/* Fullscreen Preview */}
      {fullscreenUrl && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-sm animate-fade-in" onClick={() => setFullscreenUrl(null)}>
          <button aria-label={copy?.fullscreen?.close || "Close"} className="absolute top-6 right-6 p-3 bg-white/10 hover:bg-white/20 rounded-full text-white border border-white/10 transition-colors shadow-2xl"><CloseSvg /></button>
          <video src={fullscreenUrl} controls autoPlay className="max-w-[95vw] max-h-[95vh] rounded-lg shadow-4xl animate-scale-up" onClick={e => e.stopPropagation()} />
        </div>
      )}

    </div>
  );
}
