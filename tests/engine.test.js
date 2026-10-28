// اختبارات محرك التصحيح: node tests/engine.test.js
const assert = require('assert');
const path = require('path');
const E = require(path.join(__dirname, '..', 'assets', 'engine.js'));
const bank = require(path.join(__dirname, '..', 'data', 'items.json'));

function seeded(seed) { return function () { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

// 1) بناء النموذج: كل البنود الأساسية حاضرة لكل مرحلة، والترتيب يختلف بين طالبتين
['intermediate', 'secondary'].forEach(stage => {
  const f1 = E.buildForm(bank, { stage, rng: seeded(1) });
  const f2 = E.buildForm(bank, { stage, rng: seeded(2) });
  const core = bank.items.filter(i => i.role !== 'bank').map(i => i.id).sort();
  assert.deepStrictEqual(f1.order.slice().sort(), core, 'all non-bank items present');
  assert.notDeepStrictEqual(f1.order, f2.order, 'orders differ between students');
  f1.stations.forEach(s => s.items.forEach(it => {
    if (it.type === 'ordinal') assert.deepStrictEqual(it.options.map(o => o._idx), it.options.map((_, i) => i), 'ordinal options keep order');
  }));
});

// 2) الدرجات: أعلى خيار في كل بنود الإسناد → 100، وأدنى خيار → 0
const cap = bank.items.filter(i => i.dimension === 'capability' && i.role === 'core');
let r = {}; cap.forEach(i => r[i.id] = i.options.length);
let s = E.score(bank, r);
assert.strictEqual(s.capability.score, 100); assert.strictEqual(s.capability.level, 'high');
r = {}; cap.forEach(i => r[i.id] = 1);
s = E.score(bank, r);
assert.strictEqual(s.capability.score, 0); assert.strictEqual(s.capability.level, 'low');
assert.strictEqual(s.complexity.measured, false, 'complexity has no items yet');
assert.strictEqual(s.service.level, 'brief_group'); assert.strictEqual(s.service.basis, 'capability_only');

// 3) المتابعة: الدرجات المنخفضة تفتح أسئلة متابعة بحد أقصى 4
const fus = E.followupsFor(bank, s, 'secondary');
assert.ok(fus.length > 0 && fus.length <= 4);
r = {}; cap.forEach(i => r[i.id] = i.options.length);
assert.strictEqual(E.followupsFor(bank, E.score(bank, r), 'secondary').length, 0, 'no follow-ups when high');

// 4) التشخيص ورفع مستوى الخدمة
const dg = E.diagnose(bank, { FU04: 'indecisive' });
assert.strictEqual(dg[0].code, 'indecisive');
assert.strictEqual(E.finalService({ level: 'brief' }, dg).level, 'individual');

// 5) الميول: اختيار خيار R الخالص يعطي R أولاً
const prof = bank.items.filter(i => i.type === 'profile');
r = {};
prof.forEach(i => { let best = 0, bi = 0; i.options.forEach((o, k) => { const v = (o.scores.R || 0); if (v > best) { best = v; bi = k; } }); r[i.id] = bi; });
s = E.score(bank, r);
assert.strictEqual(s.interests.top, 'R');
assert.ok(['high', 'medium', 'low'].includes(s.interests.consistency));

// 6) الجودة: الإجابة النمطية تُعلَّم
r = {}; cap.forEach(i => r[i.id] = 2);
assert.strictEqual(E.score(bank, r).quality.straightline, true);
r['ATT01'] = 2; assert.strictEqual(E.score(bank, r).quality.attentionPass, true);
r['ATT01'] = 4; assert.strictEqual(E.score(bank, r).quality.attentionPass, false);

console.log('engine tests passed');
