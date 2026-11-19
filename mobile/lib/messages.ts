import type { RealtimeChannel } from '@supabase/supabase-js';

import { supabase } from './supabase';
import { tr } from './i18n';

export type AttachmentType = 'image' | 'video' | 'audio';

export type Message = {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  // a photo, video or voice message sent from the website (mesajlar.html) -
  // such a message often has no text at all (body '')
  attachmentUrl: string | null;
  attachmentType: AttachmentType | null;
  readAt: string | null;
  createdAt: string;
  // the sender corrected it on the website (within 2 minutes) - shown as
  // "(düzenlendi)" like mesajlar.html
  editedAt: string | null;
};

function mapMessageRow(row: any): Message {
  const url = typeof row.attachment_url === 'string' && /^https:\/\//i.test(row.attachment_url) ? row.attachment_url : null;
  const type = row.attachment_type === 'image' || row.attachment_type === 'video' || row.attachment_type === 'audio' ? row.attachment_type : null;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    body: row.body || '',
    attachmentUrl: url && type ? url : null,
    attachmentType: url && type ? type : null,
    readAt: row.read_at,
    createdAt: row.created_at,
    editedAt: row.edited_at || null,
  };
}

let channelSeq = 0;
// A realtime topic of its own for every subscription. supabase-js hands
// back the EXISTING channel for a topic it already has, and adding
// listeners to a channel that has already joined throws - so a second
// chat screen for the same conversation (a tapped message notification
// while that chat is open) crashed, and reopening a chat right after
// leaving it could get the old, closing channel and no live messages.
function uniqueTopic(base: string) {
  channelSeq += 1;
  return `${base}-${Date.now().toString(36)}-${channelSeq}`;
}

// The conversation list's preview of a message without text - the
// website's attachmentPreviewLabel (mesajlar.html)
export function attachmentPreviewLabel(type: string | null | undefined) {
  if (type === 'image') return tr("📷 Fotoğraf");
  if (type === 'video') return tr("🎥 Video");
  if (type === 'audio') return tr("🎤 Sesli mesaj");
  return tr("Mesaj");
}

export type Conversation = {
  id: string;
  otherId: string;
  otherName: string;
  otherPhoto: string | null;
  lastMessageText: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
};

// null when the list couldn't be loaded (so the screen can say so instead
// of showing "no messages yet")
export async function getConversations(userId: string): Promise<Conversation[] | null> {
  const { data: conversations, error } = await supabase
    .from('conversations')
    .select('*')
    .or(`student_id.eq.${userId},teacher_id.eq.${userId}`);

  if (error || !conversations) return null;
  if (!conversations.length) return [];

  const otherIds = conversations.map((c: any) => (c.student_id === userId ? c.teacher_id : c.student_id));

  const [{ data: profiles }, { data: previews, error: previewsError }] = await Promise.all([
    // masked_profiles, not the raw profiles table - a teacher's full
    // real name must never be shown to a student (see displayName.ts's
    // shortDisplayName), so a student can't take that name off ARMUS
    // and contact them elsewhere. The raw table only masks nothing -
    // it's RLS-readable here (profiles_select_conversation_partner)
    // precisely because this app used to rely on masking it client-side
    // only, which still ships the real name over the wire in the raw
    // JSON response even though the UI re-shortens it before rendering.
    supabase.from('masked_profiles').select('id, name, photo_url').in('id', otherIds),
    // each conversation's last message and unread count, worked out by
    // the database (migration_89.sql, what messages.js uses). This list
    // used to download every message of every conversation - and the API
    // returns at most 1000 rows, oldest first, so for anyone with more
    // than that the newest messages were cut off: wrong previews, wrong
    // order and unread counts that never showed new messages.
    supabase.rpc('conversation_previews'),
  ]);

  if (previewsError) return null;

  const profileById = Object.fromEntries((profiles || []).map((p: any) => [p.id, p]));
  const previewByConvo = Object.fromEntries((previews || []).map((p: any) => [p.conversation_id, p]));

  return conversations
    .map((c: any) => {
      const otherId = c.student_id === userId ? c.teacher_id : c.student_id;
      const otherProfile = profileById[otherId] || {};
      const preview = previewByConvo[c.id] || null;
      const hasLast = !!(preview && preview.last_message_id);

      return {
        id: c.id,
        otherId,
        // a profile without a name used to crash the whole Messages tab
        // (its first letter is the avatar)
        otherName: otherProfile.name || tr("Kullanıcı"),
        otherPhoto: otherProfile.photo_url || null,
        lastMessageText: hasLast ? preview.last_message_body || attachmentPreviewLabel(preview.last_message_attachment_type) : null,
        lastMessageAt: hasLast ? preview.last_message_created_at : null,
        unreadCount: preview ? Number(preview.unread_count) || 0 : 0,
      };
    })
    .sort((a, b) => (b.lastMessageAt || '0').localeCompare(a.lastMessageAt || '0'));
}

