import { X, Terminal, Settings, HelpCircle, Sun, Info, ShieldCheck, Check, Type, FolderDown, Loader2, RefreshCw, AlertCircle, Layers, Upload } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { db } from "../db/db";
import { importPostmanCollection } from "../utils/postmanImporter";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  theme: string;
  onThemeChange: (theme: string) => void;
  useProxy: boolean;
  onProxyChange: (val: boolean) => void;
  proxyUrl: string;
  onProxyUrlChange: (val: string) => void;
  fontFamily: string;
  onFontFamilyChange: (font: string) => void;
  initialTab?: "general" | "themes" | "shortcuts" | "about" | "import";
  onTabChange?: (tab: "general" | "themes" | "shortcuts" | "about" | "import") => void;
}

const THEMES = [
  {
    id: "light",
    name: "Light",
    sidebarBg: "bg-[#151515]",
    appBg: "bg-[#ffffff]",
    borderBg: "border-[#e4e4e7]",
    accentBg: "bg-[#0284c7]",
    textColor: "text-[#09090b]",
  },
  {
    id: "dark",
    name: "Dark",
    sidebarBg: "bg-[#141414]",
    appBg: "bg-[#1c1c1c]",
    borderBg: "border-[#2d2d2d]",
    accentBg: "bg-[#ff6c37]",
    textColor: "text-[#e1e1e1]",
  },
  {
    id: "high-contrast-light",
    name: "High Contrast Light",
    sidebarBg: "bg-[#000000]",
    appBg: "bg-[#ffffff]",
    borderBg: "border-[#000000]",
    accentBg: "bg-[#0000ff]",
    textColor: "text-[#000000]",
  },
  {
    id: "high-contrast-dark",
    name: "High Contrast Dark",
    sidebarBg: "bg-[#000000]",
    appBg: "bg-[#000000]",
    borderBg: "border-[#ffffff]",
    accentBg: "bg-[#00ffff]",
    textColor: "text-[#ffffff]",
  },
  {
    id: "ayu-light",
    name: "Ayu Light",
    sidebarBg: "bg-[#fafafa]",
    appBg: "bg-[#fcfcfc]",
    borderBg: "border-[#e6e6e6]",
    accentBg: "bg-[#f29718]",
    textColor: "text-[#5c6773]",
  },
  {
    id: "ayu-dark",
    name: "Ayu Dark",
    sidebarBg: "bg-[#0a0e14]",
    appBg: "bg-[#0f1419]",
    borderBg: "border-[#1a232c]",
    accentBg: "bg-[#ffb454]",
    textColor: "text-[#e6b450]",
  },
  {
    id: "dracula",
    name: "Dracula",
    sidebarBg: "bg-[#1e1f29]",
    appBg: "bg-[#282a36]",
    borderBg: "border-[#44475a]",
    accentBg: "bg-[#bd93f9]",
    textColor: "text-[#f8f8f2]",
  },
  {
    id: "monokai",
    name: "Monokai",
    sidebarBg: "bg-[#191919]",
    appBg: "bg-[#272822]",
    borderBg: "border-[#3e3d32]",
    accentBg: "bg-[#a6e22e]",
    textColor: "text-[#f8f8f2]",
  },
  {
    id: "night-owl-light",
    name: "Night Owl Light",
    sidebarBg: "bg-[#f0f4f8]",
    appBg: "bg-[#fafcff]",
    borderBg: "border-[#d9e2ec]",
    accentBg: "bg-[#2aa198]",
    textColor: "text-[#403f53]",
  },
  {
    id: "night-owl-dark",
    name: "Night Owl Dark",
    sidebarBg: "bg-[#01111d]",
    appBg: "bg-[#011627]",
    borderBg: "border-[#1d3b53]",
    accentBg: "bg-[#7fdbca]",
    textColor: "text-[#d6deeb]",
  },
  {
    id: "solarized-light",
    name: "Solarized Light",
    sidebarBg: "bg-[#f5f2eb]",
    appBg: "bg-[#fdf6e3]",
    borderBg: "border-[#eee8d5]",
    accentBg: "bg-[#b58900]",
    textColor: "text-[#586e75]",
  },
  {
    id: "solarized-dark",
    name: "Solarized Dark",
    sidebarBg: "bg-[#002b36]",
    appBg: "bg-[#073642]",
    borderBg: "border-[#586e75]",
    accentBg: "bg-[#2aa198]",
    textColor: "text-[#93a1a1]",
  },
];

