import { supabase } from './supabase';

// "Arkadaşını davet et" - the website's referral programme (referral.html):
// a friend who signs up through your link and takes their first lesson
// earns you a free lesson with the same teacher.
export const SITE_URL = 'https://armus.com.tr';

export function referralLink(code: string | null | undefined): string | null {
  return code ? `${SITE_URL}/register?ref=${encodeURIComponent(code)}` : null;
}

// how many free lessons the invitations have earned so far
export async function getReferralRewardCount(userId: string): Promise<number> {
  const { data, error } = await supabase.from('referrals').select('id').eq('referrer_id', userId).eq('status', 'rewarded');
  if (error) return 0;
  return (data || []).length;
}
