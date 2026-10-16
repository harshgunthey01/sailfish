import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { ToastNotification } from "@carbon/react";

/**
 * App-wide transient feedback (bottom-right toasts) + persistent notification
 * center (header megaphone): every toast is also recorded into a localStorage
 * history (cap 50) so success/failure messages survive dismissal and reloads.
 * Persistent or contextual messages (incident banners, staged-restore
 * warnings, connection test results) stay inline where they belong.
 */

type Kind = "success" | "error" | "info" | "warning";

interface Toast {
  id: number;
  kind: Kind;
  title: string;
  subtitle: string;
}

export interface HistoryEntry {
  id: number;
  kind: Kind;
  title: string;
  subtitle: string;
  ts: number;
}

const HISTORY_KEY = "sf-notif-history";
const SEEN_KEY = "sf-notif-seen";
const HISTORY_CAP = 50;

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((e) => e && e.id && e.subtitle) : [];
  } catch {
    return [];
  }
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

export function useNotifications() {
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  const [seen, setSeen] = useState<number>(() => Number(localStorage.getItem(SEEN_KEY) ?? 0));
  const refresh = useCallback(() => {
    setHistory(loadHistory());
    setSeen(Number(localStorage.getItem(SEEN_KEY) ?? 0));
  }, []);
  useEffect(() => {
    window.addEventListener("sf-notify", refresh);
    return () => window.removeEventListener("sf-notify", refresh);
  }, [refresh]);
  const markRead = useCallback(() => {
    localStorage.setItem(SEEN_KEY, String(Date.now()));
    setSeen(Date.now());
  }, []);
  const clear = useCallback(() => {
    localStorage.removeItem(HISTORY_KEY);
    setHistory([]);
  }, []);
  const unread = history.filter((h) => h.ts > seen).length;
  return { history, unread, refresh, markRead, clear };
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
      const entry: HistoryEntry = { id, kind, title: TITLES[kind], subtitle: text, ts: Date.now() };
      setItems((prev) => [...prev.slice(-3), entry]);
      setTimeout(() => dismiss(id), 6000);
      try {
        const prev = loadHistory();
        localStorage.setItem(HISTORY_KEY, JSON.stringify([entry, ...prev].slice(0, HISTORY_CAP)));
        window.dispatchEvent(new Event("sf-notify"));
      } catch {
        /* storage full/blocked: toasts still work */
      }
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
