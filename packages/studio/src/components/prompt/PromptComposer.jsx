"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";

const DEFAULT_POSITION_CLASS =
  "absolute bottom-4 w-full max-w-[95%] lg:max-w-4xl z-30 animate-fade-in-up";

const DEFAULT_PANEL_CLASS =
  "w-full bg-gradient-to-b from-surface-card/90 via-surface-app/90 to-surface-panel/95 backdrop-blur-2xl rounded-[2rem] border border-white/[0.08] p-4 flex flex-col gap-3 shadow-[0_15px_50px_rgba(0,0,0,0.8)]";

const DEFAULT_TEXTAREA_CLASS =
  "w-full bg-transparent border-none text-white text-sm placeholder:text-white/20 focus:outline-none resize-none pt-1 leading-relaxed min-h-[40px] max-h-[150px] md:max-h-[250px] overflow-y-auto custom-scrollbar disabled:opacity-40";

const DEFAULT_ACTION_CLASS =
  "bg-brand text-on-brand px-7 py-3 rounded-full font-bold text-sm hover:opacity-95 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 w-full sm:w-auto shadow-lg shadow-brand/20 hover:shadow-brand/35 border border-brand/10 z-10 disabled:opacity-50 disabled:cursor-not-allowed";

const CONTROL_LAYOUT_CLASS =
  "h-[38px] flex items-center gap-2 rounded-md transition-all border group whitespace-nowrap shadow-inner focus:outline-none focus-visible:border-brand/45 focus-visible:ring-1 focus-visible:ring-brand/30";

const CONTROL_IDLE_CLASS =
  "text-white bg-surface-panel/60 hover:bg-surface-raised/80 border-white/[0.06]";

const CONTROL_ACTIVE_CLASS =
  "text-brand bg-brand/10 hover:bg-brand/15 border-brand/25";

const MEDIA_CONTROL_LAYOUT_CLASS =
  "w-10 h-10 shrink-0 rounded-full border transition-all flex items-center justify-center relative overflow-hidden group focus:outline-none focus-visible:border-brand/45 focus-visible:ring-1 focus-visible:ring-brand/30";

const DEFAULT_POPOVER_POSITION_CLASS =
  "absolute bottom-[calc(100%+12px)] left-0 z-50";

const DEFAULT_POPOVER_CLASS =
  "rounded-xl p-3.5 shadow-[0_10px_40px_rgba(0,0,0,0.8)] border border-white/[0.08] backdrop-blur-2xl min-w-[160px] max-h-[40vh] overflow-y-auto custom-scrollbar";

function joinClasses(...classes) {
  return classes.filter(Boolean).join(" ");
}

export function promptControlClassName({
  active = false,
  compact = false,
  iconOnly = false,
  className = "",
} = {}) {
  return joinClasses(
    CONTROL_LAYOUT_CLASS,
    iconOnly
      ? "w-[38px] px-0 justify-center"
      : compact
        ? "px-3"
        : "px-4",
    active ? CONTROL_ACTIVE_CLASS : CONTROL_IDLE_CLASS,
    className,
  );
}

export function promptMediaButtonClassName({
  active = false,
  className = "",
} = {}) {
  return joinClasses(
    MEDIA_CONTROL_LAYOUT_CLASS,
    active
      ? "border-brand/60 bg-brand/5 hover:border-brand/70"
      : "border-white/[0.03] bg-white/[0.03] hover:bg-white/[0.06] hover:border-brand/40",
    className,
  );
}

export const PROMPT_MEDIA_PREVIEW_CLASS =
  "relative w-10 h-10 shrink-0 rounded-full border border-white/10 overflow-hidden shadow-md group";

export const PROMPT_CONTROL_LABEL_CLASS =
  "text-xs font-semibold text-current opacity-70 group-hover:text-brand group-hover:opacity-100 transition-all";

