import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import { ToastNotification } from "@carbon/react";

/**
 * App-wide transient feedback (success/error/info) pinned to the bottom-right
 * so messages stay visible on long pages without scrolling. Persistent or
 * contextual messages (incident banners, staged-restore warnings, connection
 * test results) stay inline where they belong.
 */

type Kind = "success" | "error" | "info" | "warning";

interface Toast {
  id: number;
  kind: Kind;
  title: string;
  subtitle: string;
}

const Ctx = createContext<{ notify: (kind: Kind, text: string) => void }>({
  notify: () => {},
});

export function useToast() {
  const { notify } = useContext(Ctx);
  return {
    success: (text: string) => notify("success", text),
    error: (text: string) => notify("error", text),
    info: (text: string) => notify("info", text),
    warning: (text: string) => notify("warning", text),
  };
}

const TITLES: Record<Kind, string> = {
  success: "Done",
  error: "Error",
  info: "Info",
  warning: "Warning",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const idRef = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback(
    (kind: Kind, text: string) => {
      const id = idRef.current++;
      setItems((prev) => [...prev.slice(-3), { id, kind, title: TITLES[kind], subtitle: text }]);
      setTimeout(() => dismiss(id), 6000);
    },
    [dismiss]
  );

  return (
    <Ctx.Provider value={{ notify }}>
      {children}
      <div className="sf-toasts" aria-live="polite">
        {items.map((t) => (
          <ToastNotification
            key={t.id}
            kind={t.kind}
            title={t.title}
            subtitle={t.subtitle}
            lowContrast
            onCloseButtonClick={() => dismiss(t.id)}
          />
        ))}
      </div>
    </Ctx.Provider>
  );
}
