import { useState, useEffect, useRef, useMemo } from "react";
import { showToast } from "../utils/toast";
import { db, type RequestItem, type RequestTab, type Variable } from "../db/db";
import { parseUrlAndParams, buildUrlWithParams, detectSmartRequestType, resolveVariables } from "../utils/urlHelper";
import { refactorVariableOccurrences } from "../utils/variableRefactor";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Plus,
  X,
  Trash2,
  Lock,
  Upload,
  RefreshCw
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

  // Resizable columns states
  const [paramColWidths, setParamColWidths] = useState<Record<string, number>>({
    key: 200,
    value: 200,
    desc: 250
  });

  const [headerColWidths, setHeaderColWidths] = useState<Record<string, number>>({
    key: 200,
    value: 200,
    desc: 250
  });

  const handleParamResizeStart = (colKey: string, startWidth: number, e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      setParamColWidths(prev => ({
        ...prev,
        [colKey]: Math.max(80, startWidth + deltaX)
      }));
    };
    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const handleHeaderResizeStart = (colKey: string, startWidth: number, e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      setHeaderColWidths(prev => ({
        ...prev,
        [colKey]: Math.max(80, startWidth + deltaX)
      }));
    };
    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

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
  const collections = useLiveQuery(() => db.collections.toArray()) || [];
  const folders = useLiveQuery(() => db.folders.toArray()) || [];

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
  const [tempName, setTempName] = useState("");

  // Tab internal sub-panel state
  const [subTab, setSubTab] = useState<SubTabType>("params");


  // Focus controller
  const urlInputRef = useRef<HTMLTextAreaElement>(null);

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; tabId: string } | null>(null);

  // States for text selection right-click variable creation
  const [selectionContextMenu, setSelectionContextMenu] = useState<{
    x: number;
    y: number;
    text: string;
    targetInput: HTMLInputElement | HTMLTextAreaElement;
  } | null>(null);

  const [createVariableData, setCreateVariableData] = useState<{
    value: string;
    inputElement: HTMLInputElement | HTMLTextAreaElement;
  } | null>(null);

  const [newVarName, setNewVarName] = useState("");
  const [newVarValue, setNewVarValue] = useState("");
  const [newVarDesc, setNewVarDesc] = useState("");
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
      setTempName(activeRequest.name || "");
      if (!debounceTimers.current["url"]) {
        setLocalUrl(activeRequest.url || "");
      }
      if (!debounceTimers.current["params"]) {
        const p = activeRequest.params ? [...activeRequest.params] : [];
        if (p.length === 0) {
          p.push({
            id: `param-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            key: "",
            value: "",
            enabled: true,
          });
        }
        setLocalParams(p);
      }
      if (!debounceTimers.current["headers"]) {
        const h = activeRequest.headers ? [...activeRequest.headers] : [];
        if (h.length === 0) {
          h.push({
            id: `header-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            key: "",
            value: "",
            enabled: true,
          });
        }
        setLocalHeaders(h);
      }
      if (!debounceTimers.current["body"]) {
        setLocalBodyContent(activeRequest.body?.content || "");
      }
      if (!debounceTimers.current["formParams"]) {
        const fp = activeRequest.body?.formParams ? [...activeRequest.body.formParams] : [];
        if (fp.length === 0) {
          fp.push({
            id: `fp-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            key: "",
            value: "",
            enabled: true,
            type: "text",
          });
        }
        setLocalFormParams(fp);
      }
    } else {
      setLocalUrl("");
      setLocalParams([]);
      setLocalHeaders([]);
      setLocalBodyContent("");
      setLocalFormParams([]);
      setTempName("");
    }
  }, [activeRequest]);

  const handleNameChange = async (newName: string) => {
    setTempName(newName);
    if (!activeRequest) return;
    try {
      await db.requests.update(activeRequest.id, { name: newName });
    } catch (err) {
      console.error("Failed to update request name:", err);
    }
  };

  // Breadcrumbs calculation
  const breadcrumbs = useMemo(() => {
    if (!activeRequest) return [];
    const crumbs: string[] = [];

    // Find parent folders recursively
    let currentFolderId = activeRequest.folderId;
    while (currentFolderId) {
      const folder = folders.find((f) => f.id === currentFolderId);
      if (folder) {
        crumbs.unshift(folder.name);
        currentFolderId = folder.parentFolderId;
      } else {
        break;
      }
    }

    // Find collection
    const collection = collections.find((c) => c.id === activeRequest.collectionId);
    if (collection) {
      crumbs.unshift(collection.name);
    }

    return crumbs;
  }, [activeRequest, folders, collections]);

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
    const closeMenu = () => {
      setContextMenu(null);
      setSelectionContextMenu(null);
    };
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
    } else if (pastedText.includes("%") || pastedText.toLowerCase().startsWith("http://") || pastedText.toLowerCase().startsWith("https://") || pastedText.includes("?")) {
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

    // Postman behavior: if editing last row and it's not empty, add new empty row
    if (idx === items.length - 1 && val.trim() !== "") {
      items.push({
        id: `param-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        key: "",
        value: "",
        enabled: true,
      });
    }

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



  const handleRemoveParamRow = async (idx: number) => {
    if (!activeRequest) return;
    saveHistoryState(true);
    let items = [...localParams];
    items.splice(idx, 1);
    if (items.length === 0) {
      items.push({
        id: `param-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        key: "",
        value: "",
        enabled: true,
      });
    }
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

    // Postman behavior: if editing last row and it's not empty, add new empty row
    if (idx === items.length - 1 && val.trim() !== "") {
      items.push({
        id: `header-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        key: "",
        value: "",
        enabled: true,
      });
    }

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



  const handleRemoveHeaderRow = async (idx: number) => {
    if (!activeRequest) return;
    let items = [...localHeaders];
    items.splice(idx, 1);
    if (items.length === 0) {
      items.push({
        id: `header-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        key: "",
        value: "",
        enabled: true,
      });
    }
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
      let finalAuth = {
        ...activeRequest.auth,
        ...fields,
      };

      // If switching type, remove details of other auth types
      if (fields.type && fields.type !== activeRequest.auth.type) {
        finalAuth = { type: fields.type };
        if (fields.type === "bearer") {
          finalAuth.bearerToken = "";
        } else if (fields.type === "basic") {
          finalAuth.basicUsername = "";
          finalAuth.basicPassword = "";
        } else if (fields.type === "apiKey") {
          finalAuth.apiKeyKey = "";
          finalAuth.apiKeyValue = "";
          finalAuth.apiKeyAddTo = "header";
        }
      }

      await db.requests.update(activeRequest.id, {
        auth: finalAuth,
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

    // Postman behavior: if editing last row and it's not empty, add new empty row
    if (idx === paramsList.length - 1 && val.trim() !== "") {
      paramsList.push({
        id: `fp-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        key: "",
        value: "",
        enabled: true,
        type: "text",
      });
    }

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



  const handleRemoveFormParam = async (idx: number) => {
    if (!activeRequest) return;
    let paramsList = [...localFormParams];
    paramsList.splice(idx, 1);
    if (paramsList.length === 0) {
      paramsList.push({
        id: `fp-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        key: "",
        value: "",
        enabled: true,
        type: "text",
      });
    }
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
    const menuWidth = 160;
    const menuHeight = 128;
    // Position menu BELOW the clicked tab element, not at cursor
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    let x = rect.left;
    let y = rect.bottom + 2;

    if (x + menuWidth > window.innerWidth) {
      x = window.innerWidth - menuWidth - 8;
    }
    if (y + menuHeight > window.innerHeight) {
      // If no space below, put above instead
      y = rect.top - menuHeight - 2;
    }

    setContextMenu({ x, y, tabId });
  };

  // Right-click context menu handler for text selection in inputs/textareas
  const handleWorkspaceContextMenu = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
      const input = target as HTMLInputElement | HTMLTextAreaElement;
      const start = input.selectionStart;
      const end = input.selectionEnd;
      if (start !== null && end !== null && start !== end) {
        const selectedText = input.value.substring(start, end).trim();
        if (selectedText) {
          e.preventDefault();
          setSelectionContextMenu({
            x: e.clientX,
            y: e.clientY,
            text: selectedText,
            targetInput: input,
          });
        }
      }
    }
  };

  const replaceSelectionWithText = (
    input: HTMLInputElement | HTMLTextAreaElement,
    replacementText: string
  ) => {
    const start = input.selectionStart;
    const end = input.selectionEnd;
    if (start === null || end === null) return;

    const originalValue = input.value;
    const newValue = originalValue.slice(0, start) + replacementText + originalValue.slice(end);

    const setter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(input),
      "value"
    )?.set;
    if (setter) {
      setter.call(input, newValue);
    } else {
      input.value = newValue;
    }

    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const replaceSelectionWithVar = (
    input: HTMLInputElement | HTMLTextAreaElement,
    varName: string
  ) => {
    const start = input.selectionStart;
    const end = input.selectionEnd;
    if (start === null || end === null) return;

    const originalValue = input.value;
    const newValue = originalValue.slice(0, start) + `\${${varName}}` + originalValue.slice(end);

    const setter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(input),
      "value"
    )?.set;
    if (setter) {
      setter.call(input, newValue);
    } else {
      input.value = newValue;
    }

    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
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
    <div 
      onContextMenu={handleWorkspaceContextMenu}
      className="flex flex-col h-full bg-neutral-900 text-neutral-200 relative"
    >
      {/* Postman-style horizontal linear loader during send/waiting state */}
      {isSending && (
        <div className="absolute top-[44px] left-0 right-0 z-[100] h-[2px] overflow-hidden pointer-events-none">
          <div className="linear-progress-bar" />
        </div>
      )}
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
          <svg viewBox="0 0 500 500" className="h-12 w-12 mb-4 animate-pulse shrink-0">
            <rect width="500" height="500" rx="110" fill="#FF6C37"/>
            <g transform="translate(0, 5)">
              <g fill="none" stroke="#FFFFFF" stroke-width="28" stroke-linecap="round" stroke-linejoin="round">
                <path d="M 160 360 L 250 140" />
                <path d="M 340 360 L 250 140" />
                <path d="M 195 270 H 305" />
              </g>
              <circle cx="250" cy="140" r="22" fill="#FFFFFF" stroke="#FF6C37" stroke-width="8"/>
              <circle cx="160" cy="360" r="22" fill="#FFFFFF" stroke="#FF6C37" stroke-width="8"/>
              <circle cx="340" cy="360" r="22" fill="#FFFFFF" stroke="#FF6C37" stroke-width="8"/>
              <circle cx="250" cy="270" r="14" fill="#FF6C37" stroke="#FFFFFF" stroke-width="8"/>
            </g>
          </svg>
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">Apify Premium API Studio</h3>
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
          {/* Request Header Area (Breadcrumb + Editable Request Name) */}
          <div className="flex flex-col gap-0.5 pb-2 border-b border-neutral-900 select-none shrink-0">
            {/* Breadcrumb Path with Inline Edit */}
            <div className="flex items-center gap-1 text-[10px] text-neutral-500 font-medium font-sans">
              <svg viewBox="0 0 14 14" className="h-3 w-3 shrink-0 text-neutral-500" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <line x1="1" y1="3.5" x2="13" y2="3.5"/>
                <line x1="1" y1="7" x2="9" y2="7"/>
                <line x1="1" y1="10.5" x2="13" y2="10.5"/>
              </svg>
              {breadcrumbs.map((crumb, idx) => (
                <span key={idx} className="flex items-center gap-1">
                  <span className="truncate max-w-[120px]">{crumb}</span>
                  <span className="text-neutral-700">/</span>
                </span>
              ))}
              <input
                type="text"
                value={tempName}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="Untitled Request"
                className="bg-transparent border-none text-[11px] font-semibold text-neutral-200 hover:text-white focus:text-white focus:outline-none focus:bg-neutral-950 focus:ring-1 focus:ring-neutral-800 rounded px-1 py-0.5 w-64 transition-all font-sans"
              />
            </div>
          </div>

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
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (activeRequest) {
                      onSendRequest(activeRequest);
                    }
                  }
                }}
                placeholder="Enter API endpoint URL or ${variable}..."
                className="flex-1 bg-transparent px-3 py-2 text-xs text-neutral-300 placeholder-neutral-600 focus:outline-none font-mono resize-none"
                style={{
                  height: "auto",
                  minHeight: "32px",
                  maxHeight: "120px"
                }}
              />

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
                className="send-btn rounded-lg bg-[var(--accent-color)] text-white px-4 py-2 flex items-center justify-center transition-all duration-150 cursor-pointer shrink-0 text-xs font-semibold shadow-lg shadow-[var(--accent-color)]/10 font-sans border-0"
                title="Send Request (Ctrl+Enter)"
              >
                <div className="svg-wrapper-1 mr-1">
                  <div className="svg-wrapper">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      width="14"
                      height="14"
                      className="fill-current text-white"
                    >
                      <path fill="none" d="M0 0h24v24H0z"></path>
                      <path
                        fill="currentColor"
                        d="M1.946 9.315c-.522-.174-.527-.455.01-.634l19.087-6.362c.529-.176.832.12.684.638l-5.454 19.086c-.15.529-.455.547-.679.045L12 14l6-8-8 6-8.054-2.685z"
                      ></path>
                    </svg>
                  </div>
                </div>
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
                <div className="flex justify-between items-center text-[10px] text-neutral-400 font-bold uppercase tracking-wider mb-1">
                  <span>Query Parameters</span>
                </div>

                <div className="border border-neutral-900 rounded-lg overflow-x-auto">
                  <table className="w-full border-collapse text-xs font-mono text-left">
                    <thead>
                      <tr className="border-b border-neutral-900 bg-neutral-900/30 text-neutral-400">
                        <th className="py-2 px-3 w-12 text-center select-none">Active</th>
                        <th 
                          className="py-2 px-3 relative select-none font-sans font-semibold text-neutral-200"
                          style={{ width: `${paramColWidths.key}px` }}
                        >
                          Parameter Key
                          <div 
                            onMouseDown={(e) => handleParamResizeStart("key", paramColWidths.key, e)}
                            className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-[#ff6c37]/50 bg-transparent z-[20] transition-colors"
                          />
                        </th>
                        <th 
                          className="py-2 px-3 relative select-none font-sans font-semibold text-neutral-200"
                          style={{ width: `${paramColWidths.value}px` }}
                        >
                          Value
                          <div 
                            onMouseDown={(e) => handleParamResizeStart("value", paramColWidths.value, e)}
                            className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-[#ff6c37]/50 bg-transparent z-[20] transition-colors"
                          />
                        </th>
                        <th 
                          className="py-2 px-3 relative select-none font-sans font-semibold text-neutral-200"
                          style={{ width: `${paramColWidths.desc}px` }}
                        >
                          Description
                          <div 
                            onMouseDown={(e) => handleParamResizeStart("desc", paramColWidths.desc, e)}
                            className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-[#ff6c37]/50 bg-transparent z-[20] transition-colors"
                          />
                        </th>
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
                            <td className="py-1.5 px-2" style={{ width: `${paramColWidths.key}px`, maxWidth: `${paramColWidths.key}px` }}>
                              <input
                                type="text"
                                value={param.key}
                                onChange={(e) => handleParamRowChange(idx, "key", e.target.value)}
                                onKeyUp={handleInputCheckVar}
                                onSelect={handleInputCheckVar}
                                onMouseUp={handleInputCheckVar}
                                onBlur={handleInputBlur}
                                placeholder="Key"
                                className="w-full bg-transparent border-none text-white focus:outline-none focus:ring-1 focus:ring-neutral-800 rounded px-1.5 py-0.5 text-xs truncate"
                              />
                            </td>
                            <td className="py-1.5 px-2" style={{ width: `${paramColWidths.value}px`, maxWidth: `${paramColWidths.value}px` }}>
                              <input
                                type="text"
                                value={param.value}
                                onChange={(e) => handleParamRowChange(idx, "value", e.target.value)}
                                onKeyUp={handleInputCheckVar}
                                onSelect={handleInputCheckVar}
                                onMouseUp={handleInputCheckVar}
                                onBlur={handleInputBlur}
                                placeholder="Value"
                                className="w-full bg-transparent border-none text-neutral-300 focus:outline-none focus:ring-1 focus:ring-neutral-800 rounded px-1.5 py-0.5 text-xs truncate"
                              />
                            </td>
                            <td className="py-1.5 px-2" style={{ width: `${paramColWidths.desc}px`, maxWidth: `${paramColWidths.desc}px` }}>
                              <input
                                type="text"
                                value={param.description || ""}
                                onChange={(e) => handleParamRowChange(idx, "description", e.target.value)}
                                placeholder="Optional description..."
                                className="w-full bg-transparent border-none text-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-800 rounded px-1.5 py-0.5 text-xs font-sans truncate"
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
                </div>

                <div className="border border-neutral-900 rounded-lg relative overflow-visible">
                  <table className="w-full border-collapse text-xs font-mono text-left">
                    <thead>
                      <tr className="border-b border-neutral-900 bg-neutral-900/30 text-neutral-400">
                        <th className="py-2 px-3 w-12 text-center select-none">Active</th>
                        <th 
                          className="py-2 px-3 relative select-none font-sans font-semibold text-neutral-200"
                          style={{ width: `${headerColWidths.key}px` }}
                        >
                          Header Name
                          <div 
                            onMouseDown={(e) => handleHeaderResizeStart("key", headerColWidths.key, e)}
                            className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-[#ff6c37]/50 bg-transparent z-[20] transition-colors"
                          />
                        </th>
                        <th 
                          className="py-2 px-3 relative select-none font-sans font-semibold text-neutral-200"
                          style={{ width: `${headerColWidths.value}px` }}
                        >
                          Value
                          <div 
                            onMouseDown={(e) => handleHeaderResizeStart("value", headerColWidths.value, e)}
                            className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-[#ff6c37]/50 bg-transparent z-[20] transition-colors"
                          />
                        </th>
                        <th 
                          className="py-2 px-3 relative select-none font-sans font-semibold text-neutral-200"
                          style={{ width: `${headerColWidths.desc}px` }}
                        >
                          Description
                          <div 
                            onMouseDown={(e) => handleHeaderResizeStart("desc", headerColWidths.desc, e)}
                            className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-[#ff6c37]/50 bg-transparent z-[20] transition-colors"
                          />
                        </th>
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
                            <td className="py-1.5 px-2" style={{ width: `${headerColWidths.key}px`, maxWidth: `${headerColWidths.key}px` }}>
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
                                  className="w-full bg-transparent border-none text-white focus:outline-none focus:ring-1 focus:ring-neutral-800 rounded px-1.5 py-0.5 text-xs font-mono truncate"
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
                            <td className="py-1.5 px-2" style={{ width: `${headerColWidths.value}px`, maxWidth: `${headerColWidths.value}px` }}>
                              <input
                                type="text"
                                value={h.value}
                                onChange={(e) => handleHeaderRowChange(idx, "value", e.target.value)}
                                onKeyUp={handleInputCheckVar}
                                onSelect={handleInputCheckVar}
                                onMouseUp={handleInputCheckVar}
                                onBlur={handleInputBlur}
                                placeholder="Value"
                                className="w-full bg-transparent border-none text-neutral-300 focus:outline-none focus:ring-1 focus:ring-neutral-800 rounded px-1.5 py-0.5 text-xs truncate"
                              />
                            </td>
                            <td className="py-1.5 px-2" style={{ width: `${headerColWidths.desc}px`, maxWidth: `${headerColWidths.desc}px` }}>
                              <input
                                type="text"
                                value={h.description || ""}
                                onChange={(e) => handleHeaderRowChange(idx, "description", e.target.value)}
                                placeholder="Optional description..."
                                className="w-full bg-transparent border-none text-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-800 rounded px-1.5 py-0.5 text-xs font-sans truncate"
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
                    {(["none", "bearer", "basic"] as const).map((type) => {
                      const labels: Record<string, string> = { none: "No Auth", bearer: "Bearer Token", basic: "Basic Auth" };
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
                          showToast("Invalid JSON format — check your syntax to beautify.", "error");
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

      {/* Custom Context Menu on Text Selection in Inputs */}
      {selectionContextMenu && (
        <div
          style={{ top: `${selectionContextMenu.y}px`, left: `${selectionContextMenu.x}px` }}
          className="fixed z-[9999] w-48 bg-neutral-950 border border-neutral-850 rounded-lg p-1 shadow-2xl text-[11px] font-semibold text-neutral-400 font-sans"
          onClick={(e) => e.stopPropagation()}
        >
          {selectionContextMenu.text.includes("%") && (
            <>
              <button
                onClick={() => {
                  try {
                    const decoded = decodeURIComponent(selectionContextMenu.text);
                    replaceSelectionWithText(selectionContextMenu.targetInput, decoded);
                    showToast("URL decoded successfully", "success");
                  } catch (err) {
                    showToast("Failed to decode URL", "error");
                  }
                  setSelectionContextMenu(null);
                }}
                className="w-full text-left px-2.5 py-1.5 hover:bg-neutral-900 rounded hover:text-white flex items-center gap-1.5 cursor-pointer bg-transparent border-none text-neutral-400 animate-fade-in"
              >
                <RefreshCw className="h-3.5 w-3.5 text-emerald-400" /> Decode URL
              </button>
              <div className="border-t border-neutral-900 my-1"></div>
            </>
          )}

          <button
            onClick={() => {
              setCreateVariableData({
                value: selectionContextMenu.text,
                inputElement: selectionContextMenu.targetInput,
              });
              setNewVarName("");
              setNewVarValue(selectionContextMenu.text);
              setNewVarDesc("");
              setSelectionContextMenu(null);
            }}
            className="w-full text-left px-2.5 py-1.5 hover:bg-neutral-900 rounded hover:text-white flex items-center gap-1.5 cursor-pointer bg-transparent border-none text-neutral-400 animate-fade-in"
          >
            <Plus className="h-3.5 w-3.5 text-emerald-400" /> Set as New Variable
          </button>

          {variables.length > 0 && (
            <>
              <div className="border-t border-neutral-900 my-1"></div>
              <div className="px-2.5 py-1 text-[9px] uppercase tracking-wider text-neutral-500 font-bold">Update Existing</div>
              <div className="max-h-36 overflow-y-auto scrollbar-thin">
                {variables.map((v) => (
                  <button
                    key={v.id}
                    onClick={async () => {
                      try {
                        await db.variables.update(v.id, { value: selectionContextMenu.text });
                        const count = await refactorVariableOccurrences(v.id, selectionContextMenu.text);
                        if (count > 0) {
                          showToast(`Updated variable and refactored ${count} references`, "success");
                        } else {
                          showToast(`Updated variable \${${v.id}} value`, "success");
                        }
                        replaceSelectionWithVar(selectionContextMenu.targetInput, v.id);
                      } catch (err) {
                        showToast("Failed to update variable", "error");
                      }
                      setSelectionContextMenu(null);
                    }}
                    className="w-full text-left px-2.5 py-1 hover:bg-neutral-900 rounded truncate hover:text-white flex items-center gap-1.5 cursor-pointer bg-transparent border-none text-neutral-400 font-mono text-[10px]"
                    title={`Update ${v.id} to "${selectionContextMenu.text}"`}
                  >
                    ${`{`}{v.id}{`}`}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Modern Theme-Aware Modal for creating variables */}
      {createVariableData && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-sm bg-neutral-950 border border-neutral-850 rounded-xl p-4 shadow-2xl animate-slide-up flex flex-col gap-3 text-xs font-sans text-neutral-200">
            <div className="flex items-center justify-between border-b border-neutral-900 pb-2">
              <span className="font-bold text-white text-sm">Create New Variable</span>
              <button
                onClick={() => setCreateVariableData(null)}
                className="text-neutral-500 hover:text-white transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex flex-col gap-2">
              <div>
                <label className="block text-[9px] uppercase tracking-wider text-neutral-500 mb-1 font-semibold">Variable Name</label>
                <input
                  type="text"
                  value={newVarName}
                  onChange={(e) => setNewVarName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ""))}
                  placeholder="e.g. baseUrl"
                  className="w-full bg-neutral-900 border border-neutral-850 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-neutral-700 focus:outline-none focus:border-brand-blue font-mono"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-[9px] uppercase tracking-wider text-neutral-500 mb-1 font-semibold">Value</label>
                <input
                  type="text"
                  value={newVarValue}
                  onChange={(e) => setNewVarValue(e.target.value)}
                  placeholder="Variable value"
                  className="w-full bg-neutral-900 border border-neutral-850 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-neutral-700 focus:outline-none focus:border-brand-blue font-mono"
                />
              </div>

              <div>
                <label className="block text-[9px] uppercase tracking-wider text-neutral-500 mb-1 font-semibold">Description (Optional)</label>
                <input
                  type="text"
                  value={newVarDesc}
                  onChange={(e) => setNewVarDesc(e.target.value)}
                  placeholder="Describe variable purpose..."
                  className="w-full bg-neutral-900 border border-neutral-850 rounded-lg px-2.5 py-1.5 text-xs text-neutral-400 placeholder-neutral-700 focus:outline-none focus:border-brand-blue"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-2 border-t border-neutral-900 pt-3">
              <button
                type="button"
                onClick={() => setCreateVariableData(null)}
                className="px-3 py-1.5 hover:bg-neutral-900 rounded-lg text-neutral-400 hover:text-white transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  const trimmedName = newVarName.trim();
                  if (!trimmedName) {
                    showToast("Variable name is required", "error");
                    return;
                  }
                  const duplicate = variables.some((v) => v.id.toLowerCase() === trimmedName.toLowerCase());
                  if (duplicate) {
                    showToast(`Variable "${trimmedName}" already exists`, "error");
                    return;
                  }

                  try {
                    await db.variables.add({
                      id: trimmedName,
                      value: newVarValue,
                      enabled: true,
                      description: newVarDesc
                    });

                    if (newVarValue.trim()) {
                      const count = await refactorVariableOccurrences(trimmedName, newVarValue);
                      if (count > 0) {
                        showToast(`Created variable and refactored ${count} references`, "success");
                      } else {
                        showToast(`Created variable \${${trimmedName}}`, "success");
                      }
                    } else {
                      showToast(`Created variable \${${trimmedName}}`, "success");
                    }

                    replaceSelectionWithVar(createVariableData.inputElement, trimmedName);
                    setCreateVariableData(null);
                  } catch (err) {
                    showToast("Failed to create variable", "error");
                  }
                }}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold transition-colors cursor-pointer"
              >
                Create & Replace
              </button>
            </div>
          </div>
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

