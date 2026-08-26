/*
 * ARMUS - site-wide settings (currently: the announcement banner).
 * Requires supabase-config.js (Supabase SDK + armusSupabase client) to be
 * loaded before this file.
 */

async function armusGetSiteSetting(key) {
  const { data, error } = await armusSupabase
    .from("site_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();

  if (error || !data) return null;
  return data.value;
}

// Admin-only: the "site_settings_write_admin" RLS policy is what
// actually enforces this - a non-admin caller gets an error here.
async function armusSetSiteSetting(key, value) {
  const { data, error } = await armusSupabase
    .from("site_settings")
    .upsert({ key, value, updated_at: new Date().toISOString() })
    .select()
    .single();

  if (error) return false;
  return data;
}

// Public: renders a dismissible announcement banner at the top of the
// page if the admin has an active announcement set. No-op if there isn't
// one, the table doesn't exist yet, or this visitor already dismissed
// this exact message.
async function armusRenderAnnouncementBanner() {

  const setting = await armusGetSiteSetting("announcement");
  if (!setting || !setting.active || !setting.message) return;

  let dismissed = null;
  try {
    dismissed = localStorage.getItem("armusDismissedAnnouncement");
  } catch (e) {}
  if (dismissed === setting.message) return;

  const bar = document.createElement("div");
  bar.id = "armusAnnouncementBar";
  bar.style.cssText = [
    "position:sticky", "top:0", "z-index:999",
    "background:var(--armus-gold-gradient,#d4af6a)",
    "color:var(--armus-on-gold,#1c1c1e)",
    "font-family:'Inter',sans-serif", "font-size:13.5px", "font-weight:600",
    "padding:11px 46px 11px 16px", "text-align:center", "line-height:1.5",
  ].join(";");

  const text = document.createElement("span");
  text.textContent = setting.message;

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Kapat");
  closeBtn.textContent = "✕";
  closeBtn.style.cssText = [
    "position:absolute", "right:12px", "top:50%", "transform:translateY(-50%)",
    "background:transparent", "border:none", "color:inherit", "font-size:16px",
    "font-weight:700", "cursor:pointer", "line-height:1", "padding:4px",
  ].join(";");
  closeBtn.addEventListener("click", () => {
    try { localStorage.setItem("armusDismissedAnnouncement", setting.message); } catch (e) {}
    bar.remove();
  });

  bar.appendChild(text);
  bar.appendChild(closeBtn);
  document.body.prepend(bar);
}
