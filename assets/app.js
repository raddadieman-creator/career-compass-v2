/* =====================================================================
   app.js — واجهة المقياس: سؤال واحد في كل شاشة، خريطة رحلة، حفظ، نتائج
   البنود تقرأ من data/items.json، والحساب كله في engine.js
   ===================================================================== */
(function () {
  'use strict';
  var CFG = window.CC_CONFIG, E = window.ENGINE;
  var params = new URLSearchParams(location.search);
  var TEST = params.get('test') === '1';
  var QKEY = 'cc_v2_queue';
  var MEAS = ['interests', 'capability', 'complexity'];

  var S = {
    bank: null, user: {}, form: null, queue: [], si: 0, qi: 0,
    responses: {}, fu: {}, fuDone: false, startedAt: null, finishedAt: null,
    submissionId: null, memQueue: [], fixedSchool: null
  };

  /* ── أدوات ── */
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function uuid() { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  function fem() { return S.user.gender === 'F'; }
  function g(m, f) { return fem() ? f : m; }
  function txt(it) { return (fem() && it.textF) ? it.textF : it.text; }
  function ar(n) { return String(n).replace(/\d/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'[d]; }); }
  function shortTitle(st) { return st.title; }
  function intro(st) { return (fem() && st.introF) ? st.introF : st.intro; }
  function show(id) {
    Array.prototype.forEach.call(document.querySelectorAll('.screen'), function (s) { s.classList.remove('active'); });
    $(id).classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ── التخزين المحلي (قد يكون غير متاح؛ عندها يبقى الطابور في الذاكرة) ── */
  function loadQueue() { try { return JSON.parse(localStorage.getItem(QKEY) || '[]'); } catch (e) { return S.memQueue.slice(); } }
  function saveQueue(q) { S.memQueue = q.slice(); try { localStorage.setItem(QKEY, JSON.stringify(q)); } catch (e) { } }

  /* ── التهيئة ── */
  function init() {
    $('ver').textContent = CFG.VERSION;
    // تدريج البوصلة: ٣٦ علامة، الرئيسية كل ٩٠ درجة
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

    chipGroup($('f-gender'), null, function () { });
    var stageOnly = S.fixedSchool ? S.fixedSchool.stage : null;
    makeChips($('f-grade-int'), stageOnly === 'secondary' ? [] : CFG.GRADES.intermediate);
    makeChips($('f-grade-sec'), stageOnly === 'intermediate' ? [] : CFG.GRADES.secondary);
    if (stageOnly) $(stageOnly === 'secondary' ? 'f-grade-int' : 'f-grade-sec').parentNode.hidden = true;
    makeChips($('f-track'), CFG.TRACKS);
    chipGroup($('f-track'));
    // مجموعتا الصفوف تعملان كمجموعة واحدة
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

    $('btn-start').addEventListener('click', function () {
      if (!S.bank) return;
      show('screen-data');
    });
    $('btn-data').addEventListener('click', onData);
    $('btn-back').addEventListener('click', goBack);
    $('btn-next').addEventListener('click', function () { renderQuestion(); show('screen-quiz'); });

    fetch('data/items.json', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (b) { S.bank = b; })
      .catch(function () { $('btn-start').disabled = true; $('btn-start').textContent = 'تعذر تحميل الأسئلة، أعد/ي تحميل الصفحة'; });

    flushQueue();
    setInterval(flushQueue, 20000);
    window.addEventListener('online', flushQueue);
  }

  function makeChips(box, values) {
    box.innerHTML = values.map(function (v) { return '<button type="button" class="chip" role="radio" aria-checked="false" data-v="' + esc(v) + '">' + esc(v) + '</button>'; }).join('');
  }
  function chipGroup(box, _, cb) {
    box.addEventListener('click', function (e) {
      var b = e.target.closest('.chip'); if (!b) return;
      Array.prototype.forEach.call(box.querySelectorAll('.chip'), function (x) { x.setAttribute('aria-checked', String(x === b)); });
      if (cb) cb(b.getAttribute('data-v'));
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
  /* المدرسة تظهر بعد اختيار الصف، وتعرض مدارس المرحلة فقط */
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
      name: $('f-name').value.trim(),
      gender: picked($('f-gender')),
      stage: gr.stage, grade: gr.grade,
      track: gr.stage === 'secondary' ? picked($('f-track')) : '',
      school: sch ? sch.name : '',
      schoolCode: sch ? sch.code : '',
      schoolFromLink: !!S.fixedSchool
    };
    var err = '';
    if (!u.name) err = 'اكتب/ي الاسم من فضلك.';
    else if (!u.gender) err = 'اختر/ي: طالبة أو طالب.';
    else if (!u.grade) err = 'اختر/ي الصف.';
    else if (u.stage === 'secondary' && !u.track) err = 'اختر/ي المسار.';
    else if (!u.school) err = 'اختر/ي المدرسة.';
    $('form-error').textContent = err;
    if (err) return;

    S.user = u;
    S.submissionId = uuid();
    S.form = E.buildForm(S.bank, { stage: u.stage, bankPerStudent: CFG.BANK_PER_STUDENT });
    S.queue = S.form.stations.slice();
    S.si = 0; S.qi = 0;
    S.startedAt = new Date();
    $('journey').hidden = false;
    drawJourney();
    $('b-medal').innerHTML = '<svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="22" fill="none" stroke="var(--primary)" stroke-width="4"/><path d="M26 10 L31 26 L26 42 L21 26 Z" fill="var(--accent)"/></svg>';
    $('b-done').textContent = 'المحطة الأولى';
    $('b-title').textContent = S.queue[0].station.title;
    $('b-intro').textContent = intro(S.queue[0].station);
    show('screen-break');
  }

  /* ── خريطة الرحلة ── */
  function drawJourney() {
    var stops = S.form.stations.map(function (s) { return { id: s.station.id, label: shortTitle(s.station) }; })
      .concat([{ id: 'results', label: 'نتيجتي' }]);
    var curId = S.finishedAt ? 'results' : (S.queue[S.si] ? S.queue[S.si].station.id : 'results');
    if (curId === 'followup') curId = 'vision';
    var curIdx = stops.map(function (s) { return s.id; }).indexOf(curId);
    $('journey').innerHTML = stops.map(function (s, i) {
      var cls = i < curIdx ? 'done' : i === curIdx ? 'now' : '';
      var mark = i < curIdx ? '✓' : (i === stops.length - 1 ? '★' : ar(i + 1));
      return (i ? '<span class="jline ' + (i <= curIdx ? 'done' : '') + '"></span>' : '') +
        '<span class="jstop ' + cls + '"><i>' + mark + '</i><span>' + esc(s.label) + '</span></span>';
    }).join('');
  }

  /* ── السؤال ── */
  function current() { var st = S.queue[S.si]; return st ? { st: st, it: st.items[S.qi] } : null; }

  function renderQuestion() {
    var c = current(); if (!c) return;
    var st = c.st, it = c.it, n = st.items.length;
    $('q-station').textContent = st.station.title;
    $('q-count').textContent = ar(S.qi + 1) + ' من ' + ar(n);
    $('q-bar').style.width = Math.round(S.qi / n * 100) + '%';
    $('q-meta').textContent = ''; // تسميات البنود الداخلية لا تعرض للطالبة
    $('q-text').textContent = txt(it);
    var prev = it._followup ? S.fu[it.id] : S.responses[it.id];
    $('q-options').innerHTML = '';
    it.options.forEach(function (o) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'opt'; b.setAttribute('role', 'radio');
      b.textContent = (fem() && o.labelF) ? o.labelF : o.label;
      var val = it.type === 'profile' ? o._idx : o.value;
      if (prev != null && prev === val) { b.classList.add('selected'); b.setAttribute('aria-checked', 'true'); }
      else b.setAttribute('aria-checked', 'false');
      b.addEventListener('click', function () { choose(it, val, b); });
      $('q-options').appendChild(b);
    });
    $('btn-back').hidden = S.qi === 0;
    var card = $('q-card'); card.classList.remove('enter'); void card.offsetWidth; card.classList.add('enter');
  }

  var locked = false;
  function choose(it, val, btn) {
    if (locked) return;
    locked = true;
    Array.prototype.forEach.call($('q-options').querySelectorAll('.opt'), function (b) { b.classList.remove('selected'); b.setAttribute('aria-checked', 'false'); });
    btn.classList.add('selected'); btn.setAttribute('aria-checked', 'true');
    if (it._followup) S.fu[it.id] = val; else S.responses[it.id] = val;
    setTimeout(function () { locked = false; advance(); }, CFG.TRANSITION_MS);
  }

  function goBack() {
    if (S.qi > 0) { S.qi--; renderQuestion(); }
  }

  function advance() {
    var st = S.queue[S.si];
    if (S.qi < st.items.length - 1) { S.qi++; renderQuestion(); return; }
    // انتهت المحطة
    $('q-bar').style.width = '100%';
    var done = st.station;
    S.si++; S.qi = 0;
    maybeInsertFollowups();
    var next = S.queue[S.si];
    if (!next) { finish(); return; }
    drawJourney();
    $('b-medal').innerHTML = medal(done.id);
    $('b-done').textContent = g('أنهيت «', 'أنهيت «') + shortTitle(done) + '»';
    $('b-title').textContent = next.station.title;
    $('b-intro').textContent = intro(next.station);
    show('screen-break');
  }

  /* أسئلة المتابعة تفتح بعد محطات القياس وقبل المحطة الوصفية */
  function maybeInsertFollowups() {
    if (S.fuDone) return;
    var next = S.queue[S.si];
    if (next && MEAS.indexOf(next.station.id) !== -1) return;
    S.fuDone = true;
    var interim = E.score(S.bank, S.responses);
    var fus = E.followupsFor(S.bank, interim, S.user.stage);
    if (!fus.length) return;
    var st = S.bank.stations.filter(function (s) { return s.id === 'followup'; })[0];
    var items = fus.map(function (f) { var c = JSON.parse(JSON.stringify(f)); c.options.forEach(function (o, i) { o._idx = i; }); c._followup = true; return c; });
    S.queue.splice(S.si, 0, { station: st, items: items });
  }

  function medal(id) {
    var col = { interests: 'var(--warn)', capability: 'var(--primary)', complexity: 'var(--accent)', followup: 'var(--accent)' }[id] || 'var(--primary)';
    return '<svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="22" fill="none" stroke="' + col + '" stroke-width="4"/><path d="M15 27 l7 7 l15 -16" fill="none" stroke="' + col + '" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  /* ── النهاية: التصحيح والحفظ والنتائج ── */
  function finish() {
    S.finishedAt = new Date();
    var shown = S.queue.reduce(function (a, s) { return a + s.items.length; }, 0);
    var dur = Math.round((S.finishedAt - S.startedAt) / 1000);
    var result = E.score(S.bank, S.responses, { durationSec: dur, itemsShown: shown });
    var diagnoses = E.diagnose(S.bank, S.fu);
    var service = E.finalService(result.service, diagnoses);
    var q = loadQueue(); q.push(buildPayload(result, diagnoses, service, dur, shown)); saveQueue(q);
    drawJourney();
    renderResults(result, diagnoses, service);
    setStatus('wait');
    flushQueue();
  }

  function buildPayload(r, diagnoses, service, dur, shown) {
    var p = {
      submission_id: S.submissionId, version: CFG.VERSION, test: TEST ? 1 : 0,
      started_at: S.startedAt.toISOString(), finished_at: S.finishedAt.toISOString(), duration_sec: dur,
      name: S.user.name, gender: S.user.gender, school: S.user.school, school_code: S.user.schoolCode,
      school_from_link: S.user.schoolFromLink ? 1 : 0, stage: S.user.stage, grade: S.user.grade, track: S.user.track,
      consent: 1, consent_mode: 'assent_on_start',
      items_shown: shown, order: S.form.order.join(' '), bank_drawn: S.form.bankDrawn.join(' '),
      cap_score: r.capability.score, cap_level: r.capability.level,
      cx_score: r.complexity.score, cx_level: r.complexity.level,
      service_level: service ? service.level : '', service_basis: service ? service.basis : '',
      service_raised: service && service.raisedByFollowup ? 1 : 0,
      holland_code: r.interests ? r.interests.code : '', holland_top: r.interests ? r.interests.top : '',
      holland_diff: r.interests ? r.interests.differentiation : '', holland_clarity: r.interests ? r.interests.clarity : '',
      holland_consistency: r.interests ? r.interests.consistency : '',
      diagnoses: diagnoses.map(function (d) { return d.code; }).join(' '),
      followups: Object.keys(S.fu).join(' '),
      attention_pass: r.quality.attentionPass == null ? '' : (r.quality.attentionPass ? 1 : 0),
      straightline: r.quality.straightline ? 1 : 0, fast: r.quality.fast ? 1 : 0
    };
    Object.keys(r.facets).forEach(function (k) { p['facet_' + k] = r.facets[k].score; });
    if (r.interests) E.HEX.forEach(function (t) { p['holland_' + t] = r.interests.scores[t]; });
    Object.keys(S.responses).sort().forEach(function (k) { p['i_' + k] = S.responses[k]; });
    Object.keys(S.fu).sort().forEach(function (k) { p['f_' + k] = S.fu[k]; });
    return p;
  }

  function setStatus(kind) {
    var el = $('save-status');
    if (!CFG.ENDPOINT) { el.innerHTML = '<span class="status wait">وضع المعاينة: الحفظ غير مربوط بعد</span>'; return; }
    var m = { ok: ['ok', 'تم حفظ إجاباتك'], wait: ['wait', 'جار حفظ إجاباتك…'], err: ['err', 'لم يكتمل الحفظ بعد، وسيعاد تلقائيا. الرجاء إبقاء الصفحة مفتوحة.'] }[kind];
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

  /* ── النتائج ── */
  function counselor() { return g('المرشد الطلابي', 'المرشدة الطلابية'); }
  /* تسميات للطالبة؛ التسميات البحثية (خدمة ذاتية...) تبقى في البيانات ولوحة التحكم */
  function serviceLabel(level) {
    return {
      self: 'المتابعة بنفسك',
      brief: 'لقاء قصير مع ' + counselor(),
      brief_group: 'برنامج جماعي مع ' + counselor(),
      individual: 'لقاء فردي مع ' + counselor()
    }[level];
  }
  function serviceText(level) {
    return {
      self: g('تستطيع المتابعة بنفسك: ابحث في التخصصات التي تهمك، وارجع إلى ', 'تستطيعين المتابعة بنفسك: ابحثي في التخصصات التي تهمك، وارجعي إلى ') + counselor() + g(' متى احتجت.', ' متى احتجت.'),
      brief: 'لقاء قصير أو ورشة مع ' + counselor() + ' يكفي ليوضح لك الصورة.',
      brief_group: 'برنامج جماعي مع ' + counselor() + ' يساعدك على بناء قرارك خطوة خطوة.',
      individual: 'لقاء فردي مع ' + counselor() + ' هو الأنسب لك الآن.'
    }[level];
  }
  var CONS_TEXT = {
    high: 'أعلى نمطين لديك متجاوران على الشكل السداسي، أي أن تفضيلاتك متسقة.',
    medium: 'أعلى نمطين لديك متقاربان بدرجة متوسطة.',
    low: 'أعلى نمطين لديك متباعدان على الشكل السداسي، وقد يفيدك استكشافهما مع المرشد.'
  };
  var HL = { R: 'واقعي', I: 'بحثي', A: 'فني', S: 'اجتماعي', E: 'مبادر', C: 'تقليدي' };
  function lvColor(v) { return v >= 70 ? 'var(--good)' : v >= 45 ? 'var(--warn)' : 'var(--bad)'; }
  function bar(label, v) {
    return '<div class="bar"><div class="t"><span>' + esc(label) + '</span><span>' + (v == null ? '—' : ar(Math.round(v)) + '٪') + '</span></div>' +
      '<div class="b"><div style="width:' + (v || 0) + '%;background:' + lvColor(v || 0) + '"></div></div></div>';
  }

  function hexSvg(scores, top) {
    var order = ['R', 'I', 'A', 'S', 'E', 'C'];
    var mx = Math.max.apply(null, order.map(function (t) { return scores[t]; })) || 1;
    function pt(i, r) { var a = (-90 + i * 60) * Math.PI / 180; return [Math.round(r * Math.cos(a) * 10) / 10, Math.round(r * Math.sin(a) * 10) / 10]; }
    var grid = [0.33, 0.66, 1].map(function (k) {
      return '<polygon class="grid" points="' + order.map(function (_, i) { return pt(i, 100 * k).join(','); }).join(' ') + '"/>';
    }).join('') + order.map(function (_, i) { var p = pt(i, 100); return '<line class="grid" x1="0" y1="0" x2="' + p[0] + '" y2="' + p[1] + '"/>'; }).join('');
    var shape = order.map(function (t, i) { return pt(i, 12 + 88 * scores[t] / mx).join(','); }).join(' ');
    var dots = order.map(function (t, i) { var p = pt(i, 12 + 88 * scores[t] / mx); return '<circle class="dot" cx="' + p[0] + '" cy="' + p[1] + '" r="4"/>'; }).join('');
    var labels = order.map(function (t, i) {
      var p = pt(i, 122);
      return '<text class="lbl' + (t === top ? ' top' : '') + '" x="' + p[0] + '" y="' + (p[1] + 5) + '">' + HL[t] + ' ' + t + '</text>';
    }).join('');
    return grid + '<polygon class="shape" points="' + shape + '"/>' + dots + labels;
  }

  function renderResults(r, diagnoses, service) {
    var first = S.user.name.split(/\s+/)[0];
    $('r-hello').textContent = g('أحسنت يا ', 'أحسنت يا ') + first;
    $('r-lead').textContent = 'هذه صورة لوضعك اليوم، وتتغير كلما ' + g('عرفت', 'عرفت') + ' أكثر. ' + g('اعرضها على ', 'اعرضيها على ') + counselor() + g(' ليساعدك', ' لتساعدك') + ' في خطوتك التالية.';

    var cap = r.capability;
    var score = cap.score == null ? 0 : Math.round(cap.score);
    $('r-cap-score').textContent = cap.score == null ? '—' : ar(score) + '٪';
    var ring = $('r-ring');
    ring.style.stroke = lvColor(score);
    setTimeout(function () { ring.style.strokeDashoffset = String(314.16 * (1 - score / 100)); }, 120);
    var pill = $('r-cap-level');
    pill.textContent = cap.level ? 'جاهزية ' + E.LEVEL_LABELS[cap.level] : '';
    pill.className = 'level-pill lv-' + (cap.level || 'medium');
    var lt = cap.level && S.bank.levelTexts ? S.bank.levelTexts[cap.level] : null;
    $('r-cap-text').textContent = lt ? lt.meaning + ' ' + lt.nextStep : '';
    $('r-facets').innerHTML = S.bank.facets.filter(function (f) { return f.dimension === 'capability' && r.facets[f.id].n; })
      .map(function (f) { return bar(f.label, r.facets[f.id].score); }).join('');

    var cx = S.bank.facets.filter(function (f) { return f.dimension === 'complexity' && r.facets[f.id].n; });
    $('card-complexity').hidden = !cx.length;
    $('r-complexity').innerHTML = cx.map(function (f) { return bar(f.label, r.facets[f.id].score); }).join('');

    $('r-service').innerHTML = service ?
      '<span class="ico"><svg viewBox="0 0 24 24" width="24" height="24"><path d="M12 3 L15 12 L12 21 L9 12 Z" fill="currentColor"/></svg></span>' +
      '<div><b>' + esc(serviceLabel(service.level)) + '</b>' + esc(serviceText(service.level)) + '</div>' : '';
    var seen = {};
    $('r-diagnoses').innerHTML = diagnoses.filter(function (d) {
      if (d.code === 'none' || d.code === 'shared_ok' || seen[d.code]) return false;
      seen[d.code] = true; return true;
    }).map(function (d) { return '<div class="diag"><b>' + esc(d.label) + '</b>' + esc(d.recommendation) + '</div>'; }).join('');

    var it = r.interests;
    if (it) {
      var prof = S.bank.profiles[it.top] || {};
      $('r-hex').innerHTML = hexSvg(it.scores, it.top);
      $('r-code').textContent = it.code;
      $('r-name').textContent = prof.name || '';
      $('r-desc').textContent = prof.desc || '';
      $('r-consistency').textContent = CONS_TEXT[it.consistency] || '';
      $('r-sectors').innerHTML = (prof.sectors || []).map(function (s) { return '<span>' + esc(s) + '</span>'; }).join('');
      $('r-specs').innerHTML = (prof.specs || []).map(function (s) { return '<li>' + esc(s.text) + '</li>'; }).join('');
    }

    var sum = [
      ['الاسم', S.user.name], ['المدرسة', S.user.school], ['الصف', S.user.grade + (S.user.track ? ' · ' + S.user.track : '')],
      ['الجاهزية', cap.level ? E.LEVEL_LABELS[cap.level] : '—'], ['رمز هولاند', it ? it.code : '—'],
      ['الخطوة التالية', service ? serviceLabel(service.level) : '—']
    ];
    $('r-summary').innerHTML = sum.map(function (s) { return '<div><dt>' + esc(s[0]) + '</dt><dd>' + esc(s[1]) + '</dd></div>'; }).join('');
    show('screen-results');
  }

  window.__CC = { state: S };
  document.addEventListener('DOMContentLoaded', init);
})();
