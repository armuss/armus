/*
 * ARMUS - real auth backed by Supabase.
 * Requires supabase-config.js (Supabase SDK + armusSupabase client) to be
 * loaded before this file.
 */

// Temporarily disabled - wallet balance/top-up is on hold for now. The
// wallet_balance column and wallet_transactions history keep working
// server-side underneath this (e.g. a cancellation still credits the
// balance), it's just not shown anywhere in the UI while this is false.
// Flip back to true to bring the nav badge back.
const ARMUS_WALLET_ENABLED = false;

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
  return profile;
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
      <span class="nav-greeting">Merhaba, ${session.name.split(" ")[0]} <small>(Admin)</small></span>
      <button class="btn" id="armusLogoutBtn">Çıkış Yap</button>
    `;

    document.getElementById("armusLogoutBtn").addEventListener("click", async () => {
      await armusSignOut();
      window.location.href = "index.html";
    });

  } else if (session) {

    const firstName = session.name.split(" ")[0];
    const roleLabel = session.role === "teacher" ? "Öğretmen" : "Öğrenci";
    const dashboardLink = session.role === "teacher"
      ? '<a class="btn" href="dashboard.html">Panelim</a>'
      : '<a class="btn" href="student-dashboard.html">Panelim</a>';

    // students only - a clickable trigger that opens a tiny menu ("Para
    // Ekle" / "İşlem Geçmişi"). Currently unused while ARMUS_WALLET_ENABLED
    // is false (see top of file) - cancellations grant a lesson credit
    // (below) instead of wallet money for now.
    const walletBadge = (ARMUS_WALLET_ENABLED && session.role === "student")
      ? `<div style="position:relative;display:inline-block;">
          <button type="button" id="armusWalletTrigger" title="Cüzdan bakiyen" style="display:inline-flex;align-items:center;gap:6px;border:1px solid var(--armus-border);border-radius:999px;padding:8px 14px;font-size:12.5px;font-weight:700;color:var(--armus-gold-text);white-space:nowrap;background:none;cursor:pointer;font-family:inherit;">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">
              <rect x="2" y="6" width="20" height="14" rx="3"></rect>
              <path d="M2 10h20"></path>
              <circle cx="17" cy="15" r="1.4" fill="currentColor" stroke="none"></circle>
            </svg>
            ₺${Number(session.wallet_balance) || 0}
          </button>
          <div id="armusWalletMenu" style="display:none;position:absolute;top:calc(100% + 6px);right:0;background:var(--armus-bg, #fff);border:1px solid var(--armus-border);border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,0.12);min-width:180px;overflow:hidden;z-index:100;">
            <a href="wallet.html" style="display:block;padding:11px 16px;font-size:13px;font-weight:600;color:inherit;text-decoration:none;white-space:nowrap;">+ Para Ekle</a>
            <a href="wallet.html#history" style="display:block;padding:11px 16px;font-size:13px;font-weight:600;color:inherit;text-decoration:none;white-space:nowrap;border-top:1px solid var(--armus-border);">İşlem Geçmişi</a>
          </div>
        </div>`
      : "";

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
        const teacherList = credits.map((c) => c.teacher_name).join(", ");
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
      ${walletBadge}
      ${creditBadge}
      <span class="nav-greeting">Merhaba, ${firstName} <small>(${roleLabel})</small></span>
      <button class="btn" id="armusLogoutBtn">Çıkış Yap</button>
    `;

    document.getElementById("armusLogoutBtn").addEventListener("click", async () => {
      await armusSignOut();
      window.location.reload();
    });

    const walletTrigger = document.getElementById("armusWalletTrigger");
    if (walletTrigger) {
      const walletMenu = document.getElementById("armusWalletMenu");
      walletTrigger.addEventListener("click", (event) => {
        event.stopPropagation();
        walletMenu.style.display = walletMenu.style.display === "none" ? "block" : "none";
      });
      document.addEventListener("click", () => {
        walletMenu.style.display = "none";
      });
    }

  } else {

    el.innerHTML = `
      <a class="btn" href="login.html">Giriş Yap</a>
      <a class="btn btn-light" href="register.html">Kayıt Ol</a>
    `;
  }
}

document.addEventListener("DOMContentLoaded", armusRenderNavAuth);
