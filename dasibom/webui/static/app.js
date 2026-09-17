const CATEGORY_META = {
  image:        { label: "아이디어",   color: "orange" },
  url:          { label: "링크",       color: "blue" },
  email:        { label: "이메일",     color: "purple" },
  path:         { label: "경로",       color: "gray" },
  code:         { label: "코드",       color: "green" },
  korean_text:  { label: "한국어",     color: "brown" },
  english_text: { label: "영어",       color: "yellow" },
  mixed_text:   { label: "혼합 텍스트", color: "gray" },
  short:        { label: "짧은 텍스트", color: "gray" },
};

const SUBTYPE_LABEL = {
  python: "Python", javascript: "JS", html: "HTML", css: "CSS",
  sql: "SQL", shell: "Shell", json: "JSON", generic: "코드",
};

const ALL_CATEGORIES = Object.keys(CATEGORY_META);

const state = {
  activeCategory: null,   // null = 전체
  activeLabel: null,      // AI가 지은 분류로 필터링
  labels: [],
  pendingUnderstanding: 0,
  clips: [],
  stats: { total: 0, by_category: {} },
  selected: new Set(),
  expanded: new Set(),
  searchQuery: "",
  searchDebounce: null,
};

const el = (sel) => document.querySelector(sel);
const listEl = el("#clip-list");
const emptyEl = el("#empty-state");
const navEl = el("#nav-list");

function tagPillHTML(category, subtype) {
  const meta = CATEGORY_META[category] || { label: category, color: "gray" };
  let label = meta.label;
  if (category === "code" && subtype && SUBTYPE_LABEL[subtype]) label = SUBTYPE_LABEL[subtype];
  return `<span class="tag-pill tag-${meta.color}">${label}</span>`;
}

function relTime(unixSeconds) {
  const diff = Date.now() / 1000 - unixSeconds;
  if (diff < 45) return "방금 전";
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}일 전`;
  const d = new Date(unixSeconds * 1000);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

function escapeHTML(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// ---------- Auth (LAN phone pairing) ----------
// The Mac desktop app talks to 127.0.0.1 and never needs this. A phone on the
// same WiFi must pair once (QR scan or manual PIN) to get a bearer token.

function getToken() {
  try { return localStorage.getItem("dasibom_token"); } catch { return null; }
}
function setToken(token) {
  try { localStorage.setItem("dasibom_token", token); } catch { /* ignore */ }
  // Also as a cookie: <img src="/api/images/N"> can't send an Authorization header.
  document.cookie = `dasibom_token=${token}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
}

async function api(path, opts = {}) {
  const token = getToken();
  const headers = Object.assign({}, opts.headers);
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(path, { ...opts, headers });
  if (res.status === 401) {
    showPairOverlay();
    throw new Error("pairing_required");
  }
  return res.json();
}

function showPairOverlay() {
  el("#pair-overlay").hidden = false;
}

async function tryPair(pin) {
  const res = await fetch("/api/pair", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin }),
  });
  if (!res.ok) return false;
  const data = await res.json();
  if (!data.ok) return false;
  setToken(data.token);
  return true;
}

async function autoPairFromURL() {
  const params = new URLSearchParams(location.search);
  const pin = params.get("pin");
  if (!pin) return;
  const ok = await tryPair(pin);
  // Strip the PIN from the visible URL / history either way, so it's never
  // sitting in the address bar or bookmarks.
  const clean = new URL(location.href);
  clean.searchParams.delete("pin");
  history.replaceState({}, "", clean.pathname + clean.search);
  if (ok) showToast("연결됨");
}

el("#pair-submit").addEventListener("click", async () => {
  const pin = el("#pair-pin-input").value.trim();
  const ok = await tryPair(pin);
  if (ok) {
    el("#pair-overlay").hidden = true;
    el("#pair-error").hidden = true;
    boot();
  } else {
    el("#pair-error").hidden = false;
  }
});
el("#pair-pin-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") el("#pair-submit").click();
});

