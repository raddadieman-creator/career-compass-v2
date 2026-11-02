/* =====================================================================
   engine.js — بناء النموذج والتصحيح
   البوصلة المهنية: أداة تقدير الجاهزية لاتخاذ القرار المهني (المسودة الرابعة)
   كل الحسابات قواعد ثابتة: الإجابات نفسها تعطي النتيجة نفسها دائما.
   لا توجد هنا مستويات ولا درجات قطع؛ الأداة في مرحلة التطوير.
   ===================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ENGINE = factory();
})(this, function () {
  'use strict';

  var DEFAULTS = {
    signalHigh: 4,            // إشارة داخلية للمرشدة: متوسط جانب التعقيد 4 فأكثر (مؤقتة، تُراجع بعد التجربة الاستطلاعية)
    barrierPresent: 3,        // يُعد العائق قائما إذا كانت الإجابة 3 أو 4
    barrierBig: 4,            // «يمثل عائقا كبيرا»
    fastSecondsPerItem: 2,    // أقل من ثانيتين للبند في المتوسط يُعلَّم «سريع» للمراجعة
    straightlineShare: 0.9,   // 90% فأكثر من الإجابات بالقيمة نفسها يُعلَّم للمراجعة
    highlightGap: 0.5         // لا يُعرض «الأوضح» و«تبدأ به» إلا لجانب منفرد يبتعد عن الذي يليه نصف درجة على الأقل
  };

  function shuffle(arr, rng) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function forStage(item, stage) { return item.stage === 'both' || item.stage === stage; }

  function facetMap(bank) {
    var m = {};
    bank.facets.forEach(function (f) { m[f.id] = f; });
    return m;
  }

  function stationOf(item, fm) { return item.station || (fm[item.facet] && fm[item.facet].station); }

  /* نموذج طالب أو طالبة: كل بنود المرحلة، مرتبة عشوائيا داخل كل محطة، ويُحفظ الترتيب مع الإجابات */
  function buildForm(bank, opts) {
    opts = opts || {};
    var rng = opts.rng || Math.random;
    var fm = facetMap(bank);
    var eligible = bank.items.filter(function (it) { return forStage(it, opts.stage); });
    var stations = bank.stations.map(function (s) {
      var items = shuffle(eligible.filter(function (it) { return stationOf(it, fm) === s.id; }), rng);
      return { station: s, items: items };
    }).filter(function (s) { return s.items.length; });
    var order = [];
    stations.forEach(function (s) { s.items.forEach(function (it) { order.push(it.id); }); });
    return { stations: stations, order: order };
  }

  /* إعادة بناء النموذج نفسه من ترتيب محفوظ (للمتابعة بعد إعادة تحميل الصفحة) */
  function formFromOrder(bank, order) {
    var fm = facetMap(bank), byId = {};
    bank.items.forEach(function (it) { byId[it.id] = it; });
    var stations = bank.stations.map(function (s) {
      return { station: s, items: order.map(function (id) { return byId[id]; }).filter(function (it) { return it && stationOf(it, fm) === s.id; }) };
    }).filter(function (s) { return s.items.length; });
    return { stations: stations, order: order.slice() };
  }

  function round2(x) { return Math.round(x * 100) / 100; }

  function scaleMax(bank, it) { return bank.scales[it.scale].length; }

  /* القيمة بعد القلب للبنود العكسية */
  function keyed(bank, it, v) { return it.reverse ? (scaleMax(bank, it) + 1 - v) : v; }

  function score(bank, responses, opts) {
    opts = opts || {};
    var cfg = {}; Object.keys(DEFAULTS).forEach(function (k) { cfg[k] = opts[k] != null ? opts[k] : DEFAULTS[k]; });
    var stage = opts.stage;
    var items = bank.items.filter(function (it) { return !stage || forStage(it, stage); });

    // الجوانب المصححة: متوسط على سلم 1–5
    var facets = {};
    bank.facets.forEach(function (f) {
      if (f.component !== 'capability' && f.component !== 'complexity') return;
      var vals = items.filter(function (it) { return it.facet === f.id && it.role === 'scored' && responses[it.id] != null; })
        .map(function (it) { return keyed(bank, it, Number(responses[it.id])); });
      var k = items.filter(function (it) { return it.facet === f.id && it.role === 'scored'; }).length;
      facets[f.id] = { mean: vals.length ? round2(vals.reduce(function (a, b) { return a + b; }, 0) / vals.length) : null, n: vals.length, k: k };
    });

    function compIds(c) { return bank.facets.filter(function (f) { return f.component === c && facets[f.id] && facets[f.id].n; }).map(function (f) { return f.id; }); }

    // المكوّن الأول: وصف نسبي فقط (الجانب الأعلى والأدنى لدى المستجيب نفسه)، دون درجة كلية
    var cap = compIds('capability');
    var strongest = null, weakest = null;
    if (cap.length > 2) {
      var sorted = cap.slice().sort(function (a, b) { return facets[b].mean - facets[a].mean; });
      var m = sorted.map(function (id) { return facets[id].mean; }), L = m.length;
      if (m[0] - m[1] >= cfg.highlightGap) strongest = sorted[0];
      if (m[L - 2] - m[L - 1] >= cfg.highlightGap) weakest = sorted[L - 1];
    }

    // المكوّن الثاني: ثلاث درجات مستقلة + إشارة داخلية للمرشدة
    var cx = compIds('complexity');
    var cxHigh = cx.filter(function (id) { return facets[id].mean >= cfg.signalHigh; });

    // العوائق: كل مؤشر منفردا، والعدد داخل النسخة فقط
    var bItems = items.filter(function (it) { return it.role === 'barrier'; });
    var rated = bItems.filter(function (it) { return responses[it.id] != null; })
      .map(function (it) { return { id: it.id, value: Number(responses[it.id]) }; });
    var counted = bItems.filter(function (it) { return !it.excludeFromCount; });
    var present = counted.filter(function (it) { return Number(responses[it.id]) >= cfg.barrierPresent; }).map(function (it) { return it.id; });
    var big = counted.filter(function (it) { return Number(responses[it.id]) >= cfg.barrierBig; }).map(function (it) { return it.id; });

    // الدعم: كل مؤشر منفردا، دون أي درجة
    var support = {};
    items.filter(function (it) { return it.role === 'support'; }).forEach(function (it) { support[it.id] = responses[it.id] != null ? Number(responses[it.id]) : null; });

    // جودة الاستجابة
    var att = items.filter(function (it) { return it.role === 'attention'; });
    var attAnswered = att.filter(function (it) { return responses[it.id] != null; });
    var attFailed = attAnswered.filter(function (it) { return Number(responses[it.id]) !== it.expected; }).length;
    var agree = (opts.order || items.map(function (it) { return it.id; }))
      .map(function (id) { return items.filter(function (it) { return it.id === id; })[0]; })
      .filter(function (it) { return it && it.scale === 'agree' && it.role !== 'attention' && responses[it.id] != null; })
      .map(function (it) { return Number(responses[it.id]); });
    var counts = {}, longest = 0, run = 0;
    agree.forEach(function (v, i) {
      counts[v] = (counts[v] || 0) + 1;
      run = (i && v === agree[i - 1]) ? run + 1 : 1;
      if (run > longest) longest = run;
    });
    var modal = 0; Object.keys(counts).forEach(function (k) { if (counts[k] > modal) modal = counts[k]; });
    var share = agree.length ? modal / agree.length : 0;
    var shown = opts.itemsShown || 0;

    return {
      facets: facets,
      capability: { facets: cap, strongest: strongest, weakest: weakest },
      complexity: { facets: cx, high: cxHigh },
      barriers: { rated: rated, present: present, presentCount: present.length, countedTotal: counted.length, big: big },
      support: support,
      quality: {
        attentionPass: att.length ? (attAnswered.length === att.length && attFailed === 0) : null,
        attentionFailed: attFailed,
        longstring: longest,
        sameShare: round2(share),
        straightline: share >= cfg.straightlineShare,
        fast: !!(opts.durationSec && shown && opts.durationSec / shown < cfg.fastSecondsPerItem)
      }
    };
  }

  return { DEFAULTS: DEFAULTS, buildForm: buildForm, formFromOrder: formFromOrder, score: score, forStage: forStage, keyed: keyed };
});
