import React, { useState, useEffect, useRef } from "react";
import { db, type Variable } from "../db/db";
import { X, Plus, Trash2, Eye, EyeOff, Search, Copy, Check } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { refactorVariableOccurrences, dereferenceVariableOccurrences, renameVariableOccurrences } from "../utils/variableRefactor";

interface VariablesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function VariablesModal({ isOpen, onClose }: VariablesModalProps) {
  // DB Subscriptions
  const variables = (useLiveQuery(() => db.variables.toArray()) as Variable[]) || [];

  // Variables Form & Search State
  const [searchGlobals, setSearchGlobals] = useState("");
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [showValues, setShowValues] = useState<Record<string, boolean>>({});
  const [globalKeyWarning, setGlobalKeyWarning] = useState<string | null>(null);

  // UI state for clipboard copy indications
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Refs for debouncing writes to IndexedDB
  const debounceTimers = useRef<Record<string, NodeJS.Timeout>>({});

  // Close modal on Escape press
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

  // --- Debounced DB Helpers ---
  const debouncedUpdateGlobalValue = (id: string, val: string) => {
    if (debounceTimers.current[`g-val-${id}`]) {
      clearTimeout(debounceTimers.current[`g-val-${id}`]);
    }
    debounceTimers.current[`g-val-${id}`] = setTimeout(async () => {
      try {
        await db.variables.update(id, { value: val });
        if (val.trim()) {
          await refactorVariableOccurrences(id, val);
        }
      } catch (err) {
        console.error("Failed to update variable value:", err);
      }
    }, 300);
  };

  const debouncedUpdateGlobalDesc = (id: string, desc: string) => {
    if (debounceTimers.current[`g-desc-${id}`]) {
      clearTimeout(debounceTimers.current[`g-desc-${id}`]);
    }
    debounceTimers.current[`g-desc-${id}`] = setTimeout(async () => {
      try {
        await db.variables.update(id, { description: desc });
      } catch (err) {
        console.error("Failed to update variable description:", err);
      }
    }, 300);
  };

