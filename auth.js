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
  localStorage.setItem(ARMUS_USERS_KEY, JSON.stringify(users));
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

function armusUpdateUser(email, updates) {

  const users = armusGetUsers();
  const index = users.findIndex(u => u.email === email);
  if (index === -1) return null;

  users[index] = { ...users[index], ...updates };
  armusSaveUsers(users);

  const session = armusGetSession();
  if (session && session.email === email) {
    armusSetSession(users[index]);
  }

  return users[index];
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
