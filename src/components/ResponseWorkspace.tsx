import { useState, useMemo, useEffect } from "react";
import { db, type RequestItem, type RequestHistoryItem } from "../db/db";
import ModernConfirmModal from "./ModernConfirmModal";
import {
  formatSmartData,
  profileResponseData,
  generateLocalBusinessSummary,
  flattenObject
} from "../utils/responseInspector";
import TreeView from "./TreeView";
import ResponseDiffPanel from "./ResponseDiffPanel";
import { useLiveQuery } from "dexie-react-hooks";
import {
  FileCode,
  Table as TableIcon,
  LayoutGrid,
  TrendingUp,
  Diff,
  ShieldCheck,
  Clock,
  Database,
  History,
  Download,
  Copy,
  Check,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  X,
  Search,
  Eye,
  Play,
  Maximize2,
  Minimize2
} from "lucide-react";

// --- Static Helper Functions Defined Outside Component to Prevent TDZ (Temporal Dead Zone) Crashes ---

function formatSize(bytes: number | null) {
  if (bytes === null || bytes === undefined) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getStatusColor(status: number | null) {
  if (status === 0 || status === null) return "text-neutral-500 bg-neutral-900 border-neutral-800";
  if (status >= 200 && status < 300) return "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
  if (status >= 300 && status < 400) return "text-amber-400 bg-amber-500/10 border-amber-500/20";
  if (status >= 400 && status < 500) return "text-orange-400 bg-orange-500/10 border-orange-500/20";
  return "text-rose-400 bg-red-500/10 border-red-500/20";
}

interface ResponseWorkspaceProps {
  responseData: any;
  responseStatus: number | null;
  responseStatusText: string;
  responseDuration: number | null;
  responseSize: number | null;
  responseHeaders: { key: string; value: string }[];
  activeRequest: RequestItem | null;
  isMaximized: boolean;
  onToggleMaximize: () => void;
  onMinimize: () => void;
  isCollapsed?: boolean;
  onExpand?: () => void;
}

type ResponseTabType = "pretty" | "table" | "cards" | "tree" | "insights" | "diff" | "headers" | "history";

export default function ResponseWorkspace({
  responseData,
  responseStatus,
  responseStatusText,
  responseDuration,
  responseSize,
  responseHeaders,
  activeRequest,
  isMaximized,
  onToggleMaximize,
  onMinimize,
  isCollapsed = false,
  onExpand,
}: ResponseWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<ResponseTabType>("pretty");
  const [tableSearch, setTableSearch] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDesc, setSortDesc] = useState(false);
  const [selectedTableRow, setSelectedTableRow] = useState<any | null>(null);
  const [copiedResponse, setCopiedResponse] = useState(false);

  // Search states for Pretty JSON tab
  const [searchQuery, setSearchQuery] = useState("");
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [showSearch, setShowSearch] = useState(false);

  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  // --- React Hooks Declared BEFORE Early Returns (CRITICAL FIX) ---
  
  // Shortcut binder for Ctrl+F inside Pretty JSON
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        if (activeTab === "pretty" && responseData) {
          e.preventDefault();
          setShowSearch((prev) => !prev);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeTab, responseData]);

  // Escape key handler for drawer closure
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && selectedTableRow) {
        setSelectedTableRow(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedTableRow]);

  const jsonString = useMemo(() => {
    if (!responseData) return "";
    return JSON.stringify(responseData, null, 2);
  }, [responseData]);

  const matchesCount = useMemo(() => {
    if (!searchQuery.trim() || !jsonString) return 0;
    try {
      const escaped = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escaped, "gi");
      const matches = jsonString.match(regex);
      return matches ? matches.length : 0;
    } catch {
      return 0;
    }
  }, [searchQuery, jsonString]);

  useEffect(() => {
    if (showSearch && matchesCount > 0) {
      const activeEl = document.querySelector(`mark[data-search-match="${activeMatchIndex}"]`);
      if (activeEl) {
        activeEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }
  }, [activeMatchIndex, showSearch, matchesCount]);

  // History Log queries (with DB query limit enforced to avoid massive memory consumption)
  const historyLogs = (useLiveQuery(() => db.history.orderBy("timestamp").reverse().limit(100).toArray()) as RequestHistoryItem[]) || [];

  // Auto-detect structure and switch to table view (CRITICAL FIX: Changed from useMemo to useEffect side effect)
  useEffect(() => {
    if (responseData) {
      const isArr = Array.isArray(responseData) || (responseData && typeof responseData === "object" && Object.values(responseData).find(Array.isArray));
      if (isArr && activeTab === "pretty") {
        setActiveTab("table");
      } else if (!isArr && activeTab === "table") {
        setActiveTab("pretty");
      }
    }
  }, [responseData]);

  // Extract tabular array safely
  const tableArray = useMemo<any[]>(() => {
    if (!responseData) return [];
    if (Array.isArray(responseData)) return responseData;
    if (typeof responseData === "object") {
      const nestedArr = Object.values(responseData).find(Array.isArray);
      if (nestedArr) return nestedArr;
    }
    return [];
  }, [responseData]);

  // Generate unique flat headers for TanStack-like Table column headers
  const tableColumns = useMemo<string[]>(() => {
    if (tableArray.length === 0) return [];
    const keysSet = new Set<string>();
    tableArray.slice(0, 100).forEach((item) => {
      if (item && typeof item === "object") {
        const flat = flattenObject(item);
        Object.keys(flat).forEach((k) => keysSet.add(k));
      }
    });
    return Array.from(keysSet);
  }, [tableArray]);

  // Sort and filter table rows
  const processedRows = useMemo(() => {
    let rows = tableArray.map((row) => flattenObject(row));

    if (tableSearch.trim()) {
      const query = tableSearch.toLowerCase();
      rows = rows.filter((row) =>
        Object.values(row).some((val) => String(val).toLowerCase().includes(query))
      );
    }

    if (sortKey) {
      rows.sort((a, b) => {
        const aVal = a[sortKey];
        const bVal = b[sortKey];
        if (aVal === undefined) return 1;
        if (bVal === undefined) return -1;

        if (typeof aVal === "number" && typeof bVal === "number") {
          return sortDesc ? bVal - aVal : aVal - bVal;
        }
        const aStr = String(aVal).toLowerCase();
        const bStr = String(bVal).toLowerCase();
        return sortDesc ? bStr.localeCompare(aStr) : aStr.localeCompare(bStr);
      });
    }

    return rows;
  }, [tableArray, tableSearch, sortKey, sortDesc]);

  // Data Profiles & Summaries memoization
  const dataProfile = useMemo(() => {
    if (!responseData) return [];
    return profileResponseData(responseData);
  }, [responseData]);

  const businessSummary = useMemo(() => {
    if (!responseData) return "";
    return generateLocalBusinessSummary(responseData);
  }, [responseData]);

  // --- End of Hooks ---

  // Early return if collapsed is handled here after hooks are evaluated
  if (isCollapsed) {
    return (
      <div
        onClick={onExpand}
        className="flex items-center justify-between px-3 h-full bg-neutral-950 hover:bg-neutral-850 border-t border-neutral-800 cursor-pointer select-none group transition-all duration-150"
      >
        <div className="flex items-center gap-2.5">
          <ChevronUp className="h-3 w-3 text-neutral-500 group-hover:text-emerald-400 transition-colors" />
          <span className="text-[9px] font-bold tracking-wider text-neutral-400 uppercase font-sans">
            Response
          </span>
          {responseStatus !== null && (
            <div className="flex items-center gap-2 border-l border-neutral-800 pl-2.5">
              <span className={`text-[9px] font-bold font-mono ${responseStatus >= 200 && responseStatus < 300 ? "text-emerald-400" : "text-rose-450"}`}>
                {responseStatus}
              </span>
              <span className="text-[9.5px] text-neutral-500 font-mono">•</span>
              <span className="text-[9.5px] text-neutral-500 font-mono">
                {responseDuration} ms
              </span>
              <span className="text-[9.5px] text-neutral-500 font-mono">•</span>
              <span className="text-[9.5px] text-neutral-500 font-mono">
                {formatSize(responseSize)}
              </span>
            </div>
          )}
        </div>
        <div className="text-[9px] font-medium text-neutral-500 group-hover:text-neutral-300 font-sans transition-colors">
          Click to expand
        </div>
      </div>
    );
  }

  const getHighlightedText = (text: string, search: string) => {
    if (!search.trim()) return text;
    try {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const parts = text.split(new RegExp(`(${escaped})`, "gi"));
      let matchCount = 0;
      return (
        <>
          {parts.map((part, i) => {
            if (part.toLowerCase() === search.toLowerCase()) {
              const currentIdx = matchCount++;
              const isActive = currentIdx === activeMatchIndex;
              return (
                <mark
                  key={i}
                  data-search-match={currentIdx}
                  className={`rounded-sm px-0.5 border transition-colors ${
                    isActive
                      ? "bg-amber-500 text-black border-amber-400 font-bold"
                      : "bg-neutral-800 text-neutral-200 border-neutral-700"
                  }`}
                >
                  {part}
                </mark>
              );
            }
            return part;
          })}
        </>
      );
    } catch {
      return text;
    }
  };

  const handleSearchInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        setActiveMatchIndex((prev) => (prev - 1 + matchesCount) % matchesCount);
      } else {
        setActiveMatchIndex((prev) => (prev + 1) % matchesCount);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setShowSearch(false);
      setSearchQuery("");
    }
  };

  // Copy whole response helper
  const handleCopyResponse = () => {
    if (!responseData) return;
    navigator.clipboard.writeText(JSON.stringify(responseData, null, 2));
    setCopiedResponse(true);
    setTimeout(() => setCopiedResponse(false), 2000);
  };

  // Export CSV helper with proper quotes and newlines escaping
  const handleExportCSV = () => {
    if (processedRows.length === 0 || tableColumns.length === 0) return;

    const csvHeaders = tableColumns.join(",");
    const csvRows = processedRows.map((row) =>
      tableColumns
        .map((col) => {
          const val = row[col] !== undefined ? String(row[col]) : "";
          const escapedVal = val.replace(/"/g, '""');
          return `"${escapedVal}"`;
        })
        .join(",")
    );

    const csvContent = "data:text/csv;charset=utf-8," + [csvHeaders, ...csvRows].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `restman_export_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Replay history executor helper
  const handleReplayHistory = async (hist: RequestHistoryItem) => {
    if (!activeRequest) return;
    try {
      await db.requests.update(activeRequest.id, {
        method: hist.method as any,
        url: hist.url,
        updatedAt: Date.now(),
      });
      alert(`Restored execution parameters for [${hist.method}] into active workspace. Click Send to rerun!`);
    } catch (err) {
      console.error("Failed to restore history execution params:", err);
    }
  };

  return (
    <div className="flex flex-col h-full bg-neutral-900 text-neutral-200 border-l border-neutral-800 relative font-sans">
      {/* Dynamic Header Metrics Bar */}
      <div className="px-3 border-b border-neutral-800 bg-neutral-950 text-neutral-200 shrink-0 flex items-center justify-between gap-3 h-[41px] min-h-[41px]">
        {responseStatus !== null ? (
          <div className="flex items-center gap-3">
            {/* Status Code badge */}
            <span className={`text-[10px] font-bold font-mono px-2 py-0.5 rounded border ${getStatusColor(responseStatus)}`}>
              {responseStatus} {responseStatusText}
            </span>

            {/* Time metric */}
            <div className="flex items-center gap-1 text-[11px] text-neutral-400 font-mono">
              <Clock className="h-3.5 w-3.5 text-neutral-500" />
              <span>{responseDuration} ms</span>
            </div>

            {/* Size metric */}
            <div className="flex items-center gap-1 text-[11px] text-neutral-400 font-mono">
              <Database className="h-3.5 w-3.5 text-neutral-500" />
              <span>{formatSize(responseSize)}</span>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-xs text-neutral-500 font-semibold font-sans">
            <span>Response</span>
          </div>
        )}

        <div className="flex items-center gap-2 shrink-0">
          {/* Copy whole payload button */}
          {responseData && (
            <button
              onClick={handleCopyResponse}
              className="text-[10px] bg-neutral-900 hover:bg-neutral-850 text-neutral-300 hover:text-white border border-neutral-800 px-2.5 py-1.5 rounded cursor-pointer transition-colors flex items-center gap-1.5 shrink-0"
            >
              {copiedResponse ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                  <span className="text-emerald-600 font-bold">Copied Payload</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5 text-neutral-500" />
                  <span>Copy Payload</span>
                </>
              )}
            </button>
          )}

          <span className="text-neutral-800 font-sans">|</span>

          {/* Toggle Full Screen / Maximize */}
          <button
            onClick={onToggleMaximize}
            className="p-1 hover:bg-neutral-800 rounded text-neutral-500 hover:text-white transition-colors cursor-pointer"
            title={isMaximized ? "Restore Layout" : "Maximize Panel"}
          >
            {isMaximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>

          {/* Minimize / Close */}
          <button
            onClick={onMinimize}
            className="p-1 hover:bg-neutral-800 rounded text-neutral-500 hover:text-white transition-colors cursor-pointer"
            title="Minimize Panel"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Response tabs selectors */}
      <div className="flex items-center gap-1 px-3 border-b border-neutral-800 bg-neutral-950/40 shrink-0 text-xs font-semibold overflow-x-auto scrollbar-none min-h-[38px]">
        {[
          { key: "pretty", title: "Pretty", icon: <FileCode className="h-3.5 w-3.5" /> },
          { key: "table", title: "Table View", icon: <TableIcon className="h-3.5 w-3.5" />, hidden: tableArray.length === 0 },
          { key: "cards", title: "Cards", icon: <LayoutGrid className="h-3.5 w-3.5" />, hidden: tableArray.length === 0 },
          { key: "tree", title: "JSON Explorer", icon: <TrendingUp className="h-3.5 w-3.5" /> },
          { key: "insights", title: "Insights", icon: <ShieldCheck className="h-3.5 w-3.5" /> },
          { key: "diff", title: "Compare Diff", icon: <Diff className="h-3.5 w-3.5" /> },
          { key: "headers", title: "Headers", icon: <Database className="h-3.5 w-3.5" /> },
          { key: "history", title: "History Logs", icon: <History className="h-3.5 w-3.5" /> },
        ]
          .filter((t) => !t.hidden)
          .map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as any)}
                className={`flex items-center gap-1.5 px-3 py-2 border-b-2 transition-all cursor-pointer whitespace-nowrap ${
                  isActive
                    ? "border-emerald-500 text-white font-bold"
                    : "border-transparent text-neutral-500 hover:text-neutral-300"
                }`}
              >
                {tab.icon}
                <span>{tab.title}</span>
              </button>
            );
          })}
      </div>

      {/* Display Board */}
      <div className="flex-1 overflow-y-auto p-4 scrollbar-thin">
        {!responseData && activeTab !== "history" ? (
          <div className="h-full flex flex-col items-center justify-center p-8 text-center min-h-[350px]">
            <div className="h-12 w-12 bg-neutral-900 border border-neutral-800 rounded-xl flex items-center justify-center text-neutral-400 mb-4 shadow-lg">
              <Play className="h-5 w-5 text-brand-blue" />
            </div>
            
            <h4 className="text-sm font-bold text-neutral-200">Send a request to get a response</h4>
            <p className="text-xs text-neutral-500 max-w-xs mt-1.5 leading-relaxed font-sans">
              Enter the request URL, configure your headers or body parameters, and click the Send button to connect.
            </p>

            <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-3 max-w-md w-full border-t border-neutral-900 pt-6 text-left">
              <div className="p-3 rounded-lg border border-neutral-900 bg-neutral-950/30 flex flex-col gap-1.5">
                <span className="text-[11px] font-bold text-neutral-400 font-sans">Keyboard Actions</span>
                <div className="flex items-center justify-between text-[10px] text-neutral-500 font-mono mt-1">
                  <span>Send Request</span>
                  <kbd className="bg-neutral-900 border border-neutral-850 px-1.5 py-0.5 rounded text-[9px] font-semibold text-neutral-300 font-sans">Ctrl+Enter</kbd>
                </div>
                <div className="flex items-center justify-between text-[10px] text-neutral-500 font-mono">
                  <span>Command Palette</span>
                  <kbd className="bg-neutral-900 border border-neutral-850 px-1.5 py-0.5 rounded text-[9px] font-semibold text-neutral-300 font-sans">Ctrl+P</kbd>
                </div>
              </div>

              <div className="p-3 rounded-lg border border-neutral-900 bg-neutral-950/30 flex flex-col gap-1.5">
                <span className="text-[11px] font-bold text-neutral-400 font-sans">Workspace Studio</span>
                <div className="flex items-center justify-between text-[10px] text-neutral-500 font-mono mt-1">
                  <span>Toggle Sidebar</span>
                  <kbd className="bg-neutral-900 border border-neutral-850 px-1.5 py-0.5 rounded text-[9px] font-semibold text-neutral-300 font-sans">Ctrl+B</kbd>
                </div>
                <div className="flex items-center justify-between text-[10px] text-neutral-500 font-mono">
                  <span>Global Variables</span>
                  <kbd className="bg-neutral-900 border border-neutral-850 px-1.5 py-0.5 rounded text-[9px] font-semibold text-neutral-300 font-sans">Ctrl+Shift+V</kbd>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="h-full">
            {/* TAB VIEW: PRETTY COLLAPSED RAW JSON WITH INBUILT SEARCH */}
            {activeTab === "pretty" && (
              <div className="relative rounded-xl border border-neutral-900 bg-neutral-950 p-3 flex flex-col h-full min-h-[300px]">
                {/* Search Bar Overlay */}
                {showSearch && (
                  <div className="absolute top-2 right-2 z-40 flex items-center gap-1.5 bg-neutral-900 border border-neutral-800 p-1.5 rounded-lg shadow-2xl animate-fade-in text-[11px] text-neutral-300 select-none">
                    <input
                      type="text"
                      placeholder="Search payload..."
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        setActiveMatchIndex(0);
                      }}
                      onKeyDown={handleSearchInputKeyDown}
                      className="bg-neutral-950 border border-neutral-850 rounded px-2 py-1 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-emerald-500 w-44 font-sans"
                      autoFocus
                    />
                    <span className="text-neutral-500 font-mono shrink-0">
                      {matchesCount > 0 ? `${activeMatchIndex + 1} of ${matchesCount}` : "0 of 0"}
                    </span>
                    <button
                      disabled={matchesCount === 0}
                      onClick={() => setActiveMatchIndex((prev) => (prev - 1 + matchesCount) % matchesCount)}
                      className="p-1 hover:bg-neutral-800 rounded text-neutral-400 hover:text-white transition-colors cursor-pointer disabled:opacity-30"
                      title="Previous Match (Shift+Enter)"
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      disabled={matchesCount === 0}
                      onClick={() => setActiveMatchIndex((prev) => (prev + 1) % matchesCount)}
                      className="p-1 hover:bg-neutral-800 rounded text-neutral-400 hover:text-white transition-colors cursor-pointer disabled:opacity-30"
                      title="Next Match (Enter)"
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        setShowSearch(false);
                        setSearchQuery("");
                      }}
                      className="p-1 hover:bg-neutral-800 rounded text-neutral-400 hover:text-white transition-colors cursor-pointer"
                      title="Close search"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}

                {/* Remove static max-h constraint when maximized */}
                <div className={`flex-1 overflow-auto scrollbar-thin selectable ${isMaximized ? "max-h-full" : "max-h-[400px]"}`}>
                  <pre className="text-[11px] font-mono text-emerald-400 leading-relaxed selectable select-all selection:bg-neutral-800 whitespace-pre-wrap break-all">
                    {searchQuery ? getHighlightedText(jsonString, searchQuery) : jsonString}
                  </pre>
                </div>
              </div>
            )}

            {/* TAB VIEW: TABLE VIEW */}
            {activeTab === "table" && (
              <div className="flex flex-col gap-3 h-full">
                {/* Search / Filter Row */}
                <div className="flex flex-wrap items-center justify-between gap-3 bg-neutral-950 p-2.5 rounded-lg border border-neutral-900 font-sans">
                  <div className="relative flex-1 max-w-xs font-sans">
                    <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-neutral-500" />
                    <input
                      type="text"
                      placeholder="Filter table rows..."
                      value={tableSearch}
                      onChange={(e) => setTableSearch(e.target.value)}
                      className="w-full bg-neutral-950 border border-neutral-850 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-neutral-600 focus:outline-none"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleExportCSV}
                      className="px-2.5 py-1.5 bg-neutral-900 hover:bg-neutral-800 text-neutral-300 hover:text-white rounded border border-neutral-850 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
                      title="Download as CSV"
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>Download CSV</span>
                    </button>
                  </div>
                </div>

                {/* Table Core (high fidelity with sorting) */}
                <div className="border border-neutral-900 rounded-lg overflow-x-auto bg-neutral-950/40 relative">
                  <table className="w-full border-collapse text-left text-xs font-mono relative">
                    <thead>
                      <tr className="border-b border-neutral-900 bg-neutral-900/40 text-neutral-400 sticky top-0 backdrop-blur-md">
                        {tableColumns.map((col) => {
                          const isSorted = sortKey === col;
                          return (
                            <th
                              key={col}
                              onClick={() => {
                                if (sortKey === col) {
                                  setSortDesc(!sortDesc);
                                } else {
                                  setSortKey(col);
                                  setSortDesc(false);
                                }
                              }}
                              className="py-2.5 px-3 font-semibold cursor-pointer hover:bg-neutral-900/60 transition-colors select-none whitespace-nowrap border-r border-neutral-900"
                            >
                              <div className="flex items-center gap-1.5">
                                <span className="text-[11px] font-bold text-neutral-200 font-sans">{col}</span>
                                {isSorted && (
                                  <span className="text-[9px] text-emerald-400 font-bold">
                                    {sortDesc ? "▼" : "▲"}
                                  </span>
                                )}
                              </div>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-900/60 font-mono text-[11px]">
                      {processedRows.length === 0 ? (
                        <tr>
                          <td colSpan={tableColumns.length} className="py-8 text-center text-neutral-600 italic font-sans">
                            No matching items in this response table.
                          </td>
                        </tr>
                      ) : (
                        processedRows.map((row, rowIdx) => (
                          <tr
                            key={rowIdx}
                            onClick={() => setSelectedTableRow(row)}
                            className="hover:bg-neutral-900/20 group cursor-pointer transition-colors"
                          >
                            {tableColumns.map((col) => {
                              const cell = row[col];
                              const smart = formatSmartData(cell, col);
                              let formattedStyle = "text-neutral-300";

                              if (smart.type === "date") formattedStyle = "text-indigo-400";
                              else if (smart.type === "currency") formattedStyle = "text-emerald-400 font-bold";
                              else if (smart.type === "boolean") formattedStyle = cell ? "text-emerald-400 font-bold" : "text-rose-400 font-bold";
                              else if (smart.type === "status") {
                                const lowerS = String(cell).toLowerCase();
                                formattedStyle = lowerS.includes("success") || lowerS.includes("active") || lowerS.includes("approve")
                                  ? "text-emerald-400 font-semibold uppercase bg-emerald-500/10 px-1 py-0.2 rounded border border-emerald-500/20"
                                  : "text-neutral-400 font-semibold uppercase bg-neutral-900 px-1 py-0.2 rounded";
                              }

                              return (
                                <td
                                  key={col}
                                  className="py-2 px-3 truncate max-w-[180px] border-r border-neutral-900"
                                  title={smart.formatted}
                                >
                                  {smart.type === "image" ? (
                                    <img
                                      src={smart.formatted}
                                      alt="preview"
                                      className="h-6 w-10 object-cover rounded bg-neutral-900 border border-neutral-800"
                                    />
                                  ) : (
                                    <span className={formattedStyle}>{smart.formatted}</span>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* TAB VIEW: BUSINESS CARD VIEWER */}
            {activeTab === "cards" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {tableArray.slice(0, 48).map((row, idx) => {
                  const flatRow = flattenObject(row);
                  const entries = Object.entries(flatRow).slice(0, 6);
                  const titleKey = Object.keys(flatRow).find(
                    (k) => k.toLowerCase().includes("name") || k.toLowerCase().includes("title") || k.toLowerCase().includes("label")
                  );
                  const cardTitle = titleKey ? String(flatRow[titleKey]) : `Record #${idx + 1}`;

                  return (
                    <div
                      key={idx}
                      onClick={() => setSelectedTableRow(flatRow)}
                      className="border border-neutral-900 bg-neutral-950 rounded-xl p-4 flex flex-col gap-3 hover:border-neutral-800 transition-colors cursor-pointer group font-sans"
                    >
                      <div className="flex items-center justify-between border-b border-neutral-900 pb-2">
                        <h4 className="text-xs font-semibold text-white truncate max-w-[80%]" title={cardTitle}>
                          {cardTitle}
                        </h4>
                        <ChevronRight className="h-3.5 w-3.5 text-neutral-500 group-hover:text-white transition-colors" />
                      </div>

                      <div className="space-y-1.5 flex-1">
                        {entries.map(([k, v]) => {
                          const smart = formatSmartData(v, k);
                          return (
                            <div key={k} className="flex justify-between text-[10px] font-mono gap-4">
                              <span className="text-neutral-500 truncate max-w-[100px] font-sans">{k}</span>
                              <span className="text-neutral-300 truncate text-right">{smart.formatted}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* TAB VIEW: JSON EXPLORER TREE */}
            {activeTab === "tree" && <TreeView data={responseData} />}

            {/* TAB VIEW: RESPONSE INSIGHTS ENGINE */}
            {activeTab === "insights" && (
              <div className="flex flex-col gap-4 font-sans">
                {/* Business Summary */}
                <div className="border border-neutral-900 bg-neutral-950 p-4 rounded-xl flex flex-col gap-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                    Business Context Summary
                  </h4>
                  <p className="text-xs text-neutral-300 leading-relaxed font-sans italic">
                    "{businessSummary}"
                  </p>
                </div>

                {/* Data Profiler Grid */}
                <div className="border border-neutral-900 rounded-xl overflow-x-auto bg-neutral-950/60">
                  <table className="w-full border-collapse text-left text-xs font-mono">
                    <thead>
                      <tr className="border-b border-neutral-900 bg-neutral-900/50 text-neutral-400">
                        <th className="py-2 px-3 font-semibold font-sans text-[11px] text-neutral-200">Field Name</th>
                        <th className="py-2 px-3 font-semibold font-sans text-[11px] text-neutral-200">Value Type</th>
                        <th className="py-2 px-3 font-semibold font-sans text-[11px] text-neutral-200">Missing/Null %</th>
                        <th className="py-2 px-3 font-semibold font-sans text-[11px] text-neutral-200">Unique Count</th>
                        <th className="py-2 px-3 font-semibold font-sans text-[11px] text-neutral-200">Duplicate Ratio %</th>
                        <th className="py-2 px-3 font-semibold font-sans text-[11px] text-neutral-200">Sample / Mode</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-900 text-[11px]">
                      {dataProfile.map((prof, idx) => (
                        <tr key={idx} className="hover:bg-neutral-900/10">
                          <td className="py-2 px-3 text-neutral-200 font-semibold font-sans">{prof.fieldName}</td>
                          <td className="py-2 px-3 text-indigo-400 capitalize font-sans">{prof.type}</td>
                          <td className="py-2 px-3 text-amber-500 font-bold">{prof.nullPercentage}%</td>
                          <td className="py-2 px-3 text-neutral-300">{prof.uniqueCount}</td>
                          <td className="py-2 px-3 text-neutral-500">{prof.duplicatePercentage}%</td>
                          <td className="py-2 px-3 text-emerald-400 truncate max-w-[140px]" title={prof.mostCommonValue}>
                            {prof.mostCommonValue}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* TAB VIEW: RESPONSE DIFF COMPARE */}
            {activeTab === "diff" && (
              <ResponseDiffPanel
                currentResponse={responseData}
                currentRequestName={activeRequest ? activeRequest.name : "Active Endpoint"}
              />
            )}

            {/* TAB VIEW: HTTP RESPONSE HEADERS */}
            {activeTab === "headers" && (
              <div className="border border-neutral-900 rounded-xl overflow-x-auto bg-neutral-950/60">
                <table className="w-full border-collapse text-left text-xs font-mono">
                  <thead>
                    <tr className="border-b border-neutral-900 bg-neutral-900/50 text-neutral-400">
                      <th className="py-2 px-3 font-sans font-semibold text-[11px] text-neutral-200">Header Name</th>
                      <th className="py-2 px-3 font-sans font-semibold text-[11px] text-neutral-200">Header Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-900">
                    {responseHeaders.length === 0 ? (
                      <tr>
                        <td colSpan={2} className="py-4 text-center text-neutral-600 italic font-sans">No headers found.</td>
                      </tr>
                    ) : (
                      responseHeaders.map((hdr, idx) => (
                        <tr key={idx} className="hover:bg-neutral-900/10">
                          <td className="py-2 px-3 text-neutral-400 font-semibold select-all font-sans">{hdr.key}</td>
                          <td className="py-2 px-3 text-emerald-400 select-all">{hdr.value}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* TAB VIEW: OFFLINE RUN LOGS HISTORY */}
            {activeTab === "history" && (
              <div className="flex flex-col gap-3 font-sans">
                <div className="flex justify-between items-center bg-neutral-950 p-2.5 rounded-lg border border-neutral-900 text-xs">
                  <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">
                    Execution log stream (Offline-first persistence)
                  </span>
                  <button
                    onClick={() => {
                      setConfirmState({
                        isOpen: true,
                        title: "Clear History Logs",
                        message: "Are you sure you want to clear all historical transaction logs from IndexedDB?",
                        onConfirm: async () => {
                          try {
                            await db.history.clear();
                          } catch (err) {
                            console.error("Failed to clear history log database:", err);
                          }
                          setConfirmState(null);
                        }
                      });
                    }}
                    className="text-[10px] hover:text-red-400 text-neutral-500 cursor-pointer transition-colors bg-transparent border-none"
                  >
                    Clear History Logs
                  </button>
                </div>

                <div className="space-y-2">
                  {historyLogs.length === 0 ? (
                    <p className="text-xs text-neutral-500 italic py-10 text-center font-sans">
                      No request executions have been logged in IndexedDB yet. Send requests to log.
                    </p>
                  ) : (
                    historyLogs.map((hist) => (
                      <div
                        key={hist.id}
                        className="p-3 border border-neutral-900 rounded-lg bg-neutral-950/40 hover:bg-neutral-900/20 transition-colors text-xs font-mono flex flex-wrap justify-between items-center gap-3"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-bold font-mono px-2 py-0.2 rounded border ${getStatusColor(hist.status)}`}>
                              {hist.status}
                            </span>
                            <span className="text-white font-semibold truncate max-w-[280px] font-sans" title={hist.url}>
                              {hist.url}
                            </span>
                          </div>
                          <div className="text-[10px] text-neutral-500 mt-1 flex gap-3 flex-wrap font-sans">
                            <span>Latency: <strong className="text-neutral-400 font-mono">{hist.duration} ms</strong></span>
                            <span>Payload size: <strong className="text-neutral-400 font-mono">{formatSize(hist.size)}</strong></span>
                            <span>Ran: <strong className="text-neutral-400 font-mono">{new Date(hist.timestamp).toLocaleString()}</strong></span>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1.5 shrink-0 font-sans">
                          <button
                            onClick={() => handleReplayHistory(hist)}
                            className="bg-neutral-900 hover:bg-neutral-850 border border-neutral-800 text-neutral-300 hover:text-white px-2.5 py-1 rounded text-[10px] font-bold cursor-pointer transition-colors"
                          >
                            Replay Parameters
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Row details Drawer Slide-in */}
      {selectedTableRow && (
        <div className="absolute inset-y-0 right-0 z-40 w-full max-w-lg border-l border-neutral-900 bg-neutral-950 p-5 shadow-2xl flex flex-col gap-4 animate-slide-left font-sans">
          <div className="flex items-center justify-between border-b border-neutral-900 pb-3 shrink-0">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5 font-sans">
              <Eye className="h-4 w-4 text-emerald-400" />
              Expanded Row details
            </h3>
            <button
              onClick={() => setSelectedTableRow(null)}
              className="rounded-lg p-1.5 hover:bg-neutral-900 text-neutral-400 hover:text-white cursor-pointer transition-colors shrink-0"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-4 scrollbar-thin">
            {/* Structured Card Grid */}
            <div className="border border-neutral-900 rounded-lg p-3.5 bg-neutral-950/40 space-y-2">
              <h4 className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest border-b border-neutral-900 pb-1.5">
                Business Card Metrics
              </h4>
              <div className="space-y-2 font-mono text-xs">
                {Object.entries(selectedTableRow).map(([k, v]) => {
                  const smart = formatSmartData(v, k);
                  let metricStyle = "text-neutral-300";
                  if (smart.type === "currency") metricStyle = "text-emerald-400 font-bold";
                  else if (smart.type === "date") metricStyle = "text-indigo-400";
                  else if (smart.type === "boolean") metricStyle = v ? "text-emerald-400 font-bold" : "text-rose-400 font-bold";

                  return (
                    <div key={k} className="flex justify-between items-start gap-4 hover:bg-neutral-900/10 py-1 px-1.5 rounded font-sans">
                      <span className="text-neutral-500 text-[11px] truncate max-w-[180px] font-sans" title={k}>
                        {k}
                      </span>
                      <span className={`text-right break-all max-w-[200px] select-all font-mono ${metricStyle}`}>
                        {smart.type === "image" ? (
                          <img src={smart.formatted} alt="Metric" className="h-16 rounded max-w-full object-contain border border-neutral-800" />
                        ) : (
                          smart.formatted
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Raw JSON Row fragment */}
            <div className="border border-neutral-900 rounded-lg p-3 bg-neutral-950/40">
              <h4 className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest border-b border-neutral-900 pb-1.5 mb-2">
                Raw JSON Fragment
              </h4>
              <pre className="text-[11px] font-mono text-indigo-400 whitespace-pre-wrap select-all max-h-[160px] overflow-y-auto scrollbar-none break-all bg-neutral-950 p-2.5 rounded border border-neutral-900">
                {JSON.stringify(selectedTableRow, null, 2)}
              </pre>
            </div>
          </div>

          <div className="border-t border-neutral-900 pt-3 shrink-0 flex justify-end">
            <button
              onClick={() => setSelectedTableRow(null)}
              className="px-4 py-2 bg-neutral-900 hover:bg-neutral-850 rounded-lg text-xs font-semibold text-neutral-300 hover:text-white cursor-pointer transition-colors"
            >
              Close Drawer
            </button>
          </div>
        </div>
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
