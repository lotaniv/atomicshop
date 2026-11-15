// דוחות Word: מילוי התבניות המקוריות (דוח קב"ט לילה + דוח מקררים)
// התבנית עצמה (קובץ ה-Word המקורי) נטענת פעם אחת מהטלפון ונשמרת במכשיר בלבד.
// כאן רק מוגדר איזה ערך נכנס לאיזה תא – העיצוב נשאר בדיוק כמו בקובץ המקורי.
(function () {
  "use strict";

  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const XML_NS = "http://www.w3.org/XML/1998/namespace";
  const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

  // ---------------------------------------------------------------------------
  // הגדרות הטופס: מקררים
  // ---------------------------------------------------------------------------
  // neg: מקפיא (מספר שמוקלד נרשם אוטומטית כמינוס)
  // fixed: ערך קבוע שתמיד נכנס לדוח
  const FRIDGES = [
    { k: "f18", no: "18", name: "מקפיא מחסן רכש" },
    { k: "f1", no: "1", name: "מקפיא ב.ע.ד", neg: true },
    { k: "f2", no: "2", name: "מקפיא בצקים", neg: true },
    { k: "f3", no: "3", name: "פירות וירקות" },
    { k: "f4", no: "4", name: "מקרר ביצים" },
    { k: "f5", no: "5", name: "ירקות שטופים" },
    { k: "f6", no: "7+6", name: "מקרר מטבח קר" },
    { k: "f8", no: "8+19", name: "מקרר הפשרות" },
    { k: "f9", no: "9", name: "מקרר בשרי בתהליך" },
    { k: "f10", no: "10", name: "מקרר בשר מזון מוכן", fixed: "קר" },
    { k: "f11", no: "11", name: "מקרר חלבי" },
    { k: "f12", no: "12", name: "מקרר קונדיטוריה" },
    { k: "f13", no: "13", name: "מקפיא קונדיטוריה" },
    { k: "f14", no: "14", name: "מקרר חלבי" },
    { k: "f15", no: "15", name: "מקרר חלבי" },
    { k: "f16", no: "16", name: "קינוחים" },
    { k: "f17", no: "17", name: "קינוחים" },
    { k: "fs1", no: "לובי", name: "מקררי מטבח סאנסט", def: "תקין" },
    { k: "fs2", no: "לובי", name: "מקפיא בצקים סאנסט", neg: true }
  ];
  const POOL = [
    { k: "p1", name: "מקפיאי ומקררי בר" },
    { k: "p2", name: "מקרר פנימי" }
  ];

  // ---------------------------------------------------------------------------
  // הגדרות הטופס: דוח קב"ט לילה
  // mode: "done" = רק שעת ביצוע, "status" = שעה + תקין/תקלה, "double" = שני סבבים
  // ---------------------------------------------------------------------------
  const floorsA = ["קומה 18-14", "קומה 12", "קומה 11", "קומה 10", "קומה 9", "קומה 8", "קומה 7", "קומה 6", "קומה 5", "קומה 4", "קומה 3", "קומה 2", "קומה 1", "קומת G", "קומה 1-", "קומה 2-"];
  const floorsB = ["קומה 14", "קומה 12", "קומה 11", "קומה 10", "קומה 9", "קומה 8", "קומה 7", "קומה 6", "קומה 5", "קומה 4", "קומה 3", "קומה 2", "קומה 1", "קומה 1-", "קומה 2-"];

  const KABAT_SECTIONS = [
    { id: "kitchen", title: "סגירת מטבחים", hint: "סגירה 23:00 · פתיחה 05:00 · דלת מטבח שחורה 23:30", items: [
      { k: "kit1", label: "מטבח", mode: "done" },
      { k: "kit2", label: "יציאת חירום מסעדה", mode: "done" },
      { k: "kit3", label: "דלת כניסה למטבח", mode: "done" },
      { k: "kit4", label: "חדר אוכל ''הרייף''", mode: "done" }
    ] },
    { id: "machines", title: "חדרי מכונות", hint: "2 סיורים: 02:00 ו־04:00. הצפת מים – להתקשר דחוף למנהל אחזקה.", items: [
      { k: "mr1", label: "חדר מכונות", mode: "double" },
      { k: "mr2", label: "חדר דודים", mode: "double" },
      { k: "mr3", label: "חדר משאבות", mode: "double" },
      { k: "mr4", label: "חדר גנרטור", mode: "double" }
    ] },
    { id: "lobby", title: "לובי המלון", hint: "3 סיורים בלובי + קשר רציף עם שומר הכניסה.", items: [
      { k: "lob1", label: "לובי + כניסה – סיור 1", mode: "done" },
      { k: "lob2", label: "לובי + כניסה – סיור 2", mode: "done" },
      { k: "lob3", label: "לובי + כניסה – סיור 3", mode: "done" },
      { k: "park", label: "חנייה בכניסת המלון + VIP", mode: "status" }
    ], texts: [{ k: "lobbyDesc", label: "תיאור הלובי", def: "שקט" }] },
    { id: "pool", title: "בריכה + ספא", hint: "לבדוק את שטח הבריכה פעמיים.", items: [
      { k: "spa", label: "ספא – בדיקת נעילות", mode: "status" },
      { k: "pool1", label: "שטח הבריכה – בדיקה 1", mode: "status" },
      { k: "pool2", label: "שטח הבריכה – בדיקה 2", mode: "status" }
    ] },
    { id: "bA", title: "בניין A", hint: "עלייה דרך קומה 17 לגגות, ירידה בשתי וערב.", items:
      floorsA.map((f, i) => ({ k: "A" + i, label: f, mode: "status" })).concat([
        { k: "Aroom", label: "חדרים 234-235 – לוודא מול הקבלה שריקים ושהמרפסת סגורה", mode: "status" }
      ]) },
    { id: "hallsA", title: "אולמות בניין A", hint: "מזגן כבוי + אור כבוי + נעילה.", items: [
      { k: "hallsA", label: "אטלנטיק, פסיפיק, ריף, קורל, טייפון, בית כנסת, טרקלין עסקים", mode: "status" },
      { k: "tennis", label: "שער טניס – נעילה", mode: "status" }
    ] },
    { id: "bB", title: "בניין B", items:
      floorsB.map((f, i) => ({ k: "B" + i, label: f, mode: "status" })).concat([
        { k: "Broom", label: "חדרים 234-235 – מרפסות, לוודא מול הקבלה שהחדר ריק", mode: "status" }
      ]) },
    { id: "hallsB", title: "אולמות בניין B", hint: "מזגן כבוי + אור כבוי + נעילה.", items: [
      { k: "hallsB", label: "פוסידון, ונוס, אפרודיטה", mode: "status" },
      { k: "maalonB", label: "מעלון קומה 2 בניין B", mode: "status" }
    ] },
    { id: "bC", title: "בניין C", items: [
      { k: "C0", label: "קבלה שיזן + בר שיזן", mode: "status" },
      { k: "C1", label: "C3", mode: "status" },
      { k: "C2", label: "C2", mode: "status" },
      { k: "C3", label: "C1", mode: "status" },
      { k: "C4", label: "מעלון ספא", mode: "status" }
    ] },
    { id: "park", title: "חניון עובדים", items: [
      { k: "pk0", label: "חניון 3-", mode: "status" },
      { k: "pk1", label: "חניון 2-", mode: "status" },
      { k: "pk2", label: "חניון 1-", mode: "status" },
      { k: "pk3", label: "אזור ספקים", mode: "status" }
    ] },
    { id: "fire", title: "אזעקות אש + רכזת אש", items: [], texts: [
      { k: "fireLoc", label: "אזעקות אש – מיקום" },
      { k: "fireHandled", label: "כיצד טופל", def: "לא היו" },
      { k: "firePanel", label: "מספר תקלות ברכזת אש" }
    ] }
  ];

  // ---------------------------------------------------------------------------
  // עזרי טקסט
  // ---------------------------------------------------------------------------
  const statusText = (c) => !c ? "" : (c.status === "issue" ? ("תקלה: " + (c.issue || "")).trim() : "תקין");
  const tsText = (c) => !c || !c.time ? "" : `${c.time} – ${statusText(c)}`;
  const timeText = (c) => (c && c.time) || "";

  // מספר שלילי נכתב בדוח כמו במקור: "17.6-"
  function tempText(v) {
    v = String(v == null ? "" : v).trim();
    const m = v.match(/^-\s*(\d+(?:[.,]\d+)?)$/);
    return m ? m[1].replace(",", ".") + "-" : v;
  }

  // תאריך משמרת לילה: יום התחלה + יום למחרת
  function nightDates(base) {
    const n = new Date(base); n.setDate(n.getDate() + 1);
    return { d1: base.getDate(), d2: n.getDate(), m: n.getMonth() + 1, y: n.getFullYear() };
  }

  // שם הקובץ: אותו שם כמו בתבנית שהועלתה, רק עם התאריך של המשמרת
  function fileName(tplName, fallback, base) {
    const { d1, d2, m, y } = nightDates(base);
    let name = (tplName || "").replace(/\.docx$/i, "").trim();
    const re = /(\d{1,2})([-.\/_])(\d{1,2})([-.\/_])(\d{1,2})([-.\/_])(\d{4}|\d{2})/;
    if (name && re.test(name)) {
      name = name.replace(re, (all, a, s1, b, s2, c, s3, yr) =>
        `${d1}${s1}${d2}${s2}${m}${s3}${yr.length === 4 ? y : String(y).slice(-2)}`);
    } else {
      name = (name || fallback) + ` ${d1}-${d2}.${m}.${String(y).slice(-2)}`;
    }
    return name.replace(/[\\/:*?"<>|]/g, "") + ".docx";
  }

  // ---------------------------------------------------------------------------
  // עריכת document.xml
  // ---------------------------------------------------------------------------
  const kids = (el, name) => Array.from(el.childNodes).filter((n) => n.nodeType === 1 && n.namespaceURI === W && n.localName === name);
  const textRuns = (p) => Array.from(p.getElementsByTagNameNS(W, "r")).filter((r) => r.getElementsByTagNameNS(W, "t").length);

  function Doc(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) throw new Error("bad xml");
    const body = doc.getElementsByTagNameNS(W, "body")[0];
    const paras = kids(body, "p");
    const tables = kids(body, "tbl");

    function rows(t) { return kids(tables[t], "tr"); }
    function cell(t, r, c) {
      const tr = rows(t)[r]; if (!tr) throw new Error(`missing row ${t}/${r}`);
      const tc = kids(tr, "tc")[c]; if (!tc) throw new Error(`missing cell ${t}/${r}/${c}`);
      return tc;
    }
    function cellParas(tc) { return Array.from(tc.getElementsByTagNameNS(W, "p")); }
    function mainPara(tc) {
      const ps = cellParas(tc);
      return ps.find((p) => textRuns(p).some((r) => r.textContent.trim())) || ps.find((p) => textRuns(p).length) || ps[0];
    }

    function setT(r, text) {
      const ts = Array.from(r.getElementsByTagNameNS(W, "t"));
      // מחיקת שורות חדשות קודמות בריצה
      Array.from(r.getElementsByTagNameNS(W, "br")).forEach((b) => b.parentNode.removeChild(b));
      ts.slice(1).forEach((t) => t.parentNode.removeChild(t));
      const lines = String(text).split(/\r?\n/);
      const t0 = ts[0];
      t0.textContent = lines[0];
      t0.setAttributeNS(XML_NS, "xml:space", "preserve");
      let after = t0;
      lines.slice(1).forEach((line) => {
        const br = doc.createElementNS(W, "w:br");
        const t = doc.createElementNS(W, "w:t");
        t.setAttributeNS(XML_NS, "xml:space", "preserve");
        t.textContent = line;
        after.parentNode.insertBefore(br, after.nextSibling);
        br.parentNode.insertBefore(t, br.nextSibling);
        after = t;
      });
    }

    function newRun(styleRun, text) {
      const r = doc.createElementNS(W, "w:r");
      const rPr = styleRun && kids(styleRun, "rPr")[0];
      if (rPr) r.appendChild(rPr.cloneNode(true));
      const t = doc.createElementNS(W, "w:t");
      r.appendChild(t);
      setT(r, text);
      return r;
    }

    // מחליף את כל הטקסט בפסקה (שומר על העיצוב של הריצה הראשונה)
    function setPara(p, text, styleRun) {
      const runs = textRuns(p);
      if (runs.length) {
        setT(runs[0], text);
        runs.slice(1).forEach((r) => r.parentNode.removeChild(r));
      } else if (text) {
        p.appendChild(newRun(styleRun, text));
      }
    }

    // ריצה ספציפית בפסקה (למשל "שעת בדיקה:" + " 23:32")
    function setRun(p, idx, text) {
      const runs = textRuns(p);
      if (!runs[idx]) throw new Error("missing run " + idx);
      setT(runs[idx], text);
    }

    // מאיפה לקחת עיצוב לתא ריק: אותה עמודה בשורה קודמת, אחרת כל ריצה בשורה
    function styleFor(t, r, c) {
      for (let rr = r - 1; rr >= 0; rr--) {
        const tc = kids(rows(t)[rr], "tc")[c];
        const run = tc && textRuns(mainPara(tc))[0];
        if (run) return run;
      }
      return textRuns(rows(t)[r])[0] || textRuns(tables[t])[0] || null;
    }

    return {
      doc, paras, tables,
      cell(t, r, c, text) { setPara(mainPara(cell(t, r, c)), text, styleFor(t, r, c)); },
      cellPara(t, r, c, pi, text) { setPara(cellParas(cell(t, r, c))[pi], text, styleFor(t, r, c)); },
      cellRun(t, r, c, ri, text) { setRun(mainPara(cell(t, r, c)), ri, text); },
      para(pi, text, styleRun) { setPara(paras[pi], text, styleRun); },
      paraRun(pi, ri, text) { setRun(paras[pi], ri, text); },
      paraRunsFrom(pi, ri, text) {
        const runs = textRuns(paras[pi]);
        setT(runs[ri], text);
        runs.slice(ri + 1).forEach((r) => r.parentNode.removeChild(r));
      },
      paraAppend(pi, text) {
        if (!text) return;
        const runs = textRuns(paras[pi]);
        const style = runs[runs.length - 1];
        const r = newRun(style, " " + text);
        const rPr = kids(r, "rPr")[0];
        if (rPr) kids(rPr, "u").forEach((u) => rPr.removeChild(u));
        paras[pi].appendChild(r);
      },
      paraText(pi) { return textRuns(paras[pi]).map((r) => r.textContent).join(""); },
      rowsCount(t) { return rows(t).length; },
      serialize() {
        let s = new XMLSerializer().serializeToString(doc);
        if (!/^<\?xml/.test(s)) s = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' + s;
        return s;
      }
    };
  }

  // ---------------------------------------------------------------------------
  // זיהוי ובדיקת תבנית
  // ---------------------------------------------------------------------------
  async function openTemplate(buf) {
    const zip = await JSZip.loadAsync(buf);
    const f = zip.file("word/document.xml");
    if (!f) throw new Error("זה לא קובץ Word (docx)");
    const xml = await f.async("string");
    return { zip, d: Doc(xml) };
  }

  function detect(d) {
    const title = d.paras.slice(0, 3).map((_, i) => d.paraText(i)).join(" ");
    if (title.includes("מקררים") && d.tables.length === 3 && d.rowsCount(0) === 21) return "fridge";
    if (title.includes("לילה") && d.tables.length === 13 && d.rowsCount(4) === 18 && d.rowsCount(6) === 17) return "kabat";
    return null;
  }

  async function checkTemplate(buf) {
    const { d } = await openTemplate(buf);
    return detect(d);
  }

  // ---------------------------------------------------------------------------
  // מילוי דוח מקררים
  // ---------------------------------------------------------------------------
  function fillFridge(d, data, ctx) {
    const { d1, d2, m, y } = nightDates(ctx.base);
    const f = data || {};
    const vals = f.vals || {};
    const notes = f.notes || {};
    // כותרת: דו"ח מקררים- תאריך: -..14-15.11.26
    d.paraRunsFrom(0, 3, `-..${d1}-${d2}.${m}.${String(y).slice(-2)}`);
    // שם קב"ט
    d.paraRun(1, 2, ctx.officer || "");
    // שעות בדיקה
    d.cellPara(0, 1, 0, 1, f.t1 || "");
    d.cellPara(0, 1, 1, 1, f.t2 || "");
    FRIDGES.forEach((fr, i) => {
      const r = 2 + i;
      const v = vals[fr.k] || [];
      const v1 = fr.fixed || v[0] || "";
      const v2 = fr.fixed || v[1] || "";
      d.cell(0, r, 0, tempText(v1));
      d.cell(0, r, 1, tempText(v2));
      d.cell(0, r, 2, notes[fr.k] || "");
    });
    // מקררי בריכה
    d.cellPara(2, 0, 1, 1, f.pt1 || "");
    d.cellPara(2, 0, 2, 1, f.pt2 || "");
    POOL.forEach((p, i) => {
      const v = vals[p.k] || [];
      d.cell(2, 1 + i, 2, v[0] || "");
      d.cell(2, 1 + i, 3, v[1] || "");
      d.cell(2, 1 + i, 4, notes[p.k] || "");
    });
    d.paraAppend(4, (f.note || "").trim());
  }

  // ---------------------------------------------------------------------------
  // מילוי דוח קב"ט לילה
  // ---------------------------------------------------------------------------
  function fillKabat(d, data, ctx) {
    const k = data || {};
    const c = k.checks || {};
    const tx = k.texts || {};
    const { d1, d2, m, y } = nightDates(ctx.base);
    const officer = ctx.officer || "";

    d.paraRun(1, 2, `${d1}-${d2}/${m}/${y}`);
    d.paraRun(2, 2, " " + officer);
    d.paraRun(3, 2, k.reception || "");
    d.paraRun(4, 1, " " + (k.guard || ""));
    d.paraRun(4, 6, k.occupancy || "");

    // סגירת מטבחים
    ["kit1", "kit2", "kit3", "kit4"].forEach((key, i) => {
      d.cell(0, 1 + i, 1, timeText(c[key]));
      d.cell(0, 1 + i, 2, c[key] && c[key].time ? officer : "");
    });

    // חדרי מכונות
    ["mr1", "mr2", "mr3", "mr4"].forEach((key, i) => {
      const a = c[key + "_1"], b = c[key + "_2"];
      const done = [a, b].filter((x) => x && x.time);
      const issues = done.filter((x) => x.status === "issue").map((x) => x.issue).filter(Boolean);
      const status = !done.length ? "" : (done.some((x) => x.status === "issue") ? ("תקלה: " + issues.join(", ")).trim() : "תקין");
      d.cell(1, 1 + 2 * i, 2, status);
      d.cell(1, 1 + 2 * i, 3, done.map((x) => x.time).join(" ו-"));
    });

    // לובי
    d.cellRun(2, 0, 1, 2, " " + timeText(c.lob1));
    d.cellRun(2, 1, 1, 1, " " + timeText(c.lob2));
    d.cellRun(2, 2, 1, 1, " " + timeText(c.lob3));
    d.cell(2, 3, 1, tsText(c.park));
    d.cell(2, 4, 1, tx.lobbyDesc != null ? tx.lobbyDesc : "שקט");

    // בריכה + ספא
    d.cell(3, 0, 2, tsText(c.spa));
    d.cell(3, 1, 2, tsText(c.pool1));
    d.cell(3, 2, 2, tsText(c.pool2));

    // בניין A
    floorsA.forEach((_, i) => d.cell(4, 1 + i, 1, tsText(c["A" + i])));
    d.cell(4, 17, 1, tsText(c.Aroom));

    // אולמות A
    d.cell(5, 0, 1, c.hallsA && c.hallsA.time ? statusText(c.hallsA) : "");
    d.cell(5, 1, 1, timeText(c.hallsA));
    d.cell(5, 2, 1, c.tennis && c.tennis.time ? statusText(c.tennis) : "");

    // בניין B
    floorsB.forEach((_, i) => d.cell(6, 1 + i, 1, tsText(c["B" + i])));
    d.cell(6, 16, 1, tsText(c.Broom));

    // אולמות B
    d.cellRun(7, 0, 0, 2, c.hallsB && c.hallsB.time ? "V" : "");
    d.cellRun(7, 1, 0, 2, timeText(c.hallsB));
    d.cellRun(7, 2, 0, 1, " " + (c.hallsB && c.hallsB.time ? statusText(c.hallsB) : ""));
    d.cell(8, 1, 1, timeText(c.maalonB));
    d.cell(8, 1, 2, c.maalonB && c.maalonB.time ? statusText(c.maalonB) : "");

    // בניין C
    for (let i = 0; i < 5; i++) {
      const x = c["C" + i];
      d.cell(9, 1 + i, 1, timeText(x));
      d.cell(9, 1 + i, 2, x && x.time ? statusText(x) : "");
    }

    // חניון עובדים
    for (let i = 0; i < 4; i++) d.cell(10, 1 + i, 2, tsText(c["pk" + i]));

    // אזעקות אש + רכזת
    d.cell(11, 1, 1, tx.fireLoc || "");
    d.cell(11, 2, 1, tx.fireHandled != null ? tx.fireHandled : "לא היו");
    d.cell(12, 0, 1, tx.firePanel || "");

    // הערות על הלילה (הפסקה שאחרי הכותרת)
    d.para(68, (tx.nightNotes || "").trim(), null);
  }

  async function build(type, tplBuf, data, ctx) {
    const { zip, d } = await openTemplate(tplBuf);
    const kind = detect(d);
    if (kind !== type) throw new Error(type === "kabat" ? "התבנית שנטענה היא לא דוח קב\"ט לילה" : "התבנית שנטענה היא לא דוח מקררים");
    if (type === "kabat") fillKabat(d, data, ctx); else fillFridge(d, data, ctx);
    zip.file("word/document.xml", d.serialize());
    return zip.generateAsync({ type: "blob", mimeType: DOCX_MIME, compression: "DEFLATE" });
  }

  window.REPORTS = { FRIDGES, POOL, KABAT_SECTIONS, build, checkTemplate, fileName, statusText, tsText, DOCX_MIME };
})();
