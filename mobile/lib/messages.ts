import { supabase } from './supabase';

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
