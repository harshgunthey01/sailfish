import React, { createContext, useContext, useMemo, useState } from "react";
import { Theme } from "@carbon/react";

interface ThemeCtx {
  dark: boolean;
  toggle: () => void;
}

const Ctx = createContext<ThemeCtx>({ dark: true, toggle: () => {} });

export function useAppTheme() {
  return useContext(Ctx);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem("sf-theme");
    return saved ? saved === "dark" : true; // PRD: default g100 dark
  });

  const value = useMemo(
    () => ({
      dark,
      toggle: () =>
        setDark((d) => {
          localStorage.setItem("sf-theme", d ? "light" : "dark");
          return !d;
        }),
    }),
    [dark]
  );

  return (
    <Ctx.Provider value={value}>
      <Theme theme={dark ? "g100" : "g10"}>{children}</Theme>
    </Ctx.Provider>
  );
}
