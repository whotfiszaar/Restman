// Lightweight event-based toast notification system
// Avoids prop drilling - components call showToast() directly

export type ToastType = "success" | "error" | "info" | "warning";

export interface ToastEvent {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

const TOAST_EVENT = "restman:toast";

export function showToast(message: string, type: ToastType = "info", duration = 3500) {
  const event = new CustomEvent<ToastEvent>(TOAST_EVENT, {
    detail: {
      id: `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      message,
      type,
      duration,
    },
  });
  window.dispatchEvent(event);
}

export { TOAST_EVENT };
