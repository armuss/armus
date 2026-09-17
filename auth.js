/*
 * ARMUS - real auth backed by Supabase.
 * Requires supabase-config.js (Supabase SDK + armusSupabase client) to be
 * loaded before this file.
 */

// A teacher's full real name is never shown to a student anywhere in the
// UI - only "Ahmet Y." - so a student can't take that name off ARMUS and
// look the teacher up (or contact them) elsewhere, bypassing the platform
// entirely. The stored value (profiles.name, bookings.teacher_name, etc.)
// stays the real full name for admin/support purposes; this only affects
// what gets rendered. Never applied to a student's own name shown to
// their teacher - that's not what this protects against.
function armusShortDisplayName(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/);
  if (parts.length < 2) return parts[0] || "Öğretmen";
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

// login.html/register.html redirect to ?next=... after a successful
// sign-in/sign-up, straight from the URL with no validation - an
// attacker-crafted link like armus.vercel.app/login.html?next=https://evil.example/phish
// looks legitimate (the domain really is armus.vercel.app) and passes a
// glance at the URL, but after the victim genuinely authenticates, this
// silently bounces them to an attacker-controlled page (classic open
// redirect, e.g. for a fake "session expired, re-enter your password"
// page). Legitimate callers do sometimes pass a full absolute URL (e.g.
// class.html uses window.location.href), so this can't just reject any
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
// brings the user back to sifre-sifirla.html with a recovery session,
// where armusUpdatePassword actually sets the new password.
async function armusRequestPasswordReset(email) {
  return armusSupabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/sifre-sifirla.html`,
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
    return { ok: false, error: (data && data.error) || "Hesap silinemedi. Lütfen tekrar dene." };
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

async function armusRenderNavAuth() {

  const el = document.getElementById("navAuthButtons");
  if (!el) return;

  const session = await armusGetSession();

  if (session && session.is_admin) {

    el.innerHTML = `
      <a class="btn" href="admin.html">Admin Paneli</a>
      <span class="nav-greeting">Merhaba, ${armusEscapeHtml(session.name.split(" ")[0])} <small>(Admin)</small></span>
      <button class="btn" id="armusLogoutBtn">Çıkış Yap</button>
    `;

    document.getElementById("armusLogoutBtn").addEventListener("click", async () => {
      await armusSignOut();
      window.location.href = "index.html";
    });

  } else if (session) {

    const firstName = armusEscapeHtml(session.name.split(" ")[0]);
    const roleLabel = session.role === "teacher" ? "Öğretmen" : "Öğrenci";
    const dashboardLink = session.role === "teacher"
      ? '<a class="btn" href="dashboard.html">Panelim</a>'
      : '<a class="btn" href="student-dashboard.html">Panelim</a>';

    // students only - a plain badge (not clickable, nothing to spend it
    // on directly from here) showing how many free lessons a cancellation
    // has earned them. Hover shows which teacher(s) they're tied to.
    let creditBadge = "";
    if (session.role === "student") {
      const { data: credits } = await armusSupabase
        .from("lesson_credits")
        .select("teacher_name")
        .eq("student_id", session.id)
        .eq("status", "available");

      if (credits && credits.length > 0) {
        const teacherList = armusEscapeHtml(credits.map((c) => armusShortDisplayName(c.teacher_name)).join(", "));
        creditBadge = `<span title="Kullanılabilir ders hakkın: ${teacherList}" style="display:inline-flex;align-items:center;gap:6px;border:1px solid var(--armus-border);border-radius:999px;padding:8px 14px;font-size:12.5px;font-weight:700;color:var(--armus-gold-text);white-space:nowrap;">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">
              <path d="M20 12v9H4v-9"></path>
              <path d="M2 7h20v5H2z"></path>
              <path d="M12 22V7"></path>
              <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"></path>
              <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"></path>
            </svg>
            ${credits.length} ders hakkın var
          </span>`;
      }
    }

    el.innerHTML = `
      ${dashboardLink}
      ${creditBadge}
      <span class="nav-greeting">Merhaba, ${firstName} <small>(${roleLabel})</small></span>
      <button class="btn" id="armusLogoutBtn">Çıkış Yap</button>
      <button type="button" id="armusDeleteAccountBtn" style="background:none;border:none;color:var(--armus-faint);font-size:11px;text-decoration:underline;cursor:pointer;font-family:inherit;">Hesabımı Sil</button>
    `;

    document.getElementById("armusLogoutBtn").addEventListener("click", async () => {
      await armusSignOut();
      window.location.reload();
    });

    document.getElementById("armusDeleteAccountBtn").addEventListener("click", async () => {

      if (!confirm("Hesabını silmek istediğine emin misin? Profilin, rezervasyonların, mesajların ve tüm verilerin kalıcı olarak silinir. Bu işlem geri alınamaz.")) return;

      const btn = document.getElementById("armusDeleteAccountBtn");
      btn.disabled = true;
      btn.textContent = "Siliniyor...";

      const result = await armusDeleteOwnAccount();

      if (!result.ok) {
        btn.disabled = false;
        btn.textContent = "Hesabımı Sil";
        alert(result.error);
        return;
      }

      window.location.href = "index.html";
    });

  } else {

    el.innerHTML = `
      <a class="btn" href="login.html" data-i18n="nav.login">Giriş Yap</a>
      <a class="btn btn-light" href="register.html" data-i18n="nav.register">Kayıt Ol</a>
    `;
  }

  // this just replaced #navAuthButtons's whole innerHTML, wiping out
  // whatever i18n.js had translated there (e.g. the Giriş Yap/Kayıt Ol
  // links above) - re-apply so the current language sticks. Harmless
  // no-op on a page that never loaded i18n.js.
  if (typeof armusApplyTranslations === "function") armusApplyTranslations();
}

document.addEventListener("DOMContentLoaded", armusRenderNavAuth);
