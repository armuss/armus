/*
 * ARMUS - real auth backed by Supabase.
 * Requires supabase-config.js (Supabase SDK + armusSupabase client) to be
 * loaded before this file.
 */

// Names are stored exactly as the person typed them at signup (whatever
// casing that was), but should always render capitalized - this only
// affects what gets rendered, never the stored value.
function armusCapitalizeName(fullName) {
  return String(fullName || "")
    .trim()
    .split(/\s+/)
    .map(word => word ? word[0].toUpperCase() + word.slice(1).toLowerCase() : word)
    .join(" ");
}

// A teacher's full real name is never shown to a student anywhere in the
// UI - only "Ahmet Y." - so a student can't take that name off ARMUS and
// look the teacher up (or contact them) elsewhere, bypassing the platform
// entirely. The stored value (profiles.name, bookings.teacher_name, etc.)
// stays the real full name for admin/support purposes; this only affects
// what gets rendered. Never applied to a student's own name shown to
// their teacher - that's not what this protects against.
function armusShortDisplayName(fullName) {
  const parts = armusCapitalizeName(fullName).split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] || "Öğretmen";
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

// login/register redirect to ?next=... after a successful
// sign-in/sign-up, straight from the URL with no validation - an
// attacker-crafted link like armus.com.tr/login?next=https://evil.example/phish
// looks legitimate (the domain really is armus.com.tr) and passes a
// glance at the URL, but after the victim genuinely authenticates, this
// silently bounces them to an attacker-controlled page (classic open
// redirect, e.g. for a fake "session expired, re-enter your password"
// page). Legitimate callers do sometimes pass a full absolute URL (e.g.
// class uses window.location.href), so this can't just reject any
// value with a scheme - it resolves the value and only accepts it if it
// stays on ARMUS's own origin.
function armusSafeNextUrl(value) {
  if (!value) return null;
  try {
    const resolved = new URL(value, window.location.origin);
    if (resolved.origin !== window.location.origin) return null;
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return null;
    return resolved.href;
  } catch (err) {
    return null;
  }
}

// functions.invoke returns { data: null, error } for any non-2xx response,
// with the response body stashed on error.context - without parsing that,
// every caller falls back to its own generic message while the specific
// reason the server sent (a past slot, a taken slot, a rate limit, an
// expired verification code) only ever lives in the console. Shared by
// every page's Edge Function call sites (register, booking, cancel,
// account deletion).
async function armusEdgeErrorMessage(error) {
  try {
    if (error && error.context && typeof error.context.json === "function") {
      const body = await error.context.json();
      if (body && body.error) return body.error;
    }
  } catch {
    // fall through - the caller uses its generic message
  }
  return null;
}

async function armusSignUp({ name, email, password, role, city }) {
  return armusSupabase.auth.signUp({
    email,
    password,
    options: { data: { name, role, city: city || null } },
  });
}

async function armusSignIn({ email, password }) {
  return armusSupabase.auth.signInWithPassword({ email, password });
}

async function armusSignOut() {
  await armusSupabase.auth.signOut();
}

