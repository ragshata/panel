/* SETTINGS PAGE JS */

/* ========= API base (same-origin / cross-domain / file://) =========
   Способы указать базу API:
   1) <meta name="api-base" content="https://api.example.com">
   2) window.API_BASE = "https://api.example.com" (до подключения скрипта)
   Если не задано — используются относительные пути (тот же домен).
*/
const _API_BASE = (() => {
  try {
    const meta = document.querySelector('meta[name="api-base"]');
    if (meta && meta.content) return meta.content.replace(/\/$/, "");
    if (typeof window.API_BASE === "string") return window.API_BASE.replace(/\/$/, "");
  } catch {}
  return "";
})();

function abs(path) {
  if (!path) return _API_BASE || "/";
  if (/^https?:\/\//i.test(path)) return path; // уже абсолютный
  if (_API_BASE) return _API_BASE + (path.startsWith("/") ? path : "/" + path);
  return path; // same-origin
}

/* ========= toast ========= */
function toast(msg, isErr = false) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.remove("ok", "err");
  el.classList.add(isErr ? "err" : "ok");
  el.hidden = false;
  el.style.display = "block";
  setTimeout(() => {
    el.hidden = true;
    el.style.display = "none";
  }, 2000);
}

/* ========= auth (Basic for panel) =========
   Храним Base64(user:pass) в sessionStorage.panelAuth
*/
function getPanelAuth() {
  return sessionStorage.getItem("panelAuth") || "";
}
function setPanelAuth(user, pass) {
  const token = btoa(`${user}:${pass}`);
  sessionStorage.setItem("panelAuth", token);
}
function clearPanelAuth() {
  sessionStorage.removeItem("panelAuth");
}
function getAuthHeader() {
  const tok = getPanelAuth();
  return tok ? { Authorization: `Basic ${tok}` } : {};
}

/* Модалка логина — ЯВНО управляем display, чтобы CSS не перебивал hidden */
function openLoginModal() {
  const m = document.getElementById("loginModal");
  if (!m) return;
  m.hidden = false;
  m.style.display = "flex"; // важно!
}
function closeLoginModal() {
  const m = document.getElementById("loginModal");
  if (!m) return;
  m.hidden = true;
  m.style.display = "none"; // важно!
}

/* ========= fetch helpers ========= */
async function handleJsonResponse(r) {
  if (r.status === 401) {
    openLoginModal();
    throw new Error("401");
  }
  if (!r.ok) {
    let t = "";
    try { t = await r.text(); } catch {}
    throw new Error(t || `HTTP ${r.status}`);
  }
  return r.json();
}

async function apiGet(url) {
  const r = await fetch(abs(url), {
    method: "GET",
    headers: { ...getAuthHeader() },
    mode: "cors",
    cache: "no-store",
    credentials: "omit",
  });
  return handleJsonResponse(r);
}
async function apiPost(url, body) {
  const r = await fetch(abs(url), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeader() },
    body: JSON.stringify(body || {}),
    mode: "cors",
    cache: "no-store",
    credentials: "omit",
  });
  return handleJsonResponse(r);
}

/* ========= ensure auth ========= */
async function ensureAuthOrAsk() {
  try {
    const r = await fetch(abs("/status"), {
      headers: getAuthHeader(),
      mode: "cors",
      cache: "no-store",
      credentials: "omit",
    });
    if (r.status === 401) {
      openLoginModal();
      return Promise.reject(new Error("need auth"));
    }
    return true;
  } catch {
    openLoginModal();
    return Promise.reject(new Error("need auth"));
  }
}

/* ========= rotation token (local only) ========= */
function loadRotateToken() {
  const tok = localStorage.getItem("rotateToken") || "";
  const el = document.getElementById("rotateToken");
  if (el) el.value = tok;
}
function saveRotateToken() {
  const el = document.getElementById("rotateToken");
  const tok = (el?.value || "").trim();
  if (!tok) return toast("Токен пустой", true);
  localStorage.setItem("rotateToken", tok);
  toast("rotate_token сохранён");
}
function clearRotateToken() {
  localStorage.removeItem("rotateToken");
  const el = document.getElementById("rotateToken");
  if (el) el.value = "";
  toast("rotate_token очищен");
}

/* ========= load current creds (masked) ========= */
async function loadProxyCreds() {
  try {
    await apiGet("/auth/proxy/get");
    // masked — просто ничего не делаем; поля оставляем пустыми
  } catch (e) {
    console.error(e);
  }
}
async function loadPanelCreds() {
  try {
    await apiGet("/auth/panel/get");
  } catch (e) {
    console.error(e);
  }
}

/* ========= save creds ========= */
async function saveProxyCreds() {
  const user = document.getElementById("proxyUser").value.trim();
  const pass = document.getElementById("proxyPass").value.trim();
  if (!user && !pass) return toast("Нечего сохранять", true);
  try {
    await apiPost("/auth/proxy/set", { user, pass });
    toast("Прокси-учётки сохранены");
  } catch (e) {
    console.error(e);
    toast("Ошибка сохранения прокси-учёток", true);
  }
}

async function savePanelCreds() {
  const user = document.getElementById("panelUser").value.trim();
  const pass = document.getElementById("panelPass").value.trim();
  if (!user && !pass) return toast("Нечего сохранять", true);
  try {
    await apiPost("/auth/panel/set", { user, pass });
    toast("Учётки панели сохранены");
    // если меняли текущие, можно обновить auth
    if (user && pass) setPanelAuth(user, pass);
  } catch (e) {
    console.error(e);
    toast("Ошибка сохранения учёток панели", true);
  }
}

/* ========= init ========= */
async function loadAll() {
  await ensureAuthOrAsk();
  await Promise.all([loadProxyCreds(), loadPanelCreds()]);
  loadRotateToken();
}

/* ========= wiring ========= */
window.addEventListener("DOMContentLoaded", () => {
  // Кнопки сохранения
  document.getElementById("btnSaveProxy")?.addEventListener("click", saveProxyCreds);
  document.getElementById("btnSavePanel")?.addEventListener("click", savePanelCreds);

  // Rotation token
  document.getElementById("btnSaveRotate")?.addEventListener("click", saveRotateToken);
  document.getElementById("btnClearRotate")?.addEventListener("click", clearRotateToken);

  // Login modal
  const btnLogin = document.getElementById("btnLogin");
  if (btnLogin) {
    btnLogin.addEventListener("click", () => {
      const u = document.getElementById("loginUser").value.trim();
      const p = document.getElementById("loginPass").value.trim();
      if (!u || !p) return toast("Введите логин и пароль", true);
      setPanelAuth(u, p);
      closeLoginModal();
      loadAll().catch(() => {});
    });
  }

  // Enter в полях логина — нажимает «Войти»
  const loginUser = document.getElementById("loginUser");
  const loginPass = document.getElementById("loginPass");
  const onEnter = (e) => {
    if (e.key === "Enter") btnLogin?.click();
  };
  loginUser?.addEventListener("keydown", onEnter);
  loginPass?.addEventListener("keydown", onEnter);

  loadAll().catch(() => {});
});
