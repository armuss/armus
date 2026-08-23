/*
 * ARMUS - real-time messaging between a student and a real (self-
 * registered) teacher. Requires supabase-config.js (armusSupabase)
 * and auth.js (armusGetSession) to be loaded first.
 */

// Finds the existing conversation between the current user and
// otherUserId, or creates one. Returns the conversation row, or false
// if it couldn't be created/found.
async function armusGetOrCreateConversation(otherUserId) {

  const session = await armusGetSession();
  if (!session) return false;

  const studentId = session.role === "student" ? session.id : otherUserId;
  const teacherId = session.role === "student" ? otherUserId : session.id;

  const { data: existing } = await armusSupabase
    .from("conversations")
    .select("*")
    .eq("student_id", studentId)
    .eq("teacher_id", teacherId)
    .maybeSingle();

  if (existing) return existing;

  const { data, error } = await armusSupabase
    .from("conversations")
    .insert({ student_id: studentId, teacher_id: teacherId })
    .select()
    .single();

  if (error) return false;
  return data;
}

// Every conversation the current user is a participant in, newest
// activity first, with the other participant's name/photo attached.
async function armusGetConversations() {

  const session = await armusGetSession();
  if (!session) return [];

  const { data: conversations, error } = await armusSupabase
    .from("conversations")
    .select("*")
    .or(`student_id.eq.${session.id},teacher_id.eq.${session.id}`);

  if (error || !conversations.length) return [];

  const otherIds = conversations.map(c =>
    c.student_id === session.id ? c.teacher_id : c.student_id
  );

  const [{ data: profiles }, { data: allMessages }] = await Promise.all([
    armusSupabase.from("profiles").select("id, name, photo_url").in("id", otherIds),
    armusSupabase
      .from("messages")
      .select("*")
      .in("conversation_id", conversations.map(c => c.id))
      .order("created_at", { ascending: true }),
  ]);

  const profileById = Object.fromEntries((profiles || []).map(p => [p.id, p]));

  return conversations
    .map(c => {
      const otherId = c.student_id === session.id ? c.teacher_id : c.student_id;
      const otherProfile = profileById[otherId] || { name: "Kullanıcı", photo_url: null };
      const convoMessages = (allMessages || []).filter(m => m.conversation_id === c.id);
      const lastMessage = convoMessages[convoMessages.length - 1] || null;
      const unreadCount = convoMessages.filter(m => m.sender_id !== session.id && !m.read_at).length;

      return {
        id: c.id,
        otherId,
        otherName: otherProfile.name,
        otherPhoto: otherProfile.photo_url,
        lastMessage,
        unreadCount,
      };
    })
    .sort((a, b) => {
      const aTime = a.lastMessage ? a.lastMessage.created_at : "0";
      const bTime = b.lastMessage ? b.lastMessage.created_at : "0";
      return bTime.localeCompare(aTime);
    });
}

async function armusGetMessages(conversationId) {

  const { data, error } = await armusSupabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error) return [];
  return data;
}

// Returns the new message row on success, or false if sending failed.
async function armusSendMessage(conversationId, body) {

  const session = await armusGetSession();
  if (!session) return false;

  const { data, error } = await armusSupabase
    .from("messages")
    .insert({ conversation_id: conversationId, sender_id: session.id, body })
    .select()
    .single();

  if (error) return false;
  return data;
}

async function armusMarkMessagesRead(conversationId, myUserId) {
  await armusSupabase
    .from("messages")
    .update({ read_at: new Date().toISOString() })
    .eq("conversation_id", conversationId)
    .neq("sender_id", myUserId)
    .is("read_at", null);
}

// Calls onInsert(messageRow) whenever a new message arrives in this
// conversation. Returns the channel, so the caller can unsubscribe
// (armusSupabase.removeChannel(channel)) when leaving the page/thread.
function armusSubscribeToMessages(conversationId, onInsert) {
  return armusSupabase
    .channel(`messages-${conversationId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
      payload => onInsert(payload.new)
    )
    .subscribe();
}
