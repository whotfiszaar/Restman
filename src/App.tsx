import { useState, useEffect, useRef } from "react";
import { db, seedDatabaseIfEmpty, pruneHistory, type RequestItem, type RequestTab, type Variable } from "./db/db";
import { resolveVariables, buildUrlWithParams, parseUrlAndParams } from "./utils/urlHelper";
import { useLiveQuery } from "dexie-react-hooks";
import CollectionSidebar from "./components/CollectionSidebar";
import RequestWorkspace from "./components/RequestWorkspace";
import ResponseWorkspace from "./components/ResponseWorkspace";
import CommandPalette from "./components/CommandPalette";
import VariablesModal from "./components/VariablesModal";
import SettingsModal from "./components/SettingsModal";
import Toast from "./components/Toast";
import { AlertTriangle, X, Sliders, Settings } from "lucide-react";

interface TabResponseState {
  data: any;
  status: number | null;
  statusText: string;
  duration: number | null;
  size: number | null;
  headers: { key: string; value: string }[];
}

export default function App() {
  // DB Subscriptions
  const collections = useLiveQuery(() => db.collections.toArray());
  const tabs = (useLiveQuery(() => db.tabs.orderBy("order").toArray()) as RequestTab[]) || [];
  const requests = (useLiveQuery(() => db.requests.toArray()) as RequestItem[]) || [];
  const variables = (useLiveQuery(() => db.variables.toArray()) as Variable[]) || [];

  // Active workspace states
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [variablesOpen, setVariablesOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  // Tab-specific response cache state
  const [tabResponses, setTabResponses] = useState<Record<string, TabResponseState>>({});

  // Active Response states (represents the response of the currently active tab)
  const [activeResponse, setActiveResponse] = useState<any>(null);
  const [activeResponseStatus, setActiveResponseStatus] = useState<number | null>(null);
  const [activeResponseStatusText, setActiveResponseStatusText] = useState("");
  const [activeResponseDuration, setActiveResponseDuration] = useState<number | null>(null);
  const [activeResponseSize, setActiveResponseSize] = useState<number | null>(null);
  const [activeResponseHeaders, setActiveResponseHeaders] = useState<{ key: string; value: string }[]>([]);

  // Sending status
  const [isSending, setIsSending] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Panel sizing drag state
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [requestPaneWidth, setRequestPaneWidth] = useState(540);
  const [isDraggingSidebar, setIsDraggingSidebar] = useState(false);
  const [isDraggingRequestPane, setIsDraggingRequestPane] = useState(false);

  // Layout customization states
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [responseOpen, setResponseOpen] = useState(true);
  const [layoutMode, setLayoutMode] = useState<"side-by-side" | "stacked">("side-by-side");

  // CORS config & mode
  const [useProxy, setUseProxy] = useState(false);
  const [proxyUrl, setProxyUrl] = useState("https://api.allorigins.win/raw?url=");
  const [corsErrorMsg, setCorsErrorMsg] = useState<string | null>(null);

  // Response panel dimensions & fullscreen state
  const [responseMaximized, setResponseMaximized] = useState(false);
  const [responsePaneHeight, setResponsePaneHeight] = useState(350);
  const [isDraggingResponseHeight, setIsDraggingResponseHeight] = useState(false);

  // UI Theme (light first)
  const [theme, setTheme] = useState<string>("light");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"general" | "themes" | "shortcuts" | "about" | "import">("general");
  const [fontFamily, setFontFamily] = useState<string>("'Plus Jakarta Sans', sans-serif");
  const [zoomLevel, setZoomLevel] = useState<number>(1.0);

  const handleZoomIn = () => {
    setZoomLevel((prev) => Math.min(3.0, Number((prev + 0.1).toFixed(1))));
  };

  const handleZoomOut = () => {
    setZoomLevel((prev) => Math.max(0.5, Number((prev - 0.1).toFixed(1))));
  };

  const handleZoomReset = () => {
    setZoomLevel(1.0);
  };

  const openSettingsToTab = (tab: "general" | "themes" | "shortcuts" | "about" | "import") => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  };
  // Load seeds and persistent UI configurations on initialization
  useEffect(() => {
    async function init() {
      await seedDatabaseIfEmpty();

      // Read persistent UI state
      const pSidebar = await db.uiState.get("sidebarWidth");
      if (pSidebar) setSidebarWidth(pSidebar.value);

      const pRequestPane = await db.uiState.get("requestPaneWidth");
      if (pRequestPane) setRequestPaneWidth(pRequestPane.value);

      const pTheme = await db.uiState.get("theme");
      if (pTheme) {
        setTheme(pTheme.value);
      } else {
        const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        setTheme(systemPrefersDark ? "dark" : "light");
      }

      const pFontFamily = await db.uiState.get("fontFamily");
      if (pFontFamily) {
        setFontFamily(pFontFamily.value);
      }

      const pSidebarOpen = await db.uiState.get("sidebarOpen");
      if (pSidebarOpen !== undefined) setSidebarOpen(pSidebarOpen.value);

      const pResponseOpen = await db.uiState.get("responseOpen");
      if (pResponseOpen !== undefined) setResponseOpen(pResponseOpen.value);

      const pLayoutMode = await db.uiState.get("layoutMode");
      if (pLayoutMode !== undefined) setLayoutMode(pLayoutMode.value);

      const pResponseHeight = await db.uiState.get("responsePaneHeight");
      if (pResponseHeight !== undefined) setResponsePaneHeight(pResponseHeight.value);

      const pZoom = await db.uiState.get("zoomLevel");
      if (pZoom) {
        setZoomLevel(pZoom.value);
      }

      // Automatically select the active tab or first tab
      const dbTabs = await db.tabs.orderBy("order").toArray();
      const activeTab = dbTabs.find((t) => t.active);
      if (activeTab) {
        setActiveTabId(activeTab.id);
      } else if (dbTabs.length > 0) {
        setActiveTabId(dbTabs[0].id);
      }

      setIsInitialized(true);
    }
    init();
  }, []);

  // Sync theme changes with DOM
  useEffect(() => {
    const root = window.document.documentElement;
    root.setAttribute("data-theme", theme);
    const isLightTheme = ["light", "high-contrast-light", "ayu-light", "night-owl-light", "solarized-light"].includes(theme);
    if (isLightTheme) {
      root.classList.remove("dark");
      root.style.colorScheme = "light";
    } else {
      root.classList.add("dark");
      root.style.colorScheme = "dark";
    }
    const anyWin = window as any;
    if (anyWin.electronAPI && anyWin.electronAPI.setTheme) {
      anyWin.electronAPI.setTheme(theme);
    }
    if (isInitialized) {
      db.uiState.put({ key: "theme", value: theme });
    }
  }, [theme, isInitialized]);

  // Sync font-family changes with DOM
  useEffect(() => {
    document.documentElement.style.setProperty('--font-sans', fontFamily);
    if (isInitialized) {
      db.uiState.put({ key: "fontFamily", value: fontFamily });
    }
  }, [fontFamily, isInitialized]);

  // Sync layout customization states to IndexedDB after initialization
  useEffect(() => {
    if (isInitialized) {
      db.uiState.put({ key: "sidebarOpen", value: sidebarOpen });
    }
  }, [sidebarOpen, isInitialized]);

  useEffect(() => {
    if (isInitialized) {
      db.uiState.put({ key: "responseOpen", value: responseOpen });
    }
  }, [responseOpen, isInitialized]);

  useEffect(() => {
    if (isInitialized) {
      db.uiState.put({ key: "layoutMode", value: layoutMode });
    }
  }, [layoutMode, isInitialized]);

  // Sync zoom level with DOM and persist (in Electron apply a 1x scale; in web use raw zoomLevel)
  useEffect(() => {
    // Only apply zoom to the whole body — do NOT add a 1.35 multiplier in the web browser
    document.body.style.zoom = `${zoomLevel}`;
    if (isInitialized) {
      db.uiState.put({ key: "zoomLevel", value: zoomLevel });
    }
  }, [zoomLevel, isInitialized]);

  // Global Keyboard shortcuts
  useEffect(() => {
    const handleGlobalKeys = async (e: KeyboardEvent) => {
      // Zoom Controls (Ctrl + +, Ctrl + -, Ctrl + 0)
      if (e.ctrlKey || e.metaKey) {
        if (e.key === "=" || e.key === "+") {
          e.preventDefault();
          handleZoomIn();
          return;
        }
        if (e.key === "-") {
          e.preventDefault();
          handleZoomOut();
          return;
        }
        if (e.key === "0") {
          e.preventDefault();
          handleZoomReset();
          return;
        }
      }

      // Don't fire shortcuts if user is typing inside input or editor
      const activeEl = document.activeElement;
      if (activeEl) {
        const isInput = activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || activeEl.classList.contains("input") || activeEl.closest(".monaco-editor");
        // We still want Ctrl+K or Ctrl+Enter to fire even inside editor, but prevent others from interfering
        if (isInput && e.key.toLowerCase() !== "k" && e.key.toLowerCase() !== "enter") {
          return;
        }
      }

      // Ctrl+K -> Command Palette
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
      }

      // Ctrl+P -> Command Palette / Open Request alternative
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
      }

      // Ctrl+Shift+F -> Focus Search
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        const searchInput = document.querySelector("input[placeholder*='Search API']") as HTMLInputElement;
        if (searchInput) searchInput.focus();
      }

      // Ctrl+Shift+V -> Manage Variables
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "v") {
        e.preventDefault();
        setVariablesOpen((prev) => !prev);
      }

      // Ctrl+N -> Create Draft Request
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        const draftId = `draft-${Date.now()}`;
        const newReq: RequestItem = {
          id: draftId,
          collectionId: "drafts",
          folderId: null,
          name: "New Request Draft",
          method: "GET",
          url: "",
          headers: [{ id: `h-${Date.now()}-0`, key: "Accept", value: "application/json", enabled: true }],
          params: [],
          auth: { type: "none" },
          body: { type: "none" },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        await db.requests.add(newReq);
        await db.tabs.add({
          id: draftId,
          requestId: draftId,
          name: "New Request Draft",
          method: "GET",
          url: "",
          active: true,
          order: tabs.length > 0 ? Math.min(...tabs.map(t => t.order)) - 1 : 0,
        });
        setActiveTabId(draftId);
      }

      // Ctrl+J -> Toggle Response Panel (Minimize / Restore)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setResponseOpen((prev) => !prev);
        setResponseMaximized(false);
      }

      // Ctrl+Shift+M -> Toggle Response Maximized (Full Screen)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        setResponseMaximized((prev) => !prev);
      }

      // Ctrl+B -> Toggle Sidebar
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setSidebarOpen((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handleGlobalKeys);
    return () => window.removeEventListener("keydown", handleGlobalKeys);
  }, [tabs]);

  // Drag listeners
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const currentZoom = zoomLevel * 1.35;

      if (isDraggingSidebar) {
        const newWidth = Math.max(180, Math.min(500, e.clientX / currentZoom));
        setSidebarWidth(newWidth);
      }

      if (isDraggingRequestPane) {
        const sidebarAndLeft = (sidebarOpen ? sidebarWidth : 0) + 8; // Offset
        const newWidth = Math.max(300, Math.min(800, (e.clientX / currentZoom) - sidebarAndLeft));
        setRequestPaneWidth(newWidth);
      }

      if (isDraggingResponseHeight) {
        const newHeight = Math.max(150, Math.min((window.innerHeight / currentZoom) - 150, (window.innerHeight - e.clientY) / currentZoom));
        setResponsePaneHeight(newHeight);
      }
    };

    const handleMouseUp = async () => {
      if (isDraggingSidebar) {
        await db.uiState.put({ key: "sidebarWidth", value: sidebarWidth });
      }
      if (isDraggingRequestPane) {
        await db.uiState.put({ key: "requestPaneWidth", value: requestPaneWidth });
      }
      if (isDraggingResponseHeight) {
        await db.uiState.put({ key: "responsePaneHeight", value: responsePaneHeight });
      }

      setIsDraggingSidebar(false);
      setIsDraggingRequestPane(false);
      setIsDraggingResponseHeight(false);
    };

    if (isDraggingSidebar || isDraggingRequestPane || isDraggingResponseHeight) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDraggingSidebar, isDraggingRequestPane, isDraggingResponseHeight, sidebarWidth, requestPaneWidth, responsePaneHeight, zoomLevel, sidebarOpen]);

  // Handle Request tab switching (with optimized batch write and response caching)
  const handleSelectTab = async (tabId: string) => {
    setActiveTabId(tabId);
    
    // Sync active state in DB via single bulkPut transaction
    const allTabs = await db.tabs.toArray();
    const updatedTabs = allTabs.map((tab) => ({
      ...tab,
      active: tab.id === tabId,
    }));
    await db.tabs.bulkPut(updatedTabs);

    // Load active response from local memory cache for selected tab
    const cachedResponse = tabResponses[tabId] || {
      data: null,
      status: null,
      statusText: "",
      duration: null,
      size: null,
      headers: [],
    };
    setActiveResponse(cachedResponse.data);
    setActiveResponseStatus(cachedResponse.status);
    setActiveResponseStatusText(cachedResponse.statusText);
    setActiveResponseDuration(cachedResponse.duration);
    setActiveResponseSize(cachedResponse.size);
    setActiveResponseHeaders(cachedResponse.headers);
  };

  // Open sidebar request (creates or activates tab)
  const handleSelectRequest = async (requestId: string) => {
    const req = await db.requests.get(requestId);
    if (!req) return;

    // Check if tab already exists
    const existingTab = tabs.find((t) => t.requestId === requestId);
    if (existingTab) {
      handleSelectTab(existingTab.id);
    } else {
      // Create new tab
      const tabId = req.id;
      const nextOrder = tabs.length > 0 ? Math.min(...tabs.map(t => t.order)) - 1 : 0;
      await db.tabs.add({
        id: tabId,
        requestId: req.id,
        name: req.name,
        method: req.method,
        url: req.url,
        active: true,
        order: nextOrder,
      });
      await handleSelectTab(tabId);
    }
  };

  // REST API FETCH EXECUTOR ENGINE
  const handleSendRequest = async (req: RequestItem) => {
    setIsSending(true);
    setCorsErrorMsg(null);
    setActiveResponse(null);
    setActiveResponseStatus(null);
    setActiveResponseStatusText("");
    setActiveResponseDuration(null);
    setActiveResponseSize(null);
    setActiveResponseHeaders([]);

    // Open the response panel halfway standard layout when request is sent
    setResponseOpen(true);
    const currentZoom = zoomLevel * 1.35;
    if (layoutMode === "side-by-side") {
      const availWidth = (window.innerWidth / currentZoom) - (sidebarOpen ? sidebarWidth : 0) - 8;
      const halfWidth = Math.max(300, Math.round(availWidth / 2));
      setRequestPaneWidth(halfWidth);
    } else {
      const halfHeight = Math.max(250, Math.round((window.innerHeight / currentZoom) / 2));
      setResponsePaneHeight(halfHeight);
    }

    const tStart = performance.now();
    abortControllerRef.current = new AbortController();

    try {
      // Compile active environment variables merged with globals (using name for key mapping clarity)
      const mergedVariables = variables.map((v) => ({
        id: v.id,
        value: v.value,
        enabled: v.enabled
      }));

      // 1. Resolve variables in URL and parameters
      let resolvedUrl = resolveVariables(req.url, mergedVariables);

      // Apply parameters table to URL
      const { baseUrl } = parseUrlAndParams(resolvedUrl);
      resolvedUrl = buildUrlWithParams(baseUrl, req.params);
      resolvedUrl = resolveVariables(resolvedUrl, mergedVariables); // secondary check for variables inside parameters

      // 2. Prepare Headers
      const fetchHeaders = new Headers();

      // Apply authentication header properties
      if (req.auth.type === "bearer" && req.auth.bearerToken) {
        const token = resolveVariables(req.auth.bearerToken, mergedVariables);
        fetchHeaders.append("Authorization", token);
      } else if (req.auth.type === "basic" && req.auth.basicUsername) {
        const user = resolveVariables(req.auth.basicUsername, mergedVariables);
        const pass = resolveVariables(req.auth.basicPassword || "", mergedVariables);
        
        // Unicode-safe Base64 encoding
        const encoded = btoa(unescape(encodeURIComponent(`${user}:${pass}`)));
        fetchHeaders.append("Authorization", `Basic ${encoded}`);
      } else if (req.auth.type === "apiKey" && req.auth.apiKeyKey && req.auth.apiKeyValue) {
        const key = resolveVariables(req.auth.apiKeyKey, mergedVariables);
        const value = resolveVariables(req.auth.apiKeyValue, mergedVariables);
        if (req.auth.apiKeyAddTo === "query") {
          const sep = resolvedUrl.includes("?") ? "&" : "?";
          resolvedUrl = `${resolvedUrl}${sep}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
        } else {
          fetchHeaders.append(key, value);
        }
      }

      // Map request custom headers
      req.headers.forEach((h) => {
        if (h.enabled && h.key.trim()) {
          fetchHeaders.append(resolveVariables(h.key, mergedVariables), resolveVariables(h.value, mergedVariables));
        }
      });

      // 3. Prepare Body option
      let fetchBody: any = undefined;
      if (req.method !== "GET" && req.method !== "HEAD") {
        if (req.body.type === "json" || req.body.type === "xml" || req.body.type === "raw") {
          fetchBody = resolveVariables(req.body.content || "", mergedVariables);
        } else if (req.body.type === "form-data") {
          const form = new FormData();
          req.body.formParams?.forEach((p) => {
            if (p.enabled && p.key.trim()) {
              form.append(resolveVariables(p.key, mergedVariables), resolveVariables(p.value, mergedVariables));
            }
          });
          fetchBody = form;
        } else if (req.body.type === "urlencoded") {
          const urlParams = new URLSearchParams();
          req.body.formParams?.forEach((p) => {
            if (p.enabled && p.key.trim()) {
              urlParams.append(resolveVariables(p.key, mergedVariables), resolveVariables(p.value, mergedVariables));
            }
          });
          fetchBody = urlParams;
        }
      }

      // Check if CORS proxy is requested
      let finalTargetUrl = resolvedUrl;
      if (useProxy && proxyUrl) {
        finalTargetUrl = `${proxyUrl}${encodeURIComponent(resolvedUrl)}`;
      }

      // Ensure URL has protocol
      if (!finalTargetUrl.startsWith("http://") && !finalTargetUrl.startsWith("https://")) {
        finalTargetUrl = `https://${finalTargetUrl}`;
      }

      // 4. Fire network request
      const response = await fetch(finalTargetUrl, {
        method: req.method,
        headers: fetchHeaders,
        body: fetchBody,
        signal: abortControllerRef.current.signal,
      });

      const tEnd = performance.now();
      const duration = Math.round(tEnd - tStart);

      // Extract and map headers
      const resHeaders: { key: string; value: string }[] = [];
      response.headers.forEach((value, key) => {
        resHeaders.push({ key, value });
      });

      // Read response body content
      const text = await response.text();
      let parsedData: any = null;

      try {
        parsedData = JSON.parse(text);
      } catch {
        parsedData = text; // Fallback plain text or HTML
      }

      const size = new Blob([text]).size;

      // Update response cache for the active tab
      const responseState: TabResponseState = {
        data: parsedData,
        status: response.status,
        statusText: response.statusText || (response.status === 200 ? "OK" : ""),
        duration,
        size,
        headers: resHeaders,
      };

      if (activeTabId) {
        setTabResponses((prev) => ({ ...prev, [activeTabId]: responseState }));
      }

      // Update active response states
      setActiveResponse(parsedData);
      setActiveResponseStatus(response.status);
      setActiveResponseStatusText(responseState.statusText);
      setActiveResponseDuration(duration);
      setActiveResponseSize(size);
      setActiveResponseHeaders(resHeaders);

      // Cache Transaction run into local History Store
      await db.history.add({
        id: `hist-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
        requestId: req.id,
        name: req.name,
        method: req.method,
        url: resolvedUrl,
        status: response.status,
        statusText: response.statusText || "OK",
        duration,
        size,
        headers: resHeaders,
        requestHeaders: Array.from(fetchHeaders.entries()).map(([k, v]) => ({ key: k, value: v })),
        requestBody: req.body.content || "",
        responseBody: text,
        timestamp: Date.now(),
      });

      // Maintain database storage space by pruning history table
      await pruneHistory();
    } catch (err: any) {
      if (err.name === "AbortError") {
        setActiveResponseStatusText("Cancelled");
        return;
      }

      console.error("Execution network error", err);

      // Detect standard local browser CORS restriction blocker
      const isCorsBlocked = err.message?.toLowerCase().includes("failed to fetch") || err.name === "TypeError";
      if (isCorsBlocked && !useProxy) {
        setCorsErrorMsg(
          "CORS Policy Blocked! Standard browser sandboxing prevents loading this resource directly. Toggle CORS Proxy Mode above or enable a browser CORS bypass extension to bypass."
        );
      } else {
        setCorsErrorMsg(err.message || "Failed to establish a network connection to endpoint.");
      }

      const responseErrorState: TabResponseState = {
        data: { error: err.message || "Network request failed" },
        status: 0, // 0 represents a network error / no response received
        statusText: "Network Error",
        duration: null,
        size: null,
        headers: [],
      };

      if (activeTabId) {
        setTabResponses((prev) => ({ ...prev, [activeTabId]: responseErrorState }));
      }

      setActiveResponse(responseErrorState.data);
      setActiveResponseStatus(responseErrorState.status);
      setActiveResponseStatusText(responseErrorState.statusText);
    } finally {
      setIsSending(false);
    }
  };

  const handleCancelRequest = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setIsSending(false);
  };

  // Command palette triggered actions executor
  const handleCommandPaletteAction = (actionKey: string, payload?: any) => {
    switch (actionKey) {
      case "send-request":
        const activeTab = tabs.find((t) => t.id === activeTabId);
        const activeReq = collections ? db.requests.get(activeTab?.requestId || "") : null;
        activeReq?.then((r) => r && handleSendRequest(r));
        break;
      case "create-request":
        const triggerBtn = document.querySelector("button[title*='quick draft']") as HTMLButtonElement;
        triggerBtn?.click();
        break;
      case "create-collection":
        const sideCollAdd = document.querySelector("button[title='Create Collection']") as HTMLButtonElement;
        sideCollAdd?.click();
        break;
      case "import-collection":
        const sideImportBtn = document.querySelector("button[placeholder*='Import']") || document.querySelector("button[title*='Import']");
        (sideImportBtn as HTMLButtonElement)?.click();
        break;
      case "manage-variables":
        setVariablesOpen(true);
        break;
      case "focus-url":
        const urlIn = document.querySelector("input[placeholder*='Enter API']") as HTMLInputElement;
        urlIn?.focus();
        break;
      case "open-settings":
        setSettingsOpen(true);
        break;
      case "open-request":
        if (payload) handleSelectRequest(payload);
        break;
      case "replay-history":
        if (payload) {
          try {
            const data = JSON.parse(payload.responseBody);
            const replayState: TabResponseState = {
              data,
              status: payload.status,
              statusText: payload.statusText,
              duration: payload.duration,
              size: payload.size,
              headers: payload.headers,
            };
            if (activeTabId) {
              setTabResponses((prev) => ({ ...prev, [activeTabId]: replayState }));
            }
            setActiveResponse(data);
            setActiveResponseStatus(payload.status);
            setActiveResponseStatusText(payload.statusText);
            setActiveResponseDuration(payload.duration);
            setActiveResponseSize(payload.size);
            setActiveResponseHeaders(payload.headers);
            handleSelectRequest(payload.requestId);
          } catch {
            // fallback
          }
        }
        break;
      default:
        break;
    }
  };

  if (!isInitialized) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#0a0a0c] text-neutral-200 font-sans select-none">
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center gap-1.5 mb-2 h-4">
            <div className="w-2 h-2 rounded-full bg-[#FF6C37] bouncing-dot" />
            <div className="w-2 h-2 rounded-full bg-[#FF6C37] bouncing-dot" />
            <div className="w-2 h-2 rounded-full bg-[#FF6C37] bouncing-dot" />
          </div>
          <span className="text-[11px] font-semibold text-neutral-400 tracking-wider">Loading Apify</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-neutral-950 font-sans text-neutral-200">
      {/* Three Column Grid Workspace */}
      <div className="flex-1 flex min-h-0 w-full relative">
        {/* COLUMN 1: SIDEBAR */}
        {sidebarOpen && !responseMaximized && (
          <div style={{ width: `${sidebarWidth}px` }} className="h-full shrink-0 relative">
            <CollectionSidebar
              activeRequestId={tabs.find((t) => t.id === activeTabId)?.requestId || null}
              onSelectRequest={handleSelectRequest}
              onOpenVariables={() => setVariablesOpen(true)}
              onOpenSettings={(tab) => openSettingsToTab(tab || "general")}
            />

            {/* Mouse drag handlebar */}
            <div
              onMouseDown={() => setIsDraggingSidebar(true)}
              className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-[#007acc]/50 bg-transparent z-[40] transition-colors"
            />
          </div>
        )}

        {/* COLUMN 2 & 3 CONTAINER */}
        {!responseOpen ? (
          /* Response Collapsed: Stacked layout with 90% top (Request) and 10% bottom (Response Collapsed) */
          <div className="flex-1 flex flex-col h-full min-w-0 relative animate-fade-in">
            <div className="flex-1 min-h-0 relative">
              <RequestWorkspace
                activeTabId={activeTabId}
                onSelectTab={handleSelectTab}
                onSendRequest={handleSendRequest}
                isSending={isSending}
                onCancelRequest={handleCancelRequest}
                sidebarOpen={sidebarOpen}
                setSidebarOpen={setSidebarOpen}
                responseOpen={false}
                setResponseOpen={setResponseOpen}
                layoutMode={layoutMode}
                setLayoutMode={setLayoutMode}
                theme={theme}
                onOpenVariables={() => setVariablesOpen(true)}
                onOpenSettings={(tab) => openSettingsToTab(tab || "general")}
              />
            </div>
            <div className="h-7 border-t border-neutral-800 shrink-0">
              <ResponseWorkspace
                responseData={activeResponse}
                responseStatus={activeResponseStatus}
                responseStatusText={activeResponseStatusText}
                responseDuration={activeResponseDuration}
                responseSize={activeResponseSize}
                responseHeaders={activeResponseHeaders}
                activeRequest={requests.find((r) => r.id === tabs.find((t) => t.id === activeTabId)?.requestId) || null}
                isMaximized={false}
                onToggleMaximize={() => {}}
                onMinimize={() => {}}
                isCollapsed={true}
                onExpand={() => setResponseOpen(true)}
                theme={theme}
              />
            </div>
          </div>
        ) : layoutMode === "side-by-side" ? (
          <div className="flex-1 flex h-full min-w-0 relative">
            {/* COLUMN 2: REQUEST WORKSPACE */}
            {!responseMaximized && (
              <div
                style={{ width: `${requestPaneWidth}px` }}
                className="h-full shrink-0 relative min-w-0 flex-1"
              >
                <RequestWorkspace
                  activeTabId={activeTabId}
                  onSelectTab={handleSelectTab}
                  onSendRequest={handleSendRequest}
                  isSending={isSending}
                  onCancelRequest={handleCancelRequest}
                  sidebarOpen={sidebarOpen}
                  setSidebarOpen={setSidebarOpen}
                  responseOpen={true}
                  setResponseOpen={setResponseOpen}
                  layoutMode={layoutMode}
                  setLayoutMode={setLayoutMode}
                  theme={theme}
                  onOpenVariables={() => setVariablesOpen(true)}
                  onOpenSettings={(tab) => openSettingsToTab(tab || "general")}
                />

                {/* Mouse drag handlebar */}
                <div
                  onMouseDown={() => setIsDraggingRequestPane(true)}
                  className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-[#007acc]/50 bg-transparent z-[40] transition-colors"
                />
              </div>
            )}

            {/* COLUMN 3: RESPONSE WORKSPACE */}
            <div className="flex-1 h-full min-w-0 relative">
              <ResponseWorkspace
                responseData={activeResponse}
                responseStatus={activeResponseStatus}
                responseStatusText={activeResponseStatusText}
                responseDuration={activeResponseDuration}
                responseSize={activeResponseSize}
                responseHeaders={activeResponseHeaders}
                activeRequest={requests.find((r) => r.id === tabs.find((t) => t.id === activeTabId)?.requestId) || null}
                isMaximized={responseMaximized}
                onToggleMaximize={() => setResponseMaximized(!responseMaximized)}
                theme={theme}
                onMinimize={() => {
                  setResponseOpen(false);
                  setResponseMaximized(false);
                }}
              />
            </div>
          </div>
        ) : (
          /* Stacked Vertical Layout */
          <div className="flex-1 flex flex-col h-full min-w-0 relative">
            {/* COLUMN 2: REQUEST WORKSPACE (Top) */}
            {!responseMaximized && (
              <div className="flex-1 min-h-0 relative">
                <RequestWorkspace
                  activeTabId={activeTabId}
                  onSelectTab={handleSelectTab}
                  onSendRequest={handleSendRequest}
                  isSending={isSending}
                  onCancelRequest={handleCancelRequest}
                  sidebarOpen={sidebarOpen}
                  setSidebarOpen={setSidebarOpen}
                  responseOpen={true}
                  setResponseOpen={setResponseOpen}
                  layoutMode={layoutMode}
                  setLayoutMode={setLayoutMode}
                  theme={theme}
                  onOpenVariables={() => setVariablesOpen(true)}
                  onOpenSettings={(tab) => openSettingsToTab(tab || "general")}
                />
              </div>
            )}

            {/* Horizontal drag handlebar for vertical resizing */}
            {!responseMaximized && (
              <div
                onMouseDown={() => setIsDraggingResponseHeight(true)}
                className="h-1 w-full cursor-row-resize hover:bg-[#007acc]/50 bg-neutral-950 border-t border-neutral-800 z-[45] transition-colors shrink-0"
              />
            )}

            {/* COLUMN 3: RESPONSE WORKSPACE (Bottom) */}
            <div
              style={{ height: responseMaximized ? '100%' : `${responsePaneHeight}px` }}
              className="min-h-0 relative border-t border-neutral-800 shrink-0 flex flex-col w-full"
            >
              <ResponseWorkspace
                responseData={activeResponse}
                responseStatus={activeResponseStatus}
                responseStatusText={activeResponseStatusText}
                responseDuration={activeResponseDuration}
                responseSize={activeResponseSize}
                responseHeaders={activeResponseHeaders}
                activeRequest={requests.find((r) => r.id === tabs.find((t) => t.id === activeTabId)?.requestId) || null}
                isMaximized={responseMaximized}
                onToggleMaximize={() => setResponseMaximized(!responseMaximized)}
                theme={theme}
                onMinimize={() => {
                  setResponseOpen(false);
                  setResponseMaximized(false);
                }}
              />
            </div>
          </div>
        )}
      </div>

      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        theme={theme}
        onThemeChange={(newTheme) => setTheme(newTheme)}
        useProxy={useProxy}
        onProxyChange={(val) => setUseProxy(val)}
        proxyUrl={proxyUrl}
        onProxyUrlChange={(val) => setProxyUrl(val)}
        fontFamily={fontFamily}
        onFontFamilyChange={(newFont) => setFontFamily(newFont)}
        initialTab={settingsTab}
        onTabChange={(tab) => setSettingsTab(tab)}
      />

      {/* CORS Error explanation banner popover */}
      {corsErrorMsg && (
        <div className="fixed bottom-16 right-4 z-[250] max-w-sm rounded-xl border border-rose-500/20 bg-rose-950/90 text-rose-200 p-4 shadow-2xl backdrop-blur-md flex flex-col gap-2.5 animate-slide-up">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-1.5 text-xs font-bold text-rose-400">
              <AlertTriangle className="h-4 w-4" />
              <span>CORS Block Alert</span>
            </div>
            <button
              onClick={() => setCorsErrorMsg(null)}
              className="text-rose-400 hover:text-white rounded hover:bg-rose-900/30 p-0.5 cursor-pointer transition-colors shrink-0"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="text-[11px] leading-relaxed font-sans text-rose-300">
            {corsErrorMsg}
          </p>
          <div className="flex justify-end gap-2 mt-1 shrink-0">
            <button
              onClick={() => {
                setUseProxy(true);
                setCorsErrorMsg(null);
              }}
              className="px-2.5 py-1 bg-rose-900/60 hover:bg-rose-800 text-rose-100 text-[10px] font-bold rounded cursor-pointer transition-colors"
            >
              Enable CORS Proxy fallback
            </button>
          </div>
        </div>
      )}

      {/* Modals & Command Palettes */}
      <VariablesModal isOpen={variablesOpen} onClose={() => setVariablesOpen(false)} />

      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onAction={handleCommandPaletteAction}
      />

      {/* Global themed toast notifications — replaces all native alert() dialogs */}
      <Toast />

      {/* VS Code Style Status Bar (Fixed 24px height, dark unified background, controls on the right, Settings on the left) */}
      <div className="h-6 shrink-0 bg-sidebar-bg border-t border-sidebar-border text-sidebar-text-muted flex items-center justify-between px-3 text-[10.5px] font-sans select-none z-[30] relative">
        {/* Left side: Settings trigger */}
        <div className="w-48 shrink-0 flex items-center gap-1.5">
          <button
            onClick={() => openSettingsToTab("general")}
            className="p-1 hover:bg-sidebar-selection hover:text-sidebar-text rounded text-sidebar-text-muted transition-colors cursor-pointer bg-transparent border-none flex items-center gap-1"
            title="Preferences & Themes"
          >
            <Settings className="h-3.5 w-3.5" />
            <span className="font-sans font-medium text-[10px]">Settings</span>
          </button>
        </div>

        {/* Center: Branding */}
        <div className="font-semibold text-neutral-300 absolute left-1/2 transform -translate-x-1/2">
          Designed by Akib
        </div>

        {/* Right side: Layout control toggles and variables settings icon */}
        <div className="flex items-center gap-2">
          {/* Zoom controls */}
          <div className="flex items-center gap-1 border-r border-neutral-800 pr-2 mr-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <button
              onClick={handleZoomOut}
              className="p-0.5 hover:bg-neutral-800 rounded text-neutral-400 hover:text-white cursor-pointer font-bold text-xs leading-none w-4 h-4 flex items-center justify-center bg-transparent border-none"
              title="Zoom Out (Ctrl+-)"
            >
              -
            </button>
            <span className="text-[9px] font-mono text-neutral-400 min-w-[32px] text-center">
              {Math.round(zoomLevel * 100)}%
            </span>
            <button
              onClick={handleZoomIn}
              className="p-0.5 hover:bg-neutral-800 rounded text-neutral-400 hover:text-white cursor-pointer font-bold text-xs leading-none w-4 h-4 flex items-center justify-center bg-transparent border-none"
              title="Zoom In (Ctrl++)"
            >
              +
            </button>
          </div>

          {/* Variables Modal Trigger */}
          <button
            onClick={() => setVariablesOpen(true)}
            className="p-1 hover:bg-sidebar-selection hover:text-sidebar-text rounded text-sidebar-text-muted transition-colors cursor-pointer flex items-center gap-1 bg-transparent border-none"
            title="Manage Variables (Ctrl+Shift+V)"
          >
            <Sliders className="h-3 w-3 text-emerald-400" />
            <span className="font-sans font-medium text-[10px]">Variables</span>
          </button>

          <span className="text-neutral-800 select-none">|</span>

          {/* Toggle Sidebar */}
          <button
            onClick={() => {
              setSidebarOpen(!sidebarOpen);
              setResponseMaximized(false);
            }}
            className={`p-1 rounded hover:bg-sidebar-selection transition-colors cursor-pointer bg-transparent border-none ${sidebarOpen ? "text-[#007acc]" : "text-sidebar-text-muted hover:text-sidebar-text"}`}
            title="Toggle Sidebar (Ctrl+B)"
          >
            <svg stroke="currentColor" fill="none" strokeWidth="2.5" viewBox="0 0 24 24" className="h-3.5 w-3.5">
              <rect width="18" height="18" x="3" y="3" rx="2"></rect>
              <path d="M9 3v18"></path>
            </svg>
          </button>

          {/* Toggle Split Mode */}
          <button
            onClick={() => {
              setLayoutMode(layoutMode === "side-by-side" ? "stacked" : "side-by-side");
              setResponseMaximized(false);
            }}
            className={`p-1 rounded hover:bg-sidebar-selection transition-colors cursor-pointer bg-transparent border-none ${layoutMode === "stacked" ? "text-[#007acc]" : "text-sidebar-text-muted"}`}
            title={layoutMode === "stacked" ? "Layout: Stacked (Top/Bottom)" : "Layout: Side-by-Side"}
          >
            {layoutMode === "stacked" ? (
              <svg stroke="currentColor" fill="none" strokeWidth="2.5" viewBox="0 0 24 24" className="h-3.5 w-3.5">
                <rect width="18" height="18" x="3" y="3" rx="2"></rect>
                <path d="M3 12h18"></path>
              </svg>
            ) : (
              <svg stroke="currentColor" fill="none" strokeWidth="2.5" viewBox="0 0 24 24" className="h-3.5 w-3.5">
                <rect width="18" height="18" x="3" y="3" rx="2"></rect>
                <path d="M12 3v18"></path>
              </svg>
            )}
          </button>

          {/* Toggle Response Panel */}
          <button
            onClick={() => {
              setResponseOpen(!responseOpen);
              setResponseMaximized(false);
            }}
            className={`p-1 rounded hover:bg-sidebar-selection transition-colors cursor-pointer bg-transparent border-none ${responseOpen ? "text-[#007acc]" : "text-sidebar-text-muted hover:text-sidebar-text"}`}
            title="Toggle Response (Ctrl+J)"
          >
            <svg stroke="currentColor" fill="none" strokeWidth="2.5" viewBox="0 0 24 24" className="h-3.5 w-3.5">
              <rect width="18" height="18" x="3" y="3" rx="2"></rect>
              <path d="M15 3v18"></path>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
