/* ===================== Relay Server Dashboard — panel.js ===================== */

/* ========= API base (same-origin / cross-domain / file://) =========
   Как задать базу API:
   1) <meta name="api-base" content="https://api.example.com">
   2) window.API_BASE = "https://api.example.com" (до подключения скрипта)
   Если не задано — используем относительные пути (тот же домен).
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
  if (/^https?:\/\//i.test(path)) return path; // уже абсолютный URL
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

/* ========= auth (HTTP Basic) ========= */
const LS_KEY = "panel_basic_b64"; // новый ключ
const SS_KEY = "panelAuth";       // старый ключ совместимости

function setAuth(user, pass) {
  const b64 = btoa(`${user}:${pass}`);
  try { localStorage.setItem(LS_KEY, b64); } catch {}
  try { sessionStorage.setItem(SS_KEY, b64); } catch {}
}
function clearAuth() {
  try { localStorage.removeItem(LS_KEY); } catch {}
  try { sessionStorage.removeItem(SS_KEY); } catch {}
}
function getAuthB64() {
  let b64 = null;
  try { b64 = localStorage.getItem(LS_KEY); } catch {}
  if (!b64) { try { b64 = sessionStorage.getItem(SS_KEY); } catch {} }
  return b64 || "";
}
function getAuthHeaderOrNull() {
  return null; // никаких Basic
}

/* Единая обёртка над fetch: автоматически подкладываем Authorization */
async function api(path, opts = {}) {
  const headers = new Headers(opts.headers || {});
  const res = await fetch(abs(path), {
    ...opts,
    headers,
    mode: "cors",
    cache: "no-store",
    credentials: "omit",
  });
  // Никакого showLogin() на 401 — просто возвращаем ответ как есть
  return res;
}

/* ========= DOM Helpers ========= */
const $ = (id) => document.getElementById(id);
function fmtBytes(n) {
  if (n == null) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0, v = Number(n);
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}
function fmtRate(up, down) {
  return `↑ ${fmtBytes(up)}/s · ↓ ${fmtBytes(down)}/s`;
}
function fmtSince(ts) {
  if (!ts) return "—";
  try {
    const d = new Date(ts);
    if (Number.isNaN(+d)) return String(ts);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return `${Math.floor(diff)} сек`;
    if (diff < 3600) return `${Math.floor(diff/60)} мин`;
    if (diff < 86400) return `${Math.floor(diff/3600)} ч`;
    return d.toLocaleString();
  } catch { return String(ts); }
}

/* ========= Renderers ========= */
function renderPhones(list) {
  const ul = $("phonesList");
  if (!ul) return;
  ul.innerHTML = "";

  (list || []).forEach((p) => {
    const li = document.createElement("li");
    li.className = "phone";
    const dot = document.createElement("span");
    dot.className = `dot ${p.online ? "online" : "offline"}`;
    const title = document.createElement("div");
    title.style.fontWeight = "600";
    title.textContent = `Телефон #${p.id}`;
    const meta = document.createElement("div");
    meta.className = "muted small";
    const parts = [];
    if (p.ip) parts.push(`IP: ${p.ip}`);
    if (p.version) parts.push(`v${p.version}`);
    if (p.since) parts.push(`с ${new Date(p.since).toLocaleString()}`);
    meta.textContent = parts.join(" · ");

    li.appendChild(dot);
    li.appendChild(title);
    li.appendChild(meta);
    ul.appendChild(li);
  });

  const updated = $("updatedAt");
  if (updated) updated.textContent = new Date().toLocaleString();
}

