import { Component, type ErrorInfo, type ReactNode } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { getDiagnostics } from "@/api/diagnostics";
import { log } from "@/api/log";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches a render error anywhere below it and shows a friendly screen
 * instead of a blank window. Mounted once, at the root, in `main.tsx`.
 *
 * The one thing it cannot do anything about is its own crash: React error
 * boundaries do not catch errors raised during their own render, so this
 * component stays as small and dependency-free as it reasonably can.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    log.error(error.message, { stack: error.stack, componentStack: info.componentStack });
    log.flush();
  }

  render() {
    if (this.state.error) {
      return (
        <ErrorScreen error={this.state.error} onReset={() => this.setState({ error: null })} />
      );
    }
    return this.props.children;
  }
}

function ErrorScreen({ error, onReset }: { error: Error; onReset: () => void }) {
  const { t } = useTranslation();
  async function copyDetails() {
    let diagnostics: Awaited<ReturnType<typeof getDiagnostics>> | null = null;
    try {
      diagnostics = await getDiagnostics();
    } catch {
      // Best-effort: still copy what we caught even without the backend bundle.
    }
    const bundle = {
      error: { message: error.message, stack: error.stack },
      ...diagnostics,
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(bundle, null, 2));
    } catch {
      // Nothing more useful to do if the clipboard itself is unavailable.
    }
  }

  async function openLog() {
    try {
      const diagnostics = await getDiagnostics();
      await revealItemInDir(diagnostics.logDir);
    } catch {
      // The log folder just cannot be reached right now (e.g. this error
      // happened before the backend ever came up); nothing else to do.
    }
  }

  return (
    // This screen replaces the whole window without warning; role="alert"
    // (assertive, atomic) makes sure a screen reader announces it at once
    // rather than staying silent about content that just disappeared.
    <div
      role="alert"
      className="flex h-screen flex-col items-center justify-center gap-4 bg-bg p-8 text-center text-fg"
    >
      <h1 className="font-serif text-2xl">{t("errorBoundary.title")}</h1>
      <p className="max-w-md text-sm text-fg-muted">{t("errorBoundary.explanation")}</p>
      <pre className="max-h-40 max-w-lg overflow-auto rounded-md border border-border bg-panel p-3 text-left text-xs text-fg-muted">
        {error.message}
      </pre>
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={() => void copyDetails()}>
          {t("errorBoundary.copyDetails")}
        </Button>
        <Button type="button" variant="outline" onClick={() => void openLog()}>
          {t("errorBoundary.openLog")}
        </Button>
        <Button type="button" onClick={onReset}>
          {t("errorBoundary.tryAgain")}
        </Button>
      </div>
    </div>
  );
}
