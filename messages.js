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

// Returns the new message row on success, false if sending failed, or
// the string "blocked" if the messages_block_contact_sharing trigger
// (migration_16.sql) rejected it - see armusMessageViolatesContactPolicy
// for the client-side check that normally catches this first.
//
// options:
//   attachmentUrl/attachmentType - a voice/photo/video attachment
//     (from armusUploadChatAttachment)
async function armusSendMessage(conversationId, body, options = {}) {

  const session = await armusGetSession();
  if (!session) return false;

  const row = { conversation_id: conversationId, sender_id: session.id, body: body || "" };
  if (options.attachmentUrl) {
    row.attachment_url = options.attachmentUrl;
    row.attachment_type = options.attachmentType;
  }

  const { data, error } = await armusSupabase
    .from("messages")
    .insert(row)
    .select()
    .single();

  if (error) {
    return error.message && error.message.includes("contact_sharing_blocked") ? "blocked" : false;
  }
  return data;
}

// Edits a message's text. Returns the updated row on success, false on
// a generic failure, or "denied"/"expired" for the two specific cases
// the messages_enforce_edit_rules trigger (migration_20.sql) rejects -
// only the original sender can edit, and only within 2 minutes of
// sending. That trigger is the real enforcement; callers should also
// hide the edit affordance client-side once a message ages past that
// window instead of relying on this error.
async function armusEditMessage(messageId, newBody) {

  const { data, error } = await armusSupabase
    .from("messages")
    .update({ body: newBody })
    .eq("id", messageId)
    .select()
    .single();

  if (error) {
    if (error.message && error.message.includes("message_edit_denied")) return "denied";
    if (error.message && error.message.includes("message_edit_expired")) return "expired";
    return false;
  }
  return data;
}

function armusAttachmentTypeForFile(file) {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return null;
}

// Uploads a photo/video/voice-recording file to the chat-attachments
// bucket and returns { url, type }, or false if the upload failed or
// the file isn't an image/video/audio type. Each path is unique
// (conversation + sender + timestamp), so this never needs upsert.
async function armusUploadChatAttachment(file, conversationId) {

  const session = await armusGetSession();
  if (!session) return false;

  const type = armusAttachmentTypeForFile(file);
  if (!type) return false;

  const ext = file.name && file.name.includes(".") ? file.name.split(".").pop() : (type === "audio" ? "webm" : "bin");
  const path = `${conversationId}/${session.id}-${Date.now()}.${ext}`;

  const { error } = await armusSupabase.storage
    .from("chat-attachments")
    .upload(path, file, { contentType: file.type || undefined });

  if (error) return false;

  const { data } = armusSupabase.storage.from("chat-attachments").getPublicUrl(path);
  return { url: data.publicUrl, type };
}

// Same heuristic the messages_block_contact_sharing DB trigger enforces
// (migration_16.sql) - checked client-side too so a blocked message
// shows a clear inline reason instead of a generic "couldn't send"
// error. The trigger is the real enforcement (this can't be bypassed by
// skipping the UI); this is just a friendlier first line.
function armusMessageViolatesContactPolicy(text) {

  if (/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(text)) return true;

  // a run of 8+ digits, allowing up to 2 non-digit separators between
  // consecutive digits - catches phone numbers written as "0532 111 22 33",
  // "+90-532-111-22-33", etc. without flagging unrelated short numbers.
  if (/(\d[\s\-.()]{0,2}){7,}\d/.test(text)) return true;

  const keywords = [
    "whatsapp", "telegram", "instagram", "insta", "snapchat", "imo", "viber", "signal",
    "numaram", "numarayı", "numarası", "telefonum", "e-posta", "eposta",
    "gmail", "hotmail", "outlook",
  ];
  const lower = text.toLowerCase();
  return keywords.some(kw => lower.includes(kw));
}

// Whether the current user already has a booking with otherId - once
// they do, the contact-sharing restriction lifts (see migration_16.sql).
async function armusHasBookingWithOtherParty(otherId) {

  const session = await armusGetSession();
  if (!session) return false;

  const studentId = session.role === "student" ? session.id : otherId;
  const teacherId = session.role === "student" ? otherId : session.id;

  const { data, error } = await armusSupabase
    .from("bookings")
    .select("id")
    .eq("student_id", studentId)
    .eq("teacher_id", teacherId)
    .limit(1);

  if (error) return false;
  return Boolean(data && data.length);
}

async function armusMarkMessagesRead(conversationId, myUserId) {
  await armusSupabase
    .from("messages")
    .update({ read_at: new Date().toISOString() })
    .eq("conversation_id", conversationId)
    .neq("sender_id", myUserId)
    .is("read_at", null);
}

// Calls onInsert(messageRow) whenever a new message arrives, and
// onUpdate(messageRow) (optional) whenever one is edited or its read_at
// changes, in this conversation. Returns the channel, so the caller can
// unsubscribe (armusSupabase.removeChannel(channel)) when leaving the
// page/thread.
function armusSubscribeToMessages(conversationId, onInsert, onUpdate) {

  const channel = armusSupabase
    .channel(`messages-${conversationId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
      payload => onInsert(payload.new)
    );

  if (onUpdate) {
    channel.on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
      payload => onUpdate(payload.new)
    );
  }

  return channel.subscribe();
}
