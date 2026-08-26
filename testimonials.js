/*
 * ARMUS - homepage testimonials, managed from the admin panel.
 * Requires supabase-config.js (Supabase SDK + armusSupabase client) to be
 * loaded before this file.
 */

// Public: published testimonials for the homepage, in display order.
// Returns [] (not an error) if the table doesn't exist yet or is empty -
// callers are expected to fall back to the static hardcoded testimonials.
async function armusGetPublishedTestimonials() {
  const { data, error } = await armusSupabase
    .from("testimonials")
    .select("*")
    .eq("is_published", true)
    .order("display_order", { ascending: true });

  if (error || !data) return [];
  return data;
}

// Admin: every testimonial, published or not, in display order.
async function armusAdminGetAllTestimonials() {
  const { data, error } = await armusSupabase
    .from("testimonials")
    .select("*")
    .order("display_order", { ascending: true });

  if (error || !data) return [];
  return data;
}

async function armusAdminCreateTestimonial(fields) {
  const { data, error } = await armusSupabase
    .from("testimonials")
    .insert(fields)
    .select()
    .single();

  if (error) return false;
  return data;
}

async function armusAdminUpdateTestimonial(id, fields) {
  const { data, error } = await armusSupabase
    .from("testimonials")
    .update(fields)
    .eq("id", id)
    .select()
    .single();

  if (error) return false;
  return data;
}

async function armusAdminDeleteTestimonial(id) {
  const { error } = await armusSupabase.from("testimonials").delete().eq("id", id);
  return !error;
}
