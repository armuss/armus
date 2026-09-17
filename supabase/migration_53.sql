-- Adds a database-level floor under profiles.price. dashboard.html's own
-- price-change form only ever rejects 0/NaN (`Number(...) || 0`), not a
-- negative value, and admin.html's approval handler applies whatever was
-- submitted into pending_changes unfiltered. create-payment re-validates
-- price > 0 before ever charging a student, so this was never actually
-- chargeable - but a negative or zero price could still sit in
-- profiles.price and show broken (e.g. "₺-100") on that teacher's public
-- listing until someone tried to book them.
--
-- Any existing non-positive price is nulled first (equivalent to "no
-- price set yet") so this doesn't fail on data that predates the
-- constraint; verified this two-step approach against a local Postgres
-- instance.

update profiles set price = null where price is not null and price <= 0;

alter table profiles drop constraint if exists profiles_price_check;
alter table profiles add constraint profiles_price_check
  check (price is null or price > 0);