const FONT_OPTIONS = [
  { name: "Inter (Corporate Standard)", value: "'Inter', sans-serif" },
  { name: "Roboto (Minimal & Clean)", value: "'Roboto', sans-serif" },
  { name: "Open Sans (Professional)", value: "'Open Sans', sans-serif" },
  { name: "Lato (Warm Minimalist)", value: "'Lato', sans-serif" },
  { name: "Montserrat (Modern & Sleek)", value: "'Montserrat', sans-serif" },
  { name: "Nunito Sans (Friendly)", value: "'Nunito Sans', sans-serif" },
  { name: "Work Sans (Technical & Minimal)", value: "'Work Sans', sans-serif" },
  { name: "Plus Jakarta Sans (Corporate Tech)", value: "'Plus Jakarta Sans', sans-serif" },
  { name: "Outfit (Premium & Elegant)", value: "'Outfit', sans-serif" },
  { name: "System Sans-Serif (Standard)", value: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
];

export default function SettingsModal({
  isOpen,
  onClose,
  theme,
  onThemeChange,
  useProxy,
  onProxyChange,
  proxyUrl,
  onProxyUrlChange,
  fontFamily,
  onFontFamilyChange,
  initialTab,
  onTabChange,
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<"general" | "themes" | "shortcuts" | "about" | "import">(initialTab || "general");

  useEffect(() => {
    if (isOpen && initialTab) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  const lastTabRef = useRef(activeTab);
  useEffect(() => {
    if (onTabChange && lastTabRef.current !== activeTab) {
      lastTabRef.current = activeTab;
      onTabChange(activeTab);
    }
  }, [activeTab, onTabChange]);

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [confirmInput, setConfirmInput] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  // Request States
  const [httpVersion, setHttpVersion] = useState(() => localStorage.getItem("restman-http-version") || "Auto");
  const [requestTimeout, setRequestTimeout] = useState(() => Number(localStorage.getItem("restman-request-timeout")) || 0);
  const [maxResponseSize, setMaxResponseSize] = useState(() => Number(localStorage.getItem("restman-max-response-size")) || 1000);
  const [sslVerification, setSslVerification] = useState(() => localStorage.getItem("restman-ssl-verification") !== "false");
  const [sslKeyLog, setSslKeyLog] = useState(() => localStorage.getItem("restman-ssl-key-log") === "true");
  const [disableCookies, setDisableCookies] = useState(() => localStorage.getItem("restman-disable-cookies") === "true");
  const [responseFormatDetection, setResponseFormatDetection] = useState(() => localStorage.getItem("restman-response-format-detection") || "JSON");

  // Working Directory States
  const [workingDirectory, setWorkingDirectory] = useState(() => localStorage.getItem("restman-working-directory") || "C:\\Users\\AkibKhan\\Postman\\files");
  const [readFilesOutsideWorkingDir, setReadFilesOutsideWorkingDir] = useState(() => localStorage.getItem("restman-read-files-outside-working-dir") !== "false");

  // Headers
  const [sendNoCacheHeader, setSendNoCacheHeader] = useState(() => localStorage.getItem("restman-send-no-cache") !== "false");
  const [sendPostmanTokenHeader, setSendPostmanTokenHeader] = useState(() => localStorage.getItem("restman-send-token") === "true");

  // Editor Settings States
  const [editorFontFamily, setEditorFontFamily] = useState(() => localStorage.getItem("restman-editor-font-family") || "IBMPlexMono, 'Courier New', monospace");
  const [editorFontSize, setEditorFontSize] = useState(() => Number(localStorage.getItem("restman-editor-font-size")) || 12);
  const [editorIndentCount, setEditorIndentCount] = useState(() => Number(localStorage.getItem("restman-editor-indent-count")) || 4);
  const [editorIndentType, setEditorIndentType] = useState(() => (localStorage.getItem("restman-editor-indent-type") as "Space" | "Tab") || "Space");
  const [editorAutoCloseBrackets, setEditorAutoCloseBrackets] = useState(() => localStorage.getItem("restman-editor-auto-close-brackets") !== "false");
  const [editorAutoCloseQuotes, setEditorAutoCloseQuotes] = useState(() => localStorage.getItem("restman-editor-auto-close-quotes") !== "false");

  // Application States
  const [appLanguage, setAppLanguage] = useState(() => localStorage.getItem("restman-app-lang") || "English");
  const [appAutosave, setAppAutosave] = useState(() => localStorage.getItem("restman-app-autosave") !== "false");
  const [appSendUsageData, setAppSendUsageData] = useState(() => localStorage.getItem("restman-app-usage-data") !== "false");
  const [appShowNotificationBadge, setAppShowNotificationBadge] = useState(() => localStorage.getItem("restman-app-badge") !== "false");

  // Sync to localStorage
  useEffect(() => {
    localStorage.setItem("restman-http-version", httpVersion);
  }, [httpVersion]);
  useEffect(() => {
    localStorage.setItem("restman-request-timeout", String(requestTimeout));
  }, [requestTimeout]);
  useEffect(() => {
    localStorage.setItem("restman-max-response-size", String(maxResponseSize));
  }, [maxResponseSize]);
  useEffect(() => {
    localStorage.setItem("restman-ssl-verification", String(sslVerification));
  }, [sslVerification]);
  useEffect(() => {
    localStorage.setItem("restman-ssl-key-log", String(sslKeyLog));
  }, [sslKeyLog]);
  useEffect(() => {
    localStorage.setItem("restman-disable-cookies", String(disableCookies));
  }, [disableCookies]);
  useEffect(() => {
    localStorage.setItem("restman-response-format-detection", responseFormatDetection);
  }, [responseFormatDetection]);
  useEffect(() => {
    localStorage.setItem("restman-working-directory", workingDirectory);
  }, [workingDirectory]);
  useEffect(() => {
    localStorage.setItem("restman-read-files-outside-working-dir", String(readFilesOutsideWorkingDir));
  }, [readFilesOutsideWorkingDir]);
  useEffect(() => {
    localStorage.setItem("restman-send-no-cache", String(sendNoCacheHeader));
  }, [sendNoCacheHeader]);
  useEffect(() => {
    localStorage.setItem("restman-send-token", String(sendPostmanTokenHeader));
  }, [sendPostmanTokenHeader]);
  useEffect(() => {
    localStorage.setItem("restman-editor-font-family", editorFontFamily);
  }, [editorFontFamily]);
  useEffect(() => {
    localStorage.setItem("restman-editor-font-size", String(editorFontSize));
  }, [editorFontSize]);
  useEffect(() => {
    localStorage.setItem("restman-editor-indent-count", String(editorIndentCount));
  }, [editorIndentCount]);
  useEffect(() => {
    localStorage.setItem("restman-editor-indent-type", editorIndentType);
  }, [editorIndentType]);
  useEffect(() => {
    localStorage.setItem("restman-editor-auto-close-brackets", String(editorAutoCloseBrackets));
  }, [editorAutoCloseBrackets]);
  useEffect(() => {
    localStorage.setItem("restman-editor-auto-close-quotes", String(editorAutoCloseQuotes));
  }, [editorAutoCloseQuotes]);
  useEffect(() => {
    localStorage.setItem("restman-app-lang", appLanguage);
  }, [appLanguage]);
  useEffect(() => {
    localStorage.setItem("restman-app-autosave", String(appAutosave));
  }, [appAutosave]);
  useEffect(() => {
    localStorage.setItem("restman-app-usage-data", String(appSendUsageData));
  }, [appSendUsageData]);
  useEffect(() => {
    localStorage.setItem("restman-app-badge", String(appShowNotificationBadge));
  }, [appShowNotificationBadge]);

  // Import / Sync States
  const [importTab, setImportTab] = useState<"auto" | "manual">("manual");
  const [scanning, setScanning] = useState(false);
  const [discovered, setDiscovered] = useState<any[]>([]);
  const [selectedDiscoveredPaths, setSelectedDiscoveredPaths] = useState<Record<string, boolean>>({});
  const [importMsg, setImportMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [importJson, setImportJson] = useState("");
  const abortSyncRef = useRef<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // One-Click Scanning handler
  const handleScanLocalCollections = async () => {
    if (!window.electronAPI?.scanPostman) return;
    setScanning(true);
    setImportMsg(null);
    setDiscovered([]);
    abortSyncRef.current = false;
    try {
      const results = await window.electronAPI.scanPostman();
      if (abortSyncRef.current) {
        setImportMsg({
          type: "error",
          text: "Scan interrupted by user."
        });
        return;
      }
      setDiscovered(results);
      // Pre-select all found collections
      const selection: Record<string, boolean> = {};
      results.forEach((col) => {
        selection[col.filePath] = true;
      });
      setSelectedDiscoveredPaths(selection);
      if (results.length === 0) {
        setImportMsg({
          type: "error",
          text: "No Postman collections or backups were found in your standard system folders."
        });
      } else {
        setImportMsg({
          type: "success",
          text: `Discovered ${results.length} local Postman collections!`
        });
      }
    } catch (err: any) {
      if (abortSyncRef.current) return;
      console.error("Scan error:", err);
      setImportMsg({
        type: "error",
        text: err.message || "An error occurred during directory scanning."
      });
    } finally {
      if (!abortSyncRef.current) {
        setScanning(false);
      }
    }
  };

  // Bulk import selected collections
  const handleImportDiscovered = async () => {
    const toImport = discovered.filter((col) => selectedDiscoveredPaths[col.filePath]);
    if (toImport.length === 0) {
      setImportMsg({
        type: "error",
        text: "Please select at least one collection to import."
      });
      return;
    }

    setScanning(true);
    abortSyncRef.current = false;
    let successCount = 0;
    let totalReqs = 0;
    let totalFolders = 0;
    let lastError = "";

    for (const col of toImport) {
      if (abortSyncRef.current) {
        lastError = "Import interrupted by user.";
        break;
      }
      try {
        const result = await importPostmanCollection(col.content);
        if (result.success) {
          successCount++;
          totalReqs += result.requestsCount || 0;
          totalFolders += result.foldersCount || 0;
        } else {
          lastError = result.error || "Format issue";
        }
      } catch (err: any) {
        lastError = err.message || "Parse error";
      }
    }

    setScanning(false);
    if (successCount > 0) {
      setImportMsg({
        type: "success",
        text: `Successfully imported ${successCount} collection(s)! (${totalReqs} requests, ${totalFolders} folders)${abortSyncRef.current ? " (Interrupted)" : ""}`
      });
      setDiscovered([]);
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } else {
      setImportMsg({
        type: "error",
        text: lastError || "Failed to import the selected collections."
      });
    }
  };

  // Import Collection Logic
  const handleImportCollection = async () => {
    if (!importJson.trim()) return;
    const result = await importPostmanCollection(importJson);
    if (result.success) {
      setImportMsg({
        type: "success",
        text: `Successfully imported "${result.collectionName}"! (${result.requestsCount} requests, ${result.foldersCount} folders)`,
      });
      setImportJson("");
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } else {
      setImportMsg({
        type: "error",
        text: result.error || "Failed to parse Postman collection.",
      });
    }
  };

  const processFiles = async (files: File[]) => {
    let successCount = 0;
    let totalReqs = 0;
    let totalFolders = 0;
    let lastError = "";

    for (const file of files) {
      if (file.name.endsWith(".json") || file.type === "application/json") {
        try {
          const text = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target?.result as string);
            reader.onerror = (err) => reject(err);
            reader.readAsText(file);
          });

          const result = await importPostmanCollection(text);
          if (result.success) {
            successCount++;
            totalReqs += result.requestsCount || 0;
            totalFolders += result.foldersCount || 0;
          } else {
            lastError = result.error || "Failed to parse Postman collection.";
          }
        } catch (err: any) {
          lastError = err.message || "Failed to read file.";
        }
      }
    }

    if (successCount > 0) {
      setImportMsg({
        type: "success",
        text: `Successfully imported ${successCount} collection(s)! (${totalReqs} requests, ${totalFolders} folders)`
      });
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } else {
      setImportMsg({
        type: "error",
        text: lastError || "No valid JSON collections were imported."
      });
    }
  };

  const handleDeleteAll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (confirmInput !== "delete all collections") return;
    setIsDeleting(true);

    try {
      await db.transaction("rw", [db.collections, db.folders, db.requests, db.tabs], async () => {
        await db.collections.clear();
        await db.folders.clear();
        await db.requests.clear();
        await db.tabs.clear();
      });
      setDeleteConfirmOpen(false);
      setConfirmInput("");
      onClose();
      window.location.reload();
    } catch (err) {
      console.error("Failed to delete all collections:", err);
    } finally {
      setIsDeleting(false);
    }
  };

  // Close settings modal on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isOpen && e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-fade-in font-sans"
      onClick={onClose}
    >
      <div 
        className="w-full max-w-3xl h-[480px] rounded-xl border border-neutral-800 bg-[#181818] shadow-2xl text-neutral-200 flex overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        
        {/* Left Sidebar Menu */}
        <div className="w-48 bg-[#151515] border-r border-neutral-900 p-3 flex flex-col gap-1.5 shrink-0">
          <div className="flex items-center gap-2 px-2 py-1.5 text-xs font-bold text-neutral-400 uppercase tracking-wider mb-2">
            <Settings className="h-4 w-4 text-neutral-500" />
            <span>Preferences</span>
          </div>

          <button
            onClick={() => setActiveTab("general")}
            className={`w-full text-left px-3 py-2 text-xs rounded-lg font-semibold transition-colors flex items-center gap-2 cursor-pointer ${
              activeTab === "general" ? "bg-neutral-800 text-white" : "text-neutral-400 hover:text-neutral-250 hover:bg-neutral-900"
            }`}
          >
            <Terminal className="h-3.5 w-3.5" />
            <span>General / Network</span>
          </button>

          <button
            onClick={() => setActiveTab("themes")}
            className={`w-full text-left px-3 py-2 text-xs rounded-lg font-semibold transition-colors flex items-center gap-2 cursor-pointer ${
              activeTab === "themes" ? "bg-neutral-800 text-white" : "text-neutral-400 hover:text-neutral-250 hover:bg-neutral-900"
            }`}
          >
            <Sun className="h-3.5 w-3.5 text-amber-400" />
            <span>Themes Setting</span>
          </button>

          <button
            onClick={() => setActiveTab("import")}
            className={`w-full text-left px-3 py-2 text-xs rounded-lg font-semibold transition-colors flex items-center gap-2 cursor-pointer ${
              activeTab === "import" ? "bg-neutral-800 text-white" : "text-neutral-400 hover:text-neutral-250 hover:bg-neutral-900"
            }`}
          >
            <Upload className="h-3.5 w-3.5 text-indigo-400" />
            <span>Import / Sync</span>
          </button>

          <button
            onClick={() => setActiveTab("shortcuts")}
            className={`w-full text-left px-3 py-2 text-xs rounded-lg font-semibold transition-colors flex items-center gap-2 cursor-pointer ${
              activeTab === "shortcuts" ? "bg-neutral-800 text-white" : "text-neutral-400 hover:text-neutral-250 hover:bg-neutral-900"
            }`}
          >
            <HelpCircle className="h-3.5 w-3.5" />
            <span>Shortcuts</span>
          </button>

          <button
            onClick={() => setActiveTab("about")}
            className={`w-full text-left px-3 py-2 text-xs rounded-lg font-semibold transition-colors flex items-center gap-2 cursor-pointer ${
              activeTab === "about" ? "bg-neutral-800 text-white" : "text-neutral-400 hover:text-neutral-250 hover:bg-neutral-900"
            }`}
          >
            <Info className="h-3.5 w-3.5 text-blue-400" />
            <span>About Apify</span>
          </button>
        </div>

        {/* Right Content Panel */}
        <div className="flex-1 flex flex-col bg-[#1e1e1e]">
          {/* Header */}
          <div className="px-4 py-3 border-b border-neutral-900 flex items-center justify-between shrink-0">
            <h3 className="text-sm font-bold text-white capitalize">
              {activeTab === "general" && "General & Network Settings"}
              {activeTab === "themes" && "Visual Theme Selection"}
              {activeTab === "import" && "Import Postman Collections"}
              {activeTab === "shortcuts" && "Keyboard Shortcuts"}
              {activeTab === "about" && "About Apify Studio"}
            </h3>
            <button
              onClick={onClose}
              className="rounded-lg p-1 hover:bg-neutral-900 text-neutral-400 hover:text-white transition-colors cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Content Area */}
          <div className="flex-1 overflow-y-auto p-5 scrollbar-thin text-xs text-neutral-300">
            
            {/* GENERAL TAB */}
            {activeTab === "general" && (
              <div className="flex flex-col gap-6 text-neutral-300 pr-1 text-xs select-none">
                {/* Request Section */}
                <div className="flex flex-col gap-4">
                  <h3 className="text-sm font-bold text-white border-b border-neutral-850 pb-2">Request</h3>
                  
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-white">HTTP version <span className="text-[9px] bg-sky-500/10 text-sky-400 border border-sky-500/20 px-1.5 py-0.5 rounded ml-1 font-bold">NEW</span></span>
                      <p className="text-[10px] text-neutral-500 mt-0.5">Select the HTTP version to use for sending the request.</p>
                    </div>
                    <select
                      value={httpVersion}
                      onChange={(e) => setHttpVersion(e.target.value)}
                      className="bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1 text-xs text-white focus:outline-none focus:border-brand-blue"
                    >
                      <option value="Auto">Auto</option>
                      <option value="HTTP/1.1">HTTP/1.1</option>
                      <option value="HTTP/2">HTTP/2</option>
                    </select>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-white">Request timeout</span>
                      <p className="text-[10px] text-neutral-500 mt-0.5">Set how long a request should wait for a response before timing out. To never time out, set to 0.</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        value={requestTimeout}
                        onChange={(e) => setRequestTimeout(Number(e.target.value))}
                        className="w-20 bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1 text-xs text-white text-right focus:outline-none focus:border-brand-blue font-mono"
                      />
                      <span className="text-[10px] text-neutral-500 font-mono">ms</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-white">Max response size</span>
                      <p className="text-[10px] text-neutral-500 mt-0.5">Set the maximum size of a response to download. To download a response of any size, set to 0.</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        value={maxResponseSize}
                        onChange={(e) => setMaxResponseSize(Number(e.target.value))}
                        className="w-20 bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1 text-xs text-white text-right focus:outline-none focus:border-brand-blue font-mono"
                      />
                      <span className="text-[10px] text-neutral-500 font-mono">MB</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-white">SSL certificate verification</span>
                      <p className="text-[10px] text-neutral-500 mt-0.5">Toggle to verify SSL certificates when making requests.</p>
                    </div>
                    <button
                      onClick={() => setSslVerification(!sslVerification)}
                      className={`relative w-8 h-4.5 rounded-full transition-colors duration-200 focus:outline-none cursor-pointer ${sslVerification ? "bg-brand-blue" : "bg-neutral-850"}`}
                    >
                      <div className={`w-3.5 h-3.5 rounded-full bg-white transition-transform duration-200 transform ${sslVerification ? "translate-x-4" : "translate-x-0.5"}`} />
                    </button>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-white">SSL/TLS key log</span>
                      <p className="text-[10px] text-neutral-500 mt-0.5">Enable SSL/TLS session key logging for debugging encrypted connections.</p>
                    </div>
                    <button
                      onClick={() => setSslKeyLog(!sslKeyLog)}
                      className={`relative w-8 h-4.5 rounded-full transition-colors duration-200 focus:outline-none cursor-pointer ${sslKeyLog ? "bg-brand-blue" : "bg-neutral-850"}`}
                    >
                      <div className={`w-3.5 h-3.5 rounded-full bg-white transition-transform duration-200 transform ${sslKeyLog ? "translate-x-4" : "translate-x-0.5"}`} />
                    </button>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-white">Disable cookies</span>
                      <p className="text-[10px] text-neutral-500 mt-0.5">Disable cookie jar for all requests.</p>
                    </div>
                    <button
                      onClick={() => setDisableCookies(!disableCookies)}
                      className={`relative w-8 h-4.5 rounded-full transition-colors duration-200 focus:outline-none cursor-pointer ${disableCookies ? "bg-brand-blue" : "bg-neutral-850"}`}
                    >
                      <div className={`w-3.5 h-3.5 rounded-full bg-white transition-transform duration-200 transform ${disableCookies ? "translate-x-4" : "translate-x-0.5"}`} />
                    </button>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-white">Response format detection</span>
                      <p className="text-[10px] text-neutral-500 mt-0.5">Auto-detect response payload formatting format.</p>
                    </div>
                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name="format-detection"
                          checked={responseFormatDetection === "Auto"}
                          onChange={() => setResponseFormatDetection("Auto")}
                          className="accent-brand-blue cursor-pointer"
                        />
                        <span>Auto</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name="format-detection"
                          checked={responseFormatDetection === "JSON"}
                          onChange={() => setResponseFormatDetection("JSON")}
                          className="accent-brand-blue cursor-pointer"
                        />
                        <span>JSON</span>
                      </label>
                    </div>
                  </div>
                </div>

                {/* CORS Bypass Proxy Configuration */}
                <div className="border-t border-neutral-850 pt-4 flex flex-col gap-3">
                  <h4 className="font-semibold text-white flex items-center gap-1.5 font-sans">
                    <ShieldCheck className="h-4 w-4 text-emerald-500" />
                    CORS Bypass Proxy configuration
                  </h4>
                  
                  <div className="flex items-start gap-2.5 py-1">
                    <input
                      type="checkbox"
                      id="proxy-toggle"
                      checked={useProxy}
                      onChange={(e) => onProxyChange(e.target.checked)}
                      className="rounded border-neutral-800 bg-neutral-950 text-emerald-600 h-4 w-4 cursor-pointer mt-0.5 accent-emerald-500"
                    />
                    <div>
                      <label htmlFor="proxy-toggle" className="text-xs font-bold text-neutral-200 cursor-pointer font-sans">
                        Route HTTP requests through Proxy Server
                      </label>
                      <p className="text-[10px] text-neutral-500 mt-0.5 leading-relaxed font-sans">
                        Redirects network packets through an intermediate server. Useful in web build mode when CORS headers are strictly enforced.
                      </p>
                    </div>
                  </div>

                  {useProxy && (
                    <div className="mt-2 animate-fade-in">
                      <label className="block text-[10px] font-bold text-neutral-400 uppercase tracking-wider mb-1 font-mono">
                        Proxy Router Endpoint URL
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. https://cors-anywhere.herokuapp.com/"
                        value={proxyUrl}
                        onChange={(e) => onProxyUrlChange(e.target.value)}
                        className="w-full bg-neutral-950 border border-neutral-800 rounded-lg p-2.5 text-xs text-neutral-200 focus:outline-none focus:border-brand-blue font-mono"
                      />
                      <span className="text-[9px] text-neutral-500 block mt-1.5 leading-relaxed font-sans">
                        Ensure the proxy URL ends with a forward slash and is actively running. Requests will be prefixed like: <code className="text-neutral-400 font-mono">{proxyUrl || "[Proxy-URL]"}https://api.example.com</code>.
                      </span>
                    </div>
                  )}
                </div>

                {/* Working Directory Section */}
                <div className="flex flex-col gap-4 pt-4 border-t border-neutral-850">
                  <h3 className="text-sm font-bold text-white pb-1">Working directory</h3>
                  <p className="text-[10px] text-neutral-500 -mt-2.5">Collaborate on files used in requests by sharing your working directory.</p>
                  
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold text-white shrink-0">Location</span>
                    <div className="flex-1 flex gap-2">
                      <input
                        type="text"
                        value={workingDirectory}
                        onChange={(e) => setWorkingDirectory(e.target.value)}
                        className="flex-1 bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1 text-xs text-neutral-400 focus:outline-none"
                      />
                      <button className="px-3 py-1 bg-neutral-900 border border-neutral-800 hover:bg-neutral-850 rounded text-[10px] font-bold text-white transition-colors cursor-pointer">
                        Choose
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-white">Read files outside working directory</span>
                      <p className="text-[10px] text-neutral-500 mt-0.5">Enabling this will allow any 3rd party collections to potentially read any file on your system.</p>
                    </div>
                    <button
                      onClick={() => setReadFilesOutsideWorkingDir(!readFilesOutsideWorkingDir)}
                      className={`relative w-8 h-4.5 rounded-full transition-colors duration-200 focus:outline-none cursor-pointer ${readFilesOutsideWorkingDir ? "bg-brand-blue" : "bg-neutral-850"}`}
                    >
                      <div className={`w-3.5 h-3.5 rounded-full bg-white transition-transform duration-200 transform ${readFilesOutsideWorkingDir ? "translate-x-4" : "translate-x-0.5"}`} />
                    </button>
                  </div>
                </div>

                {/* Headers Section */}
                <div className="flex flex-col gap-4 pt-4 border-t border-neutral-850">
                  <h3 className="text-sm font-bold text-white pb-1">Headers</h3>

                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-white">Send no-cache header</span>
                      <p className="text-[10px] text-neutral-500 mt-0.5">Include a Cache-Control: no-cache header in all requests.</p>
                    </div>
                    <button
                      onClick={() => setSendNoCacheHeader(!sendNoCacheHeader)}
                      className={`relative w-8 h-4.5 rounded-full transition-colors duration-200 focus:outline-none cursor-pointer ${sendNoCacheHeader ? "bg-brand-blue" : "bg-neutral-850"}`}
                    >
                      <div className={`w-3.5 h-3.5 rounded-full bg-white transition-transform duration-200 transform ${sendNoCacheHeader ? "translate-x-4" : "translate-x-0.5"}`} />
                    </button>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-white">Send Postman token header</span>
                      <p className="text-[10px] text-neutral-500 mt-0.5">Include a Postman-Token header in all requests.</p>
                    </div>
                    <button
                      onClick={() => setSendPostmanTokenHeader(!sendPostmanTokenHeader)}
                      className={`relative w-8 h-4.5 rounded-full transition-colors duration-200 focus:outline-none cursor-pointer ${sendPostmanTokenHeader ? "bg-brand-blue" : "bg-neutral-850"}`}
                    >
                      <div className={`w-3.5 h-3.5 rounded-full bg-white transition-transform duration-200 transform ${sendPostmanTokenHeader ? "translate-x-4" : "translate-x-0.5"}`} />
                    </button>
                  </div>
                </div>

                {/* Workspace Typography Style */}
                <div className="border-t border-neutral-850 pt-4 flex flex-col gap-3">
                  <h4 className="font-semibold text-white flex items-center gap-1.5 font-sans">
                    <Type className="h-4 w-4 text-brand-blue" />
                    Workspace Typography Style
                  </h4>
                  <p className="text-[10px] text-neutral-500 leading-relaxed font-sans font-normal">
                    Choose from the top corporate minimal fonts. The selected font family will adapt globally across the workspace.
                  </p>
                  
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    {FONT_OPTIONS.map((f) => {
                      const isSelected = fontFamily === f.value;
                      return (
                        <button
                          key={f.value}
                          type="button"
                          onClick={() => onFontFamilyChange(f.value)}
                          className={`flex items-center justify-between p-2 rounded-lg border text-left cursor-pointer transition-all duration-150 ${
                            isSelected 
                              ? "bg-neutral-900 border-brand-blue text-white ring-1 ring-brand-blue/20" 
                              : "bg-neutral-950/40 border-neutral-850 text-neutral-400 hover:text-neutral-250 hover:bg-neutral-900"
                          }`}
                          style={{ fontFamily: f.value }}
                        >
                          <span className="text-xs font-normal">{f.name}</span>
                          {isSelected && <Check className="h-3 w-3 text-brand-blue" />}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Editor Settings Section */}
                <div className="flex flex-col gap-4 pt-4 border-t border-neutral-850">
                  <h3 className="text-sm font-bold text-white pb-1">Editor settings</h3>

                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-white">Font Family</span>
                      <p className="text-[10px] text-neutral-500 mt-0.5">Change the default font family for editor panels.</p>
                    </div>
                    <input
                      type="text"
                      value={editorFontFamily}
                      onChange={(e) => setEditorFontFamily(e.target.value)}
                      className="w-48 bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1 text-xs text-white focus:outline-none focus:border-brand-blue font-mono"
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-white">Font Size (px)</span>
                      <p className="text-[10px] text-neutral-500 mt-0.5">Set the default font size in pixels.</p>
                    </div>
                    <input
                      type="number"
                      value={editorFontSize}
                      onChange={(e) => setEditorFontSize(Number(e.target.value))}
                      className="w-20 bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1 text-xs text-white text-right focus:outline-none focus:border-brand-blue font-mono"
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-white">Indentation count</span>
                      <p className="text-[10px] text-neutral-500 mt-0.5">Set number of indentations to add per code level.</p>
                    </div>
                    <input
                      type="number"
                      value={editorIndentCount}
                      onChange={(e) => setEditorIndentCount(Number(e.target.value))}
                      className="w-20 bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1 text-xs text-white text-right focus:outline-none focus:border-brand-blue font-mono"
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-white">Indentation type</span>
                      <p className="text-[10px] text-neutral-500 mt-0.5">Choose indentation method for code styling.</p>
                    </div>
                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name="indent-type"
                          checked={editorIndentType === "Space"}
                          onChange={() => setEditorIndentType("Space")}
                          className="accent-brand-blue cursor-pointer"
                        />
                        <span>Space</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name="indent-type"
                          checked={editorIndentType === "Tab"}
                          onChange={() => setEditorIndentType("Tab")}
                          className="accent-brand-blue cursor-pointer"
                        />
                        <span>Tab</span>
                      </label>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-white">Auto close brackets</span>
                      <p className="text-[10px] text-neutral-500 mt-0.5">Automatically insert matching brackets during typing.</p>
                    </div>
                    <button
                      onClick={() => setEditorAutoCloseBrackets(!editorAutoCloseBrackets)}
                      className={`relative w-8 h-4.5 rounded-full transition-colors duration-200 focus:outline-none cursor-pointer ${editorAutoCloseBrackets ? "bg-brand-blue" : "bg-neutral-850"}`}
                    >
                      <div className={`w-3.5 h-3.5 rounded-full bg-white transition-transform duration-200 transform ${editorAutoCloseBrackets ? "translate-x-4" : "translate-x-0.5"}`} />
                    </button>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-white">Auto close quotes</span>
                      <p className="text-[10px] text-neutral-500 mt-0.5">Automatically insert matching quotes during typing.</p>
                    </div>
                    <button
                      onClick={() => setEditorAutoCloseQuotes(!editorAutoCloseQuotes)}
                      className={`relative w-8 h-4.5 rounded-full transition-colors duration-200 focus:outline-none cursor-pointer ${editorAutoCloseQuotes ? "bg-brand-blue" : "bg-neutral-850"}`}
                    >
                      <div className={`w-3.5 h-3.5 rounded-full bg-white transition-transform duration-200 transform ${editorAutoCloseQuotes ? "translate-x-4" : "translate-x-0.5"}`} />
                    </button>
                  </div>
                </div>

                {/* Application Section */}
                <div className="flex flex-col gap-4 pt-4 border-t border-neutral-850">
                  <h3 className="text-sm font-bold text-white pb-1">Application</h3>

                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-white">Language</span>
                      <p className="text-[10px] text-neutral-500 mt-0.5">Choose the interface language display.</p>
                    </div>
                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name="app-lang"
                          checked={appLanguage === "English"}
                          onChange={() => setAppLanguage("English")}
                          className="accent-brand-blue cursor-pointer"
                        />
                        <span>English</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name="app-lang"
                          checked={appLanguage === "日本語"}
                          onChange={() => setAppLanguage("日本語")}
                          className="accent-brand-blue cursor-pointer"
                        />
                        <span>日本語</span>
                      </label>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-white">Autosave <span className="text-[9px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1 rounded ml-1 font-bold">BETA</span></span>
                      <p className="text-[10px] text-neutral-500 mt-0.5">Autosave changes to your requests in real time.</p>
                    </div>
                    <button
                      onClick={() => setAppAutosave(!appAutosave)}
                      className={`relative w-8 h-4.5 rounded-full transition-colors duration-200 focus:outline-none cursor-pointer ${appAutosave ? "bg-brand-blue" : "bg-neutral-850"}`}
                    >
                      <div className={`w-3.5 h-3.5 rounded-full bg-white transition-transform duration-200 transform ${appAutosave ? "translate-x-4" : "translate-x-0.5"}`} />
                    </button>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-white">Send anonymous usage data</span>
                      <p className="text-[10px] text-neutral-500 mt-0.5">Help improve our client by sharing crash reports and anonymized diagnostic data.</p>
                    </div>
                    <button
                      onClick={() => setAppSendUsageData(!appSendUsageData)}
                      className={`relative w-8 h-4.5 rounded-full transition-colors duration-200 focus:outline-none cursor-pointer ${appSendUsageData ? "bg-brand-blue" : "bg-neutral-850"}`}
                    >
                      <div className={`w-3.5 h-3.5 rounded-full bg-white transition-transform duration-200 transform ${appSendUsageData ? "translate-x-4" : "translate-x-0.5"}`} />
                    </button>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-white">Show notification badge on app icon</span>
                      <p className="text-[10px] text-neutral-500 mt-0.5">Show a count of unread notifications on the app taskbar icon.</p>
                    </div>
                    <button
                      onClick={() => setAppShowNotificationBadge(!appShowNotificationBadge)}
                      className={`relative w-8 h-4.5 rounded-full transition-colors duration-200 focus:outline-none cursor-pointer ${appShowNotificationBadge ? "bg-brand-blue" : "bg-neutral-850"}`}
                    >
                      <div className={`w-3.5 h-3.5 rounded-full bg-white transition-transform duration-200 transform ${appShowNotificationBadge ? "translate-x-4" : "translate-x-0.5"}`} />
                    </button>
                  </div>
                </div>

                {/* Danger Zone / Wipe Workspace */}
                <div className="flex flex-col gap-4 pt-4 border-t border-red-950/40 border-dashed mt-2">
                  <h3 className="text-sm font-bold text-red-400 pb-1">Danger Zone</h3>
                  <div className="flex items-center justify-between bg-red-950/10 border border-red-900/20 rounded-lg p-3">
                    <div>
                      <p className="text-xs font-bold text-neutral-200">Delete All Collections</p>
                      <p className="text-[10px] text-neutral-500 mt-0.5 leading-relaxed max-w-md">
                        Recursively clears all collections, folders, request items, and open tabs. This action is permanent and cannot be undone.
                      </p>
                    </div>
                    <button
                      onClick={() => setDeleteConfirmOpen(true)}
                      className="px-3 py-1.5 bg-red-900 hover:bg-red-800 text-red-100 rounded text-xs font-semibold cursor-pointer transition-colors shrink-0"
                    >
                      Delete All
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* THEMES TAB */}
            {activeTab === "themes" && (
              <div className="flex flex-col gap-4">
                <p className="text-[11px] text-neutral-400 mb-2 font-sans">
                  Select a style to customize the IDE visual presentation. The interface will instantly adapt to color presets.
                </p>

                <div className="grid grid-cols-2 gap-4">
                  {THEMES.map((t) => {
                    const isSelected = theme === t.id;
                    return (
                      <div
                        key={t.id}
                        onClick={() => onThemeChange(t.id)}
                        className={`group rounded-lg border p-3 flex flex-col gap-2.5 cursor-pointer transition-all duration-150 relative bg-neutral-950/40 hover:bg-neutral-950 ${
                          isSelected ? "border-emerald-500 ring-1 ring-emerald-500/20" : "border-neutral-850 hover:border-neutral-700"
                        }`}
                      >
                        {/* Theme graphic preview card */}
                        <div className={`h-16 w-full rounded border ${t.borderBg} ${t.appBg} overflow-hidden flex flex-col relative`}>
                          {/* Mini Header bar */}
                          <div className={`h-3 ${t.sidebarBg} border-b ${t.borderBg} flex items-center justify-between px-1.5`}>
                            <div className="flex items-center gap-0.5">
                              <span className="h-1 w-1 rounded-full bg-rose-500 opacity-60"></span>
                              <span className="h-1 w-1 rounded-full bg-amber-500 opacity-60"></span>
                              <span className="h-1 w-1 rounded-full bg-emerald-500 opacity-60"></span>
                            </div>
                            <span className="text-[6px] opacity-40 font-mono">Restman</span>
                          </div>

                          <div className="flex-1 flex">
                            {/* Mini Sidebar */}
                            <div className={`w-8 ${t.sidebarBg} border-r ${t.borderBg} p-1 flex flex-col gap-0.5`}>
                              <span className="h-0.5 w-4 bg-neutral-500/20 rounded"></span>
                              <span className="h-0.5 w-5 bg-neutral-500/10 rounded"></span>
                              <span className="h-0.5 w-3 bg-neutral-500/15 rounded"></span>
                            </div>

                            {/* Mini Workspace */}
                            <div className="flex-1 p-1 flex flex-col justify-between">
                              <div className="flex flex-col gap-0.5">
                                <div className="flex items-center gap-1">
                                  <span className="h-1.5 w-3 bg-emerald-600/30 rounded"></span>
                                  <span className="h-1 w-8 bg-neutral-500/20 rounded"></span>
                                </div>
                                <span className="h-0.5 w-full bg-neutral-500/10 rounded"></span>
                              </div>

                              {/* Send button in preview */}
                              <div className="flex justify-end">
                                <span className={`h-1.5 w-4 rounded-sm ${t.accentBg}`}></span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Theme Name selection label */}
                        <div className="flex items-center justify-between font-sans">
                          <span className={`text-[11px] font-semibold ${isSelected ? "text-white" : "text-neutral-400 group-hover:text-neutral-200"}`}>
                            {t.name}
                          </span>
                          <div className={`h-4 w-4 rounded-full border flex items-center justify-center ${
                            isSelected ? "bg-emerald-600 border-emerald-500 text-white" : "border-neutral-800"
                          }`}>
                            {isSelected && <Check className="h-2.5 w-2.5 font-bold" />}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* IMPORT TAB */}
            {activeTab === "import" && (
              <div className="flex flex-col gap-4">
                <p className="text-[11px] text-neutral-400 font-sans">
                  Import Postman Collections or environment files to populate your local workspace database.
                </p>

                {/* Sub tabs inside Import tab */}
                <div className="flex items-center gap-1 border-b border-neutral-900 pb-1 text-[11px] font-semibold shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setImportTab("manual");
                      setImportMsg(null);
                    }}
                    className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${
                      importTab === "manual"
                        ? "bg-neutral-800 text-white font-bold"
                        : "text-neutral-400 hover:text-neutral-250 hover:bg-neutral-900"
                    }`}
                  >
                    Upload / Paste Files
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setImportTab("auto");
                      setImportMsg(null);
                    }}
                    className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${
                      importTab === "auto"
                        ? "bg-neutral-800 text-white font-bold"
                        : "text-neutral-400 hover:text-neutral-250 hover:bg-neutral-900"
                    }`}
                  >
                    Directory PC Scan
                  </button>
                </div>

                {importTab === "manual" ? (
                  <div className="flex flex-col gap-3 font-sans">
                    <div className="flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full py-8 border-2 border-dashed border-neutral-850 hover:border-neutral-700 bg-neutral-950/20 rounded-xl flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors"
                      >
                        <Upload className="h-6 w-6 text-indigo-400 animate-pulse" />
                        <span className="text-xs font-semibold text-neutral-250">Select Postman JSON files to upload</span>
                        <span className="text-[10px] text-neutral-500">Supports v2 and v2.1 collections (.json)</span>
                      </button>
                      <input
                        type="file"
                        ref={fileInputRef}
                        multiple
                        accept=".json,application/json"
                        onChange={(e) => {
                          if (e.target.files) {
                            processFiles(Array.from(e.target.files));
                          }
                        }}
                        className="hidden"
                      />
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider font-mono">
                        Or Paste Raw Collection JSON content
                      </label>
                      <textarea
                        placeholder='Paste raw JSON here (e.g., {"info": { "name": "My Workspace", ... }})'
                        value={importJson}
                        onChange={(e) => setImportJson(e.target.value)}
                        className="w-full h-28 bg-neutral-950 border border-neutral-800 rounded-lg p-3 text-xs font-mono text-neutral-300 focus:outline-none focus:border-indigo-500 scrollbar-thin resize-none"
                      />
                    </div>

                    <div className="flex justify-end gap-2 mt-1">
                      <button
                        type="button"
                        onClick={handleImportCollection}
                        disabled={!importJson.trim()}
                        className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Import Paste Content
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3 font-sans">
                    <p className="text-[11px] text-neutral-400 leading-relaxed font-sans">
                      Apify will scan standard folders (AppData, Downloads, and Documents) to automatically detect Postman backups and collections, sync-ing them locally.
                    </p>

                    {window.electronAPI?.isElectron ? (
                      <>
                        {!discovered.length && !scanning && (
                          <button
                            type="button"
                            onClick={handleScanLocalCollections}
                            className="w-full py-6 rounded-lg border border-neutral-850 hover:border-neutral-700 bg-neutral-950 flex flex-col items-center justify-center gap-2 cursor-pointer transition-all hover:bg-neutral-900/50"
                          >
                            <FolderDown className="h-6 w-6 text-indigo-400 animate-bounce" />
                            <span className="text-xs font-bold text-neutral-200">Scan My PC for Postman Collections</span>
                          </button>
                        )}

                        {scanning && (
                          <div className="py-8 text-center flex flex-col items-center justify-center gap-3">
                            <Loader2 className="h-7 w-7 animate-spin text-indigo-400" />
                            <span className="text-xs font-semibold text-neutral-300">Searching local filesystems...</span>
                            <button
                              type="button"
                              onClick={() => {
                                abortSyncRef.current = true;
                                setScanning(false);
                                setImportMsg({ type: "error", text: "Directory scan interrupted." });
                              }}
                              className="px-3 py-1 bg-red-950/80 hover:bg-red-900 border border-red-900/20 text-red-200 rounded text-[10px] font-semibold cursor-pointer transition-all"
                            >
                              Stop / Interrupt Scan
                            </button>
                          </div>
                        )}

                        {!scanning && discovered.length > 0 && (
                          <div className="flex flex-col gap-3">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider">Detected Collections</span>
                              <button
                                type="button"
                                onClick={handleScanLocalCollections}
                                className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 cursor-pointer"
                              >
                                <RefreshCw className="h-2.5 w-2.5" />
                                <span>Rescan</span>
                              </button>
                            </div>

                            <div className="max-h-36 overflow-y-auto border border-neutral-900 rounded-lg p-1.5 bg-neutral-950/60 flex flex-col gap-1.5 scrollbar-thin">
                              {discovered.map((col) => (
                                <label
                                  key={col.filePath}
                                  className="flex items-start gap-2.5 p-2 hover:bg-neutral-900/60 rounded-lg transition-colors cursor-pointer text-xs"
                                >
                                  <input
                                    type="checkbox"
                                    checked={!!selectedDiscoveredPaths[col.filePath]}
                                    onChange={(e) => {
                                      setSelectedDiscoveredPaths((prev) => ({
                                        ...prev,
                                        [col.filePath]: e.target.checked
                                      }));
                                    }}
                                    className="mt-0.5 accent-indigo-500 rounded border-neutral-850 focus:ring-indigo-500 bg-neutral-950"
                                  />
                                  <div className="flex-1 min-w-0">
                                    <div className="font-semibold text-neutral-200 truncate">{col.collectionName}</div>
                                    <div className="text-[9px] text-neutral-500 truncate mt-0.5 font-mono">{col.filePath}</div>
                                    <div className="text-[9px] text-indigo-400/90 font-semibold mt-1 flex gap-2">
                                      <span>{col.requestsCount} requests</span>
                                      <span>•</span>
                                      <span>{col.foldersCount} folders</span>
                                    </div>
                                  </div>
                                </label>
                              ))}
                            </div>

                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={handleImportDiscovered}
                                className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                              >
                                <Check className="h-3.5 w-3.5" />
                                <span>Import Selected</span>
                              </button>
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="border border-indigo-950/50 bg-indigo-950/10 rounded-lg p-5 text-center mt-1 font-sans">
                        <Layers className="h-8 w-8 text-indigo-400 mx-auto mb-2.5 animate-pulse" />
                        <h4 className="text-xs font-bold text-white mb-1.5">Standalone Desktop Feature Only</h4>
                        <p className="text-[11px] text-neutral-400 leading-relaxed max-w-sm mx-auto">
                          Auto-import filesystem scanning requires desktop system access. Install the RestMan standalone client to sync Postman backups automatically.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {importMsg && (
                  <div
                    className={`p-2.5 rounded border text-xs flex items-center gap-2 font-sans mt-1 ${
                      importMsg.type === "success"
                        ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                        : "bg-red-500/10 border-red-500/20 text-red-400"
                    }`}
                  >
                    {importMsg.type === "success" ? <Check className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                    <span>{importMsg.text}</span>
                  </div>
                )}
              </div>
            )}

            {/* SHORTCUTS TAB */}
            {activeTab === "shortcuts" && (
              <div className="flex flex-col gap-3">
                <p className="text-[11px] text-neutral-400 mb-2 font-sans">
                  Accelerate your API development workflow with native keyboard shortcuts.
                </p>

                <div className="border border-neutral-900 rounded-lg overflow-hidden bg-neutral-950/30">
                  <table className="w-full border-collapse text-left text-xs font-mono">
                    <thead>
                      <tr className="border-b border-neutral-900 bg-neutral-900/30 text-neutral-400 text-[10px] font-sans font-semibold">
                        <th className="py-2 px-3">Action</th>
                        <th className="py-2 px-3 text-right">Hotkey Command</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-900/50">
                      {[
                        { action: "Open Command Palette", key: "Ctrl + P" },
                        { action: "Send Request", key: "Ctrl + Enter" },
                        { action: "Search Endpoints globally", key: "Ctrl + Shift + F" },
                        { action: "Toggle Sidebar panel", key: "Ctrl + B" },
                        { action: "Toggle Response panel", key: "Ctrl + J" },
                        { action: "Format JSON Body", key: "Ctrl + Alt + L" },
                        { action: "Create new Tab", key: "Ctrl + T" },
                        { action: "Close current Tab", key: "Ctrl + W" },
                      ].map((s, idx) => (
                        <tr key={idx} className="hover:bg-neutral-900/25">
                          <td className="py-2 px-3 font-sans font-medium text-neutral-350">{s.action}</td>
                          <td className="py-2 px-3 text-right">
                            <span className="bg-neutral-900 border border-neutral-850 px-2 py-0.5 rounded text-[10px] font-semibold text-neutral-200">
                              {s.key}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ABOUT TAB */}
            {activeTab === "about" && (
              <div className="flex flex-col items-center justify-center text-center gap-4 py-8 font-sans">
                <div className="h-16 w-16 bg-[#FF6C37]/10 border border-[#FF6C37]/30 rounded-2xl flex items-center justify-center shadow-xl">
                  <svg viewBox="0 0 500 500" className="h-10 w-10 shrink-0">
                    <rect width="500" height="500" rx="110" fill="#FF6C37"/>
                    <g transform="translate(45, 10)">
                      <path d="M150 380 L250 120 L350 380" fill="none" stroke="#FFFFFF" stroke-width="32" stroke-linecap="round" stroke-linejoin="round"/>
                      <path d="M185 290 H315" fill="none" stroke="#FFFFFF" stroke-width="32" stroke-linecap="round"/>
                      <circle cx="250" cy="120" r="16" fill="#FF6C37" stroke="#FFFFFF" stroke-width="8"/>
                      <circle cx="250" cy="290" r="16" fill="#FF6C37" stroke="#FFFFFF" stroke-width="8"/>
                    </g>
                  </svg>
                </div>

                <div>
                  <h4 className="text-base font-black tracking-widest text-white uppercase font-sans">Apify</h4>
                  <p className="text-[10px] text-neutral-500 mt-0.5">Premium API Workspace Studio</p>
                </div>

                <p className="text-[11px] text-neutral-400 max-w-sm leading-relaxed font-sans">
                  A workstation built for lightweight HTTP communication, collection editing, and responsive dashboards. 100% offline and browser CORS-free.
                </p>

                <div className="flex flex-col gap-1 text-[10px] text-neutral-500 mt-4 border-t border-neutral-900 pt-4 w-full max-w-xs">
                  <div className="flex justify-between">
                    <span>Engine Client Version:</span>
                    <span className="font-mono text-neutral-400">v1.2.0 (2026 Edition)</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Database Engine:</span>
                    <span className="font-mono text-neutral-400">IndexedDB via Dexie.js</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Developer Signature:</span>
                    <span className="font-sans font-semibold text-emerald-400">Designed by Akib</span>
                  </div>
                </div>
              </div>
            )}

          </div>

          {/* Footer */}
          <div className="px-4 py-3 border-t border-neutral-900 flex justify-end shrink-0">
            <button
              onClick={onClose}
              className="px-4 py-1.5 bg-[#007acc] hover:bg-[#0062a3] text-white rounded text-xs font-semibold cursor-pointer transition-colors"
            >
              Done
            </button>
          </div>
        </div>

      </div>

      {/* GitHub-style Confirmation Modal */}
      {deleteConfirmOpen && (
        <div 
          className="fixed inset-0 z-[250] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 animate-fade-in text-neutral-200"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="w-full max-w-md rounded-xl border border-red-900/30 bg-neutral-950 p-5 shadow-2xl flex flex-col gap-4 font-sans">
            <div className="flex items-center justify-between border-b border-neutral-900 pb-3">
              <h3 className="text-sm font-bold text-red-400 flex items-center gap-2">
                Are you absolutely sure?
              </h3>
              <button
                onClick={() => {
                  setDeleteConfirmOpen(false);
                  setConfirmInput("");
                }}
                className="rounded-lg p-1 hover:bg-neutral-900 text-neutral-400 hover:text-white transition-colors cursor-pointer bg-transparent border-none"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="text-[11px] text-neutral-400 leading-relaxed bg-red-950/10 border border-red-955/25 p-3 rounded-lg flex flex-col gap-2">
              <p>This action **CANNOT** be undone. This will permanently delete all collections, folders, requests, and active tabs.</p>
            </div>

            <form onSubmit={handleDeleteAll} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-semibold text-neutral-400">
                  Please type <code className="text-red-400 font-mono font-bold select-all bg-neutral-900 px-1 py-0.5 rounded">delete all collections</code> to confirm:
                </label>
                <input
                  type="text"
                  value={confirmInput}
                  onChange={(e) => setConfirmInput(e.target.value)}
                  placeholder="delete all collections"
                  className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-xs text-white placeholder-neutral-700 focus:outline-none focus:border-red-500 font-mono"
                  autoFocus
                />
              </div>

              <div className="flex justify-end gap-2 border-t border-neutral-900 pt-3">
                <button
                  type="button"
                  onClick={() => {
                    setDeleteConfirmOpen(false);
                    setConfirmInput("");
                  }}
                  className="px-3 py-1.5 bg-neutral-900 hover:bg-neutral-850 text-neutral-300 hover:text-white rounded text-xs font-semibold cursor-pointer transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={confirmInput !== "delete all collections" || isDeleting}
                  className="px-4 py-1.5 bg-red-600 hover:bg-red-500 disabled:bg-red-950/40 disabled:text-red-500/60 text-white rounded text-xs font-semibold cursor-pointer transition-all border-none"
                >
                  {isDeleting ? "Deleting..." : "I understand the consequences, delete them"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
