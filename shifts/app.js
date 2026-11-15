(function () {
  "use strict";

  const STORE_KEY = "shiftapp.v1";
  const SHIFTS = window.SHIFTS;
  const ORDER = ["morning", "evening", "night"];
  const DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

  const app = document.getElementById("app");
  const sheet = document.getElementById("sheet");
  const backdrop = document.getElementById("sheet-backdrop");
  const toastEl = document.getElementById("toast");

  // ---------- Storage ----------
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    return { active: null, history: [] };
  }
  let state = load();
  state.settings = state.settings || { name: "" };
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { toast("שגיאה בשמירה"); }
  }

  // ---------- Helpers ----------
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pad = (n) => String(n).padStart(2, "0");
  const hhmm = (d) => pad(d.getHours()) + ":" + pad(d.getMinutes());
  const dateStr = (d) => pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + "/" + d.getFullYear();
  const dayName = (d) => "יום " + DAYS[d.getDay()];
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toastEl.classList.remove("show"), 1800);
  }

  // The calendar day the shift "belongs" to (night shift started after midnight → previous day).
  function shiftBaseDate(rec) {
    const d = new Date(rec.startedAt);
    if (rec.type === "night" && d.getHours() < 12) d.setDate(d.getDate() - 1);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  // Minutes from shift start, so ordering works across midnight.
  function relMin(type, t) {
    let m = toMin(t) - SHIFTS[type].start * 60;
    if (m < -120) m += 1440;
    return m;
  }

  function sortKey(type, task) {
    return relMin(type, task.time || SHIFTS[type].anytimeAt);
  }

  // Absolute Date when a timed task is due.
  function dueDate(rec, task) {
    if (!task.time) return null;
    const base = shiftBaseDate(rec);
    return new Date(base.getTime() + (SHIFTS[rec.type].start * 60 + relMin(rec.type, task.time)) * 60000);
  }

  function suggestedShift(now) {
    const h = now.getHours();
    if (h >= 6 && h < 14) return "morning";
    if (h >= 14 && h < 22) return "evening";
    return "night";
  }

  function stats(rec) {
    const total = rec.tasks.length;
    const done = rec.tasks.filter((t) => t.doneAt).length;
    return { total, done, pct: total ? Math.round((done / total) * 100) : 0 };
  }

  // ---------- Shift lifecycle ----------
  function startShift(type) {
    const now = new Date();
    const rec = { id: uid(), type, startedAt: now.toISOString(), endedAt: null, note: "", tasks: [] };
    const base = shiftBaseDate(rec);
    const isFriday = base.getDay() === 5;
    rec.tasks = SHIFTS[type].tasks
      .filter((t) => !t.fridayOnly || isFriday)
      .map((t) => ({ id: t.id, time: t.time, until: t.until || null, title: t.title, detail: t.detail || "", fridayOnly: !!t.fridayOnly, doneAt: null, note: "" }));
    state.active = rec;
    save();
    go("shift");
  }

  function endShift() {
    const rec = state.active;
    if (!rec) return;
    rec.endedAt = new Date().toISOString();
    state.history.unshift(rec);
    state.history = state.history.slice(0, 200);
    state.active = null;
    save();
  }

  // ---------- Summary text (for WhatsApp / mail) ----------
  function summaryText(rec) {
    const s = SHIFTS[rec.type];
    const base = shiftBaseDate(rec);
    const st = stats(rec);
    const lines = [];
    lines.push(`${s.icon} ${s.name} – ${dayName(base)} ${dateStr(base)}`);
    lines.push(`התחלה: ${hhmm(new Date(rec.startedAt))}` + (rec.endedAt ? ` | סיום: ${hhmm(new Date(rec.endedAt))}` : ""));
    lines.push(`בוצעו ${st.done} מתוך ${st.total} משימות`);
    lines.push("");
    sortedTasks(rec).forEach((t) => {
      const mark = t.doneAt ? "✅" : "⬜️";
      const when = t.doneAt ? ` (${hhmm(new Date(t.doneAt))})` : "";
      lines.push(`${mark} ${t.time ? t.time + " " : ""}${t.title}${when}`);
      if (t.note) lines.push(`   📝 ${t.note}`);
    });
    if (rec.note) { lines.push(""); lines.push("הערות כלליות:"); lines.push(rec.note); }
    return lines.join("\n");
  }

  async function shareText(text) {
    if (navigator.share) {
      try { await navigator.share({ text }); return; } catch (e) { if (e && e.name === "AbortError") return; }
    }
    try { await navigator.clipboard.writeText(text); toast("הסיכום הועתק"); }
    catch (e) { toast("לא ניתן להעתיק"); }
  }

  function sortedTasks(rec) {
    return rec.tasks
      .map((t, i) => ({ t, i }))
      .sort((a, b) => sortKey(rec.type, a.t) - sortKey(rec.type, b.t) || a.i - b.i)
      .map((x) => x.t);
  }

  // ---------- Routing ----------
  let route = { name: "home", id: null };
  let shiftTab = "tasks";
  function go(name, id) {
    route = { name, id: id || null };
    shiftTab = "tasks";
    render();
    window.scrollTo(0, 0);
  }

  function render() {
    closeSheet(true);
    if (route.name === "shift" && state.active) return renderShift(state.active, false);
    if (route.name === "history-view") {
      const rec = state.history.find((r) => r.id === route.id);
      if (rec) return renderShift(rec, true);
    }
    if (route.name === "history") return renderHistory();
    renderHome();
  }

  // ---------- Icons ----------
  const ICON = {
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 002 2h10a2 2 0 002-2v-6"/></svg>',
    doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>'
  };

  // ---------- Home ----------
  function renderHome() {
    const now = new Date();
    const sug = suggestedShift(now);
    const a = state.active;
    let html = `<div class="screen">
      <div class="topbar">
        <div class="eyebrow">${dayName(now)} · ${dateStr(now)}</div>
        <div class="icon-row">
          <button class="icon-btn" data-act="settings" aria-label="הגדרות">${ICON.gear}</button>
          <button class="icon-btn" data-act="history" aria-label="היסטוריה">${ICON.clock}</button>
        </div>
      </div>
      <h1>${greeting(now)} 👋</h1>`;

    if (a) {
      const s = SHIFTS[a.type], st = stats(a);
      html += `<button class="resume ${a.type}" data-act="resume">
        <div class="s">משמרת פעילה · התחילה ב־${hhmm(new Date(a.startedAt))}</div>
        <div class="t">${s.icon} ${s.name}</div>
        <div class="s">${st.done} מתוך ${st.total} משימות הושלמו</div>
        <div class="bar"><i style="width:${st.pct}%"></i></div>
      </button>`;
      html += `<h2>משמרת אחרת</h2>`;
    } else {
      html += `<h2>איזו משמרת היום?</h2>`;
    }

    html += `<div class="shift-grid">` + ORDER.map((k) => {
      const s = SHIFTS[k];
      const n = s.tasks.filter((t) => !t.fridayOnly || now.getDay() === 5 || k !== "evening").length;
      return `<button class="shift-card ${k}" data-act="start" data-type="${k}">
        <div class="shift-emoji">${s.icon}</div>
        <div class="grow">
          <div class="t">${s.name}${k === sug && !a ? '<span class="badge">עכשיו</span>' : ""}</div>
          <div class="s">${s.hours} · ${n} משימות</div>
        </div>
        <div class="chev">›</div>
      </button>`;
    }).join("") + `</div>`;

    const recent = state.history.slice(0, 3);
    if (recent.length) {
      html += `<h2>משמרות אחרונות</h2>` + recent.map(historyItem).join("");
    }
    html += `</div>`;
    app.innerHTML = html;
  }

  function greeting(d) {
    const h = d.getHours();
    if (h >= 5 && h < 12) return "בוקר טוב";
    if (h >= 12 && h < 17) return "צהריים טובים";
    if (h >= 17 && h < 22) return "ערב טוב";
    return "לילה טוב";
  }

  function historyItem(rec) {
    const s = SHIFTS[rec.type], st = stats(rec), base = shiftBaseDate(rec);
    return `<button class="history-item ${rec.type}" data-act="view" data-id="${rec.id}">
      <div class="dot">${s.icon}</div>
      <div style="flex:1;min-width:0">
        <div class="t">${s.name}</div>
        <div class="s">${dayName(base)} ${dateStr(base)} · ${hhmm(new Date(rec.startedAt))}–${rec.endedAt ? hhmm(new Date(rec.endedAt)) : ""}</div>
      </div>
      <div class="pct">${st.done}/${st.total}</div>
    </button>`;
  }

  // ---------- History ----------
  function renderHistory() {
    app.innerHTML = `<div class="screen">
      <div class="topbar">
        <button class="icon-btn" data-act="home" aria-label="חזרה">${ICON.back}</button>
        <div></div>
      </div>
      <h1>היסטוריית משמרות</h1>
      ${state.history.length ? state.history.map(historyItem).join("") : '<div class="empty">עוד אין משמרות שהסתיימו.</div>'}
    </div>`;
  }

  // ---------- Shift ----------
  function renderShift(rec, readOnly) {
    const s = SHIFTS[rec.type];
    const st = stats(rec);
    const base = shiftBaseDate(rec);
    const now = new Date();
    const C = 2 * Math.PI * 27;
    const tab = rec.type === "night" ? shiftTab : "tasks";

    let html = `<div class="screen">
      <div class="topbar">
        <button class="icon-btn" data-act="${readOnly ? "history" : "home"}" aria-label="חזרה">${ICON.back}</button>
        <button class="icon-btn" data-act="share" aria-label="שיתוף סיכום">${ICON.share}</button>
      </div>
      <div class="eyebrow">${dayName(base)} · ${dateStr(base)}${readOnly ? " · הסתיימה" : ""}</div>
      <h1>${s.icon} ${s.name}</h1>
      ${rec.type === "night" ? tabsHtml(rec, tab) : ""}`;

    if (tab !== "tasks") {
      html += tab === "kabat" ? kabatHtml(rec) : fridgeHtml(rec);
      html += `</div><div class="bottom-bar"><div class="inner"><button class="btn primary" data-act="export" data-type="${tab}">${ICON.doc} הפקת ${tab === "kabat" ? "דוח קב״ט" : "דוח מקררים"}</button></div></div>`;
      app.innerHTML = html;
      return;
    }

    html += `<div class="progress-card">
        <div class="ring ${st.done === st.total && st.total ? "complete" : ""}">
          <svg viewBox="0 0 64 64"><circle class="track" cx="32" cy="32" r="27" fill="none" stroke-width="7"/>
          <circle class="val" cx="32" cy="32" r="27" fill="none" stroke-width="7" stroke-linecap="round"
            stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - st.pct / 100)}"/></svg>
          <span>${st.pct}%</span>
        </div>
        <div>
          <div class="t">${st.done === st.total && st.total ? "כל המשימות הושלמו 🎉" : `${st.done} מתוך ${st.total} הושלמו`}</div>
          <div class="s">התחלה ${hhmm(new Date(rec.startedAt))}${rec.endedAt ? " · סיום " + hhmm(new Date(rec.endedAt)) : ""}</div>
        </div>
      </div>`;

    let lastLabel = null;
    sortedTasks(rec).forEach((t) => {
      const label = t.time ? (t.until ? `${t.time} – ${t.until}` : t.time) : s.anytimeLabel;
      if (label !== lastLabel) {
        html += `<div class="group-label">${esc(label)}</div>`;
        lastLabel = label;
      }
      const due = dueDate(rec, t);
      const isDue = !readOnly && !t.doneAt && due && now >= due;
      const chips = [];
      if (t.doneAt) chips.push(`<span class="chip ok">בוצע ${hhmm(new Date(t.doneAt))}</span>`);
      else if (isDue) chips.push(`<span class="chip warn">הגיע הזמן</span>`);
      if (t.fridayOnly) chips.push(`<span class="chip fri">שישי בלבד</span>`);
      if (t.custom) chips.push(`<span class="chip">נוספה ידנית</span>`);
      if (t.note) chips.push(`<span class="chip note">📝 ${esc(t.note.length > 28 ? t.note.slice(0, 28) + "…" : t.note)}</span>`);

      html += `<div class="task ${t.doneAt ? "done" : ""} ${isDue ? "due" : ""}">
        <button class="check" data-act="toggle" data-id="${t.id}" aria-label="סימון כבוצע" ${readOnly ? "disabled" : ""}>${ICON.check}</button>
        <button class="body" data-act="open" data-id="${t.id}">
          <div class="title">${esc(t.title)}</div>
          ${t.detail ? `<div class="detail">${esc(t.detail)}</div>` : ""}
          ${chips.length ? `<div class="meta">${chips.join("")}</div>` : ""}
        </button>
      </div>`;
    });

    if (!readOnly) html += `<button class="add-task" data-act="add">+ הוספת משימה</button>`;

    html += `<h2>הערות כלליות למשמרת</h2>
      <button class="task" data-act="shift-note" style="width:100%">
        <div class="body"><div class="${rec.note ? "" : "detail"}" style="white-space:pre-wrap">${rec.note ? esc(rec.note) : "הקש כדי להוסיף הערה כללית…"}</div></div>
      </button>`;
    html += `</div>`;

    html += `<div class="bottom-bar"><div class="inner">` + (readOnly
      ? `<button class="btn danger small" data-act="delete">מחיקה</button><button class="btn primary small" data-act="share">${ICON.share} שיתוף סיכום</button>`
      : `<button class="btn primary" data-act="end">סיום משמרת</button>`) + `</div></div>`;

    app.innerHTML = html;
  }

  // =====================================================================
  // דוחות: קב"ט לילה + מקררים
  // =====================================================================
  const R = window.REPORTS;
  const TPL_KEY = (type) => "shiftapp.tpl." + type;
  const REPORT_NAME = { kabat: "דוח קב״ט לילה", fridge: "דוח מקררים" };
  const REPORT_FALLBACK = { kabat: "דוח קבט לילה", fridge: "דוח מקררים" };
  const nowHM = () => hhmm(new Date());

  function getTpl(type) {
    try { return JSON.parse(localStorage.getItem(TPL_KEY(type)) || "null"); } catch (e) { return null; }
  }
  function bufToB64(buf) {
    const bytes = new Uint8Array(buf); let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function b64ToBuf(b64) {
    const bin = atob(b64); const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }

  function ensureKabat(rec) {
    if (!rec.kabat) rec.kabat = { officer: state.settings.name || "", reception: "", guard: "", occupancy: "", checks: {}, texts: {} };
    return rec.kabat;
  }
  function ensureFridge(rec) {
    if (!rec.fridge) rec.fridge = { t1: "", t2: "", pt1: "", pt2: "", vals: {}, notes: {}, note: "" };
    return rec.fridge;
  }
  function prevNight(rec) {
    return state.history.find((r) => r.type === "night" && r.id !== rec.id && r.fridge);
  }

  function tabsHtml(rec, tab) {
    const k = ensureKabat(rec), f = ensureFridge(rec);
    const kTotal = R.KABAT_SECTIONS.reduce((n, s) => n + s.items.reduce((m, it) => m + (it.mode === "double" ? 2 : 1), 0), 0);
    const kDone = Object.values(k.checks).filter((c) => c && c.time).length;
    const fDone = R.FRIDGES.filter((fr) => !fr.fixed).length;
    const fFilled = R.FRIDGES.filter((fr) => !fr.fixed && (f.vals[fr.k] || [])[fridgeRound - 1]).length;
    const b = (id, label, sub) => `<button class="seg-btn ${tab === id ? "on" : ""}" data-act="tab" data-tab="${id}">${label}${sub ? `<small>${sub}</small>` : ""}</button>`;
    const st = stats(rec);
    return `<div class="seg">${b("tasks", "משימות", `${st.done}/${st.total}`)}${b("kabat", "דוח קב״ט", `${kDone}/${kTotal}`)}${b("fridge", "מקררים", `${fFilled}/${fDone}`)}</div>`;
  }

  // ---------- Kabat tab ----------
  function checkSlot(k, key, mode, label) {
    const c = k.checks[key];
    if (c && c.time) {
      const bad = c.status === "issue";
      const txt = mode === "done" ? `${c.time} · בוצע` : `${c.time} · ${bad ? "תקלה" : "תקין"}`;
      return `<button class="cchip ${bad ? "bad" : "ok"}" data-act="ck-edit" data-k="${key}" data-mode="${mode}">${label ? `<b>${label}</b> ` : ""}${esc(txt)}</button>`;
    }
    if (mode === "done") return `<button class="mini go" data-act="ck-ok" data-k="${key}">${label ? label + " · " : ""}בוצע</button>`;
    return `${label ? `<span class="slot-l">${label}</span>` : ""}<button class="mini ok" data-act="ck-ok" data-k="${key}">תקין</button><button class="mini bad" data-act="ck-issue" data-k="${key}">תקלה</button>`;
  }

  function kabatHtml(rec) {
    const k = ensureKabat(rec);
    const field = (path, label, val, extra) => `<label class="fld"><span>${label}</span><input type="text" data-bind="${path}" value="${esc(val)}" ${extra || ""}></label>`;
    let html = `<div class="card">
      <div class="card-h">פרטי משמרת</div>
      <div class="grid2">
        ${field("kabat.officer", "קב״ט במשמרת", k.officer)}
        ${field("kabat.reception", "פקיד קבלה", k.reception)}
        ${field("kabat.guard", "מאבטח כניסה", k.guard)}
        ${field("kabat.occupancy", "תפוסה", k.occupancy, 'inputmode="numeric"')}
      </div>
    </div>`;
    R.KABAT_SECTIONS.forEach((sec) => {
      const total = sec.items.reduce((m, it) => m + (it.mode === "double" ? 2 : 1), 0);
      const done = sec.items.reduce((m, it) => m + (it.mode === "double"
        ? [1, 2].filter((n) => (k.checks[it.k + "_" + n] || {}).time).length
        : ((k.checks[it.k] || {}).time ? 1 : 0)), 0);
      html += `<div class="card"><div class="card-h">${esc(sec.title)}${total ? `<span class="count ${done === total ? "full" : ""}">${done}/${total}</span>` : ""}</div>`;
      if (sec.hint) html += `<div class="card-hint">${esc(sec.hint)}</div>`;
      sec.items.forEach((it) => {
        html += `<div class="crow"><div class="clabel">${esc(it.label)}</div><div class="cact">`;
        if (it.mode === "double") html += `<div class="dbl">${checkSlot(k, it.k + "_1", "status", "סבב 1")}</div><div class="dbl">${checkSlot(k, it.k + "_2", "status", "סבב 2")}</div>`;
        else html += checkSlot(k, it.k, it.mode);
        html += `</div></div>`;
      });
      (sec.texts || []).forEach((t) => {
        const v = k.texts[t.k] != null ? k.texts[t.k] : (t.def || "");
        html += `<label class="fld wide"><span>${esc(t.label)}</span><input type="text" data-bind="kabat.texts.${t.k}" value="${esc(v)}"></label>`;
      });
      html += `</div>`;
    });
    html += `<div class="card"><div class="card-h">הערות על הלילה</div>
      <textarea class="ta" data-bind="kabat.texts.nightNotes" placeholder="אירועים חריגים במהלך הלילה…">${esc(k.texts.nightNotes || "")}</textarea></div>`;
    return html;
  }

  function openCheck(rec, key, mode, issueFirst) {
    const k = ensureKabat(rec);
    const c = k.checks[key] || { time: nowHM(), status: issueFirst ? "issue" : "ok", issue: "" };
    const isNew = !k.checks[key];
    openSheet(`
      <h3>${issueFirst ? "דיווח תקלה" : "עריכת בדיקה"}</h3>
      <label for="ck-time">שעת בדיקה</label>
      <input type="time" id="ck-time" value="${esc(c.time)}">
      ${mode === "done" ? "" : `
      <label>מצב</label>
      <div class="seg small">
        <button class="seg-btn ${c.status !== "issue" ? "on" : ""}" data-sact="ck-st" data-st="ok">תקין</button>
        <button class="seg-btn ${c.status === "issue" ? "on bad" : ""}" data-sact="ck-st" data-st="issue">תקלה</button>
      </div>
      <div id="ck-issue-wrap" ${c.status === "issue" ? "" : "hidden"}>
        <label for="ck-issue">מה התקלה?</label>
        <input type="text" id="ck-issue" value="${esc(c.issue || "")}" placeholder="לדוגמה: עגלה בחדר מדרגות פנימי">
      </div>`}
      <div class="row">
        ${isNew ? `<button class="btn" data-sact="close">ביטול</button>` : `<button class="btn danger small" data-sact="ck-del" data-k="${key}" style="flex:.6">ניקוי</button>`}
        <button class="btn primary" data-sact="ck-save" data-k="${key}" data-mode="${mode}">שמירה</button>
      </div>`);
    sheet.dataset.status = c.status;
    if (issueFirst) setTimeout(() => { const i = sheet.querySelector("#ck-issue"); if (i) i.focus(); }, 250);
  }

  // ---------- Fridge tab ----------
  let fridgeRound = (() => { const h = new Date().getHours(); return h >= 1 && h < 12 ? 2 : 1; })();

  function fridgeHtml(rec) {
    const f = ensureFridge(rec);
    const r = fridgeRound, i = r - 1, o = r === 1 ? 1 : 0;
    const prev = prevNight(rec);
    const pv = (key) => prev && prev.fridge.vals[key] ? prev.fridge.vals[key][i] || "" : "";
    let html = `<div class="seg">
      <button class="seg-btn ${r === 1 ? "on" : ""}" data-act="fr-round" data-r="1">סבב 1<small>${f.t1 || "23:00"}</small></button>
      <button class="seg-btn ${r === 2 ? "on" : ""}" data-act="fr-round" data-r="2">סבב 2<small>${f.t2 || "03:00"}</small></button>
    </div>
    <div class="card">
      <div class="card-h">מקררי מטבח<span class="count">שעת בדיקה <input type="time" class="tsm" data-bind="fridge.t${r}" value="${esc(f["t" + r])}"></span></div>`;
    R.FRIDGES.forEach((fr) => {
      const v = (f.vals[fr.k] || [])[i] || "";
      const other = (f.vals[fr.k] || [])[o] || "";
      const note = f.notes[fr.k] || "";
      html += `<div class="frow ${fr.fixed ? "fixed" : ""}">
        <div class="fno">${esc(fr.no)}</div>
        <div class="fname">${esc(fr.name)}
          <div class="fsub">${other ? `סבב ${o + 1}: <bdi dir="ltr">${esc(other)}</bdi>` : ""}${note ? ` · 📝 ${esc(note)}` : ""}</div>
        </div>`;
      if (fr.fixed) {
        html += `<div class="fval-fixed">${esc(fr.fixed)} 🔒</div></div>`;
        return;
      }
      const quick = ["הפשרה"].concat(fr.def ? [fr.def] : []);
      html += `<div class="fin">
          <button class="pm" data-act="fr-sign" data-k="${fr.k}" aria-label="פלוס/מינוס">±</button>
          <input class="tin" type="text" inputmode="decimal" data-fk="${fr.k}" data-neg="${fr.neg ? 1 : 0}" value="${esc(v)}" placeholder="${esc(pv(fr.k))}">
        </div>
      </div>
      <div class="fquick">${quick.map((q) => `<button class="qchip ${v === q ? "on" : ""}" data-act="fr-quick" data-k="${fr.k}" data-v="${q}">${q}</button>`).join("")}<button class="qchip" data-act="fr-note" data-k="${fr.k}">📝 הערה</button></div>`;
    });
    html += `</div>
    <div class="card">
      <div class="card-h">מקררי בריכה<span class="count">שעת בדיקה <input type="time" class="tsm" data-bind="fridge.pt${r}" value="${esc(f["pt" + r])}"></span></div>`;
    R.POOL.forEach((p) => {
      const v = (f.vals[p.k] || [])[i] || "";
      html += `<div class="crow"><div class="clabel">${esc(p.name)}${f.notes[p.k] ? `<div class="fsub">📝 ${esc(f.notes[p.k])}</div>` : ""}</div><div class="cact">
        <button class="mini ${v === "תקין" ? "ok on" : "ok"}" data-act="fr-pool" data-k="${p.k}" data-v="תקין">תקין</button>
        <button class="mini ${v && v !== "תקין" ? "bad on" : "bad"}" data-act="fr-note" data-k="${p.k}" data-pool="1">${v && v !== "תקין" ? esc(v) : "תקלה"}</button>
      </div></div>`;
    });
    html += `<div class="card-hint">לוודא תקינות במקררי סאנסט והבריכה, לצלם ולשלוח לקבוצת סיורי לילה.</div></div>
    <div class="card"><div class="card-h">הערות</div>
      <textarea class="ta" data-bind="fridge.note" placeholder="הערות לדוח המקררים…">${esc(f.note || "")}</textarea></div>`;
    return html;
  }

  function setFridgeVal(rec, key, value, pool) {
    const f = ensureFridge(rec);
    const i = fridgeRound - 1;
    f.vals[key] = f.vals[key] || ["", ""];
    f.vals[key][i] = value;
    const tk = (pool ? "pt" : "t") + fridgeRound;
    let stamped = false;
    if (value && !f[tk]) { f[tk] = nowHM(); stamped = true; }
    save();
    return stamped;
  }

  function openFridgeNote(rec, key, pool) {
    const f = ensureFridge(rec);
    const item = pool ? R.POOL.find((p) => p.k === key) : R.FRIDGES.find((p) => p.k === key);
    const v = (f.vals[key] || [])[fridgeRound - 1] || "";
    openSheet(`
      <h3>${esc(item.name)}</h3>
      ${pool ? `<label for="fr-pool-v">מה המצב? (סבב ${fridgeRound})</label>
      <input type="text" id="fr-pool-v" value="${esc(v === "תקין" ? "" : v)}" placeholder="לדוגמה: לא מקרר">` : ""}
      <label for="fr-note">הערה (עמודת "הערות" בדוח)</label>
      <input type="text" id="fr-note" value="${esc(f.notes[key] || "")}">
      <div class="row"><button class="btn" data-sact="close">ביטול</button><button class="btn primary" data-sact="fr-note-save" data-k="${key}" data-pool="${pool ? 1 : 0}">שמירה</button></div>`);
  }

  // ---------- Export ----------
  async function exportReport(rec, type) {
    const tpl = getTpl(type);
    if (!tpl) { openTplSheet(type, true); return; }
    toast("מכין את הקובץ…");
    try {
      const base = shiftBaseDate(rec);
      const k = ensureKabat(rec);
      const data = type === "kabat" ? k : ensureFridge(rec);
      const blob = await R.build(type, b64ToBuf(tpl.b64), data, { base, officer: k.officer || state.settings.name || "" });
      const name = R.fileName(tpl.name, REPORT_FALLBACK[type], base);
      const file = new File([blob], name, { type: R.DOCX_MIME });
      const url = URL.createObjectURL(blob);
      openSheet(`
        <h3>${REPORT_NAME[type]} מוכן ✓</h3>
        <p class="desc">📄 ${esc(name.replace(/\.docx$/i, ""))}</p>
        <div class="row col">
          <button class="btn primary" data-sact="share-file">${ICON.share} שליחה / שיתוף (וואטסאפ, מייל…)</button>
          <a class="btn" href="${url}" download="${esc(name)}">שמירה בקבצים</a>
        </div>`);
      sheet._file = file;
    } catch (e) {
      openSheet(`<h3>לא הצלחתי להפיק את הדוח</h3><p class="desc">${esc(e.message || e)}</p>
        <div class="row"><button class="btn" data-sact="close">סגירה</button><button class="btn primary" data-sact="tpl-open" data-type="${type}">טעינת תבנית מחדש</button></div>`);
    }
  }

  function openTplSheet(type, thenExport) {
    const tpl = getTpl(type);
    openSheet(`
      <h3>תבנית ${REPORT_NAME[type]}</h3>
      <p class="desc">בוחרים פעם אחת את קובץ ה־Word המקורי של ${REPORT_NAME[type]} (מהקבצים / מוואטסאפ). האפליקציה שומרת אותו רק בטלפון שלך וממלאת אותו בכל משמרת – בדיוק באותו עיצוב, ובאותו שם קובץ עם התאריך של המשמרת.</p>
      ${tpl ? `<div class="done-row">✓ טעונה: <span dir="auto">${esc(tpl.name)}</span></div>` : ""}
      <label class="btn primary file-btn">${tpl ? "החלפת קובץ" : "בחירת קובץ Word"}
        <input type="file" accept=".docx,${R.DOCX_MIME}" data-tpl="${type}" data-then="${thenExport ? 1 : 0}" hidden>
      </label>
      <div class="row"><button class="btn" data-sact="close">סגירה</button></div>`);
  }

  async function loadTplFile(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    const want = input.dataset.tpl;
    try {
      const buf = await file.arrayBuffer();
      const kind = await R.checkTemplate(buf);
      if (!kind) { toast("הקובץ לא מתאים לאף אחד מהדוחות"); return; }
      localStorage.setItem(TPL_KEY(kind), JSON.stringify({ name: file.name, b64: bufToB64(buf), at: Date.now() }));
      toast(`נטענה תבנית ${REPORT_NAME[kind]}`);
      if (kind !== want) { openTplSheet(want, input.dataset.then === "1"); return; }
      const rec = currentRec();
      if (input.dataset.then === "1" && rec) exportReport(rec, kind);
      else if (sheet.dataset.view === "settings") openSettings();
      else openTplSheet(kind, false);
    } catch (e) {
      toast("לא הצלחתי לקרוא את הקובץ: " + (e && e.message || e));
    }
  }

  function openSettings() {
    const row = (type) => {
      const t = getTpl(type);
      return `<div class="crow"><div class="clabel">${REPORT_NAME[type]}<div class="fsub" dir="auto">${t ? esc(t.name) : "לא נטענה תבנית"}</div></div>
        <div class="cact"><label class="mini ${t ? "" : "go"} file-btn">${t ? "החלפה" : "טעינה"}<input type="file" accept=".docx,${R.DOCX_MIME}" data-tpl="${type}" hidden></label></div></div>`;
    };
    openSheet(`
      <h3>הגדרות</h3>
      <label for="set-name">השם שלך (קב״ט)</label>
      <input type="text" id="set-name" value="${esc(state.settings.name)}" placeholder="לדוגמה: לוטן">
      <label>תבניות הדוחות (קובצי Word מקוריים)</label>
      ${row("kabat")}${row("fridge")}
      <div class="row"><button class="btn" data-sact="close">סגירה</button><button class="btn primary" data-sact="settings-save">שמירה</button></div>`);
    sheet.dataset.view = "settings";
  }

  function getPath(obj, path) { return path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj); }
  function setPath(obj, path, val) {
    const keys = path.split("."); const last = keys.pop();
    const target = keys.reduce((o, k) => (o[k] = o[k] || {}), obj);
    target[last] = val;
  }

  function fridgeTimeInput(r) {
    return app.querySelector(`[data-bind="fridge.${r}"]`);
  }

  function currentRec() {
    if (route.name === "shift") return state.active;
    if (route.name === "history-view") return state.history.find((r) => r.id === route.id);
    return null;
  }

  // ---------- Sheets ----------
  function openSheet(html) {
    sheet.innerHTML = `<div class="grab"></div>` + html;
    sheet.hidden = false;
    backdrop.hidden = false;
    sheet.scrollTop = 0;
  }
  function closeSheet(silent) {
    sheet.hidden = true;
    backdrop.hidden = true;
    sheet.innerHTML = "";
    delete sheet.dataset.view;
    delete sheet.dataset.status;
    sheet._file = null;
    if (!silent) render();
  }
  backdrop.addEventListener("click", () => closeSheet());

  function openTask(rec, id, readOnly) {
    const t = rec.tasks.find((x) => x.id === id);
    if (!t) return;
    const s = SHIFTS[rec.type];
    const when = t.time ? (t.until ? `${t.time} – ${t.until}` : t.time) : s.anytimeLabel;
    openSheet(`
      <div class="eyebrow">${esc(when)}${t.fridayOnly ? " · שישי בלבד" : ""}</div>
      <h3>${esc(t.title)}</h3>
      ${t.detail ? `<p class="desc">${esc(t.detail)}</p>` : ""}
      ${linkOf(rec, t) ? `<button class="btn small link-btn" data-sact="goto-tab" data-tab="${linkOf(rec, t)}">${ICON.doc} ${linkOf(rec, t) === "fridge" ? "פתיחת טופס המקררים" : "פתיחת דוח הקב״ט"}</button>` : ""}
      ${t.doneAt ? `<div class="done-row">✓ בוצע בשעה <input type="time" id="done-time" value="${hhmm(new Date(t.doneAt))}" ${readOnly ? "disabled" : ""}></div>` : ""}
      <label for="task-note">הערות</label>
      <textarea id="task-note" placeholder="לדוגמה: חסר מטף בקומה 9…" ${readOnly ? "readonly" : ""}>${esc(t.note)}</textarea>
      <div class="row">
        ${readOnly ? `<button class="btn" data-sact="close">סגירה</button>` : `
          ${t.custom ? `<button class="btn danger small" data-sact="remove" data-id="${t.id}" style="flex:.5">מחיקה</button>` : ""}
          <button class="btn ${t.doneAt ? "" : "done"}" data-sact="toggle" data-id="${t.id}">${t.doneAt ? "ביטול סימון" : "✓ סימון כבוצע"}</button>
          <button class="btn primary" data-sact="save" data-id="${t.id}">שמירה</button>`}
      </div>`);
    sheet.dataset.taskId = id;
  }

  function linkOf(rec, t) {
    const def = (SHIFTS[rec.type].tasks || []).find((x) => x.id === t.id);
    return def && def.link ? def.link : null;
  }

  function saveTaskFromSheet(rec, id) {
    const t = rec.tasks.find((x) => x.id === id);
    if (!t) return;
    const note = sheet.querySelector("#task-note");
    if (note) t.note = note.value.trim();
    const dt = sheet.querySelector("#done-time");
    if (dt && dt.value && t.doneAt) {
      const d = new Date(t.doneAt);
      const [h, m] = dt.value.split(":").map(Number);
      // keep it inside the shift window: pick the date of that clock time nearest to the original
      const cand = new Date(d); cand.setHours(h, m, 0, 0);
      const diff = cand - d;
      if (diff > 12 * 3600000) cand.setDate(cand.getDate() - 1);
      if (diff < -12 * 3600000) cand.setDate(cand.getDate() + 1);
      t.doneAt = cand.toISOString();
    }
  }

  function toggleTask(rec, id) {
    const t = rec.tasks.find((x) => x.id === id);
    if (!t) return;
    t.doneAt = t.doneAt ? null : new Date().toISOString();
    save();
    if (t.doneAt) toast(`בוצע ב־${hhmm(new Date(t.doneAt))}`);
  }

  function openAdd() {
    openSheet(`
      <h3>משימה חדשה</h3>
      <label for="new-title">מה צריך לעשות?</label>
      <input type="text" id="new-title" placeholder="תיאור המשימה" autocomplete="off">
      <label for="new-time">שעה (לא חובה)</label>
      <input type="time" id="new-time">
      <label for="new-note">הערות</label>
      <textarea id="new-note"></textarea>
      <div class="row"><button class="btn" data-sact="close">ביטול</button><button class="btn primary" data-sact="create">הוספה</button></div>`);
    setTimeout(() => { const i = sheet.querySelector("#new-title"); if (i) i.focus(); }, 250);
  }

  function openShiftNote(rec, readOnly) {
    openSheet(`
      <h3>הערות כלליות</h3>
      <p class="desc">אירועים חריגים, מסירה למשמרת הבאה וכו׳.</p>
      <textarea id="shift-note" style="min-height:160px" ${readOnly ? "readonly" : ""}>${esc(rec.note)}</textarea>
      <div class="row">${readOnly ? `<button class="btn" data-sact="close">סגירה</button>` : `<button class="btn" data-sact="close">ביטול</button><button class="btn primary" data-sact="save-shift-note">שמירה</button>`}</div>`);
  }

  function openEnd(rec) {
    const st = stats(rec);
    const left = st.total - st.done;
    openSheet(`
      <h3>סיום משמרת</h3>
      <p class="desc">${left ? `נשארו ${left} משימות שלא סומנו. אפשר לסיים בכל זאת – הן יופיעו כלא בוצעו בסיכום.` : "כל המשימות הושלמו. כל הכבוד!"}</p>
      <div class="summary">${esc(summaryText(rec))}</div>
      ${rec.type === "night" ? `<div class="row">
        <button class="btn small" data-sact="export" data-type="kabat">${ICON.doc} דוח קב״ט</button>
        <button class="btn small" data-sact="export" data-type="fridge">${ICON.doc} דוח מקררים</button></div>` : ""}
      <div class="row"><button class="btn" data-sact="share-active">${ICON.share} שיתוף</button><button class="btn primary" data-sact="confirm-end">סיום ושמירה</button></div>`);
  }

  // ---------- Events ----------
  app.addEventListener("click", (e) => {
    const el = e.target.closest("[data-act]");
    if (!el) return;
    const act = el.dataset.act;
    const rec = currentRec();
    const readOnly = route.name === "history-view";
    switch (act) {
      case "home": go("home"); break;
      case "history": go("history"); break;
      case "resume": go("shift"); break;
      case "view": go("history-view", el.dataset.id); break;
      case "start": {
        const type = el.dataset.type;
        if (state.active) {
          if (state.active.type === type) { go("shift"); break; }
          if (!confirm(`יש משמרת פעילה (${SHIFTS[state.active.type].name}). לסיים אותה ולהתחיל ${SHIFTS[type].name}?`)) break;
          endShift();
        }
        startShift(type);
        break;
      }
      case "toggle": if (rec && !readOnly) { toggleTask(rec, el.dataset.id); render(); } break;
      case "open": if (rec) openTask(rec, el.dataset.id, readOnly); break;
      case "add": openAdd(); break;
      case "shift-note": if (rec) openShiftNote(rec, readOnly); break;
      case "share": if (rec) shareText(summaryText(rec)); break;
      case "end": if (rec) openEnd(rec); break;
      case "settings": openSettings(); break;
      case "tab": shiftTab = el.dataset.tab; render(); window.scrollTo(0, 0); break;
      case "export": if (rec) exportReport(rec, el.dataset.type); break;
      case "ck-ok": if (rec) { const k = ensureKabat(rec); k.checks[el.dataset.k] = { time: nowHM(), status: "ok", issue: "" }; save(); render(); } break;
      case "ck-issue": if (rec) openCheck(rec, el.dataset.k, "status", true); break;
      case "ck-edit": if (rec) openCheck(rec, el.dataset.k, el.dataset.mode, false); break;
      case "fr-round": fridgeRound = Number(el.dataset.r); render(); break;
      case "fr-quick": if (rec) {
        const f = ensureFridge(rec); const cur = (f.vals[el.dataset.k] || [])[fridgeRound - 1];
        setFridgeVal(rec, el.dataset.k, cur === el.dataset.v ? "" : el.dataset.v, false); render();
      } break;
      case "fr-pool": if (rec) {
        const f = ensureFridge(rec); const cur = (f.vals[el.dataset.k] || [])[fridgeRound - 1];
        setFridgeVal(rec, el.dataset.k, cur === "תקין" ? "" : "תקין", true); render();
      } break;
      case "fr-sign": if (rec) {
        const f = ensureFridge(rec); const cur = ((f.vals[el.dataset.k] || [])[fridgeRound - 1] || "").trim();
        if (/^-?\d/.test(cur) || cur === "-" || cur === "") setFridgeVal(rec, el.dataset.k, cur.startsWith("-") ? cur.slice(1) : "-" + cur, false);
        render();
        const inp = app.querySelector(`[data-fk="${el.dataset.k}"]`); if (inp) { inp.focus(); const L = inp.value.length; try { inp.setSelectionRange(L, L); } catch (err) { /* ignore */ } }
      } break;
      case "fr-note": if (rec) openFridgeNote(rec, el.dataset.k, el.dataset.pool === "1"); break;
      case "delete":
        if (rec && confirm("למחוק את המשמרת מההיסטוריה?")) {
          state.history = state.history.filter((r) => r.id !== rec.id);
          save(); go("history");
        }
        break;
    }
  });

  sheet.addEventListener("click", (e) => {
    const el = e.target.closest("[data-sact]");
    if (!el) return;
    const rec = currentRec();
    const act = el.dataset.sact;
    switch (act) {
      case "close": closeSheet(); break;
      case "save": saveTaskFromSheet(rec, el.dataset.id); save(); closeSheet(); toast("נשמר"); break;
      case "toggle": saveTaskFromSheet(rec, el.dataset.id); toggleTask(rec, el.dataset.id); closeSheet(); break;
      case "remove":
        rec.tasks = rec.tasks.filter((t) => t.id !== el.dataset.id); save(); closeSheet(); break;
      case "create": {
        const title = sheet.querySelector("#new-title").value.trim();
        if (!title) { sheet.querySelector("#new-title").focus(); return; }
        const time = sheet.querySelector("#new-time").value || null;
        const note = sheet.querySelector("#new-note").value.trim();
        rec.tasks.push({ id: "c" + uid(), time, until: null, title, detail: "", fridayOnly: false, custom: true, doneAt: null, note });
        save(); closeSheet(); toast("המשימה נוספה");
        break;
      }
      case "save-shift-note": rec.note = sheet.querySelector("#shift-note").value.trim(); save(); closeSheet(); toast("נשמר"); break;
      case "share-active": shareText(summaryText(rec)); break;
      case "goto-tab": closeSheet(true); shiftTab = el.dataset.tab; render(); window.scrollTo(0, 0); break;
      case "export": if (rec) exportReport(rec, el.dataset.type); break;
      case "tpl-open": openTplSheet(el.dataset.type, true); break;
      case "share-file": {
        const file = sheet._file;
        if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file] }).catch(() => {});
        } else {
          toast("שיתוף קבצים לא נתמך כאן – השתמש ב״שמירה בקבצים״");
        }
        break;
      }
      case "settings-save": state.settings.name = sheet.querySelector("#set-name").value.trim(); save(); closeSheet(); toast("נשמר"); break;
      case "ck-st": {
        sheet.dataset.status = el.dataset.st;
        sheet.querySelectorAll('[data-sact="ck-st"]').forEach((b) => { b.classList.toggle("on", b === el); b.classList.toggle("bad", b === el && el.dataset.st === "issue"); });
        const w = sheet.querySelector("#ck-issue-wrap"); if (w) { w.hidden = el.dataset.st !== "issue"; if (!w.hidden) sheet.querySelector("#ck-issue").focus(); }
        break;
      }
      case "ck-save": {
        const k = ensureKabat(rec);
        const time = sheet.querySelector("#ck-time").value || nowHM();
        const issueEl = sheet.querySelector("#ck-issue");
        const status = el.dataset.mode === "done" ? "ok" : (sheet.dataset.status || "ok");
        k.checks[el.dataset.k] = { time, status, issue: status === "issue" && issueEl ? issueEl.value.trim() : "" };
        save(); closeSheet(); break;
      }
      case "ck-del": delete ensureKabat(rec).checks[el.dataset.k]; save(); closeSheet(); break;
      case "fr-note-save": {
        const f = ensureFridge(rec);
        f.notes[el.dataset.k] = sheet.querySelector("#fr-note").value.trim();
        const pv = sheet.querySelector("#fr-pool-v");
        if (pv) setFridgeVal(rec, el.dataset.k, pv.value.trim(), true);
        save(); closeSheet(); break;
      }
      case "confirm-end": endShift(); closeSheet(true); go("home"); toast("המשמרת נשמרה בהיסטוריה"); break;
    }
  });

  sheet.addEventListener("input", (e) => {
    if (e.target.id === "set-name") { state.settings.name = e.target.value.trim(); save(); }
  });
  app.addEventListener("input", (e) => {
    const el = e.target;
    const rec = currentRec();
    if (!rec) return;
    if (el.dataset.bind) {
      setPath(rec, el.dataset.bind, el.value);
      save();
      return;
    }
    if (el.dataset.fk) {
      let v = el.value;
      const f = ensureFridge(rec);
      const prev = (f.vals[el.dataset.fk] || [])[fridgeRound - 1] || "";
      // מקפיאים: מספר חדש נרשם אוטומטית כמינוס
      if (el.dataset.neg === "1" && !prev && /^\d/.test(v)) { v = "-" + v; el.value = v; }
      app.querySelectorAll(`[data-act="fr-quick"][data-k="${el.dataset.fk}"]`).forEach((b) => b.classList.toggle("on", b.dataset.v === v));
      if (setFridgeVal(rec, el.dataset.fk, v, false)) {
        const t = fridgeTimeInput("t" + fridgeRound); if (t) t.value = f["t" + fridgeRound];
        const seg = app.querySelector(`[data-act="fr-round"][data-r="${fridgeRound}"] small`); if (seg) seg.textContent = f["t" + fridgeRound];
      }
    }
  });
  sheet.addEventListener("change", (e) => { if (e.target.dataset.tpl) loadTplFile(e.target); });

  const typing = () => { const a = document.activeElement; return a && /^(INPUT|TEXTAREA)$/.test(a.tagName); };
  // Refresh "due" highlights every minute while the app is open.
  setInterval(() => { if (sheet.hidden && route.name === "shift" && shiftTab === "tasks" && !typing()) render(); }, 60000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && sheet.hidden && !typing()) render(); });

  if (state.active) route = { name: "shift", id: null };
  render();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
})();
