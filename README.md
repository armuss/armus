# ARMUS

ARMUS ([armus.com.tr](https://armus.com.tr)) is a Turkish marketplace that
connects students with online English teachers: browse teachers, book a
paid lesson or a discounted trial, meet over video, pay by card via
iyzico, and manage everything (schedule, messages, reviews, teacher
payouts) from role-specific dashboards.

This file is a map of the codebase for anyone picking it up cold. It
describes the architecture as it actually is, not as originally
prototyped — `README.txt` (removed) described an early static-mockup
phase with no real backend; that is no longer true.

## Stack

- **Frontend**: plain HTML + vanilla JS, one file per page, no build
  step. Shared client-side logic lives in the top-level `*.js` files
  (see below) and is included via `<script src="...">` tags.
- **Backend**: [Supabase](https://supabase.com) — Postgres with Row
  Level Security as the authorization layer, Supabase Auth for
  accounts, Supabase Storage for uploaded files, and Deno **Edge
  Functions** for anything that needs a service-role key or a
  third-party secret (payments, email, AI chat).
- **Payments**: [iyzico](https://www.iyzico.com) (Turkish payment
  provider), via `create-payment` + `payment-callback`.
- **Email**: [Resend](https://resend.com), used by every `send-*` edge
  function.
- **Mobile**: a separate React Native app lives in `mobile/` with its
  own `CLAUDE.md`/`AGENTS.md` — not covered further here.

## Local development

There is no build step for the web app: any static file server works.

```
python3 -m http.server 8000
```

Then open `http://localhost:8000/index.html`. The Supabase project
itself (schema, edge functions, secrets) is managed through the
Supabase Dashboard, not from this checkout.

## Database

- `supabase/schema.sql` is the **canonical, current** combined schema —
  tables, RLS policies, triggers, functions, as they exist today.
- `supabase/migration_N.sql` files are the **history**: each one is a
  standalone, idempotent-where-possible SQL script that was actually
  run against the live project, in order, to reach the current state.
  Every migration also gets folded into `schema.sql` so that file never
  goes stale. When adding a new migration, do both: write
  `migration_<next number>.sql` **and** update the matching section of
  `schema.sql` to match.
- Migrations are run manually: Supabase Dashboard → SQL Editor → paste
  the file → Run. Nothing applies them automatically on deploy.

Row Level Security is the real authorization boundary — every table a
browser can query directly is protected by policies in `schema.sql`,
not by client-side checks. Client-side role checks (e.g. hiding an
admin button) are a UX nicety only; assume any request can be replayed
directly against Supabase with arbitrary parameters, and verify server
enforcement accordingly.

## Edge Functions (`supabase/functions/`)

Deno functions, each independently deployed. One-line purpose:

| Function | Purpose |
|---|---|
| `create-payment` | Starts a paid booking or package purchase (re-derives price/teacher identity server-side, never trusts the client) |
| `payment-callback` | iyzico's redirect target — the only place a paid booking or credit batch is actually created |
| `cancel-booking` | Cancels a booking, issuing an iyzico refund when the canceller is eligible |
| `delete-account` | Permanently deletes a user's account and data |
| `get-teacher-busy-times` | Returns a teacher's already-booked slots for the picker |
| `verify-email-code` | Confirms an email verification code at signup |
| `send-verification-email` | Sends the signup verification code |
| `send-lesson-reminder` | Scheduled: reminder emails before an upcoming lesson |
| `send-review-reminder` | Scheduled: nudges a student to review a completed lesson |
| `send-message-notification` | Emails a user about a new chat message |
| `send-teacher-status-email` | Emails a teacher when their application is approved/rejected |
| `send-contact-email` | Backs the public contact form (`iletisim.html`) |
| `site-chat` | The FAQ-grounded AI chat widget on every page |

## Key shared client-side files

- `auth.js` — session/profile helpers (`armusUpdateOwnProfile`, etc.)
- `bookings.js` — booking domain logic shared across pages: timezone
  conversion (`armusZonedTimeToUtc`, `armusFormatSlotTimeRangeForViewer`),
  slot availability (`armusSlotsForDate`), trial-to-paid conversion
  rules (`armusTrialCountsAsEarned`), commission tiers
  (`armusCommissionForHours`), booking cancellation.
- `attendance.js` — teacher no-show / late reports (student-initiated)
- `disputes.js` — general booking dispute reports, admin-triaged
- `i18n.js` — `armusT(key, fallback)` translation lookup,
  `armusEscapeHtml`/`armusSafeUrl` output-sanitization helpers, and the
  site-chat widget bootstrap
- `marketplace.js` — teacher listing/filtering (hides unapproved/banned
  teachers)
- `messages.js`, `reviews.js`, `favorites.js`, `testimonials.js`,
  `teacher-notes.js`, `student-extras.js`, `site-settings.js` — one
  feature area each, same pattern (thin wrappers around Supabase
  queries, RLS does the real enforcement)

## Conventions worth knowing before changing code

- **Dates and timezones.** A lesson's date/time is stored as the
  *teacher's own local wall-clock time* plus a `teacher_timezone`
  column (`migration_37.sql`). Never compare that raw string against
  another timezone's "today" directly — convert through
  `armusZonedTimeToUtc()` first, then compare real instants. Never use
  `new Date(...).toISOString().slice(0, 10)` for a "today" key — it's
  the UTC date, not the viewer's local date, and silently drifts a day
  near local midnight for any positive-UTC-offset viewer (Turkey is
  UTC+3). Use local `getFullYear()/getMonth()/getDate()` instead
  (several pages have a small `localDateKey()` helper for this).
- **Output escaping.** Any user- or database-derived string going into
  `innerHTML`/`insertAdjacentHTML` must go through `armusEscapeHtml()`
  first (`i18n.js`).
- **Money.** Never trust a client-supplied price or identity field.
  `create-payment` always re-derives the real price from the teacher's
  profile server-side; follow that pattern for anything new that moves
  money.
- **Business constants that appear in more than one UI** (commission
  tiers, lesson duration, cancellation window) should live once in a
  shared file (`bookings.js` is the usual home) and be imported by
  every page that needs them — not copy-pasted, which has caused real
  drift bugs before.
