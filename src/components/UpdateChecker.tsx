import { useState, useEffect } from "react";
import { RefreshCw, CheckCircle, ArrowUpCircle } from "lucide-react";
import { showToast } from "../utils/toast";

export default function UpdateChecker() {
  const [status, setStatus] = useState<"idle" | "checking" | "up-to-date" | "available" | "downloading" | "failed">("idle");
  const [latestVer, setLatestVer] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");

  const currentVer = "2.1.4";
  const isElectron = typeof window !== "undefined" && (window as any).electronAPI?.isElectron;

  const handleCheckUpdate = async (auto = false) => {
    setStatus("checking");
    try {
      const res = await fetch("https://api.github.com/repos/whotfiszaar/Apify/releases/latest");
      if (!res.ok) throw new Error("Failed to contact update server");
      const data = await res.json();
      const tag = data.tag_name || "";
      const latest = tag.replace(/^[vV]/, "").trim();

      if (latest && latest !== currentVer) {
        setLatestVer(latest);
        const exeAsset = data.assets?.find((a: any) => a.name.endsWith(".exe"));
        setDownloadUrl(exeAsset ? exeAsset.browser_download_url : data.html_url);
        setStatus("available");
        if (!auto) {
          showToast(`New update v${latest} is available!`, "success");
        }
      } else {
        setStatus("up-to-date");
        if (!auto) {
          showToast("Apify is up to date!", "success");
        }
      }
    } catch (err) {
      console.error(err);
      setStatus("failed");
      if (!auto) {
        showToast("Could not check for updates", "error");
      }
    }
  };

  // Auto check on mount
  useEffect(() => {
    handleCheckUpdate(true);
  }, []);

  const handleInstallUpdate = async () => {
    if (!downloadUrl) return;

    if (!isElectron) {
      // In web version, redirect to release page
      window.open(downloadUrl, "_blank");
      return;
    }

    setStatus("downloading");
    showToast("Downloading update in background... Apify will restart automatically.", "info");

    try {
      const result = await (window as any).electronAPI.downloadAndInstallUpdate(downloadUrl);
      if (result && result.success) {
        // App will quit and restart automatically
      } else {
        throw new Error(result?.error || "Download failed");
      }
    } catch (err: any) {
      showToast(`Update failed: ${err.message}`, "error");
      setStatus("available");
    }
  };

  if (status === "checking") {
    return (
      <span className="flex items-center gap-1 text-[10px] text-neutral-400 font-sans">
        <RefreshCw className="h-3 w-3 animate-spin text-brand-blue" />
        Checking...
      </span>
    );
  }

  if (status === "up-to-date") {
    return (
      <span className="flex items-center gap-1 text-[10px] text-neutral-500 font-sans" title="Apify is fully updated">
        <CheckCircle className="h-3 w-3 text-emerald-500" />
        Up to date
      </span>
    );
  }

  if (status === "available") {
    return (
      <button
        onClick={handleInstallUpdate}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 font-bold border border-emerald-500/20 text-[10px] transition-all cursor-pointer font-sans"
        title={isElectron ? "Click to install update" : "Click to view release"}
      >
        <ArrowUpCircle className="h-3 w-3 text-emerald-400 animate-pulse" />
        Update available (v{latestVer})
      </button>
    );
  }

  if (status === "downloading") {
    return (
      <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-sans font-bold animate-pulse">
        <RefreshCw className="h-3 w-3 animate-spin text-emerald-400" />
        Downloading update...
      </span>
    );
  }

  return (
    <button
      onClick={() => handleCheckUpdate(false)}
      className="text-neutral-500 hover:text-neutral-300 text-[10px] bg-transparent border-none cursor-pointer underline font-sans"
    >
      Check for Updates
    </button>
  );
}
