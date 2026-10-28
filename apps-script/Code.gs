/* =====================================================================
   Code.gs — خادم مقياس جاهزية القرار المهني (Google Apps Script)
   يُلصق في: Google Sheet ← الإضافات ← Apps Script
   1) doPost  يستقبل إجابات الطالبات ويحفظها صفاً في ورقة responses
   2) قائمة «لوحة المقياس» داخل الملف تفتح لوحة التحكم (لمن يملك صلاحية الملف فقط)
   ===================================================================== */

var SHEET_NAME = 'responses';
var SERVER_COLS = ['received_at', 'student_key', 'attempt'];
var MAX_TEXT = 500;

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000); // يرتّب الحفظ عند إرسال فصل كامل في اللحظة نفسها
    var data = JSON.parse(e.postData.contents);
    if (!data || !data.submission_id) return json_({ ok: false, error: 'missing submission_id' });
    data = clean_(data);

    var sh = sheet_();
    var header = ensureHeader_(sh, Object.keys(data));
    var last = sh.getLastRow();
    var idCol = header.indexOf('submission_id') + 1;
    var keyCol = header.indexOf('student_key') + 1;

    var attempt = 1;
    var key = studentKey_(data);
    if (last > 1) {
      var ids = sh.getRange(2, idCol, last - 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) {
        if (ids[i][0] === data.submission_id) return json_({ ok: true, duplicate: true }); // إعادة إرسال
      }
      var keys = sh.getRange(2, keyCol, last - 1, 1).getValues();
      for (var j = 0; j < keys.length; j++) if (keys[j][0] === key) attempt++;
    }
    data.received_at = new Date();
    data.student_key = key;
    data.attempt = attempt;

    sh.appendRow(header.map(function (h) { return data.hasOwnProperty(h) && data[h] !== null ? data[h] : ''; }));
    return json_({ ok: true, attempt: attempt });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

function doGet() {
  return json_({ ok: true, service: 'career-compass-v2' });
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) { sh = ss.insertSheet(SHEET_NAME); sh.setRightToLeft(true); }
  return sh;
}

/* العمود الجديد يُضاف في آخر الورقة؛ لا يُحذف أي عمود قديم */
function ensureHeader_(sh, keys) {
  var lastCol = sh.getLastColumn();
  var header = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].filter(String) : [];
  var wanted = SERVER_COLS.concat(keys);
  var missing = wanted.filter(function (k) { return header.indexOf(k) === -1; });
  if (missing.length) {
    sh.getRange(1, header.length + 1, 1, missing.length).setValues([missing]);
    header = header.concat(missing);
    sh.setFrozenRows(1);
  }
  return header;
}

/* قيم بسيطة فقط، بطول محدود، مع منع تفسير النص معادلةً */
function clean_(d) {
  var out = {};
  Object.keys(d).forEach(function (k) {
    if (!/^[A-Za-z0-9_]{1,64}$/.test(k)) return;
    var v = d[k];
    if (v === null || v === undefined) { out[k] = ''; return; }
    if (typeof v === 'number' || typeof v === 'boolean') { out[k] = v; return; }
    v = String(v).slice(0, MAX_TEXT);
    if (/^[=+\-@]/.test(v)) v = "'" + v;
    out[k] = v;
  });
  return out;
}

/* مفتاح الطالبة لحساب رقم المحاولة: الاسم بعد التوحيد + المدرسة + الصف */
function studentKey_(d) {
  function norm(s) {
    return String(s || '').replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim();
  }
  return [norm(d.name), norm(d.school), norm(d.grade)].join('|');
}

/* ── لوحة التحكم ─────────────────────────────────────── */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('لوحة المقياس')
    .addItem('فتح لوحة التحكم', 'openDashboard')
    .addToUi();
}

function openDashboard() {
  var html = HtmlService.createHtmlOutputFromFile('Dashboard').setWidth(1280).setHeight(860);
  SpreadsheetApp.getUi().showModelessDialog(html, 'لوحة مقياس جاهزية القرار المهني');
}

function getData() {
  var sh = sheet_();
  var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (lastRow < 2) return { header: lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0] : [], rows: [] };
  var values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  var header = values.shift();
  var rows = values.map(function (r) {
    return r.map(function (v) { return v instanceof Date ? v.toISOString() : v; });
  });
  return { header: header, rows: rows };
}

/* يكتب الصفوف المصفّاة في ورقة جديدة، ومنها: ملف ← تنزيل ← CSV */
function exportRows(header, rows, label) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var name = 'تصدير ' + (label || '') + ' ' + Utilities.formatDate(new Date(), 'Asia/Riyadh', 'yyyy-MM-dd HH-mm');
  var sh = ss.insertSheet(name.slice(0, 90));
  sh.setRightToLeft(true);
  var data = [header].concat(rows);
  if (data.length && header.length) sh.getRange(1, 1, data.length, header.length).setValues(data);
  sh.setFrozenRows(1);
  return name;
}
