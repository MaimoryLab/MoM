import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { dicts, type Lang } from './dict';

const STORAGE_KEY = 'mom-dashboard-lang';

type Ctx = {
  lang: Lang;
  t: typeof dicts.en;
  setLang: (lang: Lang) => void;
  toggle: () => void;
};

const I18nContext = createContext<Ctx | null>(null);

function readInitial(): Lang {
  if (typeof window === 'undefined') return 'en';
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === 'zh' || saved === 'en') return saved;
  const nav = window.navigator.language.toLowerCase();
  return nav.startsWith('zh') ? 'zh' : 'en';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readInitial);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, lang);
      document.documentElement.setAttribute('lang', lang === 'zh' ? 'zh-CN' : 'en');
    } catch {
      /* ignore */
    }
  }, [lang]);

  const setLang = useCallback((next: Lang) => setLangState(next), []);
  const toggle = useCallback(() => setLangState((l) => (l === 'zh' ? 'en' : 'zh')), []);

  const value = useMemo<Ctx>(
    () => ({ lang, t: dicts[lang], setLang, toggle }),
    [lang, setLang, toggle],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): Ctx {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}