export function PromptChevronIcon({ className = "" }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={joinClasses(
        "text-current opacity-[0.45] group-hover:opacity-100 flex-shrink-0 transition-opacity",
        className,
      )}
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function PromptAspectRatioIcon({ className = "" }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={joinClasses("text-current opacity-[0.45] flex-shrink-0", className)}
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
    </svg>
  );
}

export function PromptDurationIcon({ className = "" }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={joinClasses("text-current opacity-[0.45] flex-shrink-0", className)}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export function PromptQualityIcon({ className = "" }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={joinClasses("text-current opacity-70 flex-shrink-0", className)}
      aria-hidden="true"
    >
      <path d="M6.5 3.5h11L22 9 12 21 2 9l4.5-5.5Z" />
      <path d="M2 9h20" />
      <path d="m6.5 3.5 3 5.5L12 21" />
      <path d="m17.5 3.5-3 5.5L12 21" />
    </svg>
  );
}

export const PromptPopover = forwardRef(function PromptPopover(
  {
    children,
    className = "",
    positionClassName = DEFAULT_POPOVER_POSITION_CLASS,
    fitViewport = false,
    solid = false,
    ...props
  },
  ref,
) {
  const popoverRef = useRef(null);
  useImperativeHandle(ref, () => popoverRef.current);
  useLayoutEffect(() => {
    if (!fitViewport) return;
    const position = () => {
      const popover = popoverRef.current;
      popover.style.translate = "";
      popover.style.height = "";
      let left = 16;
      let right = window.innerWidth - 16;
      let top = 16;
      for (let parent = popover.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        const clipsX = /auto|scroll|hidden|clip/.test(style.overflowX);
        const clipsY = /auto|scroll|hidden|clip/.test(style.overflowY);
        if (!clipsX && !clipsY) continue;
        const bounds = parent.getBoundingClientRect();
        if (clipsX) {
          left = Math.max(left, bounds.left + 16);
          right = Math.min(right, bounds.right - 16);
        }
        if (clipsY) top = Math.max(top, bounds.top + 16);
      }
      const bounds = popover.getBoundingClientRect();
      const shift = Math.max(left - bounds.left, Math.min(0, right - bounds.right));
      popover.style.translate = `${shift}px 0`;
      if (bounds.top < top) popover.style.height = `${Math.max(0, bounds.bottom - top)}px`;
    };
    position();
    const popover = popoverRef.current;
    popover.addEventListener("toggle", position, true);
    window.addEventListener("resize", position);
    return () => {
      popover.removeEventListener("toggle", position, true);
      window.removeEventListener("resize", position);
    };
  }, [fitViewport, children]);
  return (
    <div
      {...props}
      ref={popoverRef}
      className={joinClasses(
        positionClassName,
        DEFAULT_POPOVER_CLASS,
        solid ? "bg-surface-panel" : "bg-surface-panel/[0.98]",
        className,
      )}
    >
      {children}
    </div>
  );
});

