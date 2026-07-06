import { useState, useMemo, useRef, useEffect } from "react";
import { showToast } from "../utils/toast";
import { db, type Collection, type Folder, type RequestItem } from "../db/db";
import { exportPostmanCollection } from "../utils/postmanExporter";
import { useLiveQuery } from "dexie-react-hooks";
import ModernConfirmModal from "./ModernConfirmModal";
import {
  Plus,
  FolderPlus,
  MoreVertical,
  ChevronRight,
  ChevronDown,
  Search,
  Pin,
  Star,
  Trash2,
  Copy,
  Edit3,
  Upload,
  FolderDown,
  X,
  ArrowUpDown,
  Check
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface DiscoveredCollection {
  filePath: string;
  fileName: string;
  collectionName: string;
  requestsCount: number;
  foldersCount: number;
  content: string;
}

declare global {
  interface Window {
    electronAPI?: {
      scanPostman: () => Promise<DiscoveredCollection[]>;
      isElectron?: boolean;
    };
  }
}

interface CollectionSidebarProps {
  activeRequestId: string | null;
  onSelectRequest: (id: string) => void;
  onOpenVariables: () => void;
  onOpenSettings: (tab?: "general" | "themes" | "shortcuts" | "about" | "import") => void;
}

export default function CollectionSidebar({
  activeRequestId,
  onSelectRequest,
  onOpenVariables: _onOpenVariables,
  onOpenSettings
}: CollectionSidebarProps) {
  // DB Subscriptions
  const collections = (useLiveQuery(() => db.collections.orderBy("createdAt").toArray()) as Collection[]) || [];
  const folders = (useLiveQuery(() => db.folders.orderBy("createdAt").toArray()) as Folder[]) || [];
  const requests = (useLiveQuery(() => db.requests.orderBy("createdAt").toArray()) as RequestItem[]) || [];

  // Collections list sorting (by time or name)
  const [collectionsListSort, setCollectionsListSortState] = useState<"time" | "name">(() => {
    return (localStorage.getItem("restman-collections-list-sort") as "time" | "name") || "time";
  });

  const setCollectionsListSort = (val: "time" | "name" | ((prev: "time" | "name") => "time" | "name")) => {
    setCollectionsListSortState((prev) => {
      const nextVal = typeof val === "function" ? val(prev) : val;
      localStorage.setItem("restman-collections-list-sort", nextVal);
      return nextVal;
    });
  };

  // Map collectionId -> sort type ("default" | "alphabetical")
  const [collectionSorts, setCollectionSorts] = useState<Record<string, "default" | "alphabetical">>(() => {
    const cached: Record<string, "default" | "alphabetical"> = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith("restman-sort-")) {
          const collId = key.replace("restman-sort-", "");
          const val = localStorage.getItem(key);
          if (val === "default" || val === "alphabetical") {
            cached[collId] = val;
          }
        }
      }
    } catch (err) {
      console.error("Failed to load collection sort settings from localStorage:", err);
    }
    return cached;
  });

  const updateCollectionSort = (collId: string, sortMode: "default" | "alphabetical") => {
    localStorage.setItem(`restman-sort-${collId}`, sortMode);
    setCollectionSorts((prev) => ({
      ...prev,
      [collId]: sortMode,
    }));
  };

  const handleDuplicateFolder = async (folder: Folder) => {
    try {
      const newFolderId = `folder-copy-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      
      await db.transaction("rw", [db.folders, db.requests], async () => {
        // 1. Create duplicate folder
        await db.folders.add({
          id: newFolderId,
          collectionId: folder.collectionId,
          parentFolderId: folder.parentFolderId,
          name: `${folder.name} (Copy)`,
          createdAt: Date.now(),
        });

        // 2. Map old folder IDs to new folder IDs for recursive structure
        const folderIdMap: Record<string, string> = { [folder.id]: newFolderId };
        const allCollFolders = folders.filter((f) => f.collectionId === folder.collectionId);

        const duplicateSubfolder = async (sub: Folder, newParentId: string) => {
          const nextFolderId = `folder-copy-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
          folderIdMap[sub.id] = nextFolderId;

          await db.folders.add({
            id: nextFolderId,
            collectionId: folder.collectionId,
            parentFolderId: newParentId,
            name: sub.name,
            createdAt: Date.now(),
          });

          // Duplicate subfolders recursively
          const nestedSubs = allCollFolders.filter((f) => f.parentFolderId === sub.id);
          for (const nested of nestedSubs) {
            await duplicateSubfolder(nested, nextFolderId);
          }
        };

        // Duplicate nested folders
        const immediateSubfolders = allCollFolders.filter((f) => f.parentFolderId === folder.id);
        for (const sub of immediateSubfolders) {
          await duplicateSubfolder(sub, newFolderId);
        }

        // 3. Duplicate all requests that belong to any duplicated folders
        const allCollRequests = requests.filter((r) => r.collectionId === folder.collectionId);
        for (const req of allCollRequests) {
          if (req.folderId && folderIdMap[req.folderId]) {
            const newReqId = `req-copy-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
            await db.requests.add({
              ...req,
              id: newReqId,
              collectionId: folder.collectionId,
              folderId: folderIdMap[req.folderId],
              name: req.name,
              pinned: false,
              favorite: false,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            });
          }
        }
      });

      setExpandedPaths((prev) => ({ ...prev, [newFolderId]: true }));
    } catch (err) {
      console.error("Failed to duplicate folder:", err);
    }
  };

  // Local search state with debouncing
  const [localSearch, setLocalSearch] = useState("");
  const [search, setSearch] = useState("");
  const searchDebounceRef = useRef<NodeJS.Timeout | null>(null);

  const [expandedNodes, setExpandedPaths] = useState<Record<string, boolean>>({ "coll-jsonplaceholder": true });
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");

  // Custom Naming/Prompt Modal State
  const [inputModalState, setInputModalState] = useState<{
    isOpen: boolean;
    title: string;
    placeholder: string;
    defaultValue: string;
    onConfirm: (val: string) => void;
  } | null>(null);

  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    isDestructive?: boolean;
  } | null>(null);

  // Auto-close menu dropdowns on click outside
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (activeMenuId) {
        const target = e.target as HTMLElement;
        if (!target.closest(".menu-trigger-container")) {
          setActiveMenuId(null);
        }
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [activeMenuId]);

  // Debounced search text handler
  const handleSearchChange = (val: string) => {
    setLocalSearch(val);
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }
    searchDebounceRef.current = setTimeout(() => {
      setSearch(val);
    }, 200);
  };

  // Toggle node expansion
  const toggleNode = (id: string) => {
    setExpandedPaths((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Search filtering
  const filteredRequests = useMemo(() => {
    if (!search.trim()) return requests;
    const term = search.toLowerCase();
    return requests.filter(
      (r) =>
        r.name.toLowerCase().includes(term) ||
        r.url.toLowerCase().includes(term) ||
        r.method.toLowerCase().includes(term) ||
        (r.tags && r.tags.some((t) => t.toLowerCase().includes(term)))
    );
  }, [requests, search]);

  const filteredFolders = useMemo(() => {
    if (!search.trim()) return folders;
    const term = search.toLowerCase();
    
    // Matched folders set
    const visibleFolderIds = new Set<string>();
    const matchedRequestFolderIds = new Set(
      filteredRequests.map((r) => r.folderId).filter(Boolean) as string[]
    );

    folders.forEach((f) => {
      if (f.name.toLowerCase().includes(term) || matchedRequestFolderIds.has(f.id)) {
        visibleFolderIds.add(f.id);
        // Recursively add all parent folders to expand hierarchy visibility
        let parentId = f.parentFolderId;
        while (parentId) {
          visibleFolderIds.add(parentId);
          const parent = folders.find((pf) => pf.id === parentId);
          parentId = parent ? parent.parentFolderId : null;
        }
      }
    });

    return folders.filter((f) => visibleFolderIds.has(f.id));
  }, [folders, filteredRequests, search]);

  const filteredCollections = useMemo(() => {
    let result = collections;
    if (search.trim()) {
      const matchedRequestCollectionIds = new Set(filteredRequests.map((r) => r.collectionId));
      // Also include collections that contain matched folders
      const matchedFolderCollectionIds = new Set(filteredFolders.map((f) => f.collectionId));

      result = collections.filter(
        (c) =>
          c.name.toLowerCase().includes(search.toLowerCase()) ||
          matchedRequestCollectionIds.has(c.id) ||
          matchedFolderCollectionIds.has(c.id)
      );
    }
    // Apply list header sorting
    if (collectionsListSort === "name") {
      return [...result].sort((a, b) => a.name.localeCompare(b.name));
    } else {
      return [...result].sort((a, b) => a.createdAt - b.createdAt);
    }
  }, [collections, filteredRequests, filteredFolders, search, collectionsListSort]);

  // Pinned and Favorites lists
  const pinnedRequests = useMemo(() => requests.filter((r) => r.pinned), [requests]);
  const favoriteRequests = useMemo(() => requests.filter((r) => r.favorite), [requests]);

  // Method badging helper
  const getMethodBadge = (method: string) => {
    const colors: Record<string, string> = {
      GET: "text-emerald-400 bg-emerald-500/10 border-emerald-500/10",
      POST: "text-indigo-400 bg-indigo-500/10 border-indigo-500/10",
      PUT: "text-amber-400 bg-amber-500/10 border-amber-500/10",
      PATCH: "text-violet-400 bg-violet-500/10 border-violet-500/10",
      DELETE: "text-rose-400 bg-red-500/10 border-red-500/10",
      OPTIONS: "text-cyan-400 bg-cyan-500/10 border-cyan-500/10",
      HEAD: "text-neutral-400 bg-neutral-500/10 border-neutral-500/10",
    };
    return (
      <span className={`text-[9px] font-bold font-mono px-1.5 py-0.5 rounded border ${colors[method] || "text-neutral-400 bg-neutral-900"}`}>
        {method}
      </span>
    );
  };

  // Handler CRUD Actions with custom styled Prompt input modals
  const handleCreateCollection = () => {
    setInputModalState({
      isOpen: true,
      title: "Create Collection",
      placeholder: "e.g. Stripe API Suite",
      defaultValue: "New Collection",
      onConfirm: async (name) => {
        const id = `coll-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        await db.collections.add({
          id,
          name,
          createdAt: Date.now(),
        });
        setExpandedPaths((prev) => ({ ...prev, [id]: true }));
      }
    });
  };

  const handleCreateFolder = (collectionId: string, parentFolderId: string | null = null) => {
    setInputModalState({
      isOpen: true,
      title: "Create Folder",
      placeholder: "e.g. Auth Routes",
      defaultValue: "New Folder",
      onConfirm: async (name) => {
        const id = `folder-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        await db.folders.add({
          id,
          collectionId,
          parentFolderId,
          name,
          createdAt: Date.now(),
        });
        // Ensure parent is expanded
        setExpandedPaths((prev) => ({
          ...prev,
          [collectionId]: true,
          ...(parentFolderId ? { [parentFolderId]: true } : {}),
        }));
      }
    });
  };

  const handleCreateRequest = (collectionId: string, folderId: string | null = null) => {
    setInputModalState({
      isOpen: true,
      title: "Create Request",
      placeholder: "e.g. Get User details",
      defaultValue: "Untitled Request",
      onConfirm: async (name) => {
        const id = `req-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        await db.requests.add({
          id,
          collectionId,
          folderId,
          name,
          method: "GET",
          url: "",
          headers: [],
          params: [],
          auth: { type: "none" },
          body: { type: "none" },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        // Auto expand parent
        if (folderId) setExpandedPaths((prev) => ({ ...prev, [folderId]: true }));
        else setExpandedPaths((prev) => ({ ...prev, [collectionId]: true }));

        onSelectRequest(id);
      }
    });
  };

  const handleDuplicateRequest = async (req: RequestItem) => {
    // Get all sibling requests in the same folder or root collection
    const siblings = requests
      .filter((r) => r.collectionId === req.collectionId && r.folderId === req.folderId)
      .sort((a, b) => a.createdAt - b.createdAt);

    const currentIndex = siblings.findIndex((r) => r.id === req.id);
    let newCreatedAt = Date.now();

    if (currentIndex !== -1 && currentIndex < siblings.length - 1) {
      // Sibling exists after the original, place the copy halfway between them
      const nextSibling = siblings[currentIndex + 1];
      newCreatedAt = req.createdAt + (nextSibling.createdAt - req.createdAt) / 2;
    } else {
      // Sibling does not exist after, place the copy after the original
      newCreatedAt = req.createdAt + 1000;
    }

    const id = `req-copy-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    await db.requests.add({
      ...req,
      id,
      name: `${req.name} (Copy)`,
      pinned: false,
      favorite: false,
      createdAt: newCreatedAt,
      updatedAt: Date.now(),
    });
    onSelectRequest(id);
  };

  const handleDuplicateCollection = async (collectionId: string) => {
    try {
      const coll = await db.collections.get(collectionId);
      if (!coll) return;

      const newCollId = `coll-copy-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

      await db.transaction("rw", [db.collections, db.folders, db.requests], async () => {
        // 1. Create collection
        await db.collections.add({
          id: newCollId,
          name: `${coll.name} (Copy)`,
          createdAt: Date.now(),
        });

        // 2. Map old folder IDs to new folder IDs to preserve hierarchy
        const folderIdMap: Record<string, string> = {};
        const collFolders = folders.filter((f) => f.collectionId === collectionId);

        const duplicateFolder = async (folder: Folder, newParentId: string | null) => {
          const newFolderId = `folder-copy-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
          folderIdMap[folder.id] = newFolderId;

          await db.folders.add({
            id: newFolderId,
            collectionId: newCollId,
            parentFolderId: newParentId,
            name: folder.name,
            createdAt: Date.now(),
          });

          // Duplicate subfolders recursively
          const subfolders = collFolders.filter((f) => f.parentFolderId === folder.id);
          for (const sub of subfolders) {
            await duplicateFolder(sub, newFolderId);
          }
        };

        // Duplicate top-level folders
        const rootFolders = collFolders.filter((f) => !f.parentFolderId);
        for (const rf of rootFolders) {
          await duplicateFolder(rf, null);
        }

        // 3. Duplicate all requests
        const collReqs = requests.filter((r) => r.collectionId === collectionId);
        for (const req of collReqs) {
          const newReqId = `req-copy-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
          const newFolderId = req.folderId ? folderIdMap[req.folderId] : null;

          await db.requests.add({
            ...req,
            id: newReqId,
            collectionId: newCollId,
            folderId: newFolderId,
            name: req.name,
            pinned: false,
            favorite: false,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
        }
      });

      setExpandedPaths((prev) => ({ ...prev, [newCollId]: true }));
    } catch (err) {
      console.error("Failed to duplicate collection:", err);
    }
  };


  const handleDeleteRequest = async (id: string) => {
    setConfirmState({
      isOpen: true,
      title: "Delete Request",
      message: "Are you sure you want to delete this request?",
      isDestructive: true,
      onConfirm: async () => {
        await db.requests.delete(id);
        await db.tabs.delete(id);
        setConfirmState(null);
      }
    });
  };

  const handleDeleteFolder = async (id: string) => {
    setConfirmState({
      isOpen: true,
      title: "Delete Folder",
      message: "Are you sure you want to delete this folder and all its contents recursively?",
      isDestructive: true,
      onConfirm: async () => {
        // Find all nested sub-folders and requests recursively
        const folderIdsToDelete = new Set<string>([id]);
        
        const getNestedFolders = (parentId: string) => {
          folders.forEach((f) => {
            if (f.parentFolderId === parentId) {
              folderIdsToDelete.add(f.id);
              getNestedFolders(f.id);
            }
          });
        };
        getNestedFolders(id);
        
        // Find requests contained in any of these folders
        const reqsToDelete = requests.filter(
          (r) => r.folderId !== null && folderIdsToDelete.has(r.folderId)
        );

        // Run deletion as an atomic transaction
        await db.transaction("rw", [db.folders, db.requests, db.tabs], async () => {
          for (const fId of folderIdsToDelete) {
            await db.folders.delete(fId);
          }
          for (const r of reqsToDelete) {
            await db.requests.delete(r.id);
            await db.tabs.delete(r.id);
          }
        });

        setConfirmState(null);
      }
    });
  };

  const handleDeleteCollection = async (id: string) => {
    setConfirmState({
      isOpen: true,
      title: "Delete Collection",
      message: "Are you sure you want to delete this entire collection, including all folders and requests recursively?",
      isDestructive: true,
      onConfirm: async () => {
        await db.transaction("rw", [db.collections, db.folders, db.requests, db.tabs], async () => {
          await db.collections.delete(id);
          const collFolders = folders.filter((f) => f.collectionId === id);
          for (const f of collFolders) await db.folders.delete(f.id);
          const collReqs = requests.filter((r) => r.collectionId === id);
          for (const r of collReqs) {
            await db.requests.delete(r.id);
            await db.tabs.delete(r.id);
          }
        });
        setConfirmState(null);
      }
    });
  };

  const handleExportCollection = async (coll: Collection) => {
    try {
      const jsonString = await exportPostmanCollection(coll.id);
      const blob = new Blob([jsonString], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${coll.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}.postman_collection.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      showToast(`Export failed: ${err.message}`, "error");
    }
  };

  const handleRename = async (id: string, type: "collection" | "folder" | "request") => {
    if (!renameVal.trim()) {
      setRenameId(null);
      return;
    }
    try {
      if (type === "collection") {
        await db.collections.update(id, { name: renameVal });
      } else if (type === "folder") {
        await db.folders.update(id, { name: renameVal });
      } else {
        await db.requests.update(id, { name: renameVal });
      }
    } catch (err) {
      console.error("Failed to rename item:", err);
    }
    setRenameId(null);
    setRenameVal("");
  };

  // Render recursion for folders and requests
  const renderTreeFolder = (folder: Folder, depth: number) => {
    const isExpanded = !!expandedNodes[folder.id];
    const isEditing = renameId === folder.id;

    const sortOrder = collectionSorts[folder.collectionId] || "default";

    // Get immediate children requests
    const childRequests = filteredRequests.filter((r) => r.folderId === folder.id);
    const childSubfolders = filteredFolders.filter((f) => f.parentFolderId === folder.id);

    const sortedSubfolders = sortOrder === "alphabetical"
      ? [...childSubfolders].sort((a, b) => a.name.localeCompare(b.name))
      : childSubfolders;

    const sortedRequests = sortOrder === "alphabetical"
      ? [...childRequests].sort((a, b) => a.name.localeCompare(b.name))
      : childRequests;

    return (
      <div key={folder.id} className="flex flex-col select-none">
        {/* Folder Header */}
        <div
          onClick={() => toggleNode(folder.id)}
          style={{ paddingLeft: `${depth * 10 + 4}px` }}
          className="group flex items-center justify-between py-1 px-2 rounded-md hover:bg-neutral-900/65 cursor-pointer text-xs transition-all relative text-neutral-400 hover:text-white"
        >
          <div className="flex items-center gap-1.5 min-w-0 flex-1 truncate mr-2">
            <span className="text-neutral-500">
              {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </span>
            <span className="text-neutral-400 shrink-0">
              {isExpanded ? (
                <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 text-neutral-400 group-hover:text-neutral-200 transition-colors" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1.5 5C1.5 4.17 2.17 3.5 3 3.5H5.5L7 5.5H12.5C13.33 5.5 14 6.17 14 7V12C14 12.55 13.55 13 13 13H3C2.45 13 2 12.55 2 12V5"/>
                  <path d="M1.5 7.5H14.5"/>
                </svg>
              ) : (
                <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 text-neutral-500 group-hover:text-neutral-300 transition-colors" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1.5 4.5C1.5 3.67 2.17 3 3 3H5.5L7 5H13C13.55 5 14 5.45 14 6V12C14 12.55 13.55 13 13 13H3C2.45 13 2 12.55 2 12V4.5Z"/>
                </svg>
              )}
            </span>

            {isEditing ? (
              <input
                type="text"
                value={renameVal}
                onChange={(e) => setRenameVal(e.target.value)}
                onBlur={() => handleRename(folder.id, "folder")}
                onKeyDown={(e) => e.key === "Enter" && handleRename(folder.id, "folder")}
                className="bg-neutral-950 border border-neutral-800 text-white rounded px-1 text-[11px] font-sans focus:outline-none"
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="truncate font-sans font-medium">{folder.name}</span>
            )}
          </div>

          {/* Quick Actions (only visible on hover) */}
          <div
            className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 menu-trigger-container"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => handleCreateRequest(folder.collectionId, folder.id)}
              className="p-1 hover:bg-neutral-800 rounded text-neutral-400 hover:text-emerald-400 cursor-pointer"
              title="Add request"
            >
              <Plus className="h-3 w-3" />
            </button>
            <button
              onClick={() => handleCreateFolder(folder.collectionId, folder.id)}
              className="p-1 hover:bg-neutral-800 rounded text-neutral-400 hover:text-blue-400 cursor-pointer"
              title="Add nested folder"
            >
              <FolderPlus className="h-3 w-3" />
            </button>

            {/* Menu trigger */}
            <div className="relative">
              <button
                onClick={() => {
                  setActiveMenuId(activeMenuId === folder.id ? null : folder.id);
                  setRenameVal(folder.name);
                }}
                className="p-1 hover:bg-neutral-850 rounded text-neutral-400 hover:text-white cursor-pointer"
              >
                <MoreVertical className="h-3 w-3" />
              </button>

              {activeMenuId === folder.id && (
                <div className="absolute right-0 top-6 z-30 w-36 rounded-lg border border-neutral-800 bg-neutral-950 p-1 shadow-xl text-[10px] font-semibold text-neutral-400 font-sans">
                  <button
                    onClick={() => {
                      handleCreateRequest(folder.collectionId, folder.id);
                      setActiveMenuId(null);
                    }}
                    className="w-full text-left px-2 py-1.5 hover:bg-neutral-900 rounded flex items-center gap-1.5 hover:text-white"
                  >
                    <Plus className="h-3 w-3 text-emerald-400" /> Add Request
                  </button>
                  <button
                    onClick={() => {
                      handleCreateFolder(folder.collectionId, folder.id);
                      setActiveMenuId(null);
                    }}
                    className="w-full text-left px-2 py-1.5 hover:bg-neutral-900 rounded flex items-center gap-1.5 hover:text-white"
                  >
                    <FolderPlus className="h-3 w-3 text-blue-400" /> Add Folder
                  </button>
                  <div className="border-t border-neutral-900 my-1"></div>
                  <button
                    onClick={() => {
                      setRenameId(folder.id);
                      setActiveMenuId(null);
                    }}
                    className="w-full text-left px-2 py-1.5 hover:bg-neutral-900 rounded flex items-center gap-1.5 hover:text-white"
                  >
                    <Edit3 className="h-3 w-3" /> Rename
                  </button>
                  <button
                    onClick={() => {
                      handleDuplicateFolder(folder);
                      setActiveMenuId(null);
                    }}
                    className="w-full text-left px-2 py-1.5 hover:bg-neutral-900 rounded flex items-center gap-1.5 hover:text-white"
                  >
                    <Copy className="h-3 w-3" /> Duplicate
                  </button>
                  <button
                    onClick={() => {
                      handleDeleteFolder(folder.id);
                      setActiveMenuId(null);
                    }}
                    className="w-full text-left px-2 py-1.5 hover:bg-neutral-900 rounded text-red-500 hover:bg-red-950/20 flex items-center gap-1.5"
                  >
                    <Trash2 className="h-3 w-3" /> Delete
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Children Render */}
        <AnimatePresence initial={false}>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden"
            >
              {/* Nested folders */}
              {sortedSubfolders.map((f) => renderTreeFolder(f, depth + 1))}

              {/* Nested requests */}
              {sortedRequests.map((r) => renderTreeRequest(r, depth + 1))}

              {childSubfolders.length === 0 && childRequests.length === 0 && (
                <span
                  style={{ paddingLeft: `${(depth + 1) * 10 + 20}px` }}
                  className="text-[10px] text-neutral-600 italic py-1 block"
                >
                  Empty folder
                </span>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  const renderTreeRequest = (req: RequestItem, depth: number) => {
    const isSelected = activeRequestId === req.id;
    const isEditing = renameId === req.id;

    return (
      <div
        key={req.id}
        onClick={() => onSelectRequest(req.id)}
        style={{ paddingLeft: `${depth * 10 + 12}px` }}
        className={`group flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-neutral-900/40 cursor-pointer text-xs transition-colors relative font-mono ${
          isSelected ? "bg-neutral-900 border-l border-emerald-500 text-white" : "text-neutral-400 hover:text-neutral-200"
        }`}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1 truncate mr-2">
          {getMethodBadge(req.method)}

          {isEditing ? (
            <input
              type="text"
              value={renameVal}
              onChange={(e) => setRenameVal(e.target.value)}
              onBlur={() => handleRename(req.id, "request")}
              onKeyDown={(e) => e.key === "Enter" && handleRename(req.id, "request")}
              className="bg-neutral-950 border border-neutral-800 text-white rounded px-1 text-[11px] font-sans focus:outline-none"
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="truncate font-sans font-medium text-[11px]">{req.name}</span>
          )}
        </div>

        {/* Hover Quick Actions */}
        <div
          className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 menu-trigger-container"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={async () => {
              await db.requests.update(req.id, { pinned: !req.pinned });
            }}
            className={`p-1 hover:bg-neutral-800 rounded cursor-pointer ${req.pinned ? "text-emerald-400" : "text-neutral-500"}`}
            title={req.pinned ? "Unpin request" : "Pin request"}
          >
            <Pin className="h-3 w-3" />
          </button>
          <button
            onClick={async () => {
              await db.requests.update(req.id, { favorite: !req.favorite });
            }}
            className={`p-1 hover:bg-neutral-800 rounded cursor-pointer ${req.favorite ? "text-amber-400" : "text-neutral-500"}`}
            title={req.favorite ? "Unfavorite request" : "Favorite request"}
          >
            <Star className="h-3 w-3" />
          </button>

          <div className="relative">
            <button
              onClick={() => {
                setActiveMenuId(activeMenuId === req.id ? null : req.id);
                setRenameVal(req.name);
              }}
              className="p-1 hover:bg-neutral-800 rounded text-neutral-500 hover:text-white cursor-pointer"
            >
              <MoreVertical className="h-3 w-3" />
            </button>

            {activeMenuId === req.id && (
              <div className="absolute right-0 top-6 z-30 w-32 rounded-lg border border-neutral-800 bg-neutral-950 p-1 shadow-xl text-[10px] font-semibold text-neutral-400">
                <button
                  onClick={() => {
                    setRenameId(req.id);
                    setActiveMenuId(null);
                  }}
                  className="w-full text-left px-2 py-1.5 hover:bg-neutral-900 rounded flex items-center gap-1.5 hover:text-white"
                >
                  <Edit3 className="h-3 w-3" /> Rename
                </button>
                <button
                  onClick={() => {
                    handleDuplicateRequest(req);
                    setActiveMenuId(null);
                  }}
                  className="w-full text-left px-2 py-1.5 hover:bg-neutral-900 rounded flex items-center gap-1.5 hover:text-white"
                >
                  <Copy className="h-3 w-3" /> Duplicate
                </button>
                <button
                  onClick={() => {
                    handleDeleteRequest(req.id);
                    setActiveMenuId(null);
                  }}
                  className="w-full text-left px-2 py-1.5 hover:bg-neutral-900 rounded text-red-500 hover:bg-red-950/20 flex items-center gap-1.5"
                >
                  <Trash2 className="h-3 w-3" /> Delete
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const [isSidebarDragging, setIsSidebarDragging] = useState(false);

  const handleSidebarDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsSidebarDragging(true);
  };

  const handleSidebarDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsSidebarDragging(false);
  };

  const handleSidebarDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsSidebarDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      onOpenSettings("import");
    }
  };

  return (
    <div 
      onDragOver={handleSidebarDragOver}
      onDragLeave={handleSidebarDragLeave}
      onDrop={handleSidebarDrop}
      className="flex flex-col h-full bg-sidebar-bg border-r border-sidebar-border text-sidebar-text relative font-sans"
    >
      {isSidebarDragging && (
        <div className="absolute inset-0 bg-[#151515]/90 z-50 flex flex-col items-center justify-center border-2 border-dashed border-[#007acc] p-4 text-center pointer-events-none animate-fade-in font-sans">
          <Upload className="h-8 w-8 text-[#007acc] mb-2 animate-bounce" />
          <p className="text-xs font-bold text-white">Drop Collections Here</p>
          <p className="text-[10px] text-neutral-500 mt-1">Import multiple Postman JSON files instantly</p>
        </div>
      )}
      {/* Top Identity bar (frameless draggable, unified dark styling) */}
      <div 
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        className="px-3 border-b border-sidebar-border bg-sidebar-bg flex items-center justify-between shrink-0 h-[41px] select-none"
      >
        <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
           {/* Official Apify Logo */}
          <svg viewBox="0 0 500 500" className="h-4.5 w-4.5 shrink-0">
            <rect width="500" height="500" rx="110" fill="#FF6C37"/>
            <g transform="translate(45, 10)">
              <path d="M150 380 L250 120 L350 380" fill="none" stroke="#FFFFFF" stroke-width="32" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M185 290 H315" fill="none" stroke="#FFFFFF" stroke-width="32" stroke-linecap="round"/>
              <circle cx="250" cy="120" r="16" fill="#FF6C37" stroke="#FFFFFF" stroke-width="8"/>
              <circle cx="250" cy="290" r="16" fill="#FF6C37" stroke="#FFFFFF" stroke-width="8"/>
            </g>
          </svg>
          <span className="text-[11px] font-black tracking-widest text-sidebar-text uppercase font-sans">Apify</span>
        </div>
      </div>

      {/* Global Search Bar */}
      <div className="p-2 border-b border-sidebar-border shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-sidebar-text-muted" />
          <input
            type="text"
            placeholder="Search API endpoints (Ctrl+Shift+F)"
            value={localSearch}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="w-full bg-sidebar-bg border border-sidebar-border rounded-lg pl-8 pr-3 py-1.5 text-xs text-sidebar-text placeholder-sidebar-text-muted focus:outline-none focus:border-brand-blue transition-colors font-sans"
          />
        </div>
      </div>

      {/* Navigation Tree scroll area */}
      <div className="flex-1 overflow-y-auto p-2 space-y-4 scrollbar-thin">
        {/* Pinned requests section */}
        {pinnedRequests.length > 0 && (
          <div>
            <div className="px-2 py-1 text-[10px] font-bold text-neutral-500 uppercase tracking-widest flex items-center gap-1">
              <Pin className="h-3 w-3 text-emerald-400" />
              <span>Pinned Requests</span>
            </div>
            <div className="space-y-0.5 mt-1">
              {pinnedRequests.map((r) => renderTreeRequest(r, 0))}
            </div>
          </div>
        )}

        {/* Favorite requests section */}
        {favoriteRequests.length > 0 && (
          <div>
            <div className="px-2 py-1 text-[10px] font-bold text-neutral-500 uppercase tracking-widest flex items-center gap-1">
              <Star className="h-3 w-3 text-amber-400" />
              <span>Favorites</span>
            </div>
            <div className="space-y-0.5 mt-1">
              {favoriteRequests.map((r) => renderTreeRequest(r, 0))}
            </div>
          </div>
        )}

        {/* Collections tree section */}
        <div>
          <div className="px-2 py-1 text-[10px] font-bold text-neutral-500 uppercase tracking-widest flex items-center justify-between select-none">
            <span>Collections</span>
            <div className="flex items-center gap-1.5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
              <button
                onClick={() => setCollectionsListSort(prev => prev === "time" ? "name" : "time")}
                className={`p-0.5 rounded cursor-pointer transition-colors ${collectionsListSort === "name" ? "text-emerald-400 hover:text-emerald-300" : "text-neutral-500 hover:text-white"}`}
                title={collectionsListSort === "time" ? "Sort collections by Name (A-Z)" : "Sort collections by Date Created"}
              >
                <ArrowUpDown className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={handleCreateCollection}
                className="text-neutral-500 hover:text-white p-0.5 cursor-pointer transition-colors"
                title="Create Collection"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="space-y-1 mt-1 font-sans">
            {filteredCollections.length === 0 && (
              <p className="text-[11px] text-neutral-600 italic px-2 py-4 text-center">No collections found.</p>
            )}

            {filteredCollections.map((coll) => {
              const isExpanded = !!expandedNodes[coll.id];
              const isEditing = renameId === coll.id;

              const sortOrder = collectionSorts[coll.id] || "default";

              // Filter root items
              const collRootRequests = filteredRequests.filter((r) => r.collectionId === coll.id && r.folderId === null);
              const collRootFolders = filteredFolders.filter((f) => f.collectionId === coll.id && f.parentFolderId === null);

              const sortedRootFolders = sortOrder === "alphabetical"
                ? [...collRootFolders].sort((a, b) => a.name.localeCompare(b.name))
                : collRootFolders;

              const sortedRootRequests = sortOrder === "alphabetical"
                ? [...collRootRequests].sort((a, b) => a.name.localeCompare(b.name))
                : collRootRequests;

              return (
                <div key={coll.id} className="flex flex-col select-none">
                  {/* Collection Header */}
                  <div
                    onClick={() => toggleNode(coll.id)}
                    className="group flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-neutral-900/65 cursor-pointer text-xs transition-colors text-white font-semibold"
                  >
                    <div className="flex items-center gap-1.5 min-w-0 flex-1 truncate mr-2">
                      <span className="text-neutral-400">
                        {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      </span>


                      {isEditing ? (
                        <input
                          type="text"
                          value={renameVal}
                          onChange={(e) => setRenameVal(e.target.value)}
                          onBlur={() => handleRename(coll.id, "collection")}
                          onKeyDown={(e) => e.key === "Enter" && handleRename(coll.id, "collection")}
                          className="bg-neutral-950 border border-neutral-800 text-white rounded px-1 text-[11px] focus:outline-none"
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span className="truncate">{coll.name}</span>
                      )}
                    </div>

                    {/* Collection Hover Quick Actions */}
                    <div
                      className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 menu-trigger-container"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={() => handleCreateRequest(coll.id, null)}
                        className="p-1 hover:bg-neutral-800 rounded text-neutral-400 hover:text-emerald-400 cursor-pointer"
                        title="Add Request to Root"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => handleCreateFolder(coll.id, null)}
                        className="p-1 hover:bg-neutral-800 rounded text-neutral-400 hover:text-blue-400 cursor-pointer"
                        title="Add Folder to Root"
                      >
                        <FolderPlus className="h-3 w-3" />
                      </button>

                      <div className="relative font-sans">
                        <button
                          onClick={() => {
                            setActiveMenuId(activeMenuId === coll.id ? null : coll.id);
                            setRenameVal(coll.name);
                          }}
                          className="p-1 hover:bg-neutral-800 rounded text-neutral-400 hover:text-white cursor-pointer"
                        >
                          <MoreVertical className="h-3 w-3" />
                        </button>

                        {activeMenuId === coll.id && (
                          <div className="absolute right-0 top-6 z-30 w-52 rounded-lg border border-neutral-800 bg-neutral-950 p-1 shadow-xl text-[10px] font-semibold text-neutral-400 font-sans">
                            <button
                              onClick={() => {
                                handleCreateRequest(coll.id, null);
                                setActiveMenuId(null);
                              }}
                              className="w-full text-left px-2 py-1.5 hover:bg-neutral-900 rounded flex items-center gap-1.5 hover:text-white"
                            >
                              <Plus className="h-3 w-3 text-emerald-400" /> Add Request
                            </button>
                            <button
                              onClick={() => {
                                handleCreateFolder(coll.id, null);
                                setActiveMenuId(null);
                              }}
                              className="w-full text-left px-2 py-1.5 hover:bg-neutral-900 rounded flex items-center gap-1.5 hover:text-white"
                            >
                              <FolderPlus className="h-3 w-3 text-blue-400" /> Add Folder
                            </button>
                            <div className="border-t border-neutral-900 my-1"></div>
                            <button
                              onClick={() => {
                                setRenameId(coll.id);
                                setActiveMenuId(null);
                              }}
                              className="w-full text-left px-2 py-1.5 hover:bg-neutral-900 rounded flex items-center gap-1.5 hover:text-white"
                            >
                              <Edit3 className="h-3 w-3" /> Rename
                            </button>
                            <button
                              onClick={() => {
                                handleDuplicateCollection(coll.id);
                                setActiveMenuId(null);
                              }}
                              className="w-full text-left px-2 py-1.5 hover:bg-neutral-900 rounded flex items-center gap-1.5 hover:text-white"
                            >
                              <Copy className="h-3 w-3" /> Duplicate
                            </button>
                            <button
                              onClick={() => {
                                handleExportCollection(coll);
                                setActiveMenuId(null);
                              }}
                              className="w-full text-left px-2 py-1.5 hover:bg-neutral-900 rounded flex items-center gap-1.5 hover:text-white"
                            >
                              <FolderDown className="h-3 w-3" /> Export Collection
                            </button>
                            <div className="border-t border-neutral-900 my-1"></div>
                            <div className="px-2 py-1 text-[9px] font-bold text-neutral-500 uppercase">Sort</div>
                            <button
                              onClick={() => {
                                updateCollectionSort(coll.id, "default");
                              }}
                              className="w-full text-left px-2 py-1 hover:bg-neutral-900 rounded flex items-center justify-between hover:text-white text-[10px]"
                            >
                              <span>Folders first, Default</span>
                              {(collectionSorts[coll.id] || "default") === "default" && <Check className="h-3 w-3 text-emerald-400" />}
                            </button>
                            <button
                              onClick={() => {
                                updateCollectionSort(coll.id, "alphabetical");
                              }}
                              className="w-full text-left px-2 py-1 hover:bg-neutral-900 rounded flex items-center justify-between hover:text-white text-[10px]"
                            >
                              <span>Folders first, A to Z</span>
                              {collectionSorts[coll.id] === "alphabetical" && <Check className="h-3 w-3 text-emerald-400" />}
                            </button>
                            <div className="px-2 py-0.5 text-[8px] font-normal text-neutral-600 italic leading-tight mb-1">
                              This only updates your view in the sidebar.
                            </div>
                            <div className="border-t border-neutral-900 my-1"></div>
                            <button
                              onClick={() => {
                                handleDeleteCollection(coll.id);
                                setActiveMenuId(null);
                              }}
                              className="w-full text-left px-2 py-1.5 hover:bg-neutral-900 rounded text-red-500 hover:bg-red-950/20 flex items-center gap-1.5"
                            >
                              <Trash2 className="h-3 w-3" /> Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Children Render */}
                  <AnimatePresence initial={false}>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="overflow-hidden"
                      >
                        {/* Folders in collection root */}
                        {sortedRootFolders.map((folder) => renderTreeFolder(folder, 1))}

                        {/* Requests in collection root */}
                        {sortedRootRequests.map((req) => renderTreeRequest(req, 1))}

                        {collRootFolders.length === 0 && collRootRequests.length === 0 && (
                          <span className="text-[10px] text-neutral-600 italic py-1 px-8 block">
                            Empty workspace
                          </span>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </div>
      </div>


      {/* Custom Modern Confirm Modal */}
      {confirmState && (
        <ModernConfirmModal
          isOpen={confirmState.isOpen}
          title={confirmState.title}
          message={confirmState.message}
          isDestructive={confirmState.isDestructive}
          onConfirm={confirmState.onConfirm}
          onCancel={() => setConfirmState(null)}
        />
      )}

      {/* Premium custom naming prompt modal replacing window.prompt() */}
      {inputModalState && (
        <div className="fixed inset-0 z-[250] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in font-sans">
          <div className="w-full max-w-sm rounded-xl border border-neutral-800 bg-neutral-950 p-5 shadow-2xl text-neutral-200 flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-neutral-900 pb-2">
              <h3 className="text-sm font-bold text-white">{inputModalState.title}</h3>
              <button
                onClick={() => setInputModalState(null)}
                className="rounded hover:bg-neutral-900 text-neutral-400 p-0.5 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div>
              <input
                type="text"
                id="sidebar-prompt-input"
                placeholder={inputModalState.placeholder}
                defaultValue={inputModalState.defaultValue}
                className="w-full bg-neutral-950 border border-neutral-850 rounded px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const val = (e.target as HTMLInputElement).value;
                    if (val.trim()) {
                      inputModalState.onConfirm(val.trim());
                    }
                    setInputModalState(null);
                  }
                }}
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2 mt-1">
              <button
                onClick={() => setInputModalState(null)}
                className="px-3.5 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-850 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const inputEl = document.getElementById("sidebar-prompt-input") as HTMLInputElement;
                  if (inputEl && inputEl.value.trim()) {
                    inputModalState.onConfirm(inputEl.value.trim());
                  }
                  setInputModalState(null);
                }}
                className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