  // --- Globals Handlers ---
  const handleAddGlobal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKey.trim()) return;

    const trimmedKey = newKey.trim().replace(/[\$\{\}]/g, ""); // strip curly brackets or $ signs if typed

    // Overwrite warning
    const exists = variables.some(v => v.id === trimmedKey);
    if (exists) {
      setGlobalKeyWarning(`Variable "${trimmedKey}" already exists. Submitting will overwrite its value.`);
      setTimeout(() => setGlobalKeyWarning(null), 5000);
    }

    try {
      await db.variables.put({
        id: trimmedKey,
        value: newValue,
        description: newDesc,
        enabled: true,
      });

      if (newValue.trim()) {
        await refactorVariableOccurrences(trimmedKey, newValue);
      }

      setNewKey("");
      setNewValue("");
      setNewDesc("");
      setGlobalKeyWarning(null);
    } catch (err) {
      console.error("Failed to add global variable:", err);
    }
  };

  const handleDeleteGlobal = async (id: string) => {
    try {
      const variable = await db.variables.get(id);
      if (variable) {
        await dereferenceVariableOccurrences(id, variable.value);
      }
      await db.variables.delete(id);
    } catch (err) {
      console.error("Failed to delete variable:", err);
    }
  };

  const handleToggleGlobal = async (variable: Variable) => {
    try {
      await db.variables.update(variable.id, { enabled: !variable.enabled });
    } catch (err) {
      console.error("Failed to toggle variable state:", err);
    }
  };

  const copyToClipboard = (keyName: string) => {
    const refText = `\${${keyName}}`;
    navigator.clipboard.writeText(refText);
    setCopiedKey(keyName);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  // --- Filtering Lists ---
  const filteredGlobals = variables.filter(
    (v) =>
      v.id.toLowerCase().includes(searchGlobals.toLowerCase()) ||
      v.value.toLowerCase().includes(searchGlobals.toLowerCase())
  );

  return (
    <div 
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/65 backdrop-blur-sm animate-fade-in font-sans"
      onClick={onClose}
    >
      <div 
        className="relative w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col rounded-xl border border-neutral-800 bg-neutral-950 p-6 shadow-2xl text-neutral-200"
        onClick={(e) => e.stopPropagation()}
      >
        
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-neutral-800 pb-4 mb-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-white flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
              Global Variables Studio
            </h2>
            <p className="text-xs text-neutral-400 mt-1">
              Configure parameters to resolve in URLs, headers, auth configurations, or bodies using the{" "}
              <code className="text-emerald-400 font-mono">${`{variableName}`}</code> syntax.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 hover:bg-neutral-900 text-neutral-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable Workspace Panel */}
        <div className="flex-1 overflow-y-auto pr-1 scrollbar-thin">
          <div className="space-y-4">
            {/* Create Form */}
            <form onSubmit={handleAddGlobal} className="grid grid-cols-12 gap-3 p-3 rounded-lg bg-neutral-900/40 border border-neutral-900">
              <div className="col-span-3">
                <label className="block text-[10px] font-medium text-neutral-400 uppercase tracking-wider mb-1">Variable Name</label>
                <input
                  type="text"
                  placeholder="e.g. baseUrl"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  className="w-full rounded-md border border-neutral-850 bg-neutral-950 px-3 py-1.5 text-xs text-white placeholder-neutral-600 focus:border-emerald-500 focus:outline-none font-mono"
                  required
                />
              </div>
              <div className="col-span-4">
                <label className="block text-[10px] font-medium text-neutral-400 uppercase tracking-wider mb-1">Value</label>
                <input
                  type="text"
                  placeholder="e.g. https://api.com/v1"
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  className="w-full rounded-md border border-neutral-855 bg-neutral-950 px-3 py-1.5 text-xs text-white placeholder-neutral-600 focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div className="col-span-4">
                <label className="block text-[10px] font-medium text-neutral-400 uppercase tracking-wider mb-1">Description (Optional)</label>
                <input
                  type="text"
                  placeholder="Primary endpoint URL"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  className="w-full rounded-md border border-neutral-855 bg-neutral-950 px-3 py-1.5 text-xs text-white placeholder-neutral-600 focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div className="col-span-1 flex items-end">
                <button
                  type="submit"
                  className="w-full rounded-md bg-emerald-600 hover:bg-emerald-500 text-white p-2 flex items-center justify-center transition-colors text-xs font-semibold cursor-pointer"
                  title="Add Variable"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              {globalKeyWarning && (
                <div className="col-span-12 text-[10px] text-amber-500 px-1 mt-1 font-semibold">
                  ⚠ {globalKeyWarning}
                </div>
              )}
            </form>

            {/* Filter Search */}
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-neutral-500" />
              <input
                type="text"
                placeholder="Filter variables..."
                value={searchGlobals}
                onChange={(e) => setSearchGlobals(e.target.value)}
                className="w-full rounded-lg border border-neutral-900 bg-neutral-950 pl-9 pr-4 py-2 text-xs text-white placeholder-neutral-600 focus:border-emerald-500 focus:outline-none font-sans"
              />
            </div>

            {/* Globals Table */}
            <div className="border border-neutral-900 rounded-lg bg-neutral-950/60 overflow-hidden">
              <table className="w-full border-collapse text-left text-xs font-sans">
                <thead>
                  <tr className="border-b border-neutral-900 bg-neutral-900/30 text-neutral-400">
                    <th className="py-2.5 px-3 font-medium w-12 text-center">Active</th>
                    <th className="py-2.5 px-3 font-medium w-1/4">Variable Reference</th>
                    <th className="py-2.5 px-3 font-medium w-2/5">Value</th>
                    <th className="py-2.5 px-3 font-medium w-1/4">Description</th>
                    <th className="py-2.5 px-3 font-medium w-20 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-900 font-mono">
                  {filteredGlobals.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-neutral-600 text-xs italic font-sans">
                        No variables defined. Create one above to simplify your API testing.
                      </td>
                    </tr>
                  ) : (
                    filteredGlobals.map((v) => (
                      <tr key={v.id} className="hover:bg-neutral-900/20 transition-colors group">
                        <td className="py-2 px-3 text-center">
                          <input
                            type="checkbox"
                            checked={v.enabled}
                            onChange={() => handleToggleGlobal(v)}
                            className="rounded border-neutral-850 bg-neutral-900 text-emerald-600 focus:ring-0 h-3.5 w-3.5 cursor-pointer accent-emerald-500"
                          />
                        </td>
                        <td className="py-2 px-3 text-white font-semibold flex items-center gap-1">
                          <span className="text-neutral-500">${`{`}</span>
                          <input
                            type="text"
                            defaultValue={v.id}
                            onBlur={async (e) => {
                              const newId = e.target.value.trim().replace(/[\$\{\}]/g, "");
                              const oldId = v.id;
                              if (newId === oldId) return;
                              if (!newId) {
                                e.target.value = oldId;
                                return;
                              }
                              const exists = variables.some(item => item.id.toLowerCase() === newId.toLowerCase());
                              if (exists) {
                                e.target.value = oldId;
                                return;
                              }
                              try {
                                await db.variables.put({
                                  id: newId,
                                  value: v.value,
                                  description: v.description || "",
                                  enabled: v.enabled
                                });
                                await db.variables.delete(oldId);
                                await renameVariableOccurrences(oldId, newId);
                              } catch (err) {
                                console.error("Rename failed", err);
                                e.target.value = oldId;
                              }
                            }}
                            className="bg-transparent border-none text-emerald-400 font-semibold focus:outline-none focus:ring-1 focus:ring-neutral-850 rounded px-1 py-0.5 w-full text-xs font-mono"
                          />
                          <span className="text-neutral-500">{`}`}</span>
                        </td>
                        <td className="py-2 px-3">
                          <div className="flex items-center gap-1.5">
                            <input
                              type={showValues[v.id] ? "text" : "password"}
                              defaultValue={v.value}
                              onChange={(e) => debouncedUpdateGlobalValue(v.id, e.target.value)}
                              className="bg-transparent border-none text-neutral-200 focus:outline-none focus:ring-1 focus:ring-neutral-850 rounded px-1 py-0.5 w-full text-xs font-mono"
                            />
                            <button
                              type="button"
                              onClick={() => setShowValues((prev) => ({ ...prev, [v.id]: !prev[v.id] }))}
                              className="text-neutral-500 hover:text-neutral-300 p-0.5 cursor-pointer bg-transparent border-none"
                              title={showValues[v.id] ? "Mask token value" : "Reveal token value"}
                            >
                              {showValues[v.id] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                            </button>
                          </div>
                        </td>
                        <td className="py-2 px-3">
                          <input
                            type="text"
                            defaultValue={v.description || ""}
                            placeholder="Add note..."
                            onChange={(e) => debouncedUpdateGlobalDesc(v.id, e.target.value)}
                            className="bg-transparent border-none text-neutral-400 placeholder-neutral-700 focus:outline-none focus:ring-1 focus:ring-neutral-850 rounded px-1 py-0.5 w-full text-xs font-sans"
                          />
                        </td>
                        <td className="py-2 px-3 text-center">
                          <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              type="button"
                              onClick={() => copyToClipboard(v.id)}
                              className="text-neutral-500 hover:text-white p-1 cursor-pointer bg-transparent border-none"
                              title="Copy ${} reference"
                            >
                              {copiedKey === v.id ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteGlobal(v.id)}
                              className="text-neutral-500 hover:text-red-400 p-1 cursor-pointer bg-transparent border-none"
                              title="Delete"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex justify-end gap-2 mt-5 border-t border-neutral-900 pt-4">
          <button
            onClick={onClose}
            className="rounded-lg bg-neutral-900 hover:bg-neutral-800 text-neutral-300 hover:text-white px-4 py-2 text-xs font-semibold cursor-pointer transition-colors"
          >
            Done
          </button>
        </div>

      </div>
    </div>
  );
}
