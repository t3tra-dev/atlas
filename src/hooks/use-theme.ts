import * as React from "react";

export type ThemeMode = "system" | "light" | "dark";

type ResolvedTheme = "light" | "dark";

const THEME_STORAGE_KEY = "theme";

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(resolvedTheme: ResolvedTheme) {
  document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
}

export function useTheme() {
  const [theme, setTheme] = React.useState<ThemeMode>("system");
  const [resolvedTheme, setResolvedTheme] = React.useState<ResolvedTheme>("light");

  React.useEffect(() => {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null;
    const initialTheme = stored ?? "system";
    setTheme(initialTheme);
    const nextResolved = initialTheme === "system" ? getSystemTheme() : initialTheme;
    setResolvedTheme(nextResolved);
    applyTheme(nextResolved);
  }, []);

  React.useEffect(() => {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    const nextResolved = theme === "system" ? getSystemTheme() : theme;
    setResolvedTheme(nextResolved);
    applyTheme(nextResolved);
  }, [theme]);

  React.useEffect(() => {
    if (theme !== "system") return;

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      const nextResolved = getSystemTheme();
      setResolvedTheme(nextResolved);
      applyTheme(nextResolved);
    };

    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, [theme]);

  return { theme, setTheme, resolvedTheme };
}
