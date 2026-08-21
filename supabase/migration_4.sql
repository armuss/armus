-- ARMUS migration 4: admins can read every booking (needed for the
-- admin panel's reservations tab), not just ones they're a
-- participant in.

create policy "bookings_select_admin_all"
  on bookings for select
  using (public.is_admin());
