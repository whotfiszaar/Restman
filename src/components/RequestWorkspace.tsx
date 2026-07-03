import { useState, useEffect, useRef, useMemo } from "react";
import { db, type RequestItem, type RequestTab, type Variable } from "../db/db";
import { parseUrlAndParams, buildUrlWithParams, detectSmartRequestType, resolveVariables } from "../utils/urlHelper";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Play,
  Plus,
  X,
  PlusCircle,
  Trash2,
  Lock,
  Undo2,
  Redo2,
  Upload
} from "lucide-react";
import Editor from "@monaco-editor/react";
import CustomSelect from "./CustomSelect";
import ModernConfirmModal from "./ModernConfirmModal";

interface RequestWorkspaceProps {
  activeTabId: string | null;
  onSelectTab: (id: string) => void;
  onSendRequest: (req: RequestItem) => void;
  isSending: boolean;
  onCancelRequest: () => void;
  sidebarOpen: boolean;
  setSidebarOpen: (val: boolean) => void;
  responseOpen: boolean;
  setResponseOpen: (val: boolean) => void;
  layoutMode: "side-by-side" | "stacked";
  setLayoutMode: (val: "side-by-side" | "stacked") => void;
  theme: string;
  onOpenVariables?: () => void;
  onOpenSettings?: (tab?: "general" | "themes" | "shortcuts" | "about" | "import") => void;
}

type SubTabType = "params" | "headers" | "auth" | "body" | "variables";

// Autocomplete Suggestions for headers (moved outside of component to prevent re-renders)
const HEADER_SUGGESTIONS = [
  "Accept",
  "Accept-Encoding",
  "Accept-Language",
  "Authorization",
  "Cache-Control",
  "Connection",
  "Content-Length",
  "Content-Type",
  "Cookie",
  "Host",
  "Origin",
  "Referer",
  "User-Agent"
];

