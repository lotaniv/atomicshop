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
  function go(name, id) {
    route = { name, id: id || null };
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
        <button class="icon-btn" data-act="history" aria-label="היסטוריה">${ICON.clock}</button>
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

    let html = `<div class="screen">
      <div class="topbar">
        <button class="icon-btn" data-act="${readOnly ? "history" : "home"}" aria-label="חזרה">${ICON.back}</button>
        <button class="icon-btn" data-act="share" aria-label="שיתוף סיכום">${ICON.share}</button>
      </div>
      <div class="eyebrow">${dayName(base)} · ${dateStr(base)}${readOnly ? " · הסתיימה" : ""}</div>
      <h1>${s.icon} ${s.name}</h1>
      <div class="progress-card">
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
      case "confirm-end": endShift(); closeSheet(true); go("home"); toast("המשמרת נשמרה בהיסטוריה"); break;
    }
  });

  // Refresh "due" highlights every minute while the app is open.
  setInterval(() => { if (sheet.hidden && route.name === "shift") render(); }, 60000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && sheet.hidden) render(); });

  if (state.active) route = { name: "shift", id: null };
  render();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
})();
