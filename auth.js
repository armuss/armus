/*
 * ARMUS - mock auth (frontend prototype only)
 * No real backend yet: "accounts" and the current session just live in
 * localStorage on this browser. Good enough to make the login/register
 * flow feel real until a database is wired up.
 */

const ARMUS_USERS_KEY = "armus_users";
const ARMUS_SESSION_KEY = "armus_session";

function armusGetUsers() {
  try {
    return JSON.parse(localStorage.getItem(ARMUS_USERS_KEY)) || [];
  } catch {
    return [];
  }
}

function armusSaveUsers(users) {
  try {
    localStorage.setItem(ARMUS_USERS_KEY, JSON.stringify(users));
    return true;
  } catch {
    return false;
  }
}

function armusGetSession() {
  try {
    return JSON.parse(localStorage.getItem(ARMUS_SESSION_KEY));
  } catch {
    return null;
  }
}

function armusSetSession(user) {
  localStorage.setItem(
    ARMUS_SESSION_KEY,
    JSON.stringify({ name: user.name, email: user.email, role: user.role })
  );
}

function armusClearSession() {
  localStorage.removeItem(ARMUS_SESSION_KEY);
}

function armusFindUser(email) {
  return armusGetUsers().find(u => u.email === email) || null;
}

// Returns the updated user on success, null if the user doesn't exist,
// or false if saving failed (e.g. localStorage quota exceeded by a
// large photo/video upload) - callers must check for false explicitly.
function armusUpdateUser(email, updates) {

  const users = armusGetUsers();
  const index = users.findIndex(u => u.email === email);
  if (index === -1) return null;

  const updated = { ...users[index], ...updates };
  users[index] = updated;

  if (!armusSaveUsers(users)) {
    return false;
  }

  const session = armusGetSession();
  if (session && session.email === email) {
    armusSetSession(updated);
  }

  return updated;
}

function armusRenderNavAuth() {

  const el = document.getElementById("navAuthButtons");
  if (!el) return;

  const session = armusGetSession();

  if (session) {

    const firstName = session.name.split(" ")[0];
    const roleLabel = session.role === "teacher" ? "Öğretmen" : "Öğrenci";
    const dashboardLink = session.role === "teacher"
      ? '<a class="btn" href="dashboard.html">Panelim</a>'
      : "";

    el.innerHTML = `
      ${dashboardLink}
      <a class="btn" href="my-lessons.html">Derslerim</a>
      <span class="nav-greeting">Merhaba, ${firstName} <small>(${roleLabel})</small></span>
      <button class="btn" id="armusLogoutBtn">Çıkış Yap</button>
    `;

    document.getElementById("armusLogoutBtn").addEventListener("click", () => {
      armusClearSession();
      window.location.reload();
    });

  } else {

    el.innerHTML = `
      <a class="btn" href="login.html">Giriş Yap</a>
      <a class="btn btn-light" href="register.html">Kayıt Ol</a>
    `;
  }
}

document.addEventListener("DOMContentLoaded", armusRenderNavAuth);