export default function RequestWorkspace({
  activeTabId,
  onSelectTab,
  onSendRequest,
  isSending,
  onCancelRequest,
  sidebarOpen,
  setSidebarOpen,
  responseOpen: _responseOpen,
  setResponseOpen: _setResponseOpen,
  layoutMode: _layoutMode,
  setLayoutMode: _setLayoutMode,
  theme,
  onOpenVariables: _onOpenVariables,
  onOpenSettings,
}: RequestWorkspaceProps) {
  // Autocomplete Header Key Suggestions active index states
  const [activeHeaderSuggestionsIdx, setActiveHeaderSuggestionsIdx] = useState<number | null>(null);
  const [activeHeaderSuggestionsRowIdx, setActiveHeaderSuggestionsRowIdx] = useState<number | null>(null);
  const [headerFilter, setHeaderFilter] = useState("");

  // Undo / Redo history tracking state definition
  interface HistoryState {
    url: string;
    method: any;
    headers: any[];
    params: any[];
    body: any;
    auth: any;
  }

  const historyRef = useRef<Record<string, { past: HistoryState[]; future: HistoryState[] }>>({});
  const lastSavedStateRef = useRef<Record<string, HistoryState>>({});
  const lastActionTimeRef = useRef<number>(0);
  const lastReqIdRef = useRef<string | null>(null);
  // DB Subscriptions
  const tabs = (useLiveQuery(() => db.tabs.orderBy("order").toArray()) as RequestTab[]) || [];
  const requests = (useLiveQuery(() => db.requests.toArray()) as RequestItem[]) || [];
  const variables = (useLiveQuery(() => db.variables.toArray()) as Variable[]) || [];

  // Merge globals (no environments)
  const mergedVariables = useMemo(() => {
    return variables.map((v) => ({ id: v.id, value: v.value, enabled: v.enabled }));
  }, [variables]);

  // Quick Variable hover popover state
  const [activeQuickVar, setActiveQuickVar] = useState<{
    name: string;
    value: string;
    rect: DOMRect;
  } | null>(null);

  const getVariableAtCursor = (value: string, cursorIndex: number): string | null => {
    if (!value) return null;
    const regex = /\$\{([^}]+)\}/g;
    let match;
    while ((match = regex.exec(value)) !== null) {
      const startIdx = match.index;
      const endIdx = regex.lastIndex;
      if (cursorIndex >= startIdx && cursorIndex <= endIdx) {
        return match[1].trim();
      }
    }
    return null;
  };

  const handleInputCheckVar = (e: React.SyntheticEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const val = el.value;
    const cursor = el.selectionStart || 0;
    const varName = getVariableAtCursor(val, cursor);

    if (varName) {
      const rect = el.getBoundingClientRect();
      setActiveQuickVar({
        name: varName,
        value: val,
        rect
      });
    } else {
      setActiveQuickVar(null);
    }
  };

  const handleInputBlur = () => {
    setTimeout(() => {
      if (document.activeElement && document.activeElement.closest(".quick-var-popup-container")) {
        return;
      }
      setActiveQuickVar(null);
    }, 250);
  };

  // Active Tab & Request resolution
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const activeRequest = requests.find((r) => r.id === activeTab?.requestId);

  // Local states for inputs to support debouncing
  const [localUrl, setLocalUrl] = useState("");
  const [localParams, setLocalParams] = useState<any[]>([]);
  const [localHeaders, setLocalHeaders] = useState<any[]>([]);
  const [localBodyContent, setLocalBodyContent] = useState("");
  const [localFormParams, setLocalFormParams] = useState<any[]>([]);

  // Tab internal sub-panel state
  const [subTab, setSubTab] = useState<SubTabType>("params");


  // Focus controller
  const urlInputRef = useRef<HTMLTextAreaElement>(null);

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; tabId: string } | null>(null);
  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  // Refs for debouncing DB updates
  const debounceTimers = useRef<Record<string, NodeJS.Timeout>>({});

  // Sync local states from DB when activeRequest changes or when DB updates externally
  useEffect(() => {
    if (activeRequest) {
      if (!debounceTimers.current["url"]) {
        setLocalUrl(activeRequest.url || "");
      }
      if (!debounceTimers.current["params"]) {
        setLocalParams(activeRequest.params || []);
      }
      if (!debounceTimers.current["headers"]) {
        setLocalHeaders(activeRequest.headers || []);
      }
      if (!debounceTimers.current["body"]) {
        setLocalBodyContent(activeRequest.body?.content || "");
      }
      if (!debounceTimers.current["formParams"]) {
        setLocalFormParams(activeRequest.body?.formParams || []);
      }
    } else {
      setLocalUrl("");
      setLocalParams([]);
      setLocalHeaders([]);
      setLocalBodyContent("");
      setLocalFormParams([]);
    }
  }, [activeRequest]);

  // Helper to get current state of request
  const getHistoryState = (): HistoryState | null => {
    if (!activeRequest) return null;
    return {
      url: localUrl,
      method: activeRequest.method,
      headers: JSON.parse(JSON.stringify(localHeaders)),
      params: JSON.parse(JSON.stringify(localParams)),
      body: JSON.parse(JSON.stringify(activeRequest.body || { type: "none" })),
      auth: JSON.parse(JSON.stringify(activeRequest.auth || { type: "none" })),
    };
  };

  const saveHistoryState = (forceNewEntry = false) => {
    if (!activeRequest) return;
    const reqId = activeRequest.id;
    const current = getHistoryState();
    if (!current) return;

    if (!historyRef.current[reqId]) {
      historyRef.current[reqId] = { past: [], future: [] };
    }

    const hist = historyRef.current[reqId];
    const lastSaved = lastSavedStateRef.current[reqId];

    if (lastSaved && 
        lastSaved.url === current.url &&
        lastSaved.method === current.method &&
        JSON.stringify(lastSaved.headers) === JSON.stringify(current.headers) &&
        JSON.stringify(lastSaved.params) === JSON.stringify(current.params) &&
        JSON.stringify(lastSaved.body) === JSON.stringify(current.body) &&
        JSON.stringify(lastSaved.auth) === JSON.stringify(current.auth)) {
      return; // No change, don't save
    }

    const now = Date.now();
    const timeSinceLastAction = now - lastActionTimeRef.current;
    
    if (forceNewEntry || timeSinceLastAction > 1500 || !lastSaved) {
      if (lastSaved) {
        hist.past.push(lastSaved);
        if (hist.past.length > 50) hist.past.shift();
      }
      hist.future = [];
    }

    lastSavedStateRef.current[reqId] = current;
    lastActionTimeRef.current = now;
  };

  const handleUndo = async () => {
    if (!activeRequest) return;
    const reqId = activeRequest.id;
    const hist = historyRef.current[reqId];
    if (!hist || hist.past.length === 0) return;

    const current = getHistoryState();
    if (current) {
      hist.future.push(current);
    }

    const previous = hist.past.pop()!;
    lastSavedStateRef.current[reqId] = previous;
    lastActionTimeRef.current = Date.now();

    setLocalUrl(previous.url);
    setLocalParams(previous.params);
    setLocalHeaders(previous.headers);
    if (previous.body.content !== undefined) {
      setLocalBodyContent(previous.body.content);
    }
    if (previous.body.formParams !== undefined) {
      setLocalFormParams(previous.body.formParams);
    }

    await db.requests.update(reqId, {
      url: previous.url,
      method: previous.method,
      headers: previous.headers,
      params: previous.params,
      body: previous.body,
      auth: previous.auth,
      updatedAt: Date.now(),
    });
  };

  const handleRedo = async () => {
    if (!activeRequest) return;
    const reqId = activeRequest.id;
    const hist = historyRef.current[reqId];
    if (!hist || hist.future.length === 0) return;

    const current = getHistoryState();
    if (current) {
      hist.past.push(current);
    }

    const next = hist.future.pop()!;
    lastSavedStateRef.current[reqId] = next;
    lastActionTimeRef.current = Date.now();

    setLocalUrl(next.url);
    setLocalParams(next.params);
    setLocalHeaders(next.headers);
    if (next.body.content !== undefined) {
      setLocalBodyContent(next.body.content);
    }
    if (next.body.formParams !== undefined) {
      setLocalFormParams(next.body.formParams);
    }

    await db.requests.update(reqId, {
      url: next.url,
      method: next.method,
      headers: next.headers,
      params: next.params,
      body: next.body,
      auth: next.auth,
      updatedAt: Date.now(),
    });
  };

  // Keyboard undo/redo shortcuts hook
  useEffect(() => {
    const handleUndoRedoKeys = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
        const activeEl = document.activeElement;
        if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || activeEl.closest(".monaco-editor"))) {
          e.preventDefault();
          handleUndo();
        }
      }
      if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") || 
          ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "z")) {
        const activeEl = document.activeElement;
        if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || activeEl.closest(".monaco-editor"))) {
          e.preventDefault();
          handleRedo();
        }
      }
    };
    window.addEventListener("keydown", handleUndoRedoKeys);
    return () => window.removeEventListener("keydown", handleUndoRedoKeys);
  }, [activeRequest, localUrl, localParams, localHeaders, localBodyContent, localFormParams]);

  // Sync inputs with history baseline, handling tab changes
  useEffect(() => {
    if (!activeRequest) return;
    const reqId = activeRequest.id;

    if (lastReqIdRef.current !== reqId) {
      lastReqIdRef.current = reqId;
      const current = {
        url: activeRequest.url || "",
        method: activeRequest.method || "GET",
        headers: JSON.parse(JSON.stringify(activeRequest.headers || [])),
        params: JSON.parse(JSON.stringify(activeRequest.params || [])),
        body: JSON.parse(JSON.stringify(activeRequest.body || { type: "none" })),
        auth: JSON.parse(JSON.stringify(activeRequest.auth || { type: "none" })),
      };
      lastSavedStateRef.current[reqId] = current;
      lastActionTimeRef.current = Date.now();
      return;
    }

    saveHistoryState();
  }, [localUrl, localParams, localHeaders, localBodyContent, localFormParams, activeRequest?.method, activeRequest?.auth]);

  useEffect(() => {
    const closeMenu = () => setContextMenu(null);
    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, []);

  // Auto-grow the URL textarea height when active request or url changes
  useEffect(() => {
    if (urlInputRef.current) {
      urlInputRef.current.style.height = "auto";
      urlInputRef.current.style.height = `${Math.min(urlInputRef.current.scrollHeight, 120)}px`;
    }
  }, [localUrl, activeRequest?.id]);

  // Shortcut binder for sending request (Ctrl + Enter)
  useEffect(() => {
    const handleKeys = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (activeRequest && !isSending) {
          onSendRequest(activeRequest);
        }
      }
    };
    window.addEventListener("keydown", handleKeys);
    return () => window.removeEventListener("keydown", handleKeys);
  }, [activeRequest, isSending, onSendRequest]);

  // Debounced DB Write Wrapper
  const runDebouncedUpdate = (key: string, updateFn: () => Promise<void>) => {
    if (debounceTimers.current[key]) {
      clearTimeout(debounceTimers.current[key]);
    }
    debounceTimers.current[key] = setTimeout(async () => {
      try {
        await updateFn();
      } catch (err) {
        console.error(`DB write failed for ${key}:`, err);
      } finally {
        delete debounceTimers.current[key];
      }
    }, 250);
  };

  // Tab management actions
  const handleCloseTab = async (tabId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await db.tabs.delete(tabId);
      // If active tab was closed, select another one
      if (activeTabId === tabId) {
        const remaining = tabs.filter((t) => t.id !== tabId);
        if (remaining.length > 0) {
          onSelectTab(remaining[0].id);
        } else {
          onSelectTab("");
        }
      }
    } catch (err) {
      console.error("Failed to close tab:", err);
    }
  };

  const handleCreateDraft = async () => {
    const draftId = `draft-${Date.now()}`;
    const newReq: RequestItem = {
      id: draftId,
      collectionId: "drafts",
      folderId: null,
      name: "New Request Draft",
      method: "GET",
      url: "",
      headers: [
        { id: `h-${Date.now()}-0`, key: "Accept", value: "application/json", enabled: true },
      ],
      params: [],
      auth: { type: "none" },
      body: { type: "none" },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    try {
      await db.requests.add(newReq);
      
      const nextOrder = tabs.length > 0 ? Math.min(...tabs.map(t => t.order)) - 1 : 0;
      await db.tabs.add({
        id: draftId,
        requestId: draftId,
        name: "New Request Draft",
        method: "GET",
        url: "",
        active: true,
        order: nextOrder,
      });

      onSelectTab(draftId);
    } catch (err) {
      console.error("Failed to create draft:", err);
    }
  };

  // Synchronize Tab state from Request
  useEffect(() => {
    if (activeTab && activeRequest) {
      if (activeTab.name !== activeRequest.name || activeTab.method !== activeRequest.method || activeTab.url !== activeRequest.url) {
        db.tabs.update(activeTab.id, {
          name: activeRequest.name,
          method: activeRequest.method,
          url: activeRequest.url,
        }).catch(err => console.error("Failed to sync tab from request:", err));
      }
    }
  }, [activeRequest, activeTab]);

  // Handle smart updates on URLs (Bi-directional parameters table extraction)
  const handleUrlChange = (urlVal: string) => {
    if (!activeRequest) return;
    setLocalUrl(urlVal);

    runDebouncedUpdate("url", async () => {
      const { params: parsedParams } = parseUrlAndParams(urlVal);

      // Intelligent merge parameters
      const enabledParams = parsedParams.map((p) => {
        const existing = activeRequest.params.find(
          (ap) => ap.enabled && ap.key === p.key && ap.value === p.value
        ) || activeRequest.params.find(
          (ap) => ap.enabled && ap.key === p.key
        );
        return {
          id: existing ? existing.id : p.id,
          key: p.key,
          value: p.value,
          enabled: true,
          description: existing ? existing.description : "",
        };
      });

      const disabledParams = activeRequest.params.filter((p) => !p.enabled);
      const mergedParams = [...enabledParams, ...disabledParams];

      await db.requests.update(activeRequest.id, {
        url: urlVal,
        params: mergedParams,
        updatedAt: Date.now(),
      });
      setLocalParams(mergedParams);
    });
  };

  // URL input paste interception for immediate extraction feedback
  const handleUrlPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pastedText = e.clipboardData.getData("Text");
    if (!pastedText) return;

    if (pastedText.trim().startsWith("{") || pastedText.trim().startsWith("[")) {
      try {
        const parsed = JSON.parse(pastedText);
        if (activeRequest) {
          e.preventDefault();
          setConfirmState({
            isOpen: true,
            title: "JSON Payload Detected",
            message: "Detected a JSON payload. Would you like to shift to the JSON request body tab and insert it there?",
            onConfirm: async () => {
              try {
                await db.requests.update(activeRequest.id, {
                  body: {
                    type: "json",
                    content: JSON.stringify(parsed, null, 2),
                  },
                });
                setLocalBodyContent(JSON.stringify(parsed, null, 2));
                setSubTab("body");
              } catch (err) {
                console.error("Failed to insert pasted JSON payload:", err);
              }
              setConfirmState(null);
            }
          });
        }
      } catch {
        // Continue URL paste
      }
    } else if (pastedText.toLowerCase().startsWith("http://") || pastedText.toLowerCase().startsWith("https://") || pastedText.includes("?")) {
      e.preventDefault();
      try {
        let decoded = pastedText;
        for (let i = 0; i < 3; i++) {
          const nextDecoded = decodeURIComponent(decoded);
          if (nextDecoded === decoded) break;
          decoded = nextDecoded;
        }

        const textarea = e.currentTarget;
        const start = textarea.selectionStart || 0;
        const end = textarea.selectionEnd || 0;
        const currentVal = textarea.value;
        const newVal = currentVal.substring(0, start) + decoded + currentVal.substring(end);

        handleUrlChange(newVal);
      } catch (err) {
        console.error("Failed to decode pasted URL:", err);
      }
    }
  };

  // Param row modifiers
  const handleParamRowChange = (idx: number, field: "key" | "value" | "description", val: string) => {
    if (!activeRequest) return;
    const items = [...localParams];
    items[idx][field] = val;
    setLocalParams(items);

    const { baseUrl } = parseUrlAndParams(localUrl);
    const newFullUrl = buildUrlWithParams(baseUrl, items);
    setLocalUrl(newFullUrl);

    runDebouncedUpdate("params", async () => {
      await db.requests.update(activeRequest.id, {
        url: newFullUrl,
        params: items,
        updatedAt: Date.now(),
      });
    });
  };

  const handleParamToggle = async (idx: number) => {
    if (!activeRequest) return;
    saveHistoryState(true);
    const items = [...localParams];
    items[idx].enabled = !items[idx].enabled;
    setLocalParams(items);

    const { baseUrl } = parseUrlAndParams(localUrl);
    const newFullUrl = buildUrlWithParams(baseUrl, items);
    setLocalUrl(newFullUrl);

    try {
      await db.requests.update(activeRequest.id, {
        url: newFullUrl,
        params: items,
        updatedAt: Date.now(),
      });
      setTimeout(() => saveHistoryState(true), 0);
    } catch (err) {
      console.error("Failed to toggle param:", err);
    }
  };

  const handleAddParamRow = async () => {
    if (!activeRequest) return;
    saveHistoryState(true);
    const newRow = {
      id: `param-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      key: "",
      value: "",
      enabled: true,
    };
    const updated = [...localParams, newRow];
    setLocalParams(updated);

    const { baseUrl } = parseUrlAndParams(localUrl);
    const newFullUrl = buildUrlWithParams(baseUrl, updated);
    setLocalUrl(newFullUrl);

    try {
      await db.requests.update(activeRequest.id, {
        url: newFullUrl,
        params: updated,
      });
      setTimeout(() => saveHistoryState(true), 0);
    } catch (err) {
      console.error("Failed to add param row:", err);
    }
  };

  const handleRemoveParamRow = async (idx: number) => {
    if (!activeRequest) return;
    saveHistoryState(true);
    const items = [...localParams];
    items.splice(idx, 1);
    setLocalParams(items);

    const { baseUrl } = parseUrlAndParams(localUrl);
    const newFullUrl = buildUrlWithParams(baseUrl, items);
    setLocalUrl(newFullUrl);

    try {
      await db.requests.update(activeRequest.id, {
        url: newFullUrl,
        params: items,
      });
      setTimeout(() => saveHistoryState(true), 0);
    } catch (err) {
      console.error("Failed to remove param row:", err);
    }
  };

  // Header row modifiers
  const handleHeaderRowChange = (idx: number, field: "key" | "value" | "description", val: string) => {
    if (!activeRequest) return;
    const items = [...localHeaders];
    items[idx][field] = val;
    setLocalHeaders(items);

    runDebouncedUpdate("headers", async () => {
      await db.requests.update(activeRequest.id, {
        headers: items,
        updatedAt: Date.now(),
      });
    });
  };

  const handleHeaderToggle = async (idx: number) => {
    if (!activeRequest) return;
    const items = [...localHeaders];
    items[idx].enabled = !items[idx].enabled;
    setLocalHeaders(items);

    try {
      await db.requests.update(activeRequest.id, {
        headers: items,
        updatedAt: Date.now(),
      });
    } catch (err) {
      console.error("Failed to toggle header:", err);
    }
  };

  const handleAddHeaderRow = async () => {
    if (!activeRequest) return;
    const newRow = {
      id: `header-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      key: "",
      value: "",
      enabled: true,
    };
    const updated = [...localHeaders, newRow];
    setLocalHeaders(updated);

    try {
      await db.requests.update(activeRequest.id, {
        headers: updated,
      });
    } catch (err) {
      console.error("Failed to add header row:", err);
    }
  };

  const handleRemoveHeaderRow = async (idx: number) => {
    if (!activeRequest) return;
    const items = [...localHeaders];
    items.splice(idx, 1);
    setLocalHeaders(items);

    try {
      await db.requests.update(activeRequest.id, {
        headers: items,
      });
    } catch (err) {
      console.error("Failed to remove header row:", err);
    }
  };

  const handleHeaderKeyDown = (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (activeHeaderSuggestionsRowIdx !== idx) return;
    const filtered = HEADER_SUGGESTIONS.filter(item => 
      item.toLowerCase().includes(headerFilter.toLowerCase())
    ).sort((a, b) => {
      const aStart = a.toLowerCase().startsWith(headerFilter.toLowerCase());
      const bStart = b.toLowerCase().startsWith(headerFilter.toLowerCase());
      if (aStart && !bStart) return -1;
      if (!aStart && bStart) return 1;
      return 0;
    });
    if (filtered.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveHeaderSuggestionsIdx(prev => 
        prev === null || prev >= filtered.length - 1 ? 0 : prev + 1
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveHeaderSuggestionsIdx(prev => 
        prev === null || prev <= 0 ? filtered.length - 1 : prev - 1
      );
    } else if (e.key === "Enter") {
      if (activeHeaderSuggestionsIdx !== null && filtered[activeHeaderSuggestionsIdx]) {
        e.preventDefault();
        const selectedVal = filtered[activeHeaderSuggestionsIdx];
        handleHeaderRowChange(idx, "key", selectedVal);
        setActiveHeaderSuggestionsRowIdx(null);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setActiveHeaderSuggestionsRowIdx(null);
    }
  };

  // Body content modifiers
  const handleBodyTypeChange = async (type: RequestItem["body"]["type"]) => {
    if (!activeRequest) return;

    const headers = [...localHeaders];
    const ctIdx = headers.findIndex((h) => h.key.toLowerCase() === "content-type");

    if (type === "json") {
      if (ctIdx > -1) {
        headers[ctIdx].value = "application/json";
        headers[ctIdx].enabled = true;
      } else {
        headers.push({ id: `h-${Date.now()}`, key: "Content-Type", value: "application/json", enabled: true });
      }
    } else if (type === "xml") {
      if (ctIdx > -1) {
        headers[ctIdx].value = "application/xml";
        headers[ctIdx].enabled = true;
      } else {
        headers.push({ id: `h-${Date.now()}`, key: "Content-Type", value: "application/xml", enabled: true });
      }
    }

    setLocalHeaders(headers);
    try {
      await db.requests.update(activeRequest.id, {
        headers,
        body: {
          ...activeRequest.body,
          type,
        },
        updatedAt: Date.now(),
      });
    } catch (err) {
      console.error("Failed to update body type:", err);
    }
  };

  const handleBodyContentChange = (contentVal: string) => {
    if (!activeRequest) return;
    setLocalBodyContent(contentVal);

    runDebouncedUpdate("body", async () => {
      const { contentType, suggestedType } = detectSmartRequestType(contentVal);
      let extraUpdate: Partial<RequestItem> = {};

      if (activeRequest.body.type === "none" && suggestedType && suggestedType !== "none" && suggestedType !== "raw") {
        const headers = [...localHeaders];
        const ctIdx = headers.findIndex((h) => h.key.toLowerCase() === "content-type");
        if (contentType) {
          if (ctIdx > -1) {
            headers[ctIdx].value = contentType;
            headers[ctIdx].enabled = true;
          } else {
            headers.push({ id: `h-${Date.now()}`, key: "Content-Type", value: contentType, enabled: true });
          }
        }
        setLocalHeaders(headers);
        extraUpdate = {
          headers,
          body: {
            type: suggestedType,
            content: contentVal,
          },
        };
      } else {
        extraUpdate = {
          body: {
            ...activeRequest.body,
            content: contentVal,
          },
        };
      }

      await db.requests.update(activeRequest.id, {
        ...extraUpdate,
        updatedAt: Date.now(),
      });
    });
  };

  // Auth structure updates
  const handleAuthChange = async (fields: Partial<RequestItem["auth"]>) => {
    if (!activeRequest) return;
    try {
      await db.requests.update(activeRequest.id, {
        auth: {
          ...activeRequest.auth,
          ...fields,
        },
        updatedAt: Date.now(),
      });
    } catch (err) {
      console.error("Failed to update auth configuration:", err);
    }
  };

  // Form parameters row modifications
  const handleFormParamChange = (idx: number, field: "key" | "value", val: string) => {
    if (!activeRequest) return;
    const paramsList = [...localFormParams];
    paramsList[idx][field] = val;
    setLocalFormParams(paramsList);

    runDebouncedUpdate("formParams", async () => {
      await db.requests.update(activeRequest.id, {
        body: {
          ...activeRequest.body,
          formParams: paramsList,
        },
      });
    });
  };

  const handleAddFormParam = async () => {
    if (!activeRequest) return;
    const paramsList = [...localFormParams];
    paramsList.push({
      id: `fp-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      key: "",
      value: "",
      enabled: true,
      type: "text",
    });
    setLocalFormParams(paramsList);

    try {
      await db.requests.update(activeRequest.id, {
        body: {
          ...activeRequest.body,
          formParams: paramsList,
        },
      });
    } catch (err) {
      console.error("Failed to add form parameter:", err);
    }
  };

  const handleRemoveFormParam = async (idx: number) => {
    if (!activeRequest) return;
    const paramsList = [...localFormParams];
    paramsList.splice(idx, 1);
    setLocalFormParams(paramsList);

    try {
      await db.requests.update(activeRequest.id, {
        body: {
          ...activeRequest.body,
          formParams: paramsList,
        },
      });
    } catch (err) {
      console.error("Failed to remove form parameter:", err);
    }
  };

  const handleMethodChange = async (methodVal: any) => {
    if (!activeRequest) return;
    try {
      await db.requests.update(activeRequest.id, {
        method: methodVal,
        updatedAt: Date.now(),
      });
    } catch (err) {
      console.error("Failed to update HTTP Method:", err);
    }
  };

  // Render variables auto-preview inline
  const resolvedUrlPreview = useMemo(() => {
    if (!activeRequest) return "";
    const fullUrl = buildUrlWithParams(localUrl, localParams);
    return resolveVariables(fullUrl, mergedVariables);
  }, [localUrl, localParams, mergedVariables, activeRequest]);

  const handleTabContextMenu = (e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    const menuWidth = 144;
    const menuHeight = 120;
    
    let x = e.clientX;
    let y = e.clientY;
    
    if (x + menuWidth > window.innerWidth) {
      x = window.innerWidth - menuWidth - 8;
    }
    if (y + menuHeight > window.innerHeight) {
      y = window.innerHeight - menuHeight - 8;
    }

    setContextMenu({
      x,
      y,
      tabId
    });
  };

  const handleCloseOthers = async (tabId: string) => {
    try {
      const remaining = tabs.filter((t) => t.id === tabId);
      await db.tabs.clear();
      if (remaining.length > 0) {
        await db.tabs.add(remaining[0]);
        onSelectTab(tabId);
      } else {
        onSelectTab("");
      }
    } catch (err) {
      console.error("Failed to close other tabs:", err);
    }
  };

  const handleCloseAll = async () => {
    try {
      await db.tabs.clear();
      onSelectTab("");
    } catch (err) {
      console.error("Failed to close all tabs:", err);
    }
  };

  return (
    <div className="flex flex-col h-full bg-neutral-900 text-neutral-200 relative">
      {/* Dynamic Request Tabs Header (Frameless draggable, dark styling) */}
      <div 
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        className="flex items-center justify-between border-b border-neutral-800 bg-neutral-950 px-2 pt-1 shrink-0 min-h-[44px] h-[44px] select-none pr-[140px]"
      >
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-none flex-1 min-w-0" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {!sidebarOpen && (
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-1.5 hover:bg-neutral-800 rounded text-neutral-400 hover:text-white transition-colors cursor-pointer mr-1 shrink-0"
              title="Open Primary Sidebar (Ctrl+B)"
            >
              <svg stroke="currentColor" fill="none" strokeWidth="2.5" viewBox="0 0 24 24" className="h-3.5 w-3.5">
                <rect width="18" height="18" x="3" y="3" rx="2"></rect>
                <path d="M9 3v18"></path>
              </svg>
            </button>
          )}
          {tabs.map((tab) => {
            const isTabActive = tab.id === activeTabId;
            
            // Premium custom tab method color coding
            const tabMethodColor =
              tab.method === "GET"
                ? "text-emerald-400"
                : tab.method === "POST"
                ? "text-indigo-400"
                : tab.method === "PUT"
                ? "text-amber-400"
                : tab.method === "PATCH"
                ? "text-violet-400"
                : tab.method === "DELETE"
                ? "text-rose-400"
                : tab.method === "OPTIONS"
                ? "text-cyan-400"
                : "text-neutral-400";

            return (
              <div
                key={tab.id}
                onClick={() => onSelectTab(tab.id)}
                onContextMenu={(e) => handleTabContextMenu(e, tab.id)}
                className={`group flex items-center gap-2 px-3 py-1.5 rounded-t-lg border-t border-x text-xs font-mono transition-colors cursor-pointer select-none max-w-[180px] shrink-0 ${
                  isTabActive
                    ? "bg-neutral-900 border-neutral-800 text-neutral-200 font-semibold"
                    : "bg-transparent border-transparent text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/40"
                }`}
              >
                <span className={`text-[9px] font-bold ${tabMethodColor}`}>{tab.method}</span>
                <span className="truncate max-w-[100px] text-[11px] font-sans">{tab.name}</span>
                <button
                  onClick={(e) => handleCloseTab(tab.id, e)}
                  className="rounded p-0.5 text-neutral-600 hover:bg-neutral-800 hover:text-white transition-all shrink-0 cursor-pointer"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}

          <button
            onClick={handleCreateDraft}
            className="rounded-lg p-1.5 hover:bg-neutral-800 text-neutral-500 hover:text-neutral-300 transition-colors cursor-pointer ml-1"
            title="Create draft request"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        {/* Clean spacing */}
        <div />
      </div>

      {/* Workspace Area */}
      {!activeRequest ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-neutral-900 font-sans">
          <svg viewBox="0 0 100 100" className="h-12 w-12 mb-4 animate-pulse shrink-0">
            <rect width="100" height="100" rx="22" fill="var(--accent-color)"/>
            <text y="72" x="26" fontFamily="sans-serif" fontSize="62" fontWeight="900" fill="#ffffff">R</text>
          </svg>
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">RestMan Premium API Studio</h3>
          <p className="text-xs text-neutral-500 max-w-sm mt-1 leading-relaxed mb-6">
            A state-of-the-art, offline-first API client. Select an endpoint from the left sidebar, create a draft, or import a collection to begin.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 items-center justify-center w-full max-w-md">
            <button
              onClick={handleCreateDraft}
              className="w-full sm:w-auto px-4 py-2.5 bg-neutral-950 hover:bg-neutral-900 border border-neutral-800 hover:border-neutral-700 text-white rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg"
            >
              <Plus className="h-4 w-4 text-emerald-400" />
              <span>Create New Request</span>
            </button>
            
            <button
              onClick={() => onOpenSettings && onOpenSettings("import")}
              className="w-full sm:w-auto px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg"
            >
              <Upload className="h-4 w-4 text-indigo-200" />
              <span>Import Postman Collection</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col px-4 pb-4 pt-2 overflow-y-auto scrollbar-thin space-y-4">
          {/* Main Sticky Request Bar */}
          <div className="flex items-start gap-2">
            {/* Method Custom Select - outside the card */}
            <CustomSelect
              value={activeRequest.method}
              onChange={handleMethodChange}
              options={[
                { value: "GET", label: "GET", className: "text-emerald-400 font-bold font-mono" },
                { value: "POST", label: "POST", className: "text-indigo-400 font-bold font-mono" },
                { value: "PUT", label: "PUT", className: "text-amber-400 font-bold font-mono" },
                { value: "PATCH", label: "PATCH", className: "text-violet-400 font-bold font-mono" },
                { value: "DELETE", label: "DELETE", className: "text-rose-400 font-bold font-mono" },
                { value: "OPTIONS", label: "OPTIONS", className: "text-cyan-400 font-bold font-mono" },
                { value: "HEAD", label: "HEAD", className: "text-neutral-400 font-bold font-mono" },
              ]}
              className="w-28 font-mono shrink-0"
            />

            {/* URL Input Card */}
            <div className="flex-1 min-w-0 bg-neutral-900 rounded-lg border border-neutral-850 shadow-md overflow-hidden flex items-center pr-1.5">
              <textarea
                ref={urlInputRef}
                rows={1}
                value={localUrl}
                onChange={(e) => handleUrlChange(e.target.value)}
                onPaste={handleUrlPaste}
                onKeyUp={handleInputCheckVar}
                onSelect={handleInputCheckVar}
                onMouseUp={handleInputCheckVar}
                onBlur={handleInputBlur}
                placeholder="Enter API endpoint URL or ${variable}..."
                className="flex-1 bg-transparent px-3 py-2 text-xs text-neutral-300 placeholder-neutral-600 focus:outline-none font-mono resize-none"
                style={{
                  height: "auto",
                  minHeight: "32px",
                  maxHeight: "120px"
                }}
              />
              
              {/* Inline Undo / Redo controls */}
              <div className="flex items-center gap-0.5 shrink-0 border-l border-neutral-800/80 pl-1.5">
                <button
                  type="button"
                  onClick={handleUndo}
                  disabled={!historyRef.current[activeRequest.id] || historyRef.current[activeRequest.id].past.length === 0}
                  className="p-1 hover:bg-neutral-850 rounded text-neutral-400 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors cursor-pointer"
                  title="Undo change (Ctrl+Z)"
                >
                  <Undo2 className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={handleRedo}
                  disabled={!historyRef.current[activeRequest.id] || historyRef.current[activeRequest.id].future.length === 0}
                  className="p-1 hover:bg-neutral-850 rounded text-neutral-400 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors cursor-pointer"
                  title="Redo change (Ctrl+Y)"
                >
                  <Redo2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Send / Cancel button - outside the card */}
            {isSending ? (
              <button
                onClick={onCancelRequest}
                className="rounded-lg bg-rose-600 hover:bg-rose-500 active:scale-95 px-4 py-2 text-white flex items-center justify-center gap-1.5 transition-all duration-150 cursor-pointer shrink-0 text-xs font-semibold shadow-lg shadow-rose-600/10 font-sans border-0"
                title="Click to cancel request"
              >
                <X className="h-3.5 w-3.5" />
                <span>Cancel</span>
              </button>
            ) : (
              <button
                onClick={() => onSendRequest(activeRequest)}
                className="rounded-lg bg-[var(--accent-color)] hover:opacity-90 active:scale-95 px-4 py-2 text-white flex items-center justify-center gap-1.5 transition-all duration-150 cursor-pointer shrink-0 text-xs font-semibold shadow-lg shadow-[var(--accent-color)]/10 font-sans border-0"
                title="Send Request (Ctrl+Enter)"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                <span>Send</span>
              </button>
            )}
          </div>

          {/* Smart URL preview if variables exist */}
          {localUrl.includes("${") && (
            <div className="p-2 border border-neutral-900 bg-neutral-950/40 rounded-md text-[10px] font-mono text-neutral-500 flex items-center gap-1.5">
              <span className="truncate select-all text-neutral-400 font-sans" title={resolvedUrlPreview}>
                Resolved URL: {resolvedUrlPreview || "Empty URL"}
              </span>
            </div>
          )}

          {/* Sub-panel Selector */}
          <div className="flex items-center gap-1.5 border-b border-neutral-900 pb-1 shrink-0 text-xs font-semibold">
            {(["params", "headers", "auth", "body"] as SubTabType[]).map((tab) => {
              const isActive = subTab === tab;
              const titles = {
                params: `Query Params (${localParams.length})`,
                headers: `Headers (${localHeaders.length})`,
                auth: `Authorization (${activeRequest.auth.type !== "none" ? "On" : "None"})`,
                body: `Body (${activeRequest.body.type !== "none" ? activeRequest.body.type.toUpperCase() : "None"})`,
              };

              return (
                <button
                  key={tab}
                  onClick={() => setSubTab(tab)}
                  className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                    isActive ? "bg-neutral-900 text-neutral-200 font-bold" : "text-neutral-500 hover:text-neutral-300"
                  }`}
                >
                  {titles[tab as keyof typeof titles]}
                </button>
              );
            })}
          </div>

          {/* Subpanels Container */}
          <div className="flex-1 bg-neutral-950/20 border border-neutral-900 rounded-xl p-3 min-h-[220px]">
            {/* SUBPANEL: QUERY PARAMS */}
            {subTab === "params" && (
              <div className="flex flex-col gap-2 h-full">
                <div className="flex justify-between items-center text-[10px] text-neutral-500 mb-1">
                  <span>URL Parameter Overrides (synchronizes with request URL automatically)</span>
                  <button
                    onClick={handleAddParamRow}
                    className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300 cursor-pointer"
                  >
                    <PlusCircle className="h-3.5 w-3.5" />
                    <span>Add Parameter</span>
                  </button>
                </div>

                <div className="border border-neutral-900 rounded-lg overflow-x-auto">
                  <table className="w-full border-collapse text-xs font-mono text-left">
                    <thead>
                      <tr className="border-b border-neutral-900 bg-neutral-900/30 text-neutral-400">
                        <th className="py-2 px-3 w-12 text-center">Active</th>
                        <th className="py-2 px-3 w-1/3">Parameter Key</th>
                        <th className="py-2 px-3 w-1/3">Value</th>
                        <th className="py-2 px-3">Description</th>
                        <th className="py-2 px-3 w-10 text-center"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-900">
                      {localParams.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-6 text-center text-neutral-600 italic">
                            No query parameters set. Click "Add Parameter" or edit query strings in URL bar.
                          </td>
                        </tr>
                      ) : (
                        localParams.map((param, idx) => (
                          <tr key={param.id} className="hover:bg-neutral-900/10 group">
                            <td className="py-1.5 px-3 text-center">
                              <input
                                type="checkbox"
                                checked={param.enabled}
                                onChange={() => handleParamToggle(idx)}
                                className="rounded border-neutral-800 bg-neutral-900 text-emerald-600 h-3.5 w-3.5 cursor-pointer accent-emerald-500"
                              />
                            </td>
                            <td className="py-1.5 px-2">
                              <input
                                type="text"
                                value={param.key}
                                onChange={(e) => handleParamRowChange(idx, "key", e.target.value)}
                                onKeyUp={handleInputCheckVar}
                                onSelect={handleInputCheckVar}
                                onMouseUp={handleInputCheckVar}
                                onBlur={handleInputBlur}
                                placeholder="Key"
                                className="w-full bg-transparent border-none text-white focus:outline-none focus:ring-1 focus:ring-neutral-800 rounded px-1.5 py-0.5 text-xs"
                              />
                            </td>
                            <td className="py-1.5 px-2">
                              <input
                                type="text"
                                value={param.value}
                                onChange={(e) => handleParamRowChange(idx, "value", e.target.value)}
                                onKeyUp={handleInputCheckVar}
                                onSelect={handleInputCheckVar}
                                onMouseUp={handleInputCheckVar}
                                onBlur={handleInputBlur}
                                placeholder="Value"
                                className="w-full bg-transparent border-none text-neutral-300 focus:outline-none focus:ring-1 focus:ring-neutral-800 rounded px-1.5 py-0.5 text-xs"
                              />
                            </td>
                            <td className="py-1.5 px-2">
                              <input
                                type="text"
                                value={param.description || ""}
                                onChange={(e) => handleParamRowChange(idx, "description", e.target.value)}
                                placeholder="Optional description..."
                                className="w-full bg-transparent border-none text-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-800 rounded px-1.5 py-0.5 text-xs font-sans"
                              />
                            </td>
                            <td className="py-1.5 px-2 text-center">
                              <button
                                onClick={() => handleRemoveParamRow(idx)}
                                className="text-neutral-600 hover:text-red-400 p-1 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* SUBPANEL: HEADERS */}
            {subTab === "headers" && (
              <div className="flex flex-col gap-2 h-full">
                <div className="flex justify-between items-center text-[10px] text-neutral-500 mb-1">
                  <span>Custom Request Headers (auto-detected based on payload where appropriate)</span>
                  <button
                    onClick={handleAddHeaderRow}
                    className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300 cursor-pointer"
                  >
                    <PlusCircle className="h-3.5 w-3.5" />
                    <span>Add Header</span>
                  </button>
                </div>

                <div className="border border-neutral-900 rounded-lg relative overflow-visible">
                  <table className="w-full border-collapse text-xs font-mono text-left">
                    <thead>
                      <tr className="border-b border-neutral-900 bg-neutral-900/30 text-neutral-400">
                        <th className="py-2 px-3 w-12 text-center">Active</th>
                        <th className="py-2 px-3 w-1/3">Header Name</th>
                        <th className="py-2 px-3 w-1/3">Value</th>
                        <th className="py-2 px-3">Description</th>
                        <th className="py-2 px-3 w-10 text-center"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-900">
                      {localHeaders.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-6 text-center text-neutral-600 italic">
                            No headers defined. Click "Add Header" above.
                          </td>
                        </tr>
                      ) : (
                        localHeaders.map((h, idx) => (
                          <tr key={h.id} className="hover:bg-neutral-900/10 group">
                            <td className="py-1.5 px-3 text-center">
                              <input
                                type="checkbox"
                                checked={h.enabled}
                                onChange={() => handleHeaderToggle(idx)}
                                className="rounded border-neutral-800 bg-neutral-900 text-emerald-600 h-3.5 w-3.5 cursor-pointer accent-emerald-500"
                              />
                            </td>
                            <td className="py-1.5 px-2">
                              <div className="relative">
                                <input
                                  type="text"
                                  value={h.key}
                                  onChange={(e) => {
                                    handleHeaderRowChange(idx, "key", e.target.value);
                                    setHeaderFilter(e.target.value);
                                    setActiveHeaderSuggestionsIdx(null);
                                  }}
                                  onFocus={() => {
                                    setActiveHeaderSuggestionsRowIdx(idx);
                                    setActiveHeaderSuggestionsIdx(null);
                                    setHeaderFilter(h.key);
                                  }}
                                  onKeyDown={(e) => handleHeaderKeyDown(idx, e)}
                                  onBlur={() => {
                                    setTimeout(() => {
                                      setActiveHeaderSuggestionsRowIdx(null);
                                    }, 200);
                                  }}
                                  onKeyUp={handleInputCheckVar}
                                  onSelect={handleInputCheckVar}
                                  onMouseUp={handleInputCheckVar}
                                  placeholder="e.g. Content-Type"
                                  className="w-full bg-transparent border-none text-white focus:outline-none focus:ring-1 focus:ring-neutral-800 rounded px-1.5 py-0.5 text-xs font-mono"
                                />

                                {activeHeaderSuggestionsRowIdx === idx && (
                                  (() => {
                                    const filtered = HEADER_SUGGESTIONS.filter(item => 
                                      item.toLowerCase().includes(headerFilter.toLowerCase())
                                    ).sort((a, b) => {
                                      const aStart = a.toLowerCase().startsWith(headerFilter.toLowerCase());
                                      const bStart = b.toLowerCase().startsWith(headerFilter.toLowerCase());
                                      if (aStart && !bStart) return -1;
                                      if (!aStart && bStart) return 1;
                                      return 0;
                                    });
                                    if (filtered.length === 0) return null;
                                    return (
                                      <div className="absolute left-0 top-full mt-1 z-[150] w-56 bg-neutral-950 border border-neutral-850 rounded-lg p-1 shadow-2xl max-h-48 overflow-y-auto scrollbar-thin flex flex-col font-sans">
                                        {filtered.map((hs, sIdx) => {
                                          const isSelected = activeHeaderSuggestionsIdx === sIdx;
                                          return (
                                            <button
                                              key={hs}
                                              type="button"
                                              onMouseDown={() => {
                                                handleHeaderRowChange(idx, "key", hs);
                                                setActiveHeaderSuggestionsRowIdx(null);
                                              }}
                                              className={`w-full text-left px-2.5 py-1.5 rounded text-[11px] font-semibold transition-colors cursor-pointer border-0 ${
                                                isSelected 
                                                  ? "bg-neutral-850 text-white font-bold" 
                                                  : "bg-transparent text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900"
                                              }`}
                                            >
                                              {hs}
                                            </button>
                                          );
                                        })}
                                      </div>
                                    );
                                  })()
                                )}
                              </div>
                            </td>
                            <td className="py-1.5 px-2">
                              <input
                                type="text"
                                value={h.value}
                                onChange={(e) => handleHeaderRowChange(idx, "value", e.target.value)}
                                onKeyUp={handleInputCheckVar}
                                onSelect={handleInputCheckVar}
                                onMouseUp={handleInputCheckVar}
                                onBlur={handleInputBlur}
                                placeholder="Value"
                                className="w-full bg-transparent border-none text-neutral-300 focus:outline-none focus:ring-1 focus:ring-neutral-800 rounded px-1.5 py-0.5 text-xs"
                              />
                            </td>
                            <td className="py-1.5 px-2">
                              <input
                                type="text"
                                value={h.description || ""}
                                onChange={(e) => handleHeaderRowChange(idx, "description", e.target.value)}
                                placeholder="Optional description..."
                                className="w-full bg-transparent border-none text-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-800 rounded px-1.5 py-0.5 text-xs font-sans"
                              />
                            </td>
                            <td className="py-1.5 px-2 text-center">
                              <button
                                onClick={() => handleRemoveHeaderRow(idx)}
                                className="text-neutral-600 hover:text-red-400 p-1 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* SUBPANEL: AUTHORIZATION */}
            {subTab === "auth" && (
              <div className="flex flex-col gap-4 text-xs font-sans max-w-xl">
                <div>
                  <label className="block text-[11px] font-semibold text-neutral-500 uppercase tracking-wider mb-2">
                    Authorization Type
                  </label>
                  <div className="flex items-center gap-1 bg-neutral-900 p-0.5 rounded-lg border border-neutral-850 text-[10px]">
                    {(["none", "bearer", "basic", "apiKey"] as const).map((type) => {
                      const labels: Record<string, string> = { none: "No Auth", bearer: "Bearer Token", basic: "Basic Auth", apiKey: "API Key" };
                      return (
                        <button
                          key={type}
                          onClick={() => handleAuthChange({ type: type as any })}
                          className={`px-3 py-1.5 rounded transition-all cursor-pointer whitespace-nowrap ${
                            activeRequest.auth.type === type
                              ? "bg-neutral-800 text-neutral-200 font-bold shadow-sm"
                              : "text-neutral-500 hover:text-neutral-300"
                          }`}
                        >
                          {labels[type]}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Render Dynamic Auth structures */}
                {activeRequest.auth.type === "none" && (
                  <p className="text-[11px] text-neutral-500 italic max-w-sm mt-1 font-sans">
                    No authorization parameters are sent for this request. Headers will not contain custom security identifiers.
                  </p>
                )}

                {activeRequest.auth.type === "bearer" && (
                  <div className="space-y-2 animate-fade-in border border-neutral-900 p-3.5 rounded-lg bg-neutral-950/40">
                    <div className="flex items-center justify-between">
                      <label className="block text-[10px] font-semibold text-neutral-400 uppercase tracking-wider font-sans">
                        Bearer Token secret
                      </label>
                    </div>
                    <input
                      type="text"
                      value={activeRequest.auth.bearerToken || ""}
                      onChange={(e) => handleAuthChange({ bearerToken: e.target.value })}
                      onKeyUp={handleInputCheckVar}
                      onSelect={handleInputCheckVar}
                      onMouseUp={handleInputCheckVar}
                      onBlur={handleInputBlur}
                      placeholder="Enter token... e.g. eyJhbGciOi..."
                      className="w-full bg-neutral-950 border border-neutral-850 rounded px-3 py-2 text-xs text-emerald-400 font-mono focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                )}

                {activeRequest.auth.type === "basic" && (
                  <div className="grid grid-cols-2 gap-3 animate-fade-in border border-neutral-900 p-3.5 rounded-lg bg-neutral-950/40">
                    <div>
                      <label className="block text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-1 font-sans">
                        Username
                      </label>
                      <input
                        type="text"
                        value={activeRequest.auth.basicUsername || ""}
                        onChange={(e) => handleAuthChange({ basicUsername: e.target.value })}
                        onKeyUp={handleInputCheckVar}
                        onSelect={handleInputCheckVar}
                        onMouseUp={handleInputCheckVar}
                        onBlur={handleInputBlur}
                        placeholder="admin"
                        className="w-full bg-neutral-950 border border-neutral-850 rounded px-3 py-2 text-xs text-neutral-200 focus:outline-none focus:border-emerald-500 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-1 font-sans">
                        Password
                      </label>
                      <input
                        type="text"
                        value={activeRequest.auth.basicPassword || ""}
                        onChange={(e) => handleAuthChange({ basicPassword: e.target.value })}
                        onKeyUp={handleInputCheckVar}
                        onSelect={handleInputCheckVar}
                        onMouseUp={handleInputCheckVar}
                        onBlur={handleInputBlur}
                        placeholder="••••••••"
                        className="w-full bg-neutral-950 border border-neutral-850 rounded px-3 py-2 text-xs text-neutral-200 focus:outline-none focus:border-emerald-500 font-mono"
                      />
                    </div>
                  </div>
                )}

                {activeRequest.auth.type === "apiKey" && (
                  <div className="space-y-3 animate-fade-in border border-neutral-900 p-3.5 rounded-lg bg-neutral-950/40 font-sans">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-1">
                          Key (Header or Query Name)
                        </label>
                        <input
                          type="text"
                          value={activeRequest.auth.apiKeyKey || ""}
                          onChange={(e) => handleAuthChange({ apiKeyKey: e.target.value })}
                          onKeyUp={handleInputCheckVar}
                          onSelect={handleInputCheckVar}
                          onMouseUp={handleInputCheckVar}
                          onBlur={handleInputBlur}
                          placeholder="x-api-key"
                          className="w-full bg-neutral-950 border border-neutral-850 rounded px-3 py-2 text-xs text-neutral-200 focus:outline-none focus:border-emerald-500 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-1">
                          Value
                        </label>
                        <input
                          type="text"
                          value={activeRequest.auth.apiKeyValue || ""}
                          onChange={(e) => handleAuthChange({ apiKeyValue: e.target.value })}
                          onKeyUp={handleInputCheckVar}
                          onSelect={handleInputCheckVar}
                          onMouseUp={handleInputCheckVar}
                          onBlur={handleInputBlur}
                          placeholder="api_secret_token"
                          className="w-full bg-neutral-950 border border-neutral-850 rounded px-3 py-2 text-xs text-neutral-200 focus:outline-none focus:border-emerald-500 font-mono"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-1">
                        Add API Key To
                      </label>
                      <CustomSelect
                        value={activeRequest.auth.apiKeyAddTo || "header"}
                        onChange={(val) => handleAuthChange({ apiKeyAddTo: val as any })}
                        options={[
                          { value: "header", label: "Request Headers" },
                          { value: "query", label: "URL Query Params" },
                        ]}
                        className="w-48"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* SUBPANEL: REQUEST BODY */}
            {subTab === "body" && (
              <div className="flex flex-col gap-3 h-full">
                <div className="flex items-center justify-between text-xs pb-1 border-b border-neutral-900">
                  <div className="flex items-center gap-1 bg-neutral-900 p-0.5 rounded-lg border border-neutral-850 text-[10px] font-sans">
                    {(["none", "json", "xml", "raw", "form-data", "urlencoded"] as RequestItem["body"]["type"][]).map((type) => (
                      <button
                        key={type}
                        onClick={() => handleBodyTypeChange(type)}
                        className={`px-2 py-1 rounded transition-all cursor-pointer ${
                          activeRequest.body.type === type
                            ? "bg-neutral-800 text-white font-bold"
                            : "text-neutral-500 hover:text-neutral-300"
                        }`}
                      >
                        {type.toUpperCase()}
                      </button>
                    ))}
                  </div>

                  {/* Quick Helper */}
                  {activeRequest.body.type === "json" && (
                    <button
                      onClick={() => {
                        try {
                          const parsed = JSON.parse(localBodyContent || "{}");
                          handleBodyContentChange(JSON.stringify(parsed, null, 2));
                        } catch {
                          alert("Invalid JSON format. Check syntax to beautify.");
                        }
                      }}
                      className="text-[10px] bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-300 hover:text-white px-2.5 py-1 rounded transition-all cursor-pointer font-sans"
                    >
                      Beautify Code
                    </button>
                  )}
                </div>

                {/* Body Content Renders */}
                {activeRequest.body.type === "none" && (
                  <div className="flex-1 flex flex-col items-center justify-center py-10 text-neutral-500 font-sans">
                    <Lock className="h-5 w-5 text-neutral-600 mb-1.5" />
                    <p className="text-[11px] italic">No request payload is dispatched for this method.</p>
                  </div>
                )}

                {(activeRequest.body.type === "json" || activeRequest.body.type === "xml" || activeRequest.body.type === "raw") && (
                  <div className="min-h-[220px] rounded-lg border border-neutral-900 overflow-hidden relative">
                    <Editor
                      height="220px"
                      language={activeRequest.body.type === "json" ? "json" : activeRequest.body.type === "xml" ? "xml" : "text"}
                      theme={theme === "light" ? "vs" : "vs-dark"}
                      value={localBodyContent}
                      onChange={(val) => handleBodyContentChange(val || "")}
                      options={{
                        minimap: { enabled: false },
                        fontSize: 12,
                        fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
                        automaticLayout: true,
                        scrollbar: { vertical: "hidden" },
                        lineNumbers: "on",
                      }}
                      loading={
                        /* Highly Styled Fallback custom code textarea for instant loading and completely offline support */
                        <div className="absolute inset-0 bg-neutral-950 p-2 flex flex-col font-mono text-xs">
                          <textarea
                            value={localBodyContent}
                            onChange={(e) => handleBodyContentChange(e.target.value)}
                            placeholder={`Enter raw payload ...`}
                            className="w-full h-full bg-neutral-950 border-none outline-none text-neutral-200 resize-none font-mono"
                          />
                        </div>
                      }
                    />
                  </div>
                )}

                {activeRequest.body.type === "form-data" && (
                  <div className="flex flex-col gap-2 h-full font-sans">
                    <div className="flex justify-between items-center text-[10px] text-neutral-500">
                      <span>Form Data Payload (Multipart boundaries)</span>
                      <button
                        onClick={handleAddFormParam}
                        className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300 cursor-pointer"
                      >
                        <PlusCircle className="h-3.5 w-3.5" />
                        <span>Add Param</span>
                      </button>
                    </div>

                    <div className="border border-neutral-900 rounded-lg overflow-x-auto font-mono">
                      <table className="w-full border-collapse text-xs text-left">
                        <thead>
                          <tr className="border-b border-neutral-900 bg-neutral-900/30 text-neutral-400">
                            <th className="py-1.5 px-3">Field Key</th>
                            <th className="py-1.5 px-3">Field Value</th>
                            <th className="py-1.5 px-3 w-10"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-neutral-900">
                          {localFormParams.length === 0 ? (
                            <tr>
                              <td colSpan={3} className="py-5 text-center text-neutral-600 italic">
                                No form data fields. Add key-value entries above.
                              </td>
                            </tr>
                          ) : (
                            localFormParams.map((fp, idx) => (
                              <tr key={fp.id} className="hover:bg-neutral-900/10 group">
                                <td className="py-1 px-2">
                                  <input
                                    type="text"
                                    value={fp.key}
                                    onChange={(e) => handleFormParamChange(idx, "key", e.target.value)}
                                    placeholder="key"
                                    className="w-full bg-transparent border-none text-white focus:outline-none focus:ring-1 focus:ring-neutral-800 rounded px-1 text-xs"
                                  />
                                </td>
                                <td className="py-1 px-2">
                                  <input
                                    type="text"
                                    value={fp.value}
                                    onChange={(e) => handleFormParamChange(idx, "value", e.target.value)}
                                    placeholder="value"
                                    className="w-full bg-transparent border-none text-neutral-300 focus:outline-none focus:ring-1 focus:ring-neutral-800 rounded px-1 text-xs"
                                  />
                                </td>
                                <td className="py-1 px-2 text-center">
                                  <button
                                    onClick={() => handleRemoveFormParam(idx)}
                                    className="text-neutral-600 hover:text-red-400 p-1 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer bg-transparent border-none"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {activeRequest.body.type === "urlencoded" && (
                  <div className="flex flex-col gap-2 h-full font-sans">
                    <p className="text-[11px] text-neutral-500">
                      Dispatched as URL-encoded structure (<code className="text-emerald-400">application/x-www-form-urlencoded</code>). Same syntax as URL Query parameters.
                    </p>
                    <button
                      onClick={handleAddFormParam}
                      className="text-neutral-400 hover:text-white flex items-center gap-1.5 self-start text-[10px] cursor-pointer bg-transparent border-none"
                    >
                      <Plus className="h-3.5 w-3.5" /> Add URL-encoded key
                    </button>
                    {/* Urlenocded values reuse the form data table simply */}
                    <div className="border border-neutral-900 rounded-lg overflow-x-auto font-mono">
                      <table className="w-full border-collapse text-xs text-left">
                        <tbody className="divide-y divide-neutral-900">
                          {localFormParams.length === 0 ? (
                            <tr>
                              <td className="py-4 text-center text-neutral-600 italic">No parameters.</td>
                            </tr>
                          ) : (
                            localFormParams.map((fp, idx) => (
                              <tr key={fp.id} className="hover:bg-neutral-900/10 group">
                                <td className="py-1 px-2">
                                  <input
                                    type="text"
                                    value={fp.key}
                                    onChange={(e) => handleFormParamChange(idx, "key", e.target.value)}
                                    placeholder="Key"
                                    className="w-full bg-transparent border-none text-white focus:outline-none focus:ring-1 focus:ring-neutral-800 rounded px-1"
                                  />
                                </td>
                                <td className="py-1 px-2">
                                  <input
                                    type="text"
                                    value={fp.value}
                                    onChange={(e) => handleFormParamChange(idx, "value", e.target.value)}
                                    placeholder="Value"
                                    className="w-full bg-transparent border-none text-neutral-300 focus:outline-none focus:ring-1 focus:ring-neutral-800 rounded px-1"
                                  />
                                </td>
                                <td className="py-1 px-2 text-center">
                                  <button
                                    onClick={() => handleRemoveFormParam(idx)}
                                    className="text-neutral-600 hover:text-red-400 p-1 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer bg-transparent border-none"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Custom Context Menu on Tabs */}
      {contextMenu && (
        <div 
          style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
          className="fixed z-[100] w-36 bg-neutral-950 border border-neutral-850 rounded-lg p-1 shadow-2xl text-[10.5px] font-semibold text-neutral-400 select-none font-sans"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={async () => {
              try {
                await db.tabs.delete(contextMenu.tabId);
                const remaining = tabs.filter((t) => t.id !== contextMenu.tabId);
                if (activeTabId === contextMenu.tabId) {
                  if (remaining.length > 0) {
                    onSelectTab(remaining[0].id);
                  } else {
                    onSelectTab("");
                  }
                }
              } catch (err) {
                console.error("Failed to delete tab via context menu:", err);
              }
              setContextMenu(null);
            }}
            className="w-full text-left px-2.5 py-1.5 hover:bg-neutral-900 rounded hover:text-white flex items-center gap-1.5 cursor-pointer bg-transparent border-none text-neutral-400"
          >
            Close Tab
          </button>
          <button
            onClick={() => {
              handleCloseOthers(contextMenu.tabId);
              setContextMenu(null);
            }}
            className="w-full text-left px-2.5 py-1.5 hover:bg-neutral-900 rounded hover:text-white flex items-center gap-1.5 cursor-pointer bg-transparent border-none text-neutral-400"
          >
            Close Others
          </button>
          <button
            onClick={() => {
              handleCloseAll();
              setContextMenu(null);
            }}
            className="w-full text-left px-2.5 py-1.5 hover:bg-neutral-900 rounded hover:text-white flex items-center gap-1.5 cursor-pointer border-t border-neutral-900 mt-1 pt-1.5 bg-transparent border-none text-neutral-400"
          >
            Close All
          </button>
        </div>
      )}

      {/* Floating Quick Variable Resolver Popup */}
      {activeQuickVar && (
        <QuickVarPopover
          activeQuickVar={activeQuickVar}
          variables={variables}
          onClose={() => setActiveQuickVar(null)}
        />
      )}

      {/* Custom Modern Confirm Modal */}
      {confirmState && (
        <ModernConfirmModal
          isOpen={confirmState.isOpen}
          title={confirmState.title}
          message={confirmState.message}
          onConfirm={confirmState.onConfirm}
          onCancel={() => setConfirmState(null)}
        />
      )}
    </div>
  );
}

interface QuickVarPopoverProps {
  activeQuickVar: { name: string; value: string; rect: DOMRect };
  variables: Variable[];
  onClose: () => void;
}

function QuickVarPopover({ activeQuickVar, variables, onClose }: QuickVarPopoverProps) {
  const targetVar = variables.find((v) => v.id === activeQuickVar.name);
  const isResolved = !!targetVar && targetVar.enabled;
  const initialValue = targetVar ? targetVar.value : "";
  
  const [val, setVal] = useState(initialValue);
  const [desc, setDesc] = useState(targetVar ? targetVar.description || "" : "");
  const [isSaved, setIsSaved] = useState(false);

  useEffect(() => {
    setVal(initialValue);
    setDesc(targetVar ? targetVar.description || "" : "");
    setIsSaved(false);
  }, [activeQuickVar.name, initialValue]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await db.variables.put({
        id: activeQuickVar.name,
        value: val,
        description: desc,
        enabled: true
      });
      setIsSaved(true);
      setTimeout(() => {
        onClose();
      }, 800);
    } catch (err) {
      console.error("Quick var save failed:", err);
    }
  };

  // Position below the element, clamping to viewport bounds
  const top = activeQuickVar.rect.bottom + window.scrollY + 6;
  const left = Math.max(8, Math.min(window.innerWidth - 300, activeQuickVar.rect.left + window.scrollX));

  return (
    <div
      style={{
        position: "fixed",
        top: `${top}px`,
        left: `${left}px`,
        width: "280px",
      }}
      className="quick-var-popup-container z-[999] bg-neutral-950 border border-neutral-800 rounded-lg p-3 shadow-2xl animate-fade-in flex flex-col gap-2.5 text-xs font-sans text-neutral-200"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between border-b border-neutral-900 pb-1.5 select-none">
        <div className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${isResolved ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`}></span>
          <span className="font-semibold font-mono text-[11px] text-neutral-200">
            ${`{`}{activeQuickVar.name}{`}`}
          </span>
        </div>
        <span className={`text-[9px] font-semibold px-1 py-0.5 rounded ${
          isResolved ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
        }`}>
          {isResolved ? "Resolved" : "Unresolved"}
        </span>
      </div>

      <form onSubmit={handleSave} className="flex flex-col gap-2">
        <div>
          <label className="block text-[9px] uppercase tracking-wider text-neutral-500 mb-1 font-semibold select-none">Value</label>
          <input
            type="text"
            value={val}
            onChange={(e) => setVal(e.target.value)}
            placeholder="Enter value..."
            className="w-full bg-neutral-900 border border-neutral-850 rounded px-2 py-1.5 text-xs text-white placeholder-neutral-700 focus:outline-none focus:border-emerald-500 font-mono"
            autoFocus
          />
        </div>
        <div>
          <label className="block text-[9px] uppercase tracking-wider text-neutral-500 mb-1 font-semibold select-none">Description</label>
          <input
            type="text"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="Add note..."
            className="w-full bg-neutral-900 border border-neutral-850 rounded px-2 py-1.5 text-xs text-neutral-400 placeholder-neutral-700 focus:outline-none focus:border-emerald-500"
          />
        </div>
        <div className="flex justify-end gap-1.5 mt-1 border-t border-neutral-900 pt-2 select-none">
          <button
            type="button"
            onClick={onClose}
            className="px-2 py-1 hover:bg-neutral-900 rounded text-neutral-400 hover:text-white transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-semibold transition-colors cursor-pointer"
          >
            {isSaved ? "Saved!" : isResolved ? "Save" : "Add Variable"}
          </button>
        </div>
      </form>
    </div>
  );
}

