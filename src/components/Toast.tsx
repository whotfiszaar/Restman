import { useState, useEffect } from "react";
import { TOAST_EVENT, type ToastEvent } from "../utils/toast";
import { X, CheckCircle2, AlertCircle, Info, AlertTriangle } from "lucide-react";

export default function Toast() {
  const [toasts, setToasts] = useState<ToastEvent[]>([]);

  useEffect(() => {
    const handler = (e: Event) => {
      const toast = (e as CustomEvent<ToastEvent>).detail;
      setToasts((prev) => [...prev, toast]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toast.id));
      }, toast.duration ?? 3500);
    };
    window.addEventListener(TOAST_EVENT, handler);
    return () => window.removeEventListener(TOAST_EVENT, handler);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-20 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => {
        const config = {
          success: {
            icon: <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />,
            bar: "bg-emerald-500",
            border: "border-emerald-500/20",
            bg: "bg-neutral-950",
          },
          error: {
            icon: <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />,
            bar: "bg-rose-500",
            border: "border-rose-500/20",
            bg: "bg-neutral-950",
          },
          warning: {
            icon: <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />,
            bar: "bg-amber-500",
            border: "border-amber-500/20",
            bg: "bg-neutral-950",
          },
          info: {
            icon: <Info className="h-4 w-4 text-sky-400 shrink-0" />,
            bar: "bg-sky-500",
            border: "border-sky-500/20",
            bg: "bg-neutral-950",
          },
        }[toast.type];

        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-xl border ${config.border} ${config.bg} shadow-2xl backdrop-blur-md max-w-sm w-auto animate-slide-up overflow-hidden relative`}
          >
            {/* Left accent bar */}
            <div className={`absolute left-0 top-0 bottom-0 w-[3px] ${config.bar} rounded-l-xl`} />
            {config.icon}
            <span className="text-[12px] text-neutral-200 font-sans leading-relaxed flex-1 pr-2">
              {toast.message}
            </span>
            <button
              onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
              className="text-neutral-500 hover:text-white transition-colors cursor-pointer shrink-0 rounded p-0.5"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