function showToast(msg) {
  const t = el("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => { t.hidden = true; }, 1800);
}

// ---------- Sidebar ----------

// The sidebar is built from labels the local LLM invented, not a list anyone
// hardcoded -- so it reflects what this particular person actually saves.
const LABEL_DOT_COLORS = ["blue", "green", "orange", "purple", "red", "yellow", "pink", "brown", "gray"];
function labelColor(label) {
  let hash = 0;
  for (const ch of label) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return LABEL_DOT_COLORS[hash % LABEL_DOT_COLORS.length];
}

function renderNav() {
  const items = [{ key: null, text: "전체", color: null, count: state.stats.total }];
  for (const { label, count } of state.labels) {
    items.push({ key: label, text: label, color: labelColor(label), count });
  }

  const pending = state.pendingUnderstanding > 0
    ? `<div class="nav-pending">${state.pendingUnderstanding}장 읽는 중…</div>` : "";

  navEl.innerHTML = items.map((item) => `
    <div class="nav-item ${item.key === state.activeLabel ? "active" : ""}" data-label="${item.key ?? ""}">
      <span class="nav-item-label">
        ${item.color ? `<span class="tag-dot tag-${item.color}"></span>` : `<span class="tag-dot" style="background:var(--text-faint)"></span>`}
        <span class="label-text">${item.text}</span>
      </span>
      <span class="nav-count">${item.count}</span>
    </div>
  `).join("") + pending;

  navEl.querySelectorAll(".nav-item").forEach((node) => {
    node.addEventListener("click", () => {
      state.activeLabel = node.dataset.label || null;
      state.selected.clear();
      el("#search-input").value = "";
      state.searchQuery = "";
      el("#search-clear").hidden = true;
      loadClips();
      renderNav();
    });
  });
}

// ---------- Clip list ----------

function clipRowHTML(clip, score) {
  const isCode = clip.category === "code";
  const preview = escapeHTML(clip.content).trim();
  const selected = state.selected.has(clip.id);
  const expanded = state.expanded.has(clip.id);
  const thumb = clip.has_image ? `<img class="clip-thumb" src="/api/images/${clip.id}" alt="">` : "";
  // Show what the AI understood; the raw OCR text is the fallback, since a wall
  // of OCR is exactly what made these screenshots unscannable in the first place.
  const headline = clip.summary
    ? `<div class="clip-summary">${escapeHTML(clip.summary)}</div>`
    : (clip.understood ? "" : `<div class="clip-summary pending">읽는 중…</div>`);
  const labelPill = clip.label
    ? `<span class="tag-pill tag-${labelColor(clip.label)}">${escapeHTML(clip.label)}</span>`
    : "";
  return `
    <div class="clip-row ${selected ? "selected" : ""} ${expanded ? "expanded" : ""}" data-id="${clip.id}">
      <div class="clip-check" data-role="check">${selected ? "✓" : ""}</div>
      <div class="clip-body" data-role="body">
        <div class="clip-meta-row">
          ${labelPill || tagPillHTML(clip.category, clip.subtype)}
          <span class="clip-source">${clip.source_app ? escapeHTML(clip.source_app) : "알 수 없음"}</span>
          ${score !== undefined && score !== null ? `<span class="clip-score">${score}</span>` : ""}
          <span class="clip-time">${relTime(clip.created_at)}</span>
        </div>
        ${headline}
        ${thumb}
        <div class="clip-preview ${isCode ? "code" : ""}">${preview}</div>
      </div>
      <div class="clip-actions">
        <button class="icon-btn" data-role="copy" title="복사">⧉</button>
        <button class="icon-btn" data-role="delete" title="삭제">🗑</button>
      </div>
    </div>
  `;
}

function renderClips() {
  el("#list-count").textContent = state.clips.length;
  if (state.clips.length === 0) {
    listEl.innerHTML = "";
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;
  listEl.innerHTML = state.clips.map((c) => clipRowHTML(c, c.score)).join("");

  listEl.querySelectorAll(".clip-row").forEach((row) => {
    const id = Number(row.dataset.id);

    row.querySelector('[data-role="check"]').addEventListener("click", (e) => {
      e.stopPropagation();
      toggleSelect(id);
    });

    row.querySelector('[data-role="copy"]').addEventListener("click", async (e) => {
      e.stopPropagation();
      await api(`/api/copy/${id}`, { method: "POST" });
      showToast("클립보드에 복사됨");
    });

    row.querySelector('[data-role="delete"]').addEventListener("click", async (e) => {
      e.stopPropagation();
      const btn = e.currentTarget;
      if (btn.dataset.confirm !== "1") {
        btn.dataset.confirm = "1";
        btn.textContent = "확인?";
        setTimeout(() => { btn.dataset.confirm = "0"; btn.textContent = "🗑"; }, 2500);
        return;
      }
      await api(`/api/clips/${id}`, { method: "DELETE" });
      showToast("삭제됨");
      loadStats();
      loadClips();
    });

    row.querySelector('[data-role="body"]').addEventListener("click", () => {
      if (state.expanded.has(id)) state.expanded.delete(id);
      else state.expanded.add(id);
      renderClips();
    });
  });
}

function toggleSelect(id) {
  if (state.selected.has(id)) state.selected.delete(id);
  else state.selected.add(id);
  renderClips();
  renderSelectBar();
}

function renderSelectBar() {
  const bar = el("#select-bar");
  if (state.selected.size === 0) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  el("#select-count").textContent = `${state.selected.size}개 선택됨`;
}

el("#select-cancel").addEventListener("click", () => {
  state.selected.clear();
  renderClips();
  renderSelectBar();
});

el("#select-combine").addEventListener("click", async () => {
  const ids = [...state.selected];
  await api("/api/combine", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  showToast(`${ids.length}개 결합해서 클립보드에 복사됨`);
  state.selected.clear();
  renderClips();
  renderSelectBar();
});

// ---------- Data loading ----------

async function loadStats() {
  const [stats, labelData] = await Promise.all([api("/api/stats"), api("/api/labels")]);
  state.stats = stats;
  state.labels = labelData.labels || [];
  state.pendingUnderstanding = labelData.pending || 0;
  renderNav();
}

async function loadClips() {
  const params = new URLSearchParams();
  if (state.activeLabel) params.set("label", state.activeLabel);
  params.set("limit", "200");
  state.clips = await api(`/api/clips?${params}`);
  el("#list-title").textContent = state.activeLabel ?? "전체";
  renderClips();
}

async function runSearch(query) {
  if (!query.trim()) {
    loadClips();
    return;
  }
  const params = new URLSearchParams({ q: query, top_k: "50" });
  if (state.activeCategory) params.set("category", state.activeCategory);
  state.clips = await api(`/api/search?${params}`);
  el("#list-title").textContent = `“${query}” 검색 결과`;
  renderClips();
}

// ---------- Search input ----------

const searchInput = el("#search-input");
searchInput.addEventListener("input", () => {
  const q = searchInput.value;
  el("#search-clear").hidden = q.length === 0;
  clearTimeout(state.searchDebounce);
  state.searchDebounce = setTimeout(() => runSearch(q), 260);
});
el("#search-clear").addEventListener("click", () => {
  searchInput.value = "";
  el("#search-clear").hidden = true;
  loadClips();
  searchInput.focus();
});

// ---------- Suggest ----------

el("#suggest-btn").addEventListener("click", async () => {
  const data = await api("/api/suggest");
  const banner = el("#suggest-banner");
  const appLabel = data.app_name || "알 수 없는 앱";
  const catLabel = data.category ? ` · ${CATEGORY_META[data.category]?.label ?? data.category} 맥락으로 좁힘` : "";
  el("#suggest-title").textContent = `✦ 지금 “${appLabel}”${catLabel}`;

  if (!data.results.length) {
    el("#suggest-items").innerHTML = `<div class="suggest-item">추천할 게 없어요</div>`;
  } else {
    el("#suggest-items").innerHTML = data.results.map((r) => `
      <div class="suggest-item" data-id="${r.id}">${tagPillHTML(r.category, r.subtype)} ${escapeHTML(r.content).trim().slice(0, 80)}</div>
    `).join("");
    el("#suggest-items").querySelectorAll(".suggest-item").forEach((node) => {
      node.addEventListener("click", async () => {
        const id = node.dataset.id;
        if (!id) return;
        await api(`/api/copy/${id}`, { method: "POST" });
        showToast("클립보드에 복사됨");
      });
    });
  }
  banner.hidden = false;
});
el("#suggest-close").addEventListener("click", () => { el("#suggest-banner").hidden = true; });

// ---------- Quick add (phone paste -> send, since iOS won't let us watch the
// clipboard automatically -- see the modal's own explanation text) ----------

el("#quickadd-btn").addEventListener("click", () => {
  el("#quickadd-modal").hidden = false;
  el("#quickadd-text").value = "";
  el("#quickadd-text").focus();
});
el("#quickadd-close").addEventListener("click", () => { el("#quickadd-modal").hidden = true; });

async function uploadOneScreenshot(file) {
  const form = new FormData();
  form.append("image", file);
  const token = getToken();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch("/api/clips/image", { method: "POST", body: form, headers });
  if (res.status === 401) throw new Error("pairing_required");
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "failed");
  return data;
}

el("#quickadd-image").addEventListener("change", async (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  if (!files.length) return;

  const progress = el("#upload-progress");
  const fill = el("#upload-bar-fill");
  const status = el("#quickadd-status");
  progress.hidden = false;

  // Sequential, not parallel: OCR is CPU-bound on the Mac, and firing 50 requests
  // at once would just queue them behind each other while starving the UI poll.
  let done = 0, ocrHits = 0, failed = 0;
  for (const file of files) {
    status.textContent = `글자를 읽는 중… ${done + 1} / ${files.length}`;
    try {
      const data = await uploadOneScreenshot(file);
      if (data.ocr_text) ocrHits++;
    } catch (err) {
      if (err.message === "pairing_required") { showPairOverlay(); progress.hidden = true; return; }
      failed++;
    }
    done++;
    fill.style.width = `${Math.round((done / files.length) * 100)}%`;
  }

  progress.hidden = true;
  fill.style.width = "0%";
  el("#quickadd-modal").hidden = true;
  const parts = [`${done - failed}장 저장됨`];
  if (ocrHits) parts.push(`${ocrHits}장에서 글자 읽음`);
  if (failed) parts.push(`${failed}장 실패`);
  showToast(parts.join(" · "));
  loadStats();
  loadClips();
});

el("#quickadd-submit").addEventListener("click", async () => {
  const content = el("#quickadd-text").value.trim();
  if (!content) return;
  try {
    await api("/api/clips", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    el("#quickadd-modal").hidden = true;
    showToast("추가됨");
    loadStats();
    loadClips();
  } catch (e) {
    if (e.message !== "pairing_required") throw e;
  }
});

// ---------- Phone-connect modal (shown from the desktop app only: /api/pair-info
// and /api/qr.png only answer to localhost, so this just no-ops on a phone) ----------

el("#phone-connect-btn").addEventListener("click", async () => {
  try {
    const info = await api("/api/pair-info");
    el("#phone-qr").src = `/api/qr.png?_=${Date.now()}`;
    el("#phone-url").textContent = info.hostname_url || info.lan_url;
    el("#phone-pin").textContent = info.pin;
    el("#phone-modal").hidden = false;
  } catch {
    showToast("폰 연결 정보는 컴퓨터 앱에서만 볼 수 있어요");
  }
});
el("#phone-modal-close").addEventListener("click", () => { el("#phone-modal").hidden = true; });

// ---------- Resurface: old idea screenshots you never went back to ----------

async function loadResurface() {
  let items;
  try {
    items = await api("/api/resurface");
  } catch (e) {
    if (e.message !== "pairing_required") throw e;
    return;
  }
  if (!items.length) return;

  const anyUpcoming = items.some((r) => r.kind === "upcoming");
  el("#resurface-title").textContent = anyUpcoming ? "⏰ 곧 다가와요" : "💡 잊고 있던 아이디어";

  el("#resurface-items").innerHTML = items.map((r) => `
    <div class="resurface-card ${r.kind === "upcoming" ? "upcoming" : ""}" data-id="${r.id}">
      <img src="/api/images/${r.id}" alt="">
      <div class="resurface-caption">
        ${r.reason ? `<span class="resurface-reason">${escapeHTML(r.reason)}</span>` : ""}
        ${escapeHTML(r.summary || r.content).trim().slice(0, 50)}
      </div>
    </div>
  `).join("");

  el("#resurface-items").querySelectorAll(".resurface-card").forEach((node) => {
    node.addEventListener("click", () => {
      const id = Number(node.dataset.id);
      state.expanded.add(id);
      el("#resurface-banner").hidden = true;
      loadClips().then(() => {
        const row = listEl.querySelector(`.clip-row[data-id="${id}"]`);
        if (row) row.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    });
  });
  el("#resurface-banner").hidden = false;
}

el("#resurface-close").addEventListener("click", () => { el("#resurface-banner").hidden = true; });

// ---------- Boot ----------

async function boot() {
  try {
    await loadStats();
    await loadClips();
  } catch (e) {
    if (e.message !== "pairing_required") throw e;
  }
}

(async () => {
  await autoPairFromURL();
  await boot();
  await loadResurface();
})();

// Light polling so the UI stays live as new clips come in from the background monitor.
setInterval(async () => {
  if (!getToken() && !el("#pair-overlay").hidden) return; // not paired yet, nothing to poll
  try {
    await loadStats();
    if (!state.searchQuery && document.activeElement !== searchInput) {
      if (!searchInput.value) loadClips();
    }
  } catch (e) {
    if (e.message !== "pairing_required") throw e;
  }
}, 3000);
