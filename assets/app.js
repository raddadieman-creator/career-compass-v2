/* =====================================================================
   app.js — واجهة الطلبة: سؤال واحد في كل شاشة، خريطة رحلة، حفظ، نتيجة وصفية
   البنود تُقرأ من data/items.json، والحساب كله في engine.js
   النتيجة للطالب أو الطالبة وصفية فقط: لا مستويات ولا درجات قطع ولا توجيه آلي.
   ===================================================================== */
(function () {
  'use strict';
  var CFG = window.CC_CONFIG, E = window.ENGINE;
  var params = new URLSearchParams(location.search);
  var TEST = params.get('test') === '1';
  var QKEY = 'cc_v3_queue', PKEY = 'cc_v3_progress', DKEY = 'cc_device';
  var SEC_PER_ITEM = 6; // تقدير تقريبي لعرض الوقت المتبقي فقط

  var S = {
    bank: null, user: {}, form: null, si: 0, qi: 0, responses: {},
    startedAt: null, finishedAt: null, submissionId: null, memQueue: [], fixedSchool: null, fm: {},
    times: {}, changes: {}, backs: 0, shownAt: 0, readyAt: 0, resumed: 0
  };

  /* ── أدوات ── */
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function uuid() { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  function fem() { return S.user.gender === 'F'; }
  function g(m, f) { return fem() ? f : m; }
  function ar(n) { return String(n).replace(/\d/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'[d]; }); }
  function intro(st) { return (fem() && st.introF) ? st.introF : st.intro; }
  function show(id) {
    Array.prototype.forEach.call(document.querySelectorAll('.screen'), function (s) { s.classList.remove('active'); });
    $(id).classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ── التخزين المحلي (قد يكون غير متاح؛ عندها يبقى الطابور في الذاكرة) ── */
  function loadQueue() { try { return JSON.parse(localStorage.getItem(QKEY) || '[]'); } catch (e) { return S.memQueue.slice(); } }
  function saveQueue(q) { S.memQueue = q.slice(); try { localStorage.setItem(QKEY, JSON.stringify(q)); } catch (e) { } }
  function deviceId() {
    try { var d = localStorage.getItem(DKEY); if (!d) { d = uuid(); localStorage.setItem(DKEY, d); } return d; } catch (e) { return ''; }
  }
  /* حفظ التقدم بعد كل إجابة، للمتابعة إن أعيد تحميل الصفحة */
  function saveProgress() {
    try {
      localStorage.setItem(PKEY, JSON.stringify({ instrument: S.bank.instrument, form: S.formName, sid: S.submissionId, user: S.user, order: S.form.order,
        responses: S.responses, times: S.times, changes: S.changes, backs: S.backs, startedAt: S.startedAt.toISOString(), si: S.si, qi: S.qi, savedAt: Date.now() }));
    } catch (e) { }
  }
  function loadProgress() {
    try {
      var p = JSON.parse(localStorage.getItem(PKEY) || 'null');
      if (!p || p.instrument !== S.bank.instrument || p.form !== S.formName || Date.now() - p.savedAt > 24 * 3600 * 1000) return null;
      return p;
    } catch (e) { return null; }
  }
  function clearProgress() { try { localStorage.removeItem(PKEY); } catch (e) { } }

  /* ── التهيئة ── */
  function init() {
    $('ver').textContent = CFG.VERSION;
    var ticks = '';
    for (var a = 0; a < 360; a += 10) {
      if (a % 90 === 0) continue;
      var r1 = a % 30 === 0 ? 68 : 72, rad = (a - 90) * Math.PI / 180;
      ticks += '<line class="' + (a % 30 === 0 ? 'major' : '') + '" x1="' + (100 + r1 * Math.cos(rad)).toFixed(1) + '" y1="' + (100 + r1 * Math.sin(rad)).toFixed(1) +
        '" x2="' + (100 + 79 * Math.cos(rad)).toFixed(1) + '" y2="' + (100 + 79 * Math.sin(rad)).toFixed(1) + '"/>';
    }
    if ($('c-ticks')) $('c-ticks').innerHTML = ticks;
    if (TEST) $('test-banner').hidden = false;
    var code = params.get('school');
    S.fixedSchool = CFG.SCHOOLS.filter(function (s) { return s.code === code; })[0] || null;

    chipGroup($('f-gender'));
    var stageOnly = S.fixedSchool ? S.fixedSchool.stage : null;
    makeChips($('f-grade-int'), stageOnly === 'secondary' ? [] : CFG.GRADES.intermediate);
    makeChips($('f-grade-sec'), stageOnly === 'intermediate' ? [] : CFG.GRADES.secondary);
    if (stageOnly) $(stageOnly === 'secondary' ? 'f-grade-int' : 'f-grade-sec').parentNode.hidden = true;
    makeChips($('f-track'), CFG.TRACKS);
    chipGroup($('f-track'));
    [$('f-grade-int'), $('f-grade-sec')].forEach(function (grp) {
      grp.addEventListener('click', function (e) {
        var b = e.target.closest('.chip'); if (!b) return;
        Array.prototype.forEach.call(document.querySelectorAll('#f-grade-int .chip, #f-grade-sec .chip'), function (x) { x.setAttribute('aria-checked', String(x === b)); });
        onGrade();
      });
    });
    if (S.fixedSchool) {
      $('wrap-school').hidden = true;
      $('school-fixed').hidden = false;
      $('school-fixed').textContent = 'المدرسة: ' + S.fixedSchool.name;
    } else {
      chipGroup($('f-school'));
    }

    $('btn-start').addEventListener('click', function () { if (S.bank) { clearProgress(); show('screen-data'); } });
    $('btn-resume').addEventListener('click', resume);
    $('btn-done').addEventListener('click', done);
    $('btn-data').addEventListener('click', onData);
    $('btn-back').addEventListener('click', goBack);
    $('btn-next').addEventListener('click', function () { renderQuestion(); show('screen-quiz'); });
    document.addEventListener('keydown', onKey);

    fetch('data/items.json', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (b) {
      // النموذج المطبق: «full» كل البنود، أو اسم نموذج مختصر معرّف في items.json
      S.formName = CFG.FORM || 'full';
      if (S.formName !== 'full' && b.forms && b.forms[S.formName]) {
        var keep = {}; b.forms[S.formName].forEach(function (id) { keep[id] = true; });
        b.items = b.items.filter(function (it) { return keep[it.id]; });
      }
      S.bank = b;
      b.facets.forEach(function (f) { S.fm[f.id] = f; });
      var p = loadProgress();
      if (p && Object.keys(p.responses).length) {
        $('btn-resume').hidden = false;
        $('btn-resume').textContent = 'متابعة ' + (p.user.name.split(/\s+/)[0] || '') + ' من حيث توقفت';
      }
    }).catch(function () { $('btn-start').disabled = true; $('btn-start').textContent = 'تعذر تحميل العبارات، أعد تحميل الصفحة'; });

    flushQueue();
    setInterval(flushQueue, 20000);
    window.addEventListener('online', flushQueue);
  }

  function makeChips(box, values) {
    box.innerHTML = values.map(function (v) { return '<button type="button" class="chip" role="radio" aria-checked="false" data-v="' + esc(v) + '">' + esc(v) + '</button>'; }).join('');
  }
  function chipGroup(box) {
    box.addEventListener('click', function (e) {
      var b = e.target.closest('.chip'); if (!b) return;
      Array.prototype.forEach.call(box.querySelectorAll('.chip'), function (x) { x.setAttribute('aria-checked', String(x === b)); });
    });
  }
  function picked(box) { var b = box.querySelector('.chip[aria-checked="true"]'); return b ? b.getAttribute('data-v') : ''; }
  function pickedGrade() {
    var b = document.querySelector('#f-grade-int .chip[aria-checked="true"], #f-grade-sec .chip[aria-checked="true"]');
    if (!b) return { grade: '', stage: '' };
    return { grade: b.getAttribute('data-v'), stage: b.closest('#f-grade-int') ? 'intermediate' : 'secondary' };
  }
  function onGrade() {
    var gr = pickedGrade();
    $('wrap-track').hidden = gr.stage !== 'secondary';
    if (!S.fixedSchool) fillSchools(gr.stage);
  }
  function fillSchools(stage) {
    var box = $('f-school');
    var cur = picked(box);
    var list = CFG.SCHOOLS.filter(function (s) { return s.stage === stage; });
    $('wrap-school').hidden = !list.length;
    box.innerHTML = list.map(function (s) {
      return '<button type="button" class="chip" role="radio" aria-checked="' + (s.code === cur) + '" data-v="' + esc(s.code) + '">' + esc(s.name) + '</button>';
    }).join('');
  }

  /* ── البيانات الأساسية ── */
  function onData() {
    var gr = pickedGrade();
    var code = picked($('f-school'));
    var sch = S.fixedSchool || CFG.SCHOOLS.filter(function (s) { return s.code === code && s.stage === gr.stage; })[0];
    var u = {
      name: $('f-name').value.trim(), gender: picked($('f-gender')),
      stage: gr.stage, grade: gr.grade, track: gr.stage === 'secondary' ? picked($('f-track')) : '',
      school: sch ? sch.name : '', schoolCode: sch ? sch.code : '', schoolFromLink: !!S.fixedSchool
    };
    var err = '';
    if (!u.name) err = 'اكتب الاسم من فضلك.';
    else if (!u.gender) err = 'اختر: طالبة أو طالب.';
    else if (!u.grade) err = 'اختر الصف.';
    else if (u.stage === 'secondary' && !u.track) err = 'اختر المسار.';
    else if (!u.school) err = 'اختر المدرسة.';
    S.user.gender = u.gender;
    if (err && fem()) err = err.replace('اكتب', 'اكتبي').replace(/^اختر/, 'اختاري');
    $('form-error').textContent = err;
    if (err) return;

    S.user = u;
    S.submissionId = uuid();
    S.form = E.buildForm(S.bank, { stage: u.stage });
    S.responses = {}; S.times = {}; S.changes = {}; S.backs = 0;
    S.si = 0; S.qi = 0;
    S.startedAt = new Date();
    $('journey').hidden = false;
    drawJourney();
    $('b-medal').innerHTML = '<svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="22" fill="none" stroke="var(--primary)" stroke-width="4"/><path d="M26 10 L31 26 L26 42 L21 26 Z" fill="var(--accent)"/></svg>';
    $('b-done').textContent = 'المحطة الأولى';
    $('b-title').textContent = S.form.stations[0].station.title;
    $('b-intro').textContent = intro(S.form.stations[0].station);
    show('screen-break');
  }

  function resume() {
    var p = loadProgress(); if (!p) { $('btn-resume').hidden = true; return; }
    S.user = p.user; S.submissionId = p.sid; S.form = E.formFromOrder(S.bank, p.order);
    S.responses = p.responses; S.times = p.times || {}; S.changes = p.changes || {}; S.backs = p.backs || 0;
    S.startedAt = new Date(p.startedAt); S.si = p.si; S.qi = p.qi; S.resumed = 1;
    $('journey').hidden = false;
    drawJourney();
    renderQuestion();
    show('screen-quiz');
  }

  /* إنهاء: يعيد الصفحة إلى البداية بعد اكتمال الحفظ، حتى لا تبقى النتيجة ظاهرة على جهاز مشترك */
  function done() {
    if (CFG.ENDPOINT && loadQueue().length) {
      flushQueue();
      $('done-msg').textContent = fem() ? 'انتظري لحظة حتى يكتمل الحفظ، ثم اضغطي «إنهاء».' : 'انتظر لحظة حتى يكتمل الحفظ، ثم اضغط «إنهاء».';
      return;
    }
    location.href = location.pathname + location.search;
  }

  /* ── خريطة الرحلة ── */
  function drawJourney() {
    var stops = S.form.stations.map(function (s) { return { id: s.station.id, label: s.station.title }; }).concat([{ id: 'results', label: 'نتيجتي' }]);
    var curIdx = S.finishedAt ? stops.length - 1 : S.si;
    $('journey').innerHTML = stops.map(function (s, i) {
      var cls = i < curIdx ? 'done' : i === curIdx ? 'now' : '';
      var mark = i < curIdx ? '✓' : (i === stops.length - 1 ? '★' : ar(i + 1));
      return (i ? '<span class="jline ' + (i <= curIdx ? 'done' : '') + '"></span>' : '') +
        '<span class="jstop ' + cls + '"><i>' + mark + '</i><span>' + esc(s.label) + '</span></span>';
    }).join('');
  }

  /* ── السؤال ── */
  function current() { var st = S.form.stations[S.si]; return st ? { st: st, it: st.items[S.qi] } : null; }

  function renderQuestion() {
    var c = current(); if (!c) return;
    var st = c.st, it = c.it, n = st.items.length;
    $('q-station').textContent = st.station.title;
    $('q-count').textContent = ar(S.qi + 1) + ' من ' + ar(n);
    $('q-bar').style.width = Math.round(S.qi / n * 100) + '%';
    var pos = 0; for (var k = 0; k < S.si; k++) pos += S.form.stations[k].items.length; pos += S.qi;
    var total = S.form.order.length, left = Math.max(1, Math.ceil((total - pos) * SEC_PER_ITEM / 60));
    $('q-overall').textContent = 'العبارة ' + ar(pos + 1) + ' من ' + ar(total) + ' · بقي نحو ' + (left === 1 ? 'دقيقة' : left === 2 ? 'دقيقتين' : ar(left) + (left <= 10 ? ' دقائق' : ' دقيقة'));
    $('q-overall-bar').style.width = Math.round(pos / total * 100) + '%';
    var isBarrier = it.scale === 'barrier';
    $('q-meta').hidden = !isBarrier;
    $('q-meta').textContent = isBarrier ? S.bank.barrierStem : '';
    $('q-text').textContent = it.text;
    var prev = S.responses[it.id];
    $('q-options').innerHTML = '';
    S.bank.scales[it.scale].forEach(function (label, i) {
      var val = i + 1;
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'opt'; b.setAttribute('role', 'radio');
      b.textContent = label;
      if (prev === val) { b.classList.add('selected'); b.setAttribute('aria-checked', 'true'); }
      else b.setAttribute('aria-checked', 'false');
      b.addEventListener('click', function () { choose(it, val, b); });
      $('q-options').appendChild(b);
    });
    $('q-options').setAttribute('aria-label', it.text);
    $('btn-back').hidden = S.si === 0 && S.qi === 0;
    var card = $('q-card'); card.classList.remove('enter'); void card.offsetWidth; card.classList.add('enter');
    S.shownAt = now(); S.readyAt = S.shownAt + 350; // يتجاهل اللمسة المزدوجة التي تقع على العبارة التالية
    try { $('q-text').focus({ preventScroll: true }); } catch (e) { }
  }
  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

  var locked = false;
  function choose(it, val, btn) {
    if (locked || now() < S.readyAt) return;
    locked = true;
    S.times[it.id] = Math.round(((S.times[it.id] || 0) + (now() - S.shownAt) / 1000) * 10) / 10;
    if (S.responses[it.id] != null && S.responses[it.id] !== val) S.changes[it.id] = (S.changes[it.id] || 0) + 1;
    Array.prototype.forEach.call($('q-options').querySelectorAll('.opt'), function (b) { b.classList.remove('selected'); b.setAttribute('aria-checked', 'false'); });
    btn.classList.add('selected'); btn.setAttribute('aria-checked', 'true');
    S.responses[it.id] = val;
    setTimeout(function () { locked = false; advance(); if (!S.finishedAt) saveProgress(); }, CFG.TRANSITION_MS);
  }

  /* الأرقام من لوحة المفاتيح تختار البديل المقابل */
  function onKey(e) {
    if (e.repeat || !$('screen-quiz').classList.contains('active')) return;
    var k = parseInt(e.key, 10);
    var opts = $('q-options').querySelectorAll('.opt');
    if (k >= 1 && k <= opts.length) opts[k - 1].click();
  }

  /* الرجوع يعمل داخل المحطة وبين المحطات */
  function goBack() {
    if (locked) return;
    S.backs++;
    if (S.qi > 0) { S.qi--; }
    else if (S.si > 0) { S.si--; S.qi = S.form.stations[S.si].items.length - 1; drawJourney(); }
    renderQuestion();
  }

  function advance() {
    var st = S.form.stations[S.si];
    if (S.qi < st.items.length - 1) { S.qi++; renderQuestion(); return; }
    $('q-bar').style.width = '100%';
    var done = st.station;
    var next = S.form.stations[S.si + 1];
    if (!next) { finish(); return; }
    S.si++; S.qi = 0;
    drawJourney();
    $('b-medal').innerHTML = medal();
    $('b-done').textContent = 'أنهيت «' + done.title + '»';
    $('b-title').textContent = next.station.title;
    $('b-intro').textContent = intro(next.station);
    show('screen-break');
  }

  function medal() {
    return '<svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="22" fill="none" stroke="var(--primary)" stroke-width="4"/><path d="M15 27 l7 7 l15 -16" fill="none" stroke="var(--primary)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  /* ── النهاية: التصحيح والحفظ والنتيجة ── */
  function finish() {
    S.finishedAt = new Date();
    var dur = Math.round((S.finishedAt - S.startedAt) / 1000);
    var shown = S.form.order.length;
    var active = Object.keys(S.times).reduce(function (a, k) { return a + S.times[k]; }, 0);
    var r = E.score(S.bank, S.responses, { stage: S.user.stage, order: S.form.order, durationSec: active || dur, itemsShown: shown });
    var q = loadQueue(); q.push(buildPayload(r, dur, shown)); saveQueue(q);
    clearProgress();
    drawJourney();
    renderResults(r);
    setStatus('wait');
    flushQueue();
  }

  function buildPayload(r, dur, shown) {
    var p = {
      submission_id: S.submissionId, version: CFG.VERSION, instrument: S.bank.instrument, form: S.formName, test: TEST ? 1 : 0,
      started_at: S.startedAt.toISOString(), finished_at: S.finishedAt.toISOString(), duration_sec: dur,
      name: S.user.name, gender: S.user.gender, school: S.user.school, school_code: S.user.schoolCode,
      school_from_link: S.user.schoolFromLink ? 1 : 0, stage: S.user.stage, grade: S.user.grade, track: S.user.track,
      consent: 1, consent_mode: 'assent_on_start',
      items_shown: shown, order: S.form.order.join(' '),
      cx_high: r.complexity.high.join(' '), cx_high_n: r.complexity.high.length,
      barrier_present: r.barriers.present.join(' '), barrier_count: r.barriers.presentCount, barrier_total: r.barriers.countedTotal,
      barrier_big: r.barriers.big.join(' '),
      cap_strongest: r.capability.strongest || '', cap_weakest: r.capability.weakest || '',
      attention_pass: r.quality.attentionPass == null ? '' : (r.quality.attentionPass ? 1 : 0),
      attention_failed: r.quality.attentionFailed, longstring: r.quality.longstring, same_share: r.quality.sameShare,
      straightline: r.quality.straightline ? 1 : 0, fast: r.quality.fast ? 1 : 0,
      device_id: deviceId(), resumed: S.resumed, backs: S.backs,
      changes_n: Object.keys(S.changes).reduce(function (a, k) { return a + S.changes[k]; }, 0),
      active_sec: Math.round(Object.keys(S.times).reduce(function (a, k) { return a + S.times[k]; }, 0)),
      screen_w: window.innerWidth, ua: navigator.userAgent
    };
    Object.keys(S.times).forEach(function (k) { p['t_' + k] = S.times[k]; });
    Object.keys(r.facets).forEach(function (k) { p['f_' + k] = r.facets[k].mean; });
    // الإجابات الخام كما اختارها المستجيب (قبل قلب البنود العكسية)
    S.bank.items.forEach(function (it) { if (S.responses[it.id] != null) p['i_' + it.id] = S.responses[it.id]; });
    return p;
  }

  function setStatus(kind) {
    var el = $('save-status');
    if (!CFG.ENDPOINT) { el.innerHTML = '<span class="status wait">وضع المعاينة: الحفظ غير مربوط</span>'; return; }
    var m = { ok: ['ok', 'تم حفظ إجاباتك'], wait: ['wait', 'جار حفظ إجاباتك…'], err: ['err', 'لم يكتمل الحفظ بعد، وسيعاد تلقائيا. أبق الصفحة مفتوحة من فضلك.'] }[kind];
    if (kind === 'err' && fem()) m[1] = m[1].replace('أبق', 'أبقي');
    el.innerHTML = '<span class="status ' + m[0] + '">' + m[1] + '</span>';
  }

  var flushing = false;
  function flushQueue() {
    if (flushing || !CFG.ENDPOINT) return;
    var q = loadQueue(); if (!q.length) return;
    flushing = true;
    var p = q[0];
    fetch(CFG.ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(p) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.ok) throw new Error('save failed');
        var rest = loadQueue().filter(function (x) { return x.submission_id !== p.submission_id; });
        saveQueue(rest);
        if (p.submission_id === S.submissionId) setStatus('ok');
        flushing = false;
        if (rest.length) flushQueue();
      })
      .catch(function () { flushing = false; if (p.submission_id === S.submissionId) setStatus('err'); });
  }

  /* ── النتيجة: وصفية فقط ── */
  function counselor() { return g('المرشد الطلابي', 'المرشدة الطلابية'); }
  function bar(label, mean, cls) {
    var w = mean == null ? 0 : Math.round((mean - 1) / 4 * 100);
    return '<div class="bar"><div class="t"><span>' + esc(label) + '</span></div>' +
      '<div class="b"><div class="' + cls + '" style="width:' + w + '%"></div></div></div>';
  }

  function renderResults(r) {
    var first = S.user.name.split(/\s+/)[0];
    $('r-hello').textContent = 'أحسنت يا ' + first;
    $('r-lead').textContent = 'هذه صورة لوضعك اليوم، وتتغير كلما ' + g('عرفت', 'عرفت') + ' أكثر. ' + g('اعرضها على ', 'اعرضيها على ') + counselor() + g(' ليساعدك', ' لتساعدك') + ' في خطوتك التالية.';

    // المكوّن الأول
    $('r-cap').innerHTML = r.capability.facets.map(function (id) { return bar(S.fm[id].studentLabel, r.facets[id].mean, 'fill-cap'); }).join('');
    var hl = '';
    if (r.capability.strongest) hl += '<div class="hl-row"><span class="hl-tag good">الأوضح لديك</span>' + esc(S.fm[r.capability.strongest].studentLabel) + '</div>';
    if (r.capability.weakest) hl += '<div class="hl-row"><span class="hl-tag grow">' + g('تستطيع البدء به', 'تستطيعين البدء به') + '</span>' + esc(S.fm[r.capability.weakest].studentLabel) + '</div>';
    $('r-hl').innerHTML = hl;

    // المكوّن الثاني
    $('r-cx-note').textContent = 'طول الشريط يعني أثرا أكبر لهذا الجانب في قرارك، ولا يعني ضعفا فيك.';
    $('r-cx').innerHTML = r.complexity.facets.map(function (id) { return bar(S.fm[id].studentLabel, r.facets[id].mean, 'fill-cx'); }).join('');

    // العوائق
    var itemById = {}; S.bank.items.forEach(function (it) { itemById[it.id] = it; });
    var named = r.barriers.rated.filter(function (b) { return b.value >= 3; });
    $('r-barriers').innerHTML = named.length ?
      '<p class="muted">' + 'ذكرت' + ' أن هذه الأمور تقف أمام اختيارك بدرجة متوسطة أو كبيرة:</p><ul class="blist">' +
      named.map(function (b) { return '<li><span>' + esc(itemById[b.id].text.replace(/\.$/, '')) + '</span><em>' + esc(S.bank.scales.barrier[b.value - 1]) + '</em></li>'; }).join('') + '</ul>' +
      '<p class="muted">' + g('تحدث', 'تحدثي') + ' عنها مع ' + counselor() + '؛ فبعضها له حلول لا تظهر في البداية.</p>'
      : '<p class="muted">لم ' + g('تذكر', 'تذكري') + ' أمورا تقف أمام اختيارك بدرجة متوسطة أو كبيرة.</p>';

    // الخطوة التالية: اقتراح عملي للجانب الأقل وضوحا، ثم الحديث مع المرشد أو المرشدة
    var tip = '';
    if (r.capability.weakest) {
      var f = S.fm[r.capability.weakest], sec = S.user.stage === 'secondary' && f.tipSec;
      tip = sec ? (fem() ? f.tipSecF : f.tipSec) : (fem() ? f.tipF : f.tip);
    }
    $('r-next').innerHTML =
      (tip ? '<div class="service"><span class="ico"><svg viewBox="0 0 24 24" width="24" height="24"><path d="M12 3 L15 12 L12 21 L9 12 Z" fill="currentColor"/></svg></span><div><b>' + g('ابدأ بخطوة صغيرة', 'ابدئي بخطوة صغيرة') + '</b>' + esc(tip) + '</div></div>' : '') +
      '<p class="muted" style="margin-top:12px">' + g('اعرض', 'اعرضي') + ' هذه الصفحة على ' + counselor() + '، ' + g('واتفق', 'واتفقي') + ' معه' + g('', 'ا') + ' على ما ' + g('تحتاجه', 'تحتاجينه') + ' في الفترة القادمة.</p>';

    var sum = [['الاسم', S.user.name], ['المدرسة', S.user.school], ['الصف', S.user.grade + (S.user.track ? ' · ' + S.user.track : '')],
      ['التاريخ', S.finishedAt.toLocaleDateString('ar-SA-u-ca-gregory')]];
    $('r-summary').innerHTML = sum.map(function (s) { return '<div><dt>' + esc(s[0]) + '</dt><dd>' + esc(s[1]) + '</dd></div>'; }).join('');
    show('screen-results');
  }

  window.__CC = { state: S };
  document.addEventListener('DOMContentLoaded', init);
})();
