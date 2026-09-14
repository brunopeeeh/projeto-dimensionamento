import { createContext, useContext, useEffect, type ReactNode } from "react";

export type Theme = "dark";

interface ThemeContextType {
  theme: "dark";
  toggleTheme: () => void;
  setTheme: (theme: "dark") => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: "dark",
  toggleTheme: () => {},
  setTheme: () => {},
});

export const THEME_STORAGE_KEY = "dimensionamento_theme";

export function ThemeProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("dark");

    try {
      localStorage.setItem(THEME_STORAGE_KEY, "dark");

      const metaStr = localStorage.getItem("escala_ops_v1_meta");
      if (metaStr) {
        const meta = JSON.parse(metaStr);
        if (meta && meta.settings && meta.settings.theme !== "dark") {
          meta.settings.theme = "dark";
          localStorage.setItem("escala_ops_v1_meta", JSON.stringify(meta));
        }
      }
    } catch {
      // Ignore localStorage errors
    }
  }, []);

  return (
    <ThemeContext.Provider
      value={{
        theme: "dark",
        toggleTheme: () => {},
        setTheme: () => {},
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
