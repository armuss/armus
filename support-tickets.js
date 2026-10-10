/*
 * ARMUS - internal support tickets between a teacher and the ARMUS
 * admin team (migration_97.sql). Used by both dashboard.html's "Destek"
 * panel and admin.html's "Destek Talepleri" panel.
 * Requires supabase-config.js (Supabase SDK + armusSupabase client) to be
 * loaded before this file.
 */

async function armusGetMyTickets(teacherId) {
  const { data, error } = await armusSupabase
    .from("support_tickets")
    .select("*")
    .eq("teacher_id", teacherId)
    .order("updated_at", { ascending: false });

  if (error || !data) return [];
  return data;
}

async function armusGetTicketMessages(ticketId) {
  const { data, error } = await armusSupabase
    .from("support_ticket_messages")
    .select("*")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true });

  if (error || !data) return [];
  return data;
}

async function armusCreateTicket(teacherId, subject, firstMessageBody) {
  const { data: ticket, error } = await armusSupabase
    .from("support_tickets")
    .insert({ teacher_id: teacherId, subject })
    .select()
    .single();

  if (error || !ticket) return false;

  const { error: msgError } = await armusSupabase
    .from("support_ticket_messages")
    .insert({ ticket_id: ticket.id, sender_id: teacherId, sender_role: "teacher", body: firstMessageBody });

  if (msgError) return false;
  return ticket;
}

async function armusSendTicketMessage(ticketId, senderId, senderRole, body) {
  const { data, error } = await armusSupabase
    .from("support_ticket_messages")
    .insert({ ticket_id: ticketId, sender_id: senderId, sender_role: senderRole, body })
    .select()
    .single();

  if (error || !data) return false;
  return data;
}

async function armusSetTicketStatus(ticketId, status) {
  const { error } = await armusSupabase
    .from("support_tickets")
    .update({ status })
    .eq("id", ticketId);

  return !error;
}
