/* =====================================================================
   engine.js — محرك بناء النموذج والتصحيح
   مقياس جاهزية القرار المهني · النسخة الثانية
   كل الحسابات هنا قواعد ثابتة: الإجابات نفسها تعطي النتيجة نفسها دائماً.
   ===================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ENGINE = factory();
})(this, function () {
  'use strict';

  // حدود مؤقتة — تُضبط بعد جمع البيانات (المعايير المئينية وجلسة تحديد درجات القطع)
  var DEFAULTS = {
    capabilityHigh: 70, capabilityMedium: 45,   // الإسناد الذاتي (0–100)
    complexityHigh: 60,                         // مرجعيات القرار (0–100)
    followupLow: 34, followupHigh: 66,          // حدود فتح أسئلة المتابعة على مستوى الجانب
    maxFollowups: 4,
    bankPerStudent: 7,
    fastSecondsPerItem: 2.5,                    // أقل من هذا المتوسط يُعلَّم «سريع»
    straightlineShare: 0.9
  };

  var HEX = ['R', 'I', 'A', 'S', 'E', 'C'];

  function shuffle(arr, rng) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function forStage(item, stage) {
    return !item.stages || item.stages.indexOf(stage) !== -1;
  }

  /* بناء النموذج لطالبة واحدة: البنود الأساسية + عينة عشوائية من البنك + بنود الانتباه.
     يُعاد ترتيب العرض لكل محطة، ويُحفظ هذا الترتيب مع الإجابات. */
  function buildForm(bank, opts) {
    opts = opts || {};
    var rng = opts.rng || Math.random;
    var stage = opts.stage;
    var perStudent = opts.bankPerStudent != null ? opts.bankPerStudent : DEFAULTS.bankPerStudent;

    var eligible = bank.items.filter(function (it) { return forStage(it, stage); });
    var bankItems = shuffle(eligible.filter(function (it) { return it.role === 'bank'; }), rng).slice(0, perStudent);
    var chosen = eligible.filter(function (it) { return it.role !== 'bank'; }).concat(bankItems);

    var stations = bank.stations.filter(function (s) { return s.id !== 'followup'; }).map(function (s) {
      var dims = s.dimensions;
      var items = chosen.filter(function (it) { return dims.indexOf(it.dimension) !== -1; });
      var ordered = shuffle(items, rng).map(function (it) {
        var copy = JSON.parse(JSON.stringify(it));
        var indexed = copy.options.map(function (o, i) { o._idx = i; return o; });
        copy.options = it.shuffleOptions ? shuffle(indexed, rng) : indexed;
        return copy;
      });
      return { station: s, items: ordered };
    }).filter(function (s) { return s.items.length > 0; });

    return {
      stations: stations,
      bankDrawn: bankItems.map(function (it) { return it.id; }),
      order: stations.reduce(function (acc, s) { return acc.concat(s.items.map(function (it) { return it.id; })); }, [])
    };
  }

  function itemById(bank, id) {
    for (var i = 0; i < bank.items.length; i++) if (bank.items[i].id === id) return bank.items[i];
    return null;
  }

  function round1(x) { return Math.round(x * 10) / 10; }

  /* التصحيح. responses = { itemId: قيمة } حيث القيمة:
     - للبند الرتبي: قيمة الخيار (1..k)
     - لبند الميول: فهرس الخيار في ترتيبه الأصلي داخل بنك البنود
     - للبند الوصفي: قيمة الخيار */
  function score(bank, responses, opts) {
    opts = opts || {};
    var cfg = Object.assign({}, DEFAULTS, opts.config || {});

    // 1) الجوانب
    var facets = {};
    bank.facets.forEach(function (f) { facets[f.id] = { id: f.id, dimension: f.dimension, label: f.label, values: [], k: [] }; });
    bank.items.forEach(function (it) {
      if (it.type !== 'ordinal' || (it.role !== 'core' && it.role !== 'bank') || !it.facet) return;
      var v = responses[it.id];
      if (v == null || v === '') return;
      var k = it.options.length;
      facets[it.facet].values.push((Number(v) - 1) / (k - 1) * 100);
      facets[it.facet].k.push(k);
    });
    Object.keys(facets).forEach(function (id) {
      var f = facets[id];
      f.n = f.values.length;
      f.score = f.n ? round1(f.values.reduce(function (a, b) { return a + b; }, 0) / f.n) : null;
      delete f.values; delete f.k;
    });

    // 2) الأبعاد الكامنة = متوسط جوانبها المقيسة
    function dimScore(dim) {
      var fs = Object.keys(facets).map(function (k) { return facets[k]; })
        .filter(function (f) { return f.dimension === dim && f.score != null; });
      if (!fs.length) return { score: null, measured: false, facetsMeasured: 0 };
      return {
        score: round1(fs.reduce(function (a, f) { return a + f.score; }, 0) / fs.length),
        measured: true, facetsMeasured: fs.length
      };
    }
    var capability = dimScore('capability');
    capability.level = capability.score == null ? null :
      capability.score >= cfg.capabilityHigh ? 'high' : capability.score >= cfg.capabilityMedium ? 'medium' : 'low';
    var complexity = dimScore('complexity');
    complexity.level = complexity.score == null ? null : complexity.score >= cfg.complexityHigh ? 'high' : 'low';

    // 3) الميول ومؤشرات هولاند البنيوية
    var hs = { R: 0, I: 0, A: 0, S: 0, E: 0, C: 0 };
    var nInterest = 0;
    bank.items.forEach(function (it) {
      if (it.type !== 'profile') return;
      var v = responses[it.id];
      if (v == null || v === '') return;
      var opt = it.options[Number(v)];
      if (!opt) return;
      nInterest++;
      Object.keys(opt.scores || {}).forEach(function (t) { hs[t] += opt.scores[t]; });
    });
    var ranked = HEX.slice().sort(function (a, b) { return (hs[b] - hs[a]) || (HEX.indexOf(a) - HEX.indexOf(b)); });
    var interests = null;
    if (nInterest) {
      var d = Math.abs(HEX.indexOf(ranked[0]) - HEX.indexOf(ranked[1]));
      var hexDist = Math.min(d, 6 - d);
      interests = {
        scores: hs,
        code: ranked.slice(0, 3).join(''),
        top: ranked[0],
        differentiation: hs[ranked[0]] - hs[ranked[5]],
        clarity: hs[ranked[0]] - hs[ranked[1]],
        consistency: hexDist === 1 ? 'high' : hexDist === 2 ? 'medium' : 'low',
        answered: nInterest
      };
    }

    // 4) مستوى الخدمة وفق نموذج سامبسون (القدرة × التعقيد)
    var service = null;
    if (capability.level) {
      var cx = complexity.level || 'low';
      var table = {
        high: { low: 'self', high: 'brief' },
        medium: { low: 'brief', high: 'brief' },
        low: { low: 'brief_group', high: 'individual' }
      };
      service = {
        level: table[capability.level][cx],
        basis: complexity.level ? 'capability_x_complexity' : 'capability_only'
      };
    }

    // 5) جودة الاستجابة
    var attention = bank.items.filter(function (it) { return it.role === 'attention'; });
    var attAnswered = attention.filter(function (it) { return responses[it.id] != null; });
    var attentionPass = attAnswered.length ? attAnswered.every(function (it) { return Number(responses[it.id]) === it.expected; }) : null;
    var ordVals = bank.items.filter(function (it) { return it.type === 'ordinal' && it.role !== 'attention' && responses[it.id] != null; })
      .map(function (it) { return Number(responses[it.id]); });
    var straightline = false;
    if (ordVals.length >= 6) {
      var counts = {};
      ordVals.forEach(function (v) { counts[v] = (counts[v] || 0) + 1; });
      var maxShare = Math.max.apply(null, Object.keys(counts).map(function (k) { return counts[k]; })) / ordVals.length;
      straightline = maxShare >= cfg.straightlineShare;
    }
    var fast = null;
    if (opts.durationSec != null && opts.itemsShown) fast = opts.durationSec / opts.itemsShown < cfg.fastSecondsPerItem;

    return {
      facets: facets,
      capability: capability,
      complexity: complexity,
      interests: interests,
      service: service,
      quality: { attentionPass: attentionPass, straightline: straightline, fast: fast }
    };
  }

  /* أسئلة المتابعة المستحقة: الجوانب المنخفضة في القدرة أو المرتفعة في التعقيد،
     الأشد أولاً، بحد أقصى maxFollowups. أسئلة المتابعة لا تدخل في الدرجة. */
  function followupsFor(bank, result, stage, opts) {
    var cfg = Object.assign({}, DEFAULTS, (opts && opts.config) || {});
    var picked = [];
    bank.followups.forEach(function (fu) {
      if (!forStage(fu, stage)) return;
      var severity = null;
      fu.facets.forEach(function (fid) {
        var f = result.facets[fid];
        if (!f || f.score == null) return;
        var s = fu.when === 'low' ? (f.score <= cfg.followupLow ? cfg.followupLow - f.score + 1 : null)
                                  : (f.score >= cfg.followupHigh ? f.score - cfg.followupHigh + 1 : null);
        if (s != null && (severity == null || s > severity)) severity = s;
      });
      if (severity != null) picked.push({ fu: fu, severity: severity });
    });
    picked.sort(function (a, b) { return b.severity - a.severity; });
    return picked.slice(0, cfg.maxFollowups).map(function (p) { return p.fu; });
  }

  function diagnose(bank, followupResponses) {
    var out = [];
    bank.followups.forEach(function (fu) {
      var v = followupResponses[fu.id];
      if (v == null) return;
      var opt = fu.options.filter(function (o) { return o.value === v; })[0];
      if (!opt) return;
      var d = bank.diagnoses[opt.diagnosis];
      if (!d) return;
      out.push({ followup: fu.id, code: opt.diagnosis, label: d.label, recommendation: d.recommendation, serviceHint: d.serviceHint });
    });
    return out;
  }

  /* إذا أشار التشخيص إلى إرشاد فردي يُرفع مستوى الخدمة إليه (قاعدة مقترحة تحتاج تحكيماً) */
  function finalService(service, diagnoses) {
    if (!service) return null;
    var s = Object.assign({}, service);
    if (diagnoses.some(function (d) { return d.serviceHint === 'individual'; }) && s.level !== 'individual') {
      s.level = 'individual'; s.raisedByFollowup = true;
    }
    return s;
  }

  var SERVICE_LABELS = {
    self: 'خدمة ذاتية',
    brief: 'خدمة موجزة بمساعدة المرشد',
    brief_group: 'خدمة موجزة جماعية',
    individual: 'إدارة حالة فردية'
  };
  var LEVEL_LABELS = { high: 'مرتفعة', medium: 'متوسطة', low: 'تحتاج تطوير' };

  return {
    DEFAULTS: DEFAULTS, HEX: HEX, SERVICE_LABELS: SERVICE_LABELS, LEVEL_LABELS: LEVEL_LABELS,
    shuffle: shuffle, buildForm: buildForm, score: score, followupsFor: followupsFor,
    diagnose: diagnose, finalService: finalService, itemById: itemById
  };
});