// Sends a password-reset email (if that address has an account - Supabase
// doesn't reveal either way, so neither do we). The link in that email
// brings the user back to sifre-sifirla with a recovery session,
// where armusUpdatePassword actually sets the new password.
async function armusRequestPasswordReset(email) {
  return armusSupabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/sifre-sifirla`,
  });
}

async function armusUpdatePassword(newPassword) {
  return armusSupabase.auth.updateUser({ password: newPassword });
}

// Permanently deletes the logged-in user's own account via the
// delete-account Edge Function (also used by the mobile app) - hard
// deletes auth.users, which cascades through profiles and everything
// referencing it (bookings, payments, reviews, messages, ...) per
// schema.sql. Signs the browser out locally too since the account (and
// its session) no longer exists server-side either way.
async function armusDeleteOwnAccount() {

  const { data, error } = await armusSupabase.functions.invoke("delete-account");

  if (error || !data || !data.ok) {
    return { ok: false, error: (data && data.error) || (await armusEdgeErrorMessage(error)) || "Hesap silinemedi. Lütfen tekrar dene." };
  }

  await armusSupabase.auth.signOut();
  return { ok: true };
}

// Returns the current user's full profile row (auth + application data
// merged), or null if nobody is logged in.
async function armusGetSession() {

  const { data: { user } } = await armusSupabase.auth.getUser();
  if (!user) return null;

  const { data: profile, error } = await armusSupabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (error || !profile) return null;

  armusRefreshOwnTimezone(profile);
  armusMaybeRefreshPresence(profile);
  return profile;
}

// Keeps profiles.timezone (migration_37.sql) pointed at wherever this
// person actually is right now, not just wherever they were when they
// signed up - checked on every session load, updated in the background
// when it's drifted (e.g. they're travelling) so lesson-time
// notifications (send-lesson-reminder) always land in their real current
// local time. Best-effort and silent: never blocks or fails the caller's
// armusGetSession, and updating "timezone" isn't one of the fields
// enforce_teacher_profile_lock restricts for an approved teacher.
function armusRefreshOwnTimezone(profile) {
  try {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (detected && detected !== profile.timezone) {
      profile.timezone = detected;
      armusSupabase.from("profiles").update({ timezone: detected }).eq("id", profile.id).then(() => {});
    }
  } catch (err) {}
}

// migration_85.sql: replaces the old manual "Şu an müsaitim" toggle
// (is_online - migration_10.sql) with an automatic, activity-derived
// online status. A teacher reads as online to students for
// ARMUS_PRESENCE_WINDOW_MS after profiles.last_active_at, so this just
// has to keep that timestamp fresh while they're actually around -
// called from every armusGetSession() (same best-effort, fire-and-forget
// shape as armusRefreshOwnTimezone above), which fires on every page
// load/navigation, plus the interval below for a teacher who stays on
// one page a long time (e.g. a live lesson or a Mesajlar conversation)
// without ever triggering a fresh armusGetSession() call on their own.
// Throttled client-side so neither path writes more than once per
// ARMUS_PRESENCE_REFRESH_MS, comfortably inside the window students see.
const ARMUS_PRESENCE_WINDOW_MS = 5 * 60 * 1000;
const ARMUS_PRESENCE_REFRESH_MS = 2 * 60 * 1000;
let armusLastPresenceWriteAt = 0;

function armusMaybeRefreshPresence(profile) {
  if (!profile || profile.role !== "teacher") return;
  const now = Date.now();
  if (now - armusLastPresenceWriteAt < ARMUS_PRESENCE_REFRESH_MS) return;
  armusLastPresenceWriteAt = now;
  armusSupabase.from("profiles").update({ last_active_at: new Date().toISOString() }).eq("id", profile.id).then(() => {});
}

// Whether lastActiveAt (profiles.last_active_at, read through
// masked_profiles by a viewer other than the teacher themselves) is
// recent enough to show the teacher as online right now.
function armusIsTeacherOnline(lastActiveAt) {
  if (!lastActiveAt) return false;
  return Date.now() - new Date(lastActiveAt).getTime() < ARMUS_PRESENCE_WINDOW_MS;
}

// Keeps a logged-in teacher's presence fresh on a page they stay on for a
// while without navigating anywhere (armusGetSession() on its own only
// refreshes on page load). Runs everywhere, same as
// armusEnforceEmailVerification below - armusMaybeRefreshPresence no-ops
// immediately for a non-teacher or a logged-out visitor, so this is cheap
// on every other kind of page too.
document.addEventListener("DOMContentLoaded", () => {
  setInterval(() => { armusGetSession().catch(() => null); }, ARMUS_PRESENCE_REFRESH_MS);
});

// A brand-new signup gets a fully active, usable Supabase Auth session
// the instant armusSignUp() returns (send-verification-email/
// verify-email-code both need that session's own JWT to know who
// they're verifying) - register's 6-digit-code step was only ever
// a UI suggestion the user could just navigate away from, never an
// actual gate: nothing anywhere (this site's pages or any Edge
// Function) ever checked email_verified before letting a session book,
// pay, or message normally.
//
// Only accounts created from this cutoff onward are required to verify
// before using the rest of the site - accounts from before this shipped
// are grandfathered in. Many real users have been using ARMUS for a
// while with email_verified still false (nothing ever required it), and
// retroactively locking all of them out the moment this ships would be
// a surprise mass lockout, not a fix.
const ARMUS_EMAIL_VERIFICATION_REQUIRED_FROM = new Date("2026-09-29T00:00:00Z");

function armusNeedsEmailVerification(profile) {
  return !!profile
    && !profile.email_verified
    && new Date(profile.created_at) >= ARMUS_EMAIL_VERIFICATION_REQUIRED_FROM;
}

// Runs on every page via the DOMContentLoaded listener below, same
// trigger armusRenderNavAuth uses - kept as its own independent
// armusGetSession() call (a second one per page load, alongside
// armusRenderNavAuth's) rather than piggybacking on that function,
// since armusRenderNavAuth exits immediately on any page without a
// #navAuthButtons element (e.g. a page with no standard header) and
// this gate has to hold everywhere, including exactly the pages most
// worth reaching before verifying (class, booking, ...).
// register/login are exempt: register is where
// verification actually happens, and login never renders gated
// content itself - whatever it redirects to after a successful sign-in
// gets caught by this same check on its own next page load.
async function armusEnforceEmailVerification() {
  if (/(^|\/)(register|login)(\.html)?\/?$/.test(location.pathname)) return;
  const session = await armusGetSession().catch(() => null);
  if (!armusNeedsEmailVerification(session)) return;
  window.location.href = "register?resume=1";
}
document.addEventListener("DOMContentLoaded", armusEnforceEmailVerification);

// Updates the currently logged-in user's own profile row.
// Returns the updated row, or false if the update failed.
async function armusUpdateOwnProfile(updates) {

  const { data: { user } } = await armusSupabase.auth.getUser();
  if (!user) return false;

  const { data, error } = await armusSupabase
    .from("profiles")
    .update(updates)
    .eq("id", user.id)
    .select()
    .single();

  if (error) return false;
  return data;
}

// Admin-only: updates another user's profile by id (e.g. approve/reject a
// teacher application). The profiles_update_own_or_admin RLS policy is
// what actually enforces this - a non-admin caller gets an error here.
async function armusAdminUpdateProfile(profileId, updates) {

  const { data, error } = await armusSupabase
    .from("profiles")
    .update(updates)
    .eq("id", profileId)
    .select()
    .single();

  if (error) return false;
  return data;
}

// Collapsed-avatar / dropdown-head avatar markup shared by the global nav
// (armusRenderStudentNav below) and any page that builds its own copy of
// the same header statically (student-dashboard, settings keep
// their own local copy of this logic, since their avatar also needs to
// update instantly on a photo upload).
function armusAvatarInitials(name) {
  return armusEscapeHtml((name || "?")
    .split(" ")
    .map(part => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase() || "?");
}

function armusAvatarInner(photoUrl, name) {
  return armusSafeUrl(photoUrl) ? `<img src="${armusSafeUrl(photoUrl)}" alt="">` : armusAvatarInitials(name);
}

// Wherever a logged-in student is in their panel, clicking the ARMUS
// mark top-left should take them back to their panel - most pages still
// point it at index.html (my-lessons, teacher, teachers),
// index.html's own points nowhere (href="#"), and mesajlar doesn't
// link it at all. Every page's header mark is ".logo" except index.html,
// which uses ".brand" for both its header mark and an unrelated footer
// mark - "header.nav a.brand" scopes to the header one there without
// touching the footer's.
function armusLinkLogoToPanel(href) {
  const logo = document.querySelector(".logo, header.nav a.brand");
  if (!logo) return;
  if (logo.tagName === "A") {
    logo.setAttribute("href", href);
    return;
  }
  const a = document.createElement("a");
  a.href = href;
  if (logo.id) a.id = logo.id;
  a.className = logo.className;
  a.innerHTML = logo.innerHTML;
  logo.replaceWith(a);
}

// Closes every open global-nav dropdown (bell, profile) except the one
// passed in, if any - shared by the click-outside/Escape listeners below
// and by each dropdown's own open toggle. Queried fresh every call
// (rather than cached) since #navAuthButtons's innerHTML gets rebuilt on
// every armusRenderNavAuth() re-run (e.g. a language toggle).
function armusCloseGnavDropdowns(exceptMenu) {
  document.querySelectorAll(".gnav-dropdown-wrap > .gnav-dropdown").forEach(menu => {
    if (menu === exceptMenu) return;
    menu.style.display = "none";
    const btn = menu.previousElementSibling;
    if (btn) btn.setAttribute("aria-expanded", "false");
  });
}
document.addEventListener("click", () => armusCloseGnavDropdowns(null));
document.addEventListener("keydown", (e) => { if (e.key === "Escape") armusCloseGnavDropdowns(null); });

// ---- notification bell: no dedicated notifications system/table exists
// yet, so this surfaces the two things ARMUS already tracks that
// genuinely need the student's attention - unread messages and a lesson
// starting soon (next 48h). Both are feature-detected (typeof check)
// since not every page loads messages.js/bookings.js/reviews.js - a page
// that doesn't still gets the bell icon, just with an always-empty
// dropdown instead of a broken/missing function call.
async function armusRenderGnavBell(session) {

  const badge = document.getElementById("gnavBellBadge");
  const dropdown = document.getElementById("gnavBellDropdown");
  if (!badge || !dropdown) return;

  const items = [];
  let badgeCount = 0;

  if (typeof armusGetConversations === "function") {
    const conversations = await armusGetConversations().catch(() => []);
    const unreadConvos = conversations.filter(c => c.unreadCount > 0);
    badgeCount += unreadConvos.reduce((sum, c) => sum + c.unreadCount, 0);

    unreadConvos.slice(0, 3).forEach(c => {
      const preview = c.lastMessage
        ? (c.lastMessage.body || armusT("studentDash.navBellAttachment", "📎 Ek gönderdi"))
        : "";
      items.push(`
        <a class="gnav-bell-item" href="mesajlar">
          <strong>${armusEscapeHtml(armusShortDisplayName(c.otherName))}</strong>
          <span>${armusEscapeHtml(preview.length > 60 ? preview.slice(0, 60) + "…" : preview)}</span>
        </a>
      `);
    });
  }

  if (typeof armusGetBookingsForStudent === "function" && typeof armusIsBookingPast === "function") {
    const bookings = await armusGetBookingsForStudent(session.id).catch(() => []);
    const soonCutoff = Date.now() + 48 * 3600 * 1000;
    const soonBookings = bookings
      .filter(b => !armusIsBookingPast(b))
      .filter(b => armusZonedTimeToUtc(b.date, b.time, b.teacherTimezone).getTime() <= soonCutoff)
      .sort((a, b) => armusZonedTimeToUtc(a.date, a.time, a.teacherTimezone) - armusZonedTimeToUtc(b.date, b.time, b.teacherTimezone));

    badgeCount += soonBookings.length;

    soonBookings.slice(0, 2).forEach(b => {
      const when = armusFormatLessonWhen(b);
      items.push(`
        <a class="gnav-bell-item" href="class?booking=${b.id}">
          <strong>${armusT("studentDash.navBellSoon", "Yaklaşan dersin")}</strong>
          <span>${armusEscapeHtml(armusShortDisplayName(b.teacherName))} · ${when.dateLabel}, ${when.timeRange}</span>
        </a>
      `);
    });
  }

  if (badgeCount > 0) {
    badge.textContent = badgeCount > 9 ? "9+" : String(badgeCount);
    badge.style.display = "flex";
  } else {
    badge.style.display = "none";
  }

  dropdown.innerHTML = items.length
    ? items.join("")
    : `<div class="gnav-bell-empty">${armusT("studentDash.navBellEmpty", "Henüz bildirimin yok.")}</div>`;
}

// Preply-style icon row + notification/profile dropdowns, injected into
// #navAuthButtons for a logged-in student on every page that has it
// (student-dashboard/settings build their own static copy of
// this same header instead, since they need it visible before this
// script's session check and already wire their own avatar-on-upload
// updates - this is for every other page).
async function armusRenderStudentNav(el, session, firstName) {

  const avatarInner = armusAvatarInner(session.photo_url, session.name);

  // a plain badge (not clickable, nothing to spend it on directly from
  // here) showing how many free lessons a cancellation has earned them.
  // Hover shows which teacher(s) they're tied to.
  let creditBadge = "";
  const { data: credits } = await armusSupabase
    .from("lesson_credits")
    .select("teacher_name")
    .eq("student_id", session.id)
    .eq("status", "available");

  if (credits && credits.length > 0) {
    const teacherList = armusEscapeHtml(credits.map((c) => armusShortDisplayName(c.teacher_name)).join(", "));
    const tooltip = armusT("nav.creditsTooltip", "Kullanılabilir ders hakkın: {teachers}").replace("{teachers}", teacherList);
    const badgeText = armusT("nav.creditsBadge", "{n} ders hakkın var").replace("{n}", credits.length);
    creditBadge = `<span class="gnav-credit-badge" title="${tooltip}">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">
          <path d="M20 12v9H4v-9"></path>
          <path d="M2 7h20v5H2z"></path>
          <path d="M12 22V7"></path>
          <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"></path>
          <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"></path>
        </svg>
        ${badgeText}
      </span>`;
  }

  el.innerHTML = `
    <a class="btn gnav-refer-btn" href="referral">${armusT("studentDash.navRefer", "Arkadaşını Davet Et")}</a>
    ${creditBadge}
    <a class="gnav-icon-btn" href="mesajlar" title="${armusT("nav.messages", "Mesajlar")}" aria-label="${armusT("nav.messages", "Mesajlar")}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
    </a>
    <a class="gnav-icon-btn" href="favorites" title="${armusT("studentDash.favTeachers", "Favori Öğretmenlerin")}" aria-label="${armusT("studentDash.favTeachers", "Favori Öğretmenlerin")}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"></path></svg>
    </a>
    <div class="gnav-dropdown-wrap">
      <button type="button" class="gnav-icon-btn" id="gnavBellBtn" title="${armusT("studentDash.navBellTitle", "Bildirimler")}" aria-label="${armusT("studentDash.navBellTitle", "Bildirimler")}" aria-expanded="false">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
        <span class="gnav-badge" id="gnavBellBadge" style="display:none;"></span>
      </button>
      <div class="gnav-dropdown" id="gnavBellDropdown" style="display:none;"></div>
    </div>
    <div class="gnav-dropdown-wrap">
      <button type="button" class="gnav-avatar-btn" id="gnavProfileBtn" aria-label="${armusT("nav.profileMenu", "Profil menüsü")}" aria-expanded="false">
        <div class="gnav-avatar">${avatarInner}</div>
      </button>
      <div class="gnav-dropdown" id="gnavProfileDropdown" style="display:none;">
        <div class="gnav-dropdown-head">
          <div class="gnav-avatar">${avatarInner}</div>
          <div class="gnav-dropdown-greeting">${armusT("nav.greeting", "Merhaba, {name}").replace("{name}", firstName)}</div>
        </div>
        <a href="student-dashboard">${armusT("nav.myPanel", "Panelim")}</a>
        <a href="mesajlar">${armusT("nav.messages", "Mesajlar")}</a>
        <a href="my-lessons">${armusT("studentDash.navSchedule", "Derslerim")}</a>
        <a href="favorites">${armusT("studentDash.favTeachers", "Favori Öğretmenlerin")}</a>
        <a href="referral">${armusT("studentDash.navRefer", "Arkadaşını Davet Et")}</a>
        <a href="settings">${armusT("nav.settings", "Ayarlar")}</a>
        <a href="sss">${armusT("nav.help", "Yardım")}</a>
        <hr>
        <button type="button" id="gnavLogoutBtn">${armusT("nav.logout", "Çıkış Yap")}</button>
      </div>
    </div>
  `;

  document.getElementById("gnavLogoutBtn").addEventListener("click", async () => {
    await armusSignOut();
    window.location.reload();
  });

  // delegated on `el` itself (not the buttons inside it) so this only
  // ever needs wiring once per page load, even though armusRenderNavAuth
  // rebuilds el's innerHTML from scratch on every language toggle
  if (!el.dataset.armusGnavWired) {
    el.dataset.armusGnavWired = "1";
    el.addEventListener("click", (e) => {
      const btn = e.target.closest(".gnav-dropdown-wrap > button");
      if (!btn) return;
      e.stopPropagation();
      const menu = btn.nextElementSibling;
      const opening = menu.style.display === "none" || !menu.style.display;
      armusCloseGnavDropdowns(opening ? menu : null);
      menu.style.display = opening ? "block" : "none";
      btn.setAttribute("aria-expanded", String(opening));
    });
  }

  armusRenderGnavBell(session);
  armusLinkLogoToPanel("student-dashboard");
}

// Same Preply-style icon row + notification/profile dropdown as
// armusRenderStudentNav above, for a logged-in teacher instead - every
// page that isn't dashboard.html itself (which builds its own sidebar
// nav) used to fall back to the old plain Panelim/greeting/Çıkış Yap
// button row here, the one piece of the site that never got the
// redesign the student side already has. Trimmed to what actually
// applies to a teacher: no Derslerim (lesson/booking management lives
// in dashboard.html's own tabs, not a top-level page) or Favori
// Öğretmenlerin (nothing for a teacher to favorite), and no credits
// badge (that's a student-only concept - lesson_credits.student_id).
async function armusRenderTeacherNav(el, session, firstName) {

  const avatarInner = armusAvatarInner(session.photo_url, session.name);

  el.innerHTML = `
    <a class="btn gnav-refer-btn" href="referral">${armusT("studentDash.navRefer", "Arkadaşını Davet Et")}</a>
    <a class="gnav-icon-btn" href="mesajlar" title="${armusT("nav.messages", "Mesajlar")}" aria-label="${armusT("nav.messages", "Mesajlar")}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
    </a>
    <div class="gnav-dropdown-wrap">
      <button type="button" class="gnav-icon-btn" id="gnavBellBtn" title="${armusT("studentDash.navBellTitle", "Bildirimler")}" aria-label="${armusT("studentDash.navBellTitle", "Bildirimler")}" aria-expanded="false">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
        <span class="gnav-badge" id="gnavBellBadge" style="display:none;"></span>
      </button>
      <div class="gnav-dropdown" id="gnavBellDropdown" style="display:none;"></div>
    </div>
    <div class="gnav-dropdown-wrap">
      <button type="button" class="gnav-avatar-btn" id="gnavProfileBtn" aria-label="${armusT("nav.profileMenu", "Profil menüsü")}" aria-expanded="false">
        <div class="gnav-avatar">${avatarInner}</div>
      </button>
      <div class="gnav-dropdown" id="gnavProfileDropdown" style="display:none;">
        <div class="gnav-dropdown-head">
          <div class="gnav-avatar">${avatarInner}</div>
          <div class="gnav-dropdown-greeting">${armusT("nav.greeting", "Merhaba, {name}").replace("{name}", firstName)} <small>(${armusT("nav.roleTeacher", "Öğretmen")})</small></div>
        </div>
        <a href="dashboard">${armusT("nav.myPanel", "Panelim")}</a>
        <a href="mesajlar">${armusT("nav.messages", "Mesajlar")}</a>
        <a href="referral">${armusT("studentDash.navRefer", "Arkadaşını Davet Et")}</a>
        <a href="settings">${armusT("nav.settings", "Ayarlar")}</a>
        <a href="sss">${armusT("nav.help", "Yardım")}</a>
        <hr>
        <button type="button" id="gnavLogoutBtn">${armusT("nav.logout", "Çıkış Yap")}</button>
      </div>
    </div>
  `;

  document.getElementById("gnavLogoutBtn").addEventListener("click", async () => {
    await armusSignOut();
    window.location.reload();
  });

  if (!el.dataset.armusGnavWired) {
    el.dataset.armusGnavWired = "1";
    el.addEventListener("click", (e) => {
      const btn = e.target.closest(".gnav-dropdown-wrap > button");
      if (!btn) return;
      e.stopPropagation();
      const menu = btn.nextElementSibling;
      const opening = menu.style.display === "none" || !menu.style.display;
      armusCloseGnavDropdowns(opening ? menu : null);
      menu.style.display = opening ? "block" : "none";
      btn.setAttribute("aria-expanded", String(opening));
    });
  }

  armusRenderGnavBell(session);
  armusLinkLogoToPanel("dashboard");
}

async function armusRenderNavAuth() {

  const el = document.getElementById("navAuthButtons");
  if (!el) return;

  const session = await armusGetSession();

  if (session && session.is_admin) {

    const firstName = armusEscapeHtml(armusCapitalizeName(session.name).split(" ")[0]);
    el.innerHTML = `
      <a class="btn" href="admin">${armusT("nav.adminPanel", "Admin Paneli")}</a>
      <span class="nav-greeting">${armusT("nav.greeting", "Merhaba, {name}").replace("{name}", firstName)} <small>(${armusT("nav.roleAdmin", "Admin")})</small></span>
      <button class="btn" id="armusLogoutBtn">${armusT("nav.logout", "Çıkış Yap")}</button>
    `;

    document.getElementById("armusLogoutBtn").addEventListener("click", async () => {
      await armusSignOut();
      window.location.href = "/";
    });

  } else if (session && session.role === "student") {

    const firstName = armusEscapeHtml(armusCapitalizeName(session.name).split(" ")[0]);
    await armusRenderStudentNav(el, session, firstName);

  } else if (session) {

    const firstName = armusEscapeHtml(armusCapitalizeName(session.name).split(" ")[0]);
    await armusRenderTeacherNav(el, session, firstName);

  } else {

    el.innerHTML = `
      <a class="btn" href="login" data-i18n="nav.login">Giriş Yap</a>
      <a class="btn btn-light" href="register" data-i18n="nav.register">Kayıt Ol</a>
    `;
  }

  // this just replaced #navAuthButtons's whole innerHTML, wiping out
  // whatever i18n.js had translated there (e.g. the Giriş Yap/Kayıt Ol
  // links above) - re-apply so the current language sticks. Harmless
  // no-op on a page that never loaded i18n.js.
  if (typeof armusApplyTranslations === "function") armusApplyTranslations();
}

document.addEventListener("DOMContentLoaded", armusRenderNavAuth);

// the widget bakes armusT() text into innerHTML at render time (it isn't
// built from data-i18n attributes armusApplyTranslations() could just
// re-swap), so a language toggle needs a full re-render to pick up
document.addEventListener("armus:langchange", armusRenderNavAuth);

// Nothing used to listen for the session itself changing, only for
// DOMContentLoaded/language toggles - so signing out in one tab left
// every other open tab showing the logged-in nav (avatar, "Panelim",
// credit badge...) indefinitely; the first clue anything was wrong was
// whatever the user tried to do next silently failing against RLS.
// onAuthStateChange fires in every tab sharing this session (Supabase
// propagates it via a storage event), so one listener here keeps all of
// them in sync. TOKEN_REFRESHED/USER_UPDATED/etc. are ignored on purpose
// - a full nav re-render (another armusGetSession() round trip) isn't
// needed for those, only for an actual sign-in/sign-out.
armusSupabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_IN" || event === "SIGNED_OUT") armusRenderNavAuth();
});
