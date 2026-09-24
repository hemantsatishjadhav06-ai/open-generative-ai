'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import axios from 'axios';
// Only light-weight subpath imports from 'studio' here: importing the barrel
// would statically pull every studio (and the model catalog) into first paint.
import { getUserBalance } from 'studio/balance';
import { formatErrorMessage } from 'studio/formatError';
import { STUDIO_NOTIFY_EVENT } from 'studio/notify';
import useEscapeKey from 'studio/useEscapeKey';
import ApiKeyModal from './ApiKeyModal';
import { getCommonCopy, getLocaleConfig, localizeStudioPath } from '@/lib/locales';
// Tab/category ids, icons, and English `label` fallbacks are stable
// identifiers, not locale copy — the actual rendered label is resolved
// per-locale from `copy.tabs`/`copy.categories` via tabLabel()/categoryLabel()
// inside the component below, with these English strings as the fallback
// when a locale bundle is missing the key.
import { TABS, STUDIO_TAB_IDS } from '@/lib/studios';
import { classifyBalanceError } from '@/lib/apiKeyStatus';
import { track, installAnalytics } from '@/lib/analytics';

const StudioLoading = () => (
  <div className="h-full w-full bg-surface-app flex items-center justify-center">
    <div className="animate-spin text-brand text-3xl" aria-label="Loading">◌</div>
  </div>
);

// Each studio is its own async chunk and only mounts once its tab is opened.
const ImageStudio = dynamic(() => import('studio/ImageStudio'), { ssr: false, loading: StudioLoading });
const VideoStudio = dynamic(() => import('studio/VideoStudio'), { ssr: false, loading: StudioLoading });
const ClippingStudio = dynamic(() => import('studio/ClippingStudio'), { ssr: false, loading: StudioLoading });
const MotionControlStudio = dynamic(() => import('studio/MotionControlStudio'), { ssr: false, loading: StudioLoading });
const VibeMotionStudio = dynamic(() => import('studio/VibeMotionStudio'), { ssr: false, loading: StudioLoading });
const LipSyncStudio = dynamic(() => import('studio/LipSyncStudio'), { ssr: false, loading: StudioLoading });
const RecastStudio = dynamic(() => import('studio/RecastStudio'), { ssr: false, loading: StudioLoading });
const CinemaStudio = dynamic(() => import('studio/CinemaStudio'), { ssr: false, loading: StudioLoading });
const AudioStudio = dynamic(() => import('studio/AudioStudio'), { ssr: false, loading: StudioLoading });
const MarketingStudio = dynamic(() => import('studio/MarketingStudio'), { ssr: false, loading: StudioLoading });
const WorkflowStudio = dynamic(() => import('studio/WorkflowStudio'), { ssr: false, loading: StudioLoading });
const AgentStudio = dynamic(() => import('studio/AgentStudio'), { ssr: false, loading: StudioLoading });
const AppsStudio = dynamic(() => import('studio/AppsStudio'), { ssr: false, loading: StudioLoading });
const AiInfluencerStudio = dynamic(() => import('studio/AiInfluencerStudio'), { ssr: false, loading: StudioLoading });
const LayersStudio = dynamic(() => import('studio/LayersStudio'), { ssr: false, loading: StudioLoading });
const DesignAgentStudio = dynamic(() => import('studio/DesignAgentStudio'), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-surface-app flex items-center justify-center text-secondary">Loading design studio…</div>
});

const SPARK_PATH = 'M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z';

// Reelty is a separate app embedded in the Reelty tab. NEXT_PUBLIC_* is
// inlined at build time (middleware.js derives the CSP frame-src from the
// same variable, so the two stay consistent).
const REELTY_URL = process.env.NEXT_PUBLIC_REELTY_URL || 'https://web-production-0e433.up.railway.app';
const REELTY_OPEN_URL = (() => {
  try {
    const u = new URL(REELTY_URL);
    u.searchParams.set('utm_source', 'aquora');
    u.searchParams.set('utm_medium', 'embed');
    return u.toString();
  } catch {
    return REELTY_URL;
  }
})();

const NAVIGATION_CATEGORIES = [
  {
    id: 'images',
    label: 'Images',
    tabIds: ['image', 'layers', 'cinema', 'design-agent', 'ai-influencer'],
    icon: (
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <circle cx="8.5" cy="8.5" r="1.5"/>
        <path d="M21 15l-5-5L5 21"/>
      </svg>
    )
  },
  {
    id: 'video',
    label: 'Video',
    tabIds: ['video', 'clipping', 'motion-control', 'vibe-motion', 'lipsync', 'body-swap', 'marketing'],
    icon: (
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="4" width="15" height="16" rx="2"/>
        <path d="M17 9l5-3v12l-5-3"/>
        <path d="M8 9l4 3-4 3z"/>
      </svg>
    )
  },
  {
    id: 'audio',
    label: 'Audio',
    tabIds: ['audio'],
    icon: (
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 18V5l12-2v13"/>
        <circle cx="6" cy="18" r="3"/>
        <circle cx="18" cy="16" r="3"/>
      </svg>
    )
  },
  {
    id: 'agents-automation',
    label: 'Agents & Automation',
    tabIds: ['agents', 'workflows'],
    icon: (
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="6" height="6" rx="1"/>
        <rect x="15" y="3" width="6" height="6" rx="1"/>
        <rect x="9" y="15" width="6" height="6" rx="1"/>
        <path d="M6 9v2a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V9"/>
        <path d="M12 13v2"/>
      </svg>
    )
  },
  {
    id: 'reelty',
    label: 'Reelty',
    tabIds: ['reelty'],
    icon: (
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 13V5.5L8 2l5 3.5V13"/>
        <path d="M16 8l5 3-5 3z"/>
        <rect x="3" y="16" width="18" height="5" rx="1"/>
      </svg>
    )
  }
];

const EXPLORE_APPS_TAB = TABS.find((tab) => tab.id === 'apps');

const getNavigationCategory = (tabId) => (
  NAVIGATION_CATEGORIES.find((category) => category.tabIds.includes(tabId))
);

const STORAGE_KEY = 'muapi_key';
const NOTIFICATIONS_STORAGE_KEY = 'aquora_notifications_v1';
// Pre-rebrand key: still read (once) so notifications survive the rename.
const LEGACY_NOTIFICATIONS_STORAGE_KEY = 'creator_agency_notifications_v1';
const MAX_VISIBLE_NOTIFICATIONS = 3;

// The key cookie is real server-side auth for the /agents/* SSR pages, so
// mark it Secure whenever the app is served over https.
const cookieSecureSuffix = () =>
  (typeof window !== 'undefined' && window.location.protocol === 'https:') ? '; Secure' : '';

// Errors are sticky (expiresAt null) until dismissed; everything else times out.
const isLiveNotification = (notification, now) =>
  notification.expiresAt == null || notification.expiresAt > now;

const loadStoredNotifications = () => {
  if (typeof window === 'undefined') return [];

  try {
    const raw = window.sessionStorage.getItem(NOTIFICATIONS_STORAGE_KEY)
      ?? window.sessionStorage.getItem(LEGACY_NOTIFICATIONS_STORAGE_KEY);
    window.sessionStorage.removeItem(LEGACY_NOTIFICATIONS_STORAGE_KEY);
    const stored = JSON.parse(raw || '[]');
    const now = Date.now();
    return Array.isArray(stored)
      ? stored.filter((notification) => isLiveNotification(notification, now)).slice(0, MAX_VISIBLE_NOTIFICATIONS)
      : [];
  } catch {
    return [];
  }
};

