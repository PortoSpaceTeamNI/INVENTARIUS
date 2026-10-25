import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { type Dict, en } from "./en";
import { pt } from "./pt";

export type { Dict } from "./en";
export type Lang = "pt" | "en";

const dicts: Record<Lang, Dict> = { pt, en };
const LANG_KEY = "inventarius.lang";

/** The saved choice, else the browser's language (pt* → PT, anything else → EN). */
function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === "pt" || saved === "en") return saved;
  } catch {
    // storage unavailable
  }
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
  return langs[0]?.toLowerCase().startsWith("pt") ? "pt" : "en";
}

// Helpers outside components (lib.ts formatting) read the current language
// from here; components re-render through the context when it changes.
let current: Lang = typeof navigator === "undefined" ? "en" : initialLang();

/** The dictionary for the current language, for code outside components. */
export const dict = (): Dict => dicts[current];

const LangCtx = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({
  lang: current,
  setLang: () => {},
});

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(current);
  const setLang = useCallback((l: Lang) => {
    current = l;
    try {
      localStorage.setItem(LANG_KEY, l);
    } catch {
      // storage unavailable
    }
    setLangState(l);
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang === "pt" ? "pt-PT" : "en";
  }, [lang]);
  return <LangCtx.Provider value={{ lang, setLang }}>{children}</LangCtx.Provider>;
}

export const useLang = () => useContext(LangCtx);

/** The UI text in the chosen language. */
export const useT = (): Dict => dicts[useContext(LangCtx).lang];

/** PT | EN switch. "dark" suits the sidebar. */
export function LangToggle({ tone }: { tone?: "dark" }) {
  const { lang, setLang } = useLang();
  const t = useT();
  return (
    <div className={`lang-toggle ${tone ?? ""}`} role="radiogroup" aria-label={t.lang.label}>
      {(["pt", "en"] as const).map((l) => (
        <button
          key={l}
          type="button"
          role="radio"
          aria-checked={lang === l}
          className={lang === l ? "on" : ""}
          onClick={() => setLang(l)}
          title={l === "pt" ? t.lang.ptName : t.lang.enName}
          lang={l === "pt" ? "pt-PT" : "en"}
        >
          {l === "pt" ? t.lang.pt : t.lang.en}
        </button>
      ))}
    </div>
  );
}
