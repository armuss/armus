import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

// Same project the web app (supabase-config.js) talks to, so accounts
// created on the site or in the app both work everywhere.
const ARMUS_SUPABASE_URL = 'https://rwdxubadjbwdsmrmgmkr.supabase.co';
const ARMUS_SUPABASE_ANON_KEY = 'sb_publishable_JpGfg8-vY2dJf-2XOa3Law_o4Uzegci';

export const supabase = createClient(ARMUS_SUPABASE_URL, ARMUS_SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
