import { supabase } from './supabase';

export type EdgeResult<T = any> =
  | { ok: true; data: T }
  | { ok: false; error: string | null; body: any };

// Calls an Edge Function and, on a non-2xx answer, reads the function's
// own JSON body - supabase-js hands that back only as error.context (a
// Response), so without this every specific server message ("Bu dersin
// zamanı geçti, iptal edilemez.", trialAlreadyTaken, ...) reads as the
// caller's generic fallback. Mirrors the web's armusEdgeErrorMessage (auth.js).
export async function invokeEdge<T = any>(name: string, body?: Record<string, unknown>): Promise<EdgeResult<T>> {
  const { data, error } = await supabase.functions.invoke(name, body ? { body } : undefined);
  if (!error && data && data.ok !== false && !data.error) return { ok: true, data };

  let errorBody: any = data ?? null;
  const context = (error as any)?.context;
  if (!errorBody && context && typeof context.json === 'function') {
    try {
      errorBody = await (typeof context.clone === 'function' ? context.clone() : context).json();
    } catch {
      errorBody = null;
    }
  }
  return { ok: false, error: (errorBody && typeof errorBody.error === 'string' && errorBody.error) || null, body: errorBody };
}