// Finds the existing conversation between the current user and
// otherUserId, or creates one. Returns the conversation row, or null if
// it couldn't be created/found.
export async function getOrCreateConversation(
  myId: string,
  myRole: 'student' | 'teacher',
  otherUserId: string
): Promise<{ id: string } | null> {
  const studentId = myRole === 'student' ? myId : otherUserId;
  const teacherId = myRole === 'student' ? otherUserId : myId;

  const { data: existing } = await supabase
    .from('conversations')
    .select('*')
    .eq('student_id', studentId)
    .eq('teacher_id', teacherId)
    .maybeSingle();

  if (existing) return existing as { id: string };

  const { data, error } = await supabase
    .from('conversations')
    .insert({ student_id: studentId, teacher_id: teacherId })
    .select()
    .single();

  if (!error) return data as { id: string };

  // 23505 = unique_violation (student_id, teacher_id): a second tap (or the
  // website) created it between the check above and this insert - it
  // exists now, so open it rather than fail. Same as messages.js.
  if (error.code === '23505') {
    const { data: nowExisting } = await supabase
      .from('conversations')
      .select('*')
      .eq('student_id', studentId)
      .eq('teacher_id', teacherId)
      .maybeSingle();
    if (nowExisting) return nowExisting as { id: string };
  }
  return null;
}

// null when the conversation couldn't be loaded (a failed load used to
// look like an empty conversation)
export async function getMessages(conversationId: string): Promise<Message[] | null> {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (error || !data) return null;
  return data.map(mapMessageRow);
}

// Returns the new message on success, null on a generic failure, or
// "blocked" if the messages_block_contact_sharing DB trigger rejected it
// (see messageViolatesContactPolicy for the client-side check that
// normally catches this first).
export async function sendMessage(
  conversationId: string,
  senderId: string,
  body: string
): Promise<Message | null | 'blocked'> {
  const { data, error } = await supabase
    .from('messages')
    .insert({ conversation_id: conversationId, sender_id: senderId, body })
    .select()
    .single();

  if (error) {
    return error.message && error.message.includes('contact_sharing_blocked') ? 'blocked' : null;
  }
  return mapMessageRow(data);
}

export async function markMessagesRead(conversationId: string, myUserId: string) {
  await supabase
    .from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .neq('sender_id', myUserId)
    .is('read_at', null);
}

// Calls onInsert whenever a new message arrives in this conversation, and
// onUpdate when one changes - the website lets the sender correct a message
// for 2 minutes (mesajlar.html), and the open chat kept showing the old text.
// Returns the channel so the caller can supabase.removeChannel(channel)
// when leaving the thread.
export function subscribeToMessages(
  conversationId: string,
  onInsert: (message: Message) => void,
  onUpdate?: (message: Message) => void
): RealtimeChannel {
  const filter = `conversation_id=eq.${conversationId}`;
  return supabase
    .channel(uniqueTopic(`messages-${conversationId}`))
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter }, (payload) =>
      onInsert(mapMessageRow(payload.new))
    )
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter }, (payload) =>
      onUpdate?.(mapMessageRow(payload.new))
    )
    .subscribe();
}

// Whether the current user already has a confirmed (non-cancelled) booking
// with otherId - once they do, the contact-sharing restriction lifts
// (migration_16.sql / migration_36.sql, armusHasBookingWithOtherParty).
export async function hasBookingWithOtherParty(
  myId: string,
  myRole: 'student' | 'teacher',
  otherId: string
): Promise<boolean> {
  const studentId = myRole === 'student' ? myId : otherId;
  const teacherId = myRole === 'student' ? otherId : myId;

  const { data, error } = await supabase
    .from('bookings')
    .select('id')
    .eq('student_id', studentId)
    .eq('teacher_id', teacherId)
    // only a confirmed (not cancelled) booking lifts it, like the site
    .eq('status', 'confirmed')
    .limit(1);

  if (error) return false;
  return Boolean(data && data.length);
}

// Same heuristic the messages_block_contact_sharing DB trigger enforces
// (enforce_no_contact_sharing) - checked client-side too so a blocked
// message shows a clear inline reason instead of a generic send failure.
// Word for word the website's armusMessageViolatesContactPolicy
// (messages.js), which matches the trigger's own regex: "insta" and "imo"
// only as whole words (so "instant", "limousine" pass), and the
// "numaray"/"numaras" stems (so "numarayla" is caught too).
export function messageViolatesContactPolicy(text: string): boolean {
  if (/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(text)) return true;

  // a run of 8+ digits, allowing up to 2 non-digit separators between
  // consecutive digits - catches phone numbers written as "0532 111 22 33",
  // "+90-532-111-22-33", etc. without flagging unrelated short numbers.
  if (/(\d[\s\-.()]{0,2}){7,}\d/.test(text)) return true;

  if (/whatsapp|telegram|instagram|\binsta\b|snapchat|\bimo\b|viber|signal|numaram|numaray|numaras|telefonum|e-?posta|eposta|gmail|hotmail|outlook/i.test(text)) return true;

  return false;
}
