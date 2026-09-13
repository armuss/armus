import { supabase } from './supabase';

export type Dispute = {
  id: string;
  bookingId: string | null;
  reporterId: string;
  reporterName: string;
  reporterRole: string;
  otherPartyName: string;
  subject: string;
  description: string;
  status: 'open' | 'in_progress' | 'resolved';
  createdAt: string;
};

function mapDisputeRow(row: any): Dispute {
  return {
    id: row.id,
    bookingId: row.booking_id,
    reporterId: row.reporter_id,
    reporterName: row.reporter_name,
    reporterRole: row.reporter_role,
    otherPartyName: row.other_party_name,
    subject: row.subject,
    description: row.description,
    status: row.status || 'open',
    createdAt: row.created_at,
  };
}

export async function createDispute(params: {
  bookingId: string;
  reporterId: string;
  reporterName: string;
  reporterRole: string;
  otherPartyName: string;
  subject: string;
  description: string;
}): Promise<Dispute | null> {
  const { data, error } = await supabase
    .from('disputes')
    .insert({
      booking_id: params.bookingId,
      reporter_id: params.reporterId,
      reporter_name: params.reporterName,
      reporter_role: params.reporterRole,
      other_party_name: params.otherPartyName,
      subject: params.subject,
      description: params.description,
    })
    .select()
    .single();

  if (error) return null;
  return mapDisputeRow(data);
}

// The reporting user's own disputes (mirrors my-lessons.html's "your
// reports so far" - one dispute can be attached per booking).
export async function getOwnDisputes(reporterId: string): Promise<Dispute[]> {
  const { data, error } = await supabase
    .from('disputes')
    .select('*')
    .eq('reporter_id', reporterId)
    .order('created_at', { ascending: false });

  if (error || !data) return [];
  return data.map(mapDisputeRow);
}
