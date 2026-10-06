/*
 * Points the ARMUS logo back at the student panel (student-dashboard)
 * instead of the public homepage, for a logged-in student visiting one
 * of the simple marketing/help pages (sss.html, hakkimizda.html, etc.)
 * that don't load the full auth.js nav system. Self-contained on purpose
 * - these pages (register/login's own consent links, among others) must
 * never pick up auth.js's email-verification redirect gate as a side
 * effect of fixing this, so this duplicates just the one check it needs
 * instead of loading auth.js itself. Requires supabase-config.js loaded
 * first. No-ops silently for anyone not logged in as a student.
 */
(async function () {
  try {
    const { data: { user } } = await armusSupabase.auth.getUser();
    if (!user) return;
    const { data: profile } = await armusSupabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (!profile || profile.role !== "student") return;
    const logo = document.querySelector(".logo");
    if (logo && logo.tagName === "A") logo.setAttribute("href", "student-dashboard");
  } catch (e) {
    // best-effort only - the logo just keeps pointing at "/" on failure
  }
})();
