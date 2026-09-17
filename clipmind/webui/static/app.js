const CATEGORY_META = {
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

async function api(path, opts) {
  const res = await fetch(path, opts);
  return res.json();
}

function showToast(msg) {
  const t = el("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => { t.hidden = true; }, 1800);
}

// ---------- Sidebar ----------

function renderNav() {
  const items = [{ key: null, label: "전체", color: null, count: state.stats.total }];
  for (const cat of ALL_CATEGORIES) {
    const count = state.stats.by_category[cat];
    if (!count) continue;
    items.push({ key: cat, label: CATEGORY_META[cat].label, color: CATEGORY_META[cat].color, count });
  }

  navEl.innerHTML = items.map((item) => `
    <div class="nav-item ${item.key === state.activeCategory ? "active" : ""}" data-cat="${item.key ?? ""}">
      <span class="nav-item-label">
        ${item.color ? `<span class="tag-dot tag-${item.color}"></span>` : `<span class="tag-dot" style="background:var(--text-faint)"></span>`}
        <span class="label-text">${item.label}</span>
      </span>
      <span class="nav-count">${item.count}</span>
    </div>
  `).join("");

  navEl.querySelectorAll(".nav-item").forEach((node) => {
    node.addEventListener("click", () => {
      state.activeCategory = node.dataset.cat || null;
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
  return `
    <div class="clip-row ${selected ? "selected" : ""} ${expanded ? "expanded" : ""}" data-id="${clip.id}">
      <div class="clip-check" data-role="check">${selected ? "✓" : ""}</div>
      <div class="clip-body" data-role="body">
        <div class="clip-meta-row">
          ${tagPillHTML(clip.category, clip.subtype)}
          <span class="clip-source">${clip.source_app ? escapeHTML(clip.source_app) : "알 수 없음"}</span>
          ${score !== undefined && score !== null ? `<span class="clip-score">${score}</span>` : ""}
          <span class="clip-time">${relTime(clip.created_at)}</span>
        </div>
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
  state.stats = await api("/api/stats");
  renderNav();
}

async function loadClips() {
  const params = new URLSearchParams();
  if (state.activeCategory) params.set("category", state.activeCategory);
  params.set("limit", "200");
  state.clips = await api(`/api/clips?${params}`);
  el("#list-title").textContent = state.activeCategory
    ? (CATEGORY_META[state.activeCategory]?.label ?? state.activeCategory)
    : "전체";
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

// ---------- Boot ----------

async function boot() {
  await loadStats();
  await loadClips();
}
boot();

// Light polling so the UI stays live as new clips come in from the background monitor.
setInterval(async () => {
  await loadStats();
  if (!state.searchQuery && document.activeElement !== searchInput) {
    if (!searchInput.value) loadClips();
  }
}, 3000);
