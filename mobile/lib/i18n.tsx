import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { EN } from './translations/en';

/**
 * The app speaks Turkish and English, like the website (i18n.js).
 *
 *   - The first time it opens, it follows the phone: a phone set to
 *     Turkish gets Turkish, any other language gets English.
 *   - Once the person picks a language (on the welcome screen or in
 *     Profil -> Dil · Language), that choice is kept on this phone.
 *
 * Texts are written in Turkish in the code and looked up in EN (Turkish
 * text -> English text) when the app is in English, so a screen reads
 * `t('Kaydet')`. A text with values in it uses numbered slots:
 * `t('{0} kelime', count)`. An English entry can be a pair
 * `[one, other]` for words that change with the number ("1 word",
 * "7 words") - picked by the first value.
 *
 * Screens call `useT()` (so they redraw when the language changes);
 * helpers that run while a screen draws use `tr()`.
 */

export type Lang = 'tr' | 'en';

const STORAGE_KEY = 'armusLang';

/** The phone's own language decides the first language: Turkish -> tr, anything else -> en. */
export function deviceLang(): Lang {
  try {
    const first = getLocales()[0];
    return (first?.languageCode || '').toLowerCase() === 'tr' ? 'tr' : 'en';
  } catch {
    return 'tr';
  }
}

let current: Lang = deviceLang();

export function getLang(): Lang {
  return current;
}

/** The locale for dates and numbers in the current language. */
export function getLocale(): string {
  return current === 'en' ? 'en-GB' : 'tr-TR';
}

type Arg = string | number | null | undefined;

function fill(text: string, args: Arg[]) {
  return text.replace(/\{(\d+)\}/g, (m, i) => {
    const v = args[Number(i)];
    return v === undefined || v === null ? '' : String(v);
  });
}

function lookup(key: string, args: Arg[]): string {
  if (current === 'tr') return fill(key, args);
  // the surrounding spaces of a text belong to the layout, not the words
  const m = key.match(/^(\s*)([\s\S]*?)(\s*)$/);
  const lead = m ? m[1] : '';
  const core = m ? m[2] : key;
  const tail = m ? m[3] : '';
  const entry = EN[core];
  if (entry === undefined) return fill(key, args);
  const text = Array.isArray(entry) ? (Number(args[0]) === 1 ? entry[0] : entry[1]) : entry;
  return lead + fill(text, args) + tail;
}

/** Translate outside a component (a helper called while a screen draws, an alert). */
export function tr(key: string, ...args: Arg[]): string {
  if (typeof key !== 'string') return key;
  return lookup(key, args);
}

export type T = (key: string, ...args: Arg[]) => string;

type LangState = { lang: Lang; setLang: (lang: Lang) => void; t: T; ready: boolean; chosen: boolean };

const LangContext = createContext<LangState>({
  lang: current,
  setLang: () => {},
  t: tr,
  ready: false,
  chosen: false,
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(current);
  const [ready, setReady] = useState(false);
  const [chosen, setChosen] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((saved) => {
        if (saved === 'tr' || saved === 'en') {
          current = saved;
          setLangState(saved);
          setChosen(true);
        }
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  const setLang = useCallback((next: Lang) => {
    current = next;
    setLangState(next);
    setChosen(true);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  }, []);

  // a new function per language, so anything holding on to `t` (a list's
  // extraData, a memo) knows to redraw
  const t = useMemo<T>(() => (key: string, ...args: Arg[]) => lookup(key, args), [lang]);

  const value = useMemo(() => ({ lang, setLang, t, ready, chosen }), [lang, setLang, t, ready, chosen]);
  // the saved choice is read before anything draws, so the app never
  // flashes in the other language (the launch screen is still showing)
  if (!ready) return null;
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

/** The translate function for a screen; the screen redraws when the language changes. */
export function useT(): T {
  return useContext(LangContext).t;
}

export function useLang() {
  return useContext(LangContext);
}