export function PromptPopoverHeader({ children, className = "" }) {
  return (
    <div
      className={joinClasses(
        "text-[11px] font-semibold text-white/30 uppercase tracking-wider pb-2 border-b border-white/[0.05] mb-2 px-1",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PromptMenuList({ children, className = "" }) {
  return (
    <div role="menu" className={joinClasses("flex flex-col gap-1", className)}>
      {children}
    </div>
  );
}

export function PromptMenuItem({
  children,
  description,
  wrapDescription = false,
  selected = false,
  className = "",
  type = "button",
  ...props
}) {
  return (
    <button
      {...props}
      type={type}
      aria-checked={selected}
      role="menuitemradio"
      className={joinClasses(
        "w-full min-h-10 flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl text-left cursor-pointer transition-all group/menu-item",
        "text-xs font-semibold text-white/70 hover:bg-brand/10 hover:text-brand focus:outline-none focus-visible:bg-brand/10 focus-visible:text-brand",
        className,
      )}
    >
      <span className="min-w-0">
        <span className="block truncate">{children}</span>
        {description && (
          <span className={joinClasses(
            "block font-medium mt-0.5",
            wrapDescription
              ? "text-[10px] leading-relaxed whitespace-normal text-white/55 group-hover/menu-item:text-white/70"
              : "text-[9px] text-white/35 truncate group-hover/menu-item:text-white/50",
          )}>
            {description}
          </span>
        )}
      </span>
      {selected && (
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#2ee6d6"
          strokeWidth="4.5"
          className="flex-shrink-0"
          aria-hidden="true"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
    </button>
  );
}

export function PromptSegmentedControl({ children, className = "" }) {
  return (
    <div
      className={joinClasses(
        "inline-flex items-center gap-1 bg-white/[0.03] border border-white/[0.05] rounded-full p-0.5",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PromptSegmentOption({
  children,
  selected = false,
  className = "",
  type = "button",
  ...props
}) {
  return (
    <button
      {...props}
      type={type}
      aria-pressed={selected}
      className={joinClasses(
        "min-h-7 px-3 py-1 rounded-full text-xs font-semibold transition-all flex items-center justify-center gap-1.5",
        "focus:outline-none focus-visible:ring-1 focus-visible:ring-brand/40",
        selected
          ? "bg-brand text-on-brand shadow-md shadow-brand/20"
          : "text-white/40 hover:text-white/70",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function PromptComposer({
  children,
  className = "",
  panelClassName = "",
  positionClassName = DEFAULT_POSITION_CLASS,
  style = { animationDelay: "0.2s" },
}) {
  return (
    <div className={joinClasses(positionClassName, className)} style={style}>
      <div className={joinClasses(DEFAULT_PANEL_CLASS, panelClassName)} data-prompt-composer="">
        {children}
      </div>
    </div>
  );
}

export const PromptTextarea = forwardRef(function PromptTextarea(
  {
    value,
    onChange,
    onInput,
    onKeyDown,
    className = "",
    maxHeightMobile = 150,
    maxHeightDesktop = 250,
    rows = 1,
    ...props
  },
  forwardedRef,
) {
  const internalRef = useRef(null);

  useImperativeHandle(forwardedRef, () => internalRef.current);

  const resize = useCallback(
    (element = internalRef.current) => {
      if (!element) return;

      element.style.height = "auto";
      const maxHeight =
        window.innerWidth < 768 ? maxHeightMobile : maxHeightDesktop;
      element.style.height = `${Math.min(element.scrollHeight, maxHeight)}px`;
    },
    [maxHeightDesktop, maxHeightMobile],
  );

  useEffect(() => {
    resize();
  }, [resize, value]);

  const handleChange = (event) => {
    onChange?.(event);
    resize(event.currentTarget);
  };

  const handleInput = (event) => {
    onInput?.(event);
    resize(event.currentTarget);
  };

  // Ctrl/Cmd+Enter runs the composer's primary action (Generate). Plain Enter
  // still inserts a newline.
  const handleKeyDown = (event) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      const button = event.currentTarget
        .closest("[data-prompt-composer]")
        ?.querySelector("[data-prompt-action]");
      if (button && !button.disabled) button.click();
    }
  };

  return (
    <textarea
      {...props}
      ref={internalRef}
      value={value}
      onChange={handleChange}
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      rows={rows}
      className={joinClasses(DEFAULT_TEXTAREA_CLASS, className)}
    />
  );
});

export function PromptFooter({ children, className = "" }) {
  return (
    <div
      className={joinClasses(
        "flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 pt-3 border-t border-white/[0.03] relative",
        className,
      )}
    >
      {children}
    </div>
  );
}

export const PromptControls = forwardRef(function PromptControls(
  { children, className = "" },
  ref,
) {
  return (
    <div
      ref={ref}
      className={joinClasses(
        "flex items-center gap-2 relative flex-wrap pb-1 md:pb-0",
        className,
      )}
    >
      {children}
    </div>
  );
});

export const PromptAction = forwardRef(function PromptAction(
  { children, className = "", type = "button", ...props },
  ref,
) {
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      data-prompt-action=""
      className={joinClasses(DEFAULT_ACTION_CLASS, className)}
    >
      {children}
    </button>
  );
});
