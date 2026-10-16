import React, { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import {
  Header,
  HeaderName,
  HeaderNavigation,
  HeaderMenuItem,
  HeaderGlobalBar,
  HeaderGlobalAction,
  SideNav,
  SideNavItems,
  SideNavLink,
  Content,
  Button,
  Tag,
} from "@carbon/react";
import { Asleep, Awake, Menu } from "@carbon/icons-react";
import { ThemeProvider, useAppTheme } from "./theme";
import { ToastProvider, useNotifications } from "./toast";

/** Hand-drawn megaphone (Carbon icons-react has no megaphone in this version). */
function MegaphoneIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M2.5 8.5v3H6l6.5 3.5v-10L6 8.5H2.5z" fill="currentColor" />
      <path d="M14.5 4.5v11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M6.8 12.3 6 17h2.4l1-4.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function tagFor(kind: string) {
  if (kind === "success") return "green";
  if (kind === "error") return "red";
  if (kind === "info") return "blue";
  return "magenta";
}
import { api } from "./api";
import SetupWizard from "./pages/SetupWizard";
import Dashboard from "./pages/Dashboard";
import RouterPage from "./pages/RouterPage";
import ModelsPage from "./pages/ModelsPage";
import SettingsPage from "./pages/SettingsPage";
import InfrastructurePage from "./pages/InfrastructurePage";

function useSetupStatus() {
  const [status, setStatus] = useState<{ setup_complete: boolean; admin_created: boolean } | null>(
    null
  );
  const refresh = () =>
    api
      .get<{ setup_complete: boolean; admin_created: boolean }>("/setup/status")
      .then(setStatus)
      .catch(() => setStatus({ setup_complete: false, admin_created: false }));
  useEffect(() => {
    refresh();
    const h = setInterval(refresh, 15000);
    return () => clearInterval(h);
  }, []);
  return { status, refresh };
}

function Shell() {
  const { dark, toggle } = useAppTheme();
  const [navOpen, setNavOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const { history, unread, refresh: refreshNotif, markRead, clear } = useNotifications();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const { status, refresh } = useSetupStatus();
  const navigate = useNavigate();

  useEffect(() => {
    api
      .get<{ authenticated: boolean }>("/setup/me")
      .then((r) => setAuthed(r.authenticated))
      .catch(() => setAuthed(false));
  }, []);

  if (authed === null || status === null) return null;

  // PRD §2.1: forced setup before dashboard
  if (!status.setup_complete || !authed) {
    return (
      <SetupWizard
        needLogin={authed === false && status.admin_created}
        onDone={() => {
          refresh();
          setAuthed(true);
          navigate("/");
        }}
      />
    );
  }

  return (
    <>
      <Header aria-label="Sailfish">
        <HeaderGlobalAction
          aria-label="Toggle navigation"
          onClick={() => setNavOpen((o) => !o)}
        >
          <Menu />
        </HeaderGlobalAction>
        <img
          src="/favicon.svg"
          alt="Sailfish home"
          title="Home"
          width={26}
          height={26}
          style={{ marginLeft: "0.25rem", flexShrink: 0, cursor: "pointer" }}
          onClick={() => navigate("/")}
        />
        <HeaderName prefix="" onClick={() => navigate("/")} style={{ cursor: "pointer" }}>
          Sailfish
        </HeaderName>
        <HeaderNavigation aria-label="Main">
          <HeaderMenuItem onClick={() => navigate("/")}>Home</HeaderMenuItem>
          <HeaderMenuItem onClick={() => navigate("/")}>Dashboard</HeaderMenuItem>
          <HeaderMenuItem onClick={() => navigate("/infrastructure")}>Infrastructure</HeaderMenuItem>
          <HeaderMenuItem onClick={() => navigate("/router")}>Router</HeaderMenuItem>
          <HeaderMenuItem onClick={() => navigate("/models")}>Models</HeaderMenuItem>
          <HeaderMenuItem onClick={() => navigate("/settings")}>Settings</HeaderMenuItem>
        </HeaderNavigation>
        <HeaderGlobalBar>
          <HeaderGlobalAction
            aria-label="Notifications"
            onClick={() => {
              setPanelOpen((o) => {
                if (!o) {
                  markRead();
                  refreshNotif();
                }
                return !o;
              });
            }}
          >
            <span className="sf-bell-wrap">
              <MegaphoneIcon />
              {unread > 0 && (
                <span className="sf-bell-badge">{unread > 9 ? "9+" : unread}</span>
              )}
            </span>
          </HeaderGlobalAction>
          <HeaderGlobalAction aria-label="Toggle theme" onClick={toggle}>
            {dark ? <Awake /> : <Asleep />}
          </HeaderGlobalAction>
          <HeaderGlobalAction
            aria-label="Sign out"
            onClick={async () => {
              await api.post("/setup/logout");
              setAuthed(false);
              refresh();
            }}
          >
            <span
              style={{
                fontSize: "0.875rem",
                fontWeight: 700,
                color: "var(--cds-text-error, #da1e28)",
                whiteSpace: "nowrap",
              }}
            >
              Sign out
            </span>
          </HeaderGlobalAction>
        </HeaderGlobalBar>
        <SideNav aria-label="Side" isFixedNav expanded={navOpen} onOverlayClick={() => setNavOpen(false)}>
          <SideNavItems>
            <SideNavLink onClick={() => navigate("/")}>Home</SideNavLink>
            <SideNavLink onClick={() => navigate("/")}>Dashboard</SideNavLink>
            <SideNavLink onClick={() => navigate("/infrastructure")}>Infrastructure</SideNavLink>
            <SideNavLink onClick={() => navigate("/router")}>Router Rules</SideNavLink>
            <SideNavLink onClick={() => navigate("/models")}>Model Registry</SideNavLink>
            <SideNavLink onClick={() => navigate("/settings")}>Settings & Alerts</SideNavLink>
          </SideNavItems>
        </SideNav>
      </Header>
      {panelOpen && (
        <div className="sf-notif-panel" role="dialog" aria-label="Notifications">
          <div className="sf-notif-head">
            <strong>Notifications</strong>
            <div style={{ display: "flex", gap: "0.25rem" }}>
              <Button kind="ghost" size="sm" onClick={clear}>
                Clear
              </Button>
              <Button kind="ghost" size="sm" onClick={() => setPanelOpen(false)}>
                Close
              </Button>
            </div>
          </div>
          <div className="sf-notif-list">
            {history.length === 0 ? (
              <p className="sf-muted">No notifications yet.</p>
            ) : (
              history.map((h) => (
                <div key={h.id} className="sf-notif-item">
                  <Tag type={tagFor(h.kind) as any}>{h.title}</Tag>
                  <div>
                    <div>{h.subtitle}</div>
                    <div className="sf-muted">{new Date(h.ts).toLocaleString()}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
      <Content className={navOpen ? "sf-nav-open" : undefined}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/router" element={<RouterPage />} />
          <Route path="/models" element={<ModelsPage />} />
          <Route path="/infrastructure" element={<InfrastructurePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </Content>
    </>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <BrowserRouter>
          <Shell />
        </BrowserRouter>
      </ToastProvider>
    </ThemeProvider>
  );
}