const persistNotifications = (notifications) => {
  if (typeof window === 'undefined') return;

  try {
    window.sessionStorage.setItem(
      NOTIFICATIONS_STORAGE_KEY,
      JSON.stringify(notifications),
    );
  } catch {
    // Notification persistence is optional; rendering still works without storage.
  }
};

function BrandMark({ size = 'md' }) {
  const box = size === 'sm' ? 'w-6 h-6 rounded-lg' : 'w-8 h-8 rounded-xl shadow-glow';
  const icon = size === 'sm' ? 13 : 18;
  return (
    <div className={`${box} bg-brand-gradient flex items-center justify-center flex-shrink-0`} aria-hidden="true">
      <svg width={icon} height={icon} viewBox="0 0 24 24" focusable="false">
        <path d={SPARK_PATH} className="fill-on-brand" />
      </svg>
    </div>
  );
}

export default function StandaloneShell({ locale = 'en' }) {
  const params = useParams();
  const slugParam = params?.slug;
  const slug = useMemo(() => slugParam || [], [slugParam]);
  const idFromParams = params?.id;
  const tabFromParams = params?.tab;

  const copy = getCommonCopy(locale);
  const tabLabel = useCallback(
    (tabId) => copy.tabs?.[tabId] || TABS.find((t) => t.id === tabId)?.label || tabId,
    [copy],
  );
  const categoryLabel = useCallback(
    (categoryId) => copy.categories?.[categoryId] || NAVIGATION_CATEGORIES.find((c) => c.id === categoryId)?.label || categoryId,
    [copy],
  );
  const studioPath = useCallback((tabId) => localizeStudioPath(locale, tabId), [locale]);

  // Language toggle target: same tab, other locale. Only on /studio routes
  // (the /workflow/[id] routes have no /zh mirror).
  const otherLocale = locale === 'zh' ? 'en' : 'zh';
  const otherLocaleConfig = getLocaleConfig(otherLocale);
  const showLanguageToggle = !idFromParams && !tabFromParams;

  // Helper to extract workflow details precisely from either route structure
  const getWorkflowInfo = useCallback(() => {
    if (idFromParams) {
        return { id: idFromParams, tab: tabFromParams || null };
    }
    const wfIndex = slug.findIndex(s => s === 'workflows' || s === 'workflow');
    if (wfIndex === -1) return { id: null, tab: null };
    return {
      id: slug[wfIndex + 1] || null,
      tab: slug[wfIndex + 2] || null
    };
  }, [slug, idFromParams, tabFromParams]);

  const { id: urlWorkflowId } = getWorkflowInfo();

  // Initialize activeTab from URL slug/params or default to 'image'
  const getInitialTab = () => {
    if (idFromParams || slug.includes('workflow')) return 'workflows';
    if (slug.includes('agents')) return 'agents';
    if (slug.includes('design-agent')) return 'design-agent';
    if (slug.includes('apps')) return 'apps';
    const firstSegment = slug[0];
    if (firstSegment && STUDIO_TAB_IDS.includes(firstSegment)) return firstSegment;
    return 'image';
  };

  const [apiKey, setApiKey] = useState(null);
  const [activeTab, setActiveTab] = useState(getInitialTab());
  // Studios mount on first visit and then stay mounted (state survives tab
  // switches) — nothing loads for tabs the user never opens.
  const [visitedTabs, setVisitedTabs] = useState(() => new Set([getInitialTab()]));
  useEffect(() => {
    setVisitedTabs((prev) => (prev.has(activeTab) ? prev : new Set(prev).add(activeTab)));
  }, [activeTab]);
  const shouldMount = (id) => activeTab === id || visitedTabs.has(id);

  const [balance, setBalance] = useState(null);
  // 'loading' | 'ok' | 'error' | 'unauthorized'
  const [balanceState, setBalanceState] = useState('loading');
  // null | { message } — shown as an overlay key prompt when MuAPI rejects the key.
  const [authPrompt, setAuthPrompt] = useState(null);
  const authPromptDismissedRef = useRef(false);
  const revalidatingRef = useRef(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isHeaderVisible, setIsHeaderVisible] = useState(true);
  const [hasMounted, setHasMounted] = useState(false);

  // Reelty embed: loading/slow states for the skeleton over the iframe.
  const [reeltyLoaded, setReeltyLoaded] = useState(false);
  const [reeltySlow, setReeltySlow] = useState(false);
  const reeltyMounted = shouldMount('reelty');

  // Sidebar Collapsed & Mobile Drawer State. The stored preference is read in
  // the mount effect below (not during render) so SSR and first paint agree.
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [expandedCategoryId, setExpandedCategoryId] = useState(() => (
    getNavigationCategory(getInitialTab())?.id || NAVIGATION_CATEGORIES[0].id
  ));
  const activeCategory = getNavigationCategory(activeTab);

  const toggleSidebar = useCallback(() => {
    setIsSidebarCollapsed(prev => {
      const next = !prev;
      try {
        localStorage.setItem('sidebar_collapsed', next ? 'true' : 'false');
      } catch {
        // storage can be unavailable (private mode); the toggle still works
      }
      return next;
    });
  }, []);

  const handleCategoryToggle = useCallback((categoryId) => {
    const isCollapsedNavigation = isSidebarCollapsed && !isMobileOpen;

    if (!isCollapsedNavigation) {
      setExpandedCategoryId((currentId) => (
        currentId === categoryId ? null : categoryId
      ));
      return;
    }

    setExpandedCategoryId(categoryId);
    toggleSidebar();
  }, [isMobileOpen, isSidebarCollapsed, toggleSidebar]);

  useEffect(() => {
    if (activeCategory?.id) {
      setExpandedCategoryId(activeCategory.id);
    }
  }, [activeCategory?.id]);

  // Drag and Drop State
  const [isDragging, setIsDragging] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState(null);

  // Global generation notifications remain mounted while users switch studios.
  const [notifications, setNotifications] = useState([]);
  const [notificationsHydrated, setNotificationsHydrated] = useState(false);
  const [generationCounts, setGenerationCounts] = useState({});
  // Start timestamps per tab, for generation duration analytics.
  const generationStartedAt = useRef({});

  useEffect(() => {
    setNotifications(loadStoredNotifications());
    setNotificationsHydrated(true);
  }, []);

  const pushNotification = useCallback((notif) => {
    const now = Date.now();
    const id = `notif-${Date.now()}-${Math.random()}`;
    // Generation failures stay until dismissed; studio notices (validation
    // hints, upload errors) and successes time out.
    const ttl = notif.source === 'studio' ? 8000 : 12000;
    const sticky = notif.type === 'error' && notif.source !== 'studio';
    const entry = { ...notif, id, expiresAt: sticky ? null : now + ttl };
    const isDuplicate = (notification) => notif.source === 'studio'
      && notification.source === 'studio'
      && notification.message === notif.message
      && notification.tabId === notif.tabId;
    setNotifications((previous) => {
      const next = [
        ...previous.filter((notification) => isLiveNotification(notification, now) && !isDuplicate(notification)),
        entry,
      ].slice(-MAX_VISIBLE_NOTIFICATIONS);
      persistNotifications(next);
      return next;
    });
  }, []);

  // Studio notices (validation hints, upload errors) arrive as a cancelable
  // window event; claiming it keeps the studio from falling back to alert().
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  useEffect(() => {
    const onStudioNotify = (event) => {
      const message = event.detail?.message;
      if (!message) return;
      event.preventDefault();
      const tabId = activeTabRef.current;
      pushNotification({ type: event.detail.type || 'info', source: 'studio', tabId, label: tabLabel(tabId), message });
    };
    window.addEventListener(STUDIO_NOTIFY_EVENT, onStudioNotify);
    return () => window.removeEventListener(STUDIO_NOTIFY_EVENT, onStudioNotify);
  }, [pushNotification, tabLabel]);

  const dismissNotification = useCallback((id) => {
    setNotifications((previous) => {
      const next = previous.filter((notification) => notification.id !== id);
      persistNotifications(next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!notificationsHydrated) return;

    persistNotifications(notifications);
  }, [notifications, notificationsHydrated]);

  useEffect(() => {
    const timed = notifications.filter((notification) => typeof notification.expiresAt === 'number');
    if (timed.length === 0) return undefined;

    const nextExpiry = Math.min(...timed.map((notification) => notification.expiresAt));
    const timer = window.setTimeout(() => {
      const now = Date.now();
      setNotifications((previous) => previous.filter((notification) => isLiveNotification(notification, now)));
    }, Math.max(0, nextExpiry - Date.now()));

    return () => window.clearTimeout(timer);
  }, [notifications]);

  const fetchBalance = useCallback(async (key) => {
    try {
      const data = await getUserBalance(key);
      setBalance(data.balance);
      setBalanceState('ok');
      track('key_check', { ok: true });
    } catch (err) {
      console.error('Balance fetch failed:', err);
      setBalanceState(classifyBalanceError(err));
      // Only a 401/403 means the key is bad; anything else is the network/service.
      track('key_check', { ok: false, status: typeof err?.status === 'number' ? err.status : 'network' });
    }
  }, []);

  const takeDuration = useCallback((tabId) => {
    const queue = generationStartedAt.current[tabId];
    const startedAt = queue && queue.shift();
    return startedAt ? Date.now() - startedAt : undefined;
  }, []);

  const makeSuccessCallback = useCallback((tabId) => (data) => {
    track('generation_completed', {
      tab: tabId,
      model: typeof data?.model === 'string' ? data.model : (data?.model?.id || data?.model?.name),
      type: data?.type,
      duration_ms: takeDuration(tabId),
    });
    pushNotification({
      type: 'success',
      tabId,
      label: tabLabel(tabId),
      resultUrl: data?.url || null,
    });
  }, [pushNotification, tabLabel, takeDuration]);

  const makeErrorCallback = useCallback((tabId) => (errorOrMessage) => {
    track('generation_failed', { tab: tabId, duration_ms: takeDuration(tabId) });
    const message = formatErrorMessage(errorOrMessage, copy.notifications.generationFailed, {
      unreachable: copy.notifications.unreachable,
      auth: copy.notifications.badKey,
    });
    const rawMessage = typeof errorOrMessage === 'string'
      ? errorOrMessage
      : String(errorOrMessage?.message || errorOrMessage?.error || errorOrMessage || '');
    pushNotification({ type: 'error', tabId, label: tabLabel(tabId), message, rawMessage: rawMessage.slice(0, 300) });
    if (apiKey) void fetchBalance(apiKey);
  }, [apiKey, copy, fetchBalance, pushNotification, tabLabel, takeDuration]);

  const makeGenerationStartCallback = useCallback((tabId) => () => {
    (generationStartedAt.current[tabId] ||= []).push(Date.now());
    track('generation_started', { tab: tabId });
    setGenerationCounts((previous) => ({
      ...previous,
      [tabId]: (previous[tabId] || 0) + 1,
    }));
  }, []);

  const makeGenerationEndCallback = useCallback((tabId) => () => {
    setGenerationCounts((previous) => {
      const currentCount = previous[tabId] || 0;
      if (currentCount <= 1) {
        const next = { ...previous };
        delete next[tabId];
        return next;
      }

      return {
        ...previous,
        [tabId]: currentCount - 1,
      };
    });
  }, []);

  const activeGenerations = TABS
    .filter((tab) => generationCounts[tab.id] > 0)
    .map((tab) => ({
      tabId: tab.id,
      label: tabLabel(tab.id),
      count: generationCounts[tab.id],
    }));

  // Popstate event listener to sync tab state with URL on back/forward navigation
  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname;
      // Strip the locale root prefix (if any) before reading the
      // /studio/<tab> segment, so this works for both /studio/<tab> and
      // /<locale>/studio/<tab>.
      const { rootPath } = getLocaleConfig(locale);
      const localeAwarePath = rootPath && path.startsWith(rootPath) ? path.slice(rootPath.length) : path;
      const segments = localeAwarePath.split('/').filter(Boolean);
      const tabId = segments[1] || 'image';
      if (STUDIO_TAB_IDS.includes(tabId)) {
        setActiveTab(tabId);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [locale]);

  const handleTabChange = useCallback((tabId) => {
    window.history.pushState(null, '', studioPath(tabId));
    setActiveTab(tabId);
  }, [studioPath]);

  const handleOpenNotification = useCallback((notification) => {
    handleTabChange(notification.tabId);
    dismissNotification(notification.id);
  }, [dismissNotification, handleTabChange]);

  const handleTabClick = (e, tabId) => {
    if (e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      handleTabChange(tabId);
      return true;
    }
    return false;
  };

  const handleNavigationItemClick = (event, tabId) => {
    if (handleTabClick(event, tabId)) {
      setIsMobileOpen(false);
    }
  };

  // Auto-hide header when inside a specific workflow view or design agent
  useEffect(() => {
    const isEditingWorkflow = (activeTab === 'workflows' || !!idFromParams) && urlWorkflowId;
    const isDesignAgent = activeTab === 'design-agent';
    
    if (isEditingWorkflow || isDesignAgent) {
      setIsHeaderVisible(false);
    } else {
      setIsHeaderVisible(true);
    }
  }, [activeTab, urlWorkflowId, idFromParams]);

  // Global builder CSS cleanup when switching away from Workflows or Design Agent tabs
  useEffect(() => {
    const fromBuilder = sessionStorage.getItem("fromWorkflowBuilder");
    const fromDesignAgent = sessionStorage.getItem("fromDesignAgent");
    
    if ((fromBuilder && activeTab !== 'workflows') || (fromDesignAgent && activeTab !== 'design-agent')) {
      sessionStorage.removeItem("fromWorkflowBuilder");
      sessionStorage.removeItem("fromDesignAgent");
      window.location.reload();
    }
  }, [activeTab]);

  useEffect(() => {
    installAnalytics();
    setHasMounted(true);
    try {
      setIsSidebarCollapsed(localStorage.getItem('sidebar_collapsed') === 'true');
    } catch {
      // storage unavailable: keep the expanded default
    }
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      setApiKey(stored);
      fetchBalance(stored);
      // Sync cookie immediately on mount to establish identity for background requests
      document.cookie = `muapi_key=${stored}; path=/; max-age=31536000; SameSite=Lax${cookieSecureSuffix()}`;
    }
  }, [fetchBalance]);

  // Analytics: page/tab views and the key wall.
  useEffect(() => {
    track('studio_view', { tab: activeTab, locale });
  }, [activeTab, locale]);

  useEffect(() => {
    if (hasMounted && !apiKey) track('key_wall_view');
  }, [hasMounted, apiKey]);

  // Validates the key against the balance endpoint BEFORE persisting it.
  // Returns a string (shown inline by ApiKeyModal) when MuAPI rejects it;
  // network/5xx failures let the key through with an amber balance pill.
  const handleKeySave = useCallback(async (key) => {
    const trimmed = key.trim();
    try {
      const data = await getUserBalance(trimmed);
      setBalance(data.balance);
      setBalanceState('ok');
      track('key_check', { ok: true });
    } catch (err) {
      const kind = classifyBalanceError(err);
      track('key_check', { ok: false, status: typeof err?.status === 'number' ? err.status : 'network' });
      if (kind === 'unauthorized') return copy.apiKeyModal.invalidKey;
      setBalanceState('error');
    }
    localStorage.setItem(STORAGE_KEY, trimmed);
    document.cookie = `muapi_key=${trimmed}; path=/; max-age=31536000; SameSite=Lax${cookieSecureSuffix()}`;
    setApiKey(trimmed);
    authPromptDismissedRef.current = false;
    setAuthPrompt(null);
    track('key_saved');
    return null;
  }, [copy]);

  const handleKeyChange = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setApiKey(null);
    setBalance(null);
    setBalanceState('loading');
    setAuthPrompt(null);
    authPromptDismissedRef.current = false;
    document.cookie = `muapi_key=; path=/; max-age=0; SameSite=Lax${cookieSecureSuffix()}`;
    track('key_removed');
  }, []);

  // MuAPI said 401/403 somewhere (muapi.js dispatches 'muapi:auth-required').
  // Re-check against the balance endpoint first, so a 403 about one specific
  // request or a burst of poll failures can't raise a false/duplicate prompt.
  useEffect(() => {
    if (!apiKey) return undefined;
    const handler = async () => {
      if (revalidatingRef.current || authPromptDismissedRef.current) return;
      revalidatingRef.current = true;
      try {
        const data = await getUserBalance(apiKey);
        setBalance(data.balance);
        setBalanceState('ok');
      } catch (err) {
        if (classifyBalanceError(err) === 'unauthorized') {
          setBalanceState('unauthorized');
          setAuthPrompt({ message: copy.apiKeyModal.invalidKey });
        }
      } finally {
        revalidatingRef.current = false;
      }
    };
    window.addEventListener('muapi:auth-required', handler);
    return () => window.removeEventListener('muapi:auth-required', handler);
  }, [apiKey, copy]);

  // Inject the API key into outgoing Axios requests — same-origin only, so
  // third-party hosts such as S3 never receive it.
  useEffect(() => {
    // Safety: Clear any global defaults that might have been set previously
    delete axios.defaults.headers.common['x-api-key'];

    if (!apiKey) return;

    const interceptorId = axios.interceptors.request.use((config) => {
      const url = typeof config.url === 'string' ? config.url : '';
      const isAbsolute = /^https?:\/\//i.test(url);
      const isSameOrigin = isAbsolute && typeof window !== 'undefined' && url.startsWith(`${window.location.origin}/`);
      if (!isAbsolute || isSameOrigin) {
        config.headers = config.headers || {};
        config.headers['x-api-key'] = apiKey;
      }
      return config;
    });

    return () => {
      axios.interceptors.request.eject(interceptorId);
    };
  }, [apiKey]);

  // Refresh the balance every 60s while the tab is visible, and right away
  // when the user comes back to it.
  useEffect(() => {
    if (!apiKey) return undefined;
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') fetchBalance(apiKey);
    };
    const interval = setInterval(refreshIfVisible, 60000);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [apiKey, fetchBalance]);

  // Settings dialog: Esc/backdrop close it and focus returns to the trigger.
  const closeMobileNav = useCallback(() => setIsMobileOpen(false), []);
  useEscapeKey(isMobileOpen, closeMobileNav);
  // Focus goes to the dialog's Close button on open (autoFocus) and back to
  // the Settings button that opened it on close.
  const settingsTriggerRef = useRef(null);
  const openSettings = useCallback((event) => {
    settingsTriggerRef.current = event?.currentTarget || null;
    setShowSettings(true);
  }, []);
  const closeSettings = useCallback(() => {
    setShowSettings(false);
    const trigger = settingsTriggerRef.current;
    if (trigger && typeof trigger.focus === 'function') window.setTimeout(() => trigger.focus(), 0);
  }, []);
  // "Change key" opens a cancelable key overlay; the current key stays until
  // the new one is saved.
  const [changingKey, setChangingKey] = useState(false);
  const startKeyChange = useCallback(() => {
    setShowSettings(false);
    setChangingKey(true);
  }, []);
  const handleChangedKeySave = useCallback(async (key) => {
    const result = await handleKeySave(key);
    if (!result) setChangingKey(false);
    return result;
  }, [handleKeySave]);
  const handleKeyRemove = useCallback(() => {
    setShowSettings(false);
    handleKeyChange();
  }, [handleKeyChange]);
  useEscapeKey(showSettings, closeSettings);

  // Reelty: after 8s without a load event, offer to open it in a new tab.
  useEffect(() => {
    if (!reeltyMounted || reeltyLoaded) return undefined;
    const timer = setTimeout(() => setReeltySlow(true), 8000);
    return () => clearTimeout(timer);
  }, [reeltyMounted, reeltyLoaded]);

  // Drag and Drop Handlers
  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    const isFileDrag = e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('Files');
    if (isFileDrag && e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set to false if we're leaving the container itself, not moving between children
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      setDroppedFiles(files);
    }
  }, []);

  const handleFilesHandled = useCallback(() => {
    setDroppedFiles(null);
  }, []);

  if (!hasMounted) return (
    <div className="min-h-screen bg-surface-app flex items-center justify-center">
      <div className="animate-spin text-brand text-3xl">◌</div>
    </div>
  );

  // Reelty doesn't use MuAPI, so it opens without the key wall.
  if (!apiKey && activeTab === 'reelty') {
    return (
      <div className="h-screen bg-surface-app flex flex-col overflow-hidden text-white">
        <header className="flex-shrink-0 h-14 border-b border-white/[0.05] flex items-center justify-between px-4 bg-surface-panel/80 backdrop-blur-md gap-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <BrandMark />
            <span className="font-display font-bold tracking-tight text-[13px] sm:text-[15px] whitespace-nowrap text-white">
              {copy.shell.brand}
            </span>
          </div>
          <a
            href={studioPath('image')}
            onClick={(e) => { if (e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) { e.preventDefault(); handleTabChange('image'); } }}
            className="h-9 px-4 inline-flex items-center rounded-full bg-brand text-on-brand text-xs font-bold hover:bg-brand-hover transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 whitespace-nowrap"
          >
            {copy.shell.unlockStudios}
          </a>
        </header>
        <iframe
          src={REELTY_URL}
          title={copy.reelty.iframeTitle}
          referrerPolicy="strict-origin-when-cross-origin"
          className="flex-1 w-full border-0 bg-surface-app"
          allow="clipboard-write; fullscreen; clipboard-read"
        />
      </div>
    );
  }

  if (!apiKey) {
    return <ApiKeyModal onSave={handleKeySave} locale={locale} onOpenReelty={() => handleTabChange('reelty')} />;
  }

  const balanceDotClass = {
    ok: 'bg-green-500 animate-pulse',
    loading: 'bg-white/40 animate-pulse',
    error: 'bg-amber-400',
    unauthorized: 'bg-red-500',
  }[balanceState];
  const balanceTitle = {
    ok: copy.shell.balanceOk,
    loading: copy.shell.balanceLoading,
    error: copy.shell.balanceUnavailable,
    unauthorized: copy.shell.keyNotWorking,
  }[balanceState];
  const balanceText = balanceState === 'ok' && balance !== null
    ? `$${balance}`
    : balanceState === 'unauthorized'
      ? copy.shell.keyNotWorking
      : balanceState === 'error'
        ? copy.shell.balanceUnavailable
        : '$---';
  const balanceTextIsLong = balanceState === 'unauthorized' || balanceState === 'error';

  const studioCallbacks = (tabId) => ({
    onGenerationStart: makeGenerationStartCallback(tabId),
    onGenerationEnd: makeGenerationEndCallback(tabId),
    onGenerationComplete: makeSuccessCallback(tabId),
    onGenerationError: makeErrorCallback(tabId),
  });

  return (
    <div 
      className="h-screen bg-surface-app flex flex-col overflow-hidden text-white relative"
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag Overlay */}
      {isDragging && (
        <div className="fixed inset-0 z-[100] bg-brand/10 backdrop-blur-md border-4 border-dashed border-brand/50 flex items-center justify-center pointer-events-none transition-all duration-300">
          <div className="bg-surface-panel p-8 rounded-3xl border border-white/10 shadow-2xl flex flex-col items-center gap-4 scale-110 animate-pulse">
            <div className="w-20 h-20 bg-brand rounded-2xl flex items-center justify-center">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2.5">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
              </svg>
            </div>
            <div className="flex flex-col items-center">
              <span className="font-display text-xl font-bold text-white">{copy.shell.dropHere}</span>
              <span className="text-sm text-secondary">{copy.shell.dropHereHint}</span>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      {isHeaderVisible && (
        <header className="flex-shrink-0 h-14 border-b border-white/[0.05] flex items-center justify-between px-4 bg-surface-panel/80 backdrop-blur-md z-50 gap-2 sm:gap-4">
          {/* Left: Mobile menu toggle + Logo + Desktop Sidebar Toggle */}
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            {/* Mobile drawer toggle */}
            <button
              onClick={() => setIsMobileOpen(!isMobileOpen)}
              className="md:hidden p-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition-colors"
              aria-label={copy.shell.toggleNavMenu}
              aria-expanded={isMobileOpen}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>

            {/* Desktop Sidebar Toggle Button (Single Toggle Button) */}
            <div className="hidden md:block relative group">
              <button
                onClick={toggleSidebar}
                className="flex items-center justify-center w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-colors border border-white/5"
                aria-label={isSidebarCollapsed ? copy.shell.expandSidebar : copy.shell.collapseSidebar}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className={`transition-transform duration-300 ${isSidebarCollapsed ? 'rotate-180' : ''}`}
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <path d="M9 3v18" />
                  <path d="M14 9l-3 3 3 3" />
                </svg>
              </button>
              {/* Custom Tooltip */}
              <div className="absolute left-0 top-full mt-2 px-2.5 py-1 bg-surface-raised/95 backdrop-blur-md text-white text-[11px] font-medium rounded-md shadow-2xl border border-white/15 opacity-0 group-hover:opacity-100 pointer-events-none transition-all duration-200 z-50 whitespace-nowrap">
                {isSidebarCollapsed ? copy.shell.expandSidebar : copy.shell.collapseSidebar}
              </div>
            </div>

            {/* Logo & wordmark */}
            <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
              <BrandMark />
              <span className="font-display font-bold tracking-tight text-[13px] sm:text-[15px] whitespace-nowrap text-white">
                {copy.shell.brand}
              </span>
            </div>
          </div>

          {/* Active Tab Breadcrumb Badge */}
          <div className="hidden lg:flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.03] border border-white/[0.05] text-xs text-white/60">
            <span className="w-1.5 h-1.5 rounded-full bg-brand" />
            <span className="font-medium text-white/80">
              {tabLabel(activeTab) || copy.shell.studioFallback}
            </span>
          </div>

          {/* Right: Actions */}
          <div className="flex-shrink-0 flex items-center gap-2 sm:gap-3">
            {showLanguageToggle && (
              <a
                href={localizeStudioPath(otherLocale, activeTab)}
                hrefLang={otherLocaleConfig.htmlLang}
                lang={otherLocaleConfig.htmlLang}
                aria-label={copy.shell.switchLanguage}
                title={copy.shell.switchLanguage}
                className="hidden sm:inline-flex px-2.5 py-1.5 rounded-md border border-white/10 bg-white/5 text-[12px] font-bold text-white/70 hover:text-white hover:bg-white/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                {otherLocale === 'zh' ? otherLocaleConfig.nativeName : 'EN'}
              </a>
            )}

            <div
              title={balanceTitle}
              aria-label={balanceTitle}
              className="flex items-center gap-2 sm:gap-2.5 bg-white/5 px-2 sm:px-3 py-1.5 rounded-full border border-white/5 transition-colors"
            >
              <div className={`w-2 h-2 rounded-full ${balanceDotClass}`} />
              <span className={`text-xs font-bold text-white/90 whitespace-nowrap ${balanceTextIsLong ? 'hidden sm:inline' : ''}`}>
                {balanceText}
              </span>
              {balanceState === 'unauthorized' && (
                <button
                  type="button"
                  onClick={() => { authPromptDismissedRef.current = false; setAuthPrompt({ message: copy.apiKeyModal.invalidKey }); }}
                  className="text-xs font-semibold text-brand hover:text-brand-hover whitespace-nowrap"
                >
                  {copy.settingsModal.changeKey}
                </button>
              )}
            </div>

            <button
              onClick={openSettings}
              className="flex items-center justify-center gap-2 min-h-[40px] min-w-[40px] px-2.5 sm:px-3 py-1.5 rounded-md border border-white/10 bg-white/5 text-[13px] font-bold text-white/80 hover:text-white hover:bg-white/10 hover:border-white/20 transition-colors"
              aria-label={copy.shell.settings}
              aria-haspopup="dialog"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              <span className="hidden sm:inline">{copy.shell.settings}</span>
            </button>
          </div>
        </header>
      )}

      {/* Main Body Layout: Left Sidebar + Studio Content Area */}
      <div className="flex-1 min-h-0 flex relative overflow-hidden">
        {/* Mobile Backdrop Overlay */}
        {isMobileOpen && (
          <div 
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40 md:hidden animate-fade-in"
            onClick={() => setIsMobileOpen(false)}
          />
        )}

        {/* Left Sidebar Navigation */}
        {isHeaderVisible && (
          <aside
            className={`
              fixed top-14 bottom-0 left-0 md:static md:h-full z-30 bg-surface-panel/95 backdrop-blur-md border-r border-white/[0.06] flex flex-col transition-all duration-300 ease-in-out flex-shrink-0 select-none
              ${isMobileOpen ? 'translate-x-0 w-60 z-50' : '-translate-x-full md:translate-x-0'}
              ${isSidebarCollapsed ? 'md:w-16' : 'md:w-52'}
            `}
          >
            <nav aria-label={copy.shell.studioNavigation} className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-none py-2 px-2">
              <div className="space-y-1">
                {NAVIGATION_CATEGORIES.map((category) => {
                  const isCategoryActive = activeCategory?.id === category.id;
                  const isCollapsed = isSidebarCollapsed && !isMobileOpen;
                  const isCategoryOpen = !isCollapsed && expandedCategoryId === category.id;
                  const categoryPanelId = `navigation-category-${category.id}`;
                  const categoryLabelText = categoryLabel(category.id);
                  const categoryItemClass = `
                          group relative flex items-center rounded-xl transition-all duration-150 font-semibold
                          ${isCollapsed ? 'h-11 w-11 justify-center mx-auto' : 'px-3 py-2.5 w-full gap-3 text-left'}
                          ${isCategoryActive
                            ? 'bg-gradient-to-r from-brand/15 to-pop/10 text-brand border border-brand/20 shadow-[0_0_15px_rgba(46,230,214,0.08)]'
                            : isCategoryOpen
                              ? 'bg-white/[0.06] text-white border border-white/[0.08]'
                              : 'text-white/60 hover:text-white hover:bg-white/[0.04] border border-transparent'
                          }
                        `;
                  // A category with a single tab (Audio, Reelty) is a direct
                  // link rather than an accordion of itself.
                  const singleTab = category.tabIds.length === 1
                    ? TABS.find((t) => t.id === category.tabIds[0])
                    : null;

                  if (singleTab) {
                    return (
                      <div key={category.id} className="relative">
                        <a
                          href={studioPath(singleTab.id)}
                          onClick={(event) => handleNavigationItemClick(event, singleTab.id)}
                          aria-current={activeTab === singleTab.id ? 'page' : undefined}
                          aria-label={categoryLabelText}
                          title={isCollapsed ? categoryLabelText : undefined}
                          className={categoryItemClass}
                        >
                          {isCategoryActive && (
                            <span className="absolute left-0 top-2 bottom-2 w-1 bg-gradient-to-b from-brand to-pop rounded-r-full shadow-[0_0_8px_rgba(46,230,214,0.6)]" />
                          )}
                          <span className={`flex-shrink-0 transition-colors ${isCategoryActive ? 'text-brand' : 'text-white/55 group-hover:text-white'}`}>
                            {category.icon}
                          </span>
                          {!isCollapsed && (
                            <span className="flex-1 min-w-0 text-[12px] leading-4 tracking-tight">
                              {categoryLabelText}
                            </span>
                          )}
                        </a>
                      </div>
                    );
                  }

                  return (
                    <div key={category.id} className="relative">
                      <button
                        type="button"
                        onClick={() => handleCategoryToggle(category.id)}
                        aria-label={categoryLabelText}
                        aria-expanded={isCategoryOpen}
                        aria-controls={isCollapsed ? undefined : categoryPanelId}
                        title={isCollapsed ? categoryLabelText : undefined}
                        className={categoryItemClass}
                      >
                        {isCategoryActive && (
                          <span className="absolute left-0 top-2 bottom-2 w-1 bg-gradient-to-b from-brand to-pop rounded-r-full shadow-[0_0_8px_rgba(46,230,214,0.6)]" />
                        )}

                        <span className={`flex-shrink-0 transition-colors ${isCategoryActive ? 'text-brand' : 'text-white/55 group-hover:text-white'}`}>
                          {category.icon}
                        </span>

                        {!isCollapsed && (
                          <>
                            <span className="flex-1 min-w-0 text-[12px] leading-4 tracking-tight">
                              {categoryLabelText}
                            </span>
                            <svg
                              width="15"
                              height="15"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className={`flex-shrink-0 transition-transform duration-200 ${isCategoryOpen ? 'rotate-180' : ''}`}
                              aria-hidden="true"
                            >
                              <path d="M6 9l6 6 6-6"/>
                            </svg>
                          </>
                        )}
                      </button>

                      {!isCollapsed && isCategoryOpen && (
                        <div
                          id={categoryPanelId}
                          role="group"
                          aria-label={`${categoryLabelText} ${copy.shell.toolsSuffix}`}
                          className="mt-1 ml-2 pl-2 border-l border-white/[0.08] space-y-1"
                        >
                          {category.tabIds.map((tabId) => {
                            const tab = TABS.find((item) => item.id === tabId);
                            if (!tab) return null;
                            const isActive = activeTab === tab.id;

                            return (
                              <a
                                key={tab.id}
                                href={studioPath(tab.id)}
                                onClick={(event) => handleNavigationItemClick(event, tab.id)}
                                aria-current={isActive ? 'page' : undefined}
                                className={`
                                  group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12px] font-medium transition-all duration-150
                                  ${isActive
                                    ? 'bg-brand/10 text-brand border border-brand/20'
                                    : 'text-white/55 hover:text-white hover:bg-white/[0.04] border border-transparent'
                                  }
                                `}
                              >
                                {isActive && (
                                  <span className="absolute -left-[11px] top-2 bottom-2 w-0.5 rounded-full bg-brand shadow-[0_0_7px_rgba(46,230,214,0.7)]" />
                                )}
                                <span className={`flex-shrink-0 ${isActive ? 'text-brand' : 'text-white/45 group-hover:text-white/80'}`}>
                                  {tab.icon}
                                </span>
                                <span className="truncate">{tabLabel(tab.id)}</span>
                              </a>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {EXPLORE_APPS_TAB && (
                <div className="mt-3 pt-3 border-t border-white/[0.07]">
                  <a
                    href={studioPath(EXPLORE_APPS_TAB.id)}
                    onClick={(event) => handleNavigationItemClick(event, EXPLORE_APPS_TAB.id)}
                    aria-current={activeTab === EXPLORE_APPS_TAB.id ? 'page' : undefined}
                    aria-label={tabLabel(EXPLORE_APPS_TAB.id)}
                    title={isSidebarCollapsed && !isMobileOpen ? tabLabel(EXPLORE_APPS_TAB.id) : undefined}
                    className={`
                      group relative flex items-center rounded-xl transition-all duration-150 text-[13px] font-semibold
                      ${isSidebarCollapsed && !isMobileOpen ? 'h-11 w-11 justify-center mx-auto' : 'px-3 py-2.5 w-full gap-3'}
                      ${activeTab === EXPLORE_APPS_TAB.id
                        ? 'bg-gradient-to-r from-brand/15 to-pop/10 text-brand border border-brand/20'
                        : 'text-white/60 hover:text-white hover:bg-white/[0.04] border border-transparent'
                      }
                    `}
                  >
                    {activeTab === EXPLORE_APPS_TAB.id && (
                      <span className="absolute left-0 top-2 bottom-2 w-1 bg-gradient-to-b from-brand to-pop rounded-r-full" />
                    )}
                    <span className={`flex-shrink-0 ${activeTab === EXPLORE_APPS_TAB.id ? 'text-brand' : 'text-white/50 group-hover:text-white'}`}>
                      {EXPLORE_APPS_TAB.icon}
                    </span>
                    {(!isSidebarCollapsed || isMobileOpen) && (
                      <span className="truncate">{tabLabel(EXPLORE_APPS_TAB.id)}</span>
                    )}
                  </a>
                </div>
              )}

              {showLanguageToggle && (isMobileOpen || !isSidebarCollapsed) && (
                <div className="sm:hidden mt-3 pt-3 border-t border-white/[0.07]">
                  <a
                    href={localizeStudioPath(otherLocale, activeTab)}
                    hrefLang={otherLocaleConfig.htmlLang}
                    lang={otherLocaleConfig.htmlLang}
                    aria-label={copy.shell.switchLanguage}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-semibold text-white/60 hover:text-white hover:bg-white/[0.04]"
                  >
                    {otherLocale === 'zh' ? otherLocaleConfig.nativeName : 'EN'}
                  </a>
                </div>
              )}
            </nav>
          </aside>
        )}

        {/* Studio Content */}
        <div className="flex-1 min-h-0 h-full relative overflow-hidden bg-surface-app">
        <div className={activeTab === 'image' ? "h-full w-full" : "hidden"}>
          {shouldMount('image') && <ImageStudio apiKey={apiKey} locale={locale} droppedFiles={droppedFiles} onFilesHandled={handleFilesHandled} {...studioCallbacks('image')} />}
        </div>
        <div className={activeTab === 'layers' ? "h-full w-full" : "hidden"}>
          {shouldMount('layers') && <LayersStudio apiKey={apiKey} locale={locale} droppedFiles={droppedFiles} onFilesHandled={handleFilesHandled} {...studioCallbacks('layers')} />}
        </div>
        <div className={activeTab === 'video' ? "h-full w-full" : "hidden"}>
          {shouldMount('video') && <VideoStudio apiKey={apiKey} locale={locale} droppedFiles={droppedFiles} onFilesHandled={handleFilesHandled} {...studioCallbacks('video')} />}
        </div>
        <div className={activeTab === 'clipping' ? "h-full w-full" : "hidden"}>
          {shouldMount('clipping') && <ClippingStudio apiKey={apiKey} locale={locale} droppedFiles={droppedFiles} onFilesHandled={handleFilesHandled} {...studioCallbacks('clipping')} />}
        </div>
        <div className={activeTab === 'motion-control' ? "h-full w-full" : "hidden"}>
          {shouldMount('motion-control') && <MotionControlStudio apiKey={apiKey} locale={locale} droppedFiles={droppedFiles} onFilesHandled={handleFilesHandled} {...studioCallbacks('motion-control')} />}
        </div>
        <div className={activeTab === 'vibe-motion' ? "h-full w-full" : "hidden"}>
          {shouldMount('vibe-motion') && <VibeMotionStudio apiKey={apiKey} locale={locale} {...studioCallbacks('vibe-motion')} />}
        </div>
        <div className={activeTab === 'lipsync' ? "h-full w-full" : "hidden"}>
          {shouldMount('lipsync') && <LipSyncStudio apiKey={apiKey} locale={locale} droppedFiles={droppedFiles} onFilesHandled={handleFilesHandled} {...studioCallbacks('lipsync')} />}
        </div>
        <div className={activeTab === 'body-swap' ? "h-full w-full" : "hidden"}>
          {shouldMount('body-swap') && <RecastStudio apiKey={apiKey} locale={locale} droppedFiles={droppedFiles} onFilesHandled={handleFilesHandled} {...studioCallbacks('body-swap')} />}
        </div>
        <div className={activeTab === 'cinema' ? "h-full w-full" : "hidden"}>
          {shouldMount('cinema') && <CinemaStudio apiKey={apiKey} locale={locale} {...studioCallbacks('cinema')} />}
        </div>
        <div className={activeTab === 'audio' ? "h-full w-full" : "hidden"}>
          {shouldMount('audio') && <AudioStudio apiKey={apiKey} locale={locale} droppedFiles={droppedFiles} onFilesHandled={handleFilesHandled} {...studioCallbacks('audio')} />}
        </div>
        <div className={activeTab === 'marketing' ? "h-full w-full" : "hidden"}>
          {shouldMount('marketing') && <MarketingStudio apiKey={apiKey} locale={locale} droppedFiles={droppedFiles} onFilesHandled={handleFilesHandled} {...studioCallbacks('marketing')} />}
        </div>
        <div className={activeTab === 'workflows' ? "h-full w-full" : "hidden"}>
          {shouldMount('workflows') && (
            <WorkflowStudio
              apiKey={apiKey}
              isHeaderVisible={isHeaderVisible}
              onToggleHeader={setIsHeaderVisible}
              {...studioCallbacks('workflows')}
            />
          )}
        </div>
        <div className={activeTab === 'agents' ? "h-full w-full" : "hidden"}>
          {shouldMount('agents') && <AgentStudio apiKey={apiKey} locale={locale} isHeaderVisible={isHeaderVisible} onToggleHeader={setIsHeaderVisible} />}
        </div>
        <div className={activeTab === 'design-agent' ? "h-full w-full" : "hidden"}>
          {activeTab === 'design-agent' && (
            <DesignAgentStudio
              apiKey={apiKey}
              isHeaderVisible={isHeaderVisible}
              onToggleHeader={setIsHeaderVisible}
              backHref={studioPath()}
              brandSlot={(
                <span className="flex items-center gap-2 pl-1 pr-2">
                  <BrandMark size="sm" />
                  <span className="font-display font-bold text-[13px] tracking-tight text-white hidden sm:inline">{copy.shell.brand}</span>
                </span>
              )}
              {...studioCallbacks('design-agent')}
            />
          )}
        </div>
        <div className={activeTab === 'apps' ? "h-full w-full" : "hidden"}>
          {shouldMount('apps') && <AppsStudio apiKey={apiKey} locale={locale} />}
        </div>
        <div className={activeTab === 'ai-influencer' ? "h-full w-full" : "hidden"}>
          {shouldMount('ai-influencer') && (
            <AiInfluencerStudio
              apiKey={apiKey}
              locale={locale}
              {...studioCallbacks('ai-influencer')}
            />
          )}
        </div>
        <div className={activeTab === 'reelty' ? 'flex h-full w-full flex-col' : 'hidden'}>
          <div className="shrink-0 h-10 px-4 flex items-center justify-between gap-3 border-b border-white/[0.06] bg-surface-panel/80 text-[12px]">
            <span className="truncate text-white/70">
              <span className="font-semibold text-brand">Reelty</span> · {copy.reelty.tagline}
            </span>
            <a
              href={REELTY_OPEN_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 font-semibold text-white/70 hover:text-brand transition-colors"
            >
              {copy.reelty.openFull} ↗
            </a>
          </div>
          <div className="relative flex-1 min-h-0 bg-surface-app">
            {reeltyMounted && (
              <iframe
                src={REELTY_URL}
                title={copy.reelty.iframeTitle}
                referrerPolicy="strict-origin-when-cross-origin"
                allow="clipboard-write; fullscreen; clipboard-read"
                className="h-full w-full border-0 bg-transparent"
                onLoad={() => setReeltyLoaded(true)}
              />
            )}
            {!reeltyLoaded && (
              <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center gap-3 bg-surface-app">
                <div className="h-2 w-40 rounded-full bg-brand/40 animate-pulse" />
                {reeltySlow ? (
                  <a
                    href={REELTY_OPEN_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="pointer-events-auto text-[12px] text-white/60 hover:text-brand underline-offset-2 hover:underline"
                  >
                    {copy.reelty.slow}
                  </a>
                ) : (
                  <p className="text-[12px] text-white/50">{copy.reelty.loading}</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>

      {/* Global generation activity and notification stack */}
      {(activeGenerations.length > 0 || notifications.length > 0) && (
        <div
          aria-live="polite"
          aria-label={copy.notifications.ariaLabel}
          className="fixed top-16 right-4 sm:right-5 z-[200] flex max-h-[calc(100vh-80px)] w-[340px] max-w-[calc(100vw-32px)] flex-col gap-2 overflow-x-hidden overflow-y-auto global-notif-stack pointer-events-none max-sm:[&>*:not(:last-child)]:hidden"
          data-testid="global-notification-stack"
        >
          {activeGenerations.map((generation) => (
            <div
              key={generation.tabId}
              role="status"
              data-generation-tab={generation.tabId}
              className="pointer-events-auto flex items-center gap-3 rounded-xl border border-brand/40 bg-surface-raised px-3.5 py-3 text-[13px] text-white shadow-[0_10px_30px_rgba(0,0,0,0.55)]"
              data-testid="generation-activity"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-brand/40 bg-brand/15">
                <span
                  className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand/30 border-t-brand"
                  aria-hidden="true"
                />
              </span>
              <p className="min-w-0 flex-1 font-semibold leading-5 text-white">
                {generation.label} {copy.notifications.generating}
                {generation.count > 1 ? ` (${generation.count})` : ''}
              </p>
            </div>
          ))}

          {notifications.map((notif) => {
            const messageText = typeof notif.message === 'string' ? notif.message : String(notif.message?.message || notif.message || '');
            const isStudioNotice = notif.source === 'studio';
            return (
              <div
                key={notif.id}
                role={notif.type === 'error' ? 'alert' : 'status'}
                data-notification-type={notif.type}
                data-notification-tab={notif.tabId}
                className="pointer-events-auto flex items-start gap-3 rounded-xl border bg-surface-raised px-3.5 py-3 text-[13px] text-white shadow-[0_10px_30px_rgba(0,0,0,0.55)]"
                style={{
                  borderColor: notif.type === 'success' ? 'rgba(46,230,214,0.5)' : 'rgba(59,130,246,0.45)',
                  animation: 'slideInRight 280ms cubic-bezier(0.16,1,0.3,1) forwards',
                }}
              >
                <span
                  className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${
                    notif.type === 'success'
                      ? 'border-brand/40 bg-brand/15 text-brand'
                      : 'border-pop/40 bg-pop/15 text-pop-400'
                  }`}
                >
                  {notif.type === 'success' ? (
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="m5 12 4 4L19 6" />
                    </svg>
                  ) : (
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M12 7v6" />
                      <path d="M12 17h.01" />
                    </svg>
                  )}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="font-semibold leading-5 text-white">
                    {notif.label}
                    {!isStudioNotice && (
                      <span className="font-normal text-white/60">
                        {' '}
                        {notif.type === 'success' ? copy.notifications.generationComplete : copy.notifications.generationFailed}
                      </span>
                    )}
                  </p>
                  {isStudioNotice && (
                    <p className={`mt-0.5 text-[12px] font-medium leading-4 ${notif.type === 'error' ? 'text-pop-300' : 'text-white/80'}`}>
                      {messageText}
                    </p>
                  )}
                  {!isStudioNotice && notif.type === 'error' && messageText && (
                    <p className="mt-0.5 line-clamp-2 text-[12px] font-medium leading-4 text-pop-300" title={notif.rawMessage || messageText}>
                      {messageText}
                    </p>
                  )}
                  {!isStudioNotice && notif.type === 'error' && (
                    <p className="mt-0.5 text-[12px] leading-4 text-white/50">
                      {copy.notifications.retryHint}
                    </p>
                  )}
                  {!isStudioNotice && notif.type === 'success' && (
                    <p className="mt-0.5 text-[12px] leading-4 text-white/60">
                      {copy.notifications.resultReady}
                    </p>
                  )}
                  {!isStudioNotice && notif.type === 'success' && (
                    <button
                      type="button"
                      onClick={() => handleOpenNotification(notif)}
                      className="mt-1.5 text-[11px] font-bold text-brand transition-colors hover:text-brand-hover"
                      aria-label={copy.notifications.openResult.replace('{label}', notif.label)}
                    >
                      {copy.notifications.open}
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => dismissNotification(notif.id)}
                  className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white/40 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                  aria-label={copy.notifications.dismissNotification}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Keyframe for toast slide-in & scrollbar suppression */}
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(110%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
        .global-notif-stack::-webkit-scrollbar {
          display: none;
        }
        .global-notif-stack {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>

      {/* Settings Modal */}
      {showSettings && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 px-4 animate-fade-in-up"
          onClick={(e) => { if (e.target === e.currentTarget) closeSettings(); }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-modal-title"
        >
          <div className="bg-surface-panel border border-white/10 rounded-2xl p-8 w-full max-w-sm shadow-2xl">
            <h2 id="settings-modal-title" className="font-display text-white font-bold text-lg mb-2">{copy.settingsModal.title}</h2>
            <p className="text-secondary text-[13px] mb-8">
              {copy.settingsModal.subtitle}
            </p>

            <div className="space-y-4 mb-8">
              <div className="bg-white/5 border border-white/[0.06] rounded-xl p-4">
                <p className="block text-xs font-semibold text-secondary mb-2">
                   {copy.settingsModal.activeApiKey}
                </p>
                <div className="text-[13px] font-mono text-white/80">
                  {apiKey.slice(0, 8)}••••••••••••••••
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={startKeyChange}
                className="flex-1 h-10 rounded-md bg-brand text-on-brand hover:bg-brand-hover text-xs font-semibold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
              >
                {copy.settingsModal.changeKey}
              </button>
              <button
                type="button"
                onClick={closeSettings}
                autoFocus
                className="flex-1 h-10 rounded-md bg-white/5 text-white/80 hover:bg-white/10 text-xs font-semibold transition-all border border-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                {copy.settingsModal.close}
              </button>
            </div>
            <button
              type="button"
              onClick={handleKeyRemove}
              className="mt-4 w-full text-center text-[12px] font-medium text-red-400 hover:text-red-300 transition-colors rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400/40"
            >
              {copy.settingsModal.removeKey}
            </button>
          </div>
        </div>
      )}

      {changingKey && !authPrompt && (
        <ApiKeyModal
          overlay
          locale={locale}
          title={copy.apiKeyModal.changeKeyTitle}
          subtitle={copy.apiKeyModal.changeKeySubtitle}
          onSave={handleChangedKeySave}
          onClose={() => setChangingKey(false)}
        />
      )}

      {/* MuAPI rejected the saved key: ask for a fresh one without leaving the studio. */}
      {authPrompt && (
        <ApiKeyModal
          overlay
          locale={locale}
          title={copy.apiKeyModal.keyStoppedTitle}
          subtitle={copy.apiKeyModal.keyStoppedSubtitle}
          onSave={handleKeySave}
          onClose={() => { setAuthPrompt(null); authPromptDismissedRef.current = true; }}
        />
      )}
    </div>
  );
}