function renderClients(clients, filters) {
  const tbody = $("clientsTbody");
  if (!tbody) return;

  // фильтрация
  const fIP = (filters.ip || "").trim();
  const fPhone = (filters.phone || "").trim();
  const fStream = (filters.stream || "").trim();

  let shown = clients || [];
  if (fIP)     shown = shown.filter((c) => (c.ip || "").includes(fIP));
  if (fPhone)  shown = shown.filter((c) => String(c.phone || "").includes(fPhone));
  if (fStream) shown = shown.filter((c) => String(c.stream || "").includes(fStream));

  // инфо о фильтре
  const fi = $("filterInfo");
  if (fi) {
    const parts = [];
    if (fPhone) parts.push(`Телефон=${fPhone}`);
    if (fIP) parts.push(`IP=${fIP}`);
    if (fStream) parts.push(`Stream=${fStream}`);
    fi.textContent = parts.length ? `Фильтр: ${parts.join(" · ")}` : "Фильтр: нет";
  }
  const found = $("foundInfo");
  if (found) found.textContent = `Найдено: ${shown.length}`;

  tbody.innerHTML = "";
  let totalUpRate = 0;
  let totalDownRate = 0;

  shown.forEach((c, idx) => {
    // сервер может прислать kind/proto и port, либо мы увидим только port
    const proto = c.proto || c.kind || c.type || "UNKNOWN";
    const port = c.port ?? c.listen_port ?? null;
    const protoPort = port ? `${proto} :${port}` : proto;

    // возможно есть раздельные «за секунду» поля; если нет — считаем 0
    const upRate = c.bytes_up_rate ?? c.rate_up ?? 0;
    const downRate = c.bytes_down_rate ?? c.rate_down ?? 0;
    totalUpRate += Number(upRate) || 0;
    totalDownRate += Number(downRate) || 0;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td class="mono">${c.stream ?? "—"}</td>
      <td class="mono">${c.phone ?? "—"}</td>
      <td class="mono">${c.ip ?? "—"}</td>
      <td class="mono">${protoPort}</td>
      <td>${fmtSince(c.since)}</td>
      <td class="mono">${fmtBytes(c.bytes_up ?? 0)}</td>
      <td class="mono">${fmtBytes(c.bytes_down ?? 0)}</td>
    `;
    tbody.appendChild(tr);
  });

  const badge = $("totalRate");
  if (badge) badge.textContent = fmtRate(totalUpRate, totalDownRate);
}

/* ========= Data loaders ========= */
async function fetchPhones() {
  const r = await api("/phones");
  if (!r.ok) throw new Error("phones http " + r.status);
  const data = await r.json();
  renderPhones(data.phones || []);
}
async function fetchClients() {
  const r = await api("/clients");
  if (!r.ok) throw new Error("clients http " + r.status);
  const data = await r.json();
  window.__clientsCache = data.clients || data || [];
  // перерисовать с текущими фильтрами
  renderClients(window.__clientsCache, {
    ip: $("fIP")?.value || "",
    phone: $("fPhone")?.value || "",
    stream: $("fStream")?.value || "",
  });
}
async function fetchAll() {
  await Promise.allSettled([fetchPhones(), fetchClients()]);
}

/* ========= Login modal ========= */
function showLogin() { hideLogin(); }
function hideLogin() {
  const m = document.getElementById("loginModal");
  if (m) { m.hidden = true; m.style.display = "none"; }
}

async function testAuth() { return true; }

function bindLogin() {
  const btn = $("btnLogin");
  if (!btn) return;
  const doLogin = async () => {
    const u = ($("loginUser")?.value || "").trim();
    const p = ($("loginPass")?.value || "");
    if (!u || !p) { toast("Введите логин и пароль", true); return; }
    setAuth(u, p);
    if (await testAuth()) {
      hideLogin();
      toast("Вход выполнен");
      fetchAll().catch(()=>{});
    } else {
      clearAuth();
      toast("Неверный логин/пароль", true);
    }
  };
  btn.addEventListener("click", doLogin);
  ["loginUser","loginPass"].forEach(id => {
    const el = $(id);
    el && el.addEventListener("keydown", (e) => e.key === "Enter" && doLogin());
  });
}
async function ensureAuthOrAsk() { hideLogin(); return true; }

/* ========= Filters ========= */
function bindFilters() {
  const apply = () => {
    renderClients(window.__clientsCache || [], {
      ip: $("fIP")?.value || "",
      phone: $("fPhone")?.value || "",
      stream: $("fStream")?.value || "",
    });
  };
  ["fIP","fPhone","fStream"].forEach(id => {
    const el = $(id);
    if (el) el.addEventListener("input", apply);
  });
  const reset = $("btnResetFilters");
  if (reset) reset.addEventListener("click", () => {
    ["fIP","fPhone","fStream"].forEach(id => { const el = $(id); if (el) el.value = ""; });
    apply();
  });
}

/* ========= Actions (rotate / restart) ========= */
function bindActions() {
  const rotate = $("btnRotate");
  if (rotate) {
    rotate.addEventListener("click", async () => {
      try {
        rotate.disabled = true;
        // берём токен из localStorage (сохраняется на странице настроек)
        const tok = (localStorage.getItem("rotateToken") || "").trim();
        const url = tok ? `/rotate?token=${encodeURIComponent(tok)}` : "/rotate";
        const r = await api(url);
        if (!r.ok) throw new Error("/rotate http " + r.status);
        const data = await r.json();
        if (data.ok) {
          toast(`IP сменён у: ${data.changed?.length || 0}`);
        } else {
          toast(`Ошибка: ${data.error || "rotate failed"}`, true);
        }
        fetchPhones().catch(()=>{});
      } catch (e) {
        toast(String(e), true);
      } finally {
        rotate.disabled = false;
      }
    });
  }

  // Кнопка рестарта (если добавлена в разметку)
  const restart = $("btnRestart");
  if (restart) {
    restart.addEventListener("click", async () => {
      try {
        restart.disabled = true;
        const r = await api("/restart", { method: "POST" });
        if (!r.ok) throw new Error("/restart http " + r.status);
        const data = await r.json();
        if (data.ok || data.status === "restarted") {
          toast("Рестарт инициирован");
        } else {
          toast(`Ошибка: ${data.error || "restart failed"}`, true);
        }
      } catch (e) {
        toast(String(e), true);
      } finally {
        restart.disabled = false;
      }
    });
  }
}

/* ========= Boot ========= */
window.addEventListener("DOMContentLoaded", async () => {
  bindLogin();
  bindFilters();
  bindActions();

  const authed = await ensureAuthOrAsk();
  if (authed) fetchAll().catch(()=>{});

  // автообновление каждые 3 сек
  setInterval(() => {
    if ($("loginModal")?.hidden !== false) { // если модалка скрыта — обновляем
      fetchAll().catch(()=>{});
    }
  }, 3000);
});
