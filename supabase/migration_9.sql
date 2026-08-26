-- Migration 9: collect city on signup, for the admin panel's city
-- breakdown. Run this once in Supabase Dashboard -> SQL Editor -> New
-- query -> Run. Safe to run once; running it a second time will fail on
-- "already exists" for the column, which is expected (the function
-- replace is safe to rerun).

alter table profiles add column city text;

-- Update the signup trigger to also copy city out of the signUp() call's
-- options.data, same as name/role already work.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, role, city)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', ''),
    coalesce(new.raw_user_meta_data->>'role', 'student'),
    new.raw_user_meta_data->>'city'
  );
  return new;
end;
$$;
