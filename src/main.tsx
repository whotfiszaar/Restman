import { Component, ErrorInfo, ReactNode } from "react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ error, errorInfo });
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-neutral-950 text-neutral-200 font-sans p-6">
          <div className="w-full max-w-lg p-6 rounded-xl border border-rose-500/20 bg-rose-950/20 backdrop-blur-md shadow-2xl flex flex-col gap-4">
            <div className="flex items-center gap-2.5 text-rose-400 font-bold">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 animate-bounce" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span>Application Error Caught</span>
            </div>
            <p className="text-xs text-rose-300 leading-relaxed">
              Something went wrong during rendering. RestMan caught a critical exception and protected the workspace state.
            </p>
            <div className="p-3 bg-black/60 rounded border border-rose-950 font-mono text-[11px] text-rose-200 max-h-[200px] overflow-auto select-text scrollbar-thin">
              <p className="font-semibold text-rose-100">{this.state.error?.toString()}</p>
              <pre className="mt-2 text-neutral-500 whitespace-pre-wrap leading-normal font-mono">
                {this.state.errorInfo?.componentStack || this.state.error?.stack}
              </pre>
            </div>
            <div className="flex justify-end gap-2.5 mt-2">
              <button
                onClick={this.handleReload}
                className="px-4 py-2 bg-rose-900/60 hover:bg-rose-800 text-rose-100 text-xs font-bold rounded-lg cursor-pointer transition-colors"
              >
                Reload Workspace
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Failed to find the root element in index.html");
}

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
