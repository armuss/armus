import type { RealtimeChannel } from '@supabase/supabase-js';

import { supabase } from './supabase';

export type Message = {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  readAt: string | null;
  createdAt: string;
};

function mapMessageRow(row: any): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    body: row.body,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
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

export async function getConversations(userId: string): Promise<Conversation[]> {
  const { data: conversations, error } = await supabase
    .from('conversations')
    .select('*')
    .or(`student_id.eq.${userId},teacher_id.eq.${userId}`);

  if (error || !conversations || !conversations.length) return [];

  const otherIds = conversations.map((c: any) => (c.student_id === userId ? c.teacher_id : c.student_id));

  const [{ data: profiles }, { data: allMessages }] = await Promise.all([
    supabase.from('profiles').select('id, name, photo_url').in('id', otherIds),
    supabase
      .from('messages')
      .select('*')
      .in(
        'conversation_id',
        conversations.map((c: any) => c.id)
      )
      .order('created_at', { ascending: true }),
  ]);

  const profileById = Object.fromEntries((profiles || []).map((p: any) => [p.id, p]));

  return conversations
    .map((c: any) => {
      const otherId = c.student_id === userId ? c.teacher_id : c.student_id;
      const otherProfile = profileById[otherId] || { name: 'Kullanıcı', photo_url: null };
      const convoMessages = (allMessages || []).filter((m: any) => m.conversation_id === c.id);
      const lastMessage = convoMessages[convoMessages.length - 1] || null;
      const unreadCount = convoMessages.filter((m: any) => m.sender_id !== userId && !m.read_at).length;

      return {
        id: c.id,
        otherId,
        otherName: otherProfile.name,
        otherPhoto: otherProfile.photo_url,
        lastMessageText: lastMessage?.body ?? null,
        lastMessageAt: lastMessage?.created_at ?? null,
        unreadCount,
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

  if (error) return null;
  return data as { id: string };
}

export async function getMessages(conversationId: string): Promise<Message[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (error || !data) return [];
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

// Calls onInsert whenever a new message arrives in this conversation.
// Returns the channel so the caller can supabase.removeChannel(channel)
// when leaving the thread.
export function subscribeToMessages(conversationId: string, onInsert: (message: Message) => void): RealtimeChannel {
  return supabase
    .channel(`messages-${conversationId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
      (payload) => onInsert(mapMessageRow(payload.new))
    )
    .subscribe();
}

// Whether the current user already has a booking with otherId - once they
// do, the contact-sharing restriction lifts (matches migration_16.sql).
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
    .limit(1);

  if (error) return false;
  return Boolean(data && data.length);
}

// Same heuristic the messages_block_contact_sharing DB trigger enforces -
// checked client-side too so a blocked message shows a clear inline
// reason instead of a generic send failure. The trigger is the real
// enforcement; this is just a friendlier first line.
export function messageViolatesContactPolicy(text: string): boolean {
  if (/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(text)) return true;

  // a run of 8+ digits, allowing up to 2 non-digit separators between
  // consecutive digits - catches phone numbers written as "0532 111 22 33" etc.
  if (/(\d[\s\-.()]{0,2}){7,}\d/.test(text)) return true;

  const keywords = [
    'whatsapp', 'telegram', 'instagram', 'insta', 'snapchat', 'imo', 'viber', 'signal',
    'numaram', 'numarayı', 'numarası', 'telefonum', 'e-posta', 'eposta',
    'gmail', 'hotmail', 'outlook',
  ];
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw));
}
