import { EN_APP } from './en-app';
import { EN_SITE } from './en-site';

/** Turkish text -> English text for the whole app (the app's own entries win). */
export const EN: Record<string, string | [string, string]> = { ...EN_SITE, ...EN_APP };
