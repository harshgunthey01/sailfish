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
} from "@carbon/react";
import { Asleep, Awake, Menu } from "@carbon/icons-react";
import { ThemeProvider, useAppTheme } from "./theme";
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
          <HeaderGlobalAction aria-label="Toggle theme" onClick={toggle}>
            {dark ? <Awake /> : <Asleep />}
          </HeaderGlobalAction>
          <HeaderGlobalAction
            aria-label="Logout"
            onClick={async () => {
              await api.post("/setup/logout");
              setAuthed(false);
              refresh();
            }}
          >
            <span style={{ fontSize: "0.75rem" }}>exit</span>
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
      <BrowserRouter>
        <Shell />
      </BrowserRouter>
    </ThemeProvider>
  );
}
