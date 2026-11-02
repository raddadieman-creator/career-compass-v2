// اختبارات المحرك: node tests/engine.test.js
const assert = require('assert');
const path = require('path');
const E = require(path.join(__dirname, '..', 'assets', 'engine.js'));
const bank = require(path.join(__dirname, '..', 'data', 'items.json'));

function seeded(seed) { return function () { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }
const scored = bank.items.filter(i => i.role === 'scored');

// 1) أعداد البنود في كل نسخة كما في بطاقة تعريف الأداة
const expect = { intermediate: { scored: 45, barrier: 5, support: 2, total: 52 }, secondary: { scored: 44, barrier: 7, support: 2, total: 53 } };
['intermediate', 'secondary'].forEach(stage => {
  const f = E.buildForm(bank, { stage, rng: seeded(1) });
  const ids = f.order;
  const byRole = r => bank.items.filter(i => i.role === r && ids.includes(i.id)).length;
  assert.strictEqual(byRole('scored'), expect[stage].scored, stage + ' scored');
  assert.strictEqual(byRole('barrier'), expect[stage].barrier, stage + ' barriers');
  assert.strictEqual(byRole('support'), expect[stage].support, stage + ' support');
  assert.strictEqual(byRole('attention'), 2, stage + ' attention');
  assert.strictEqual(ids.length, expect[stage].total + 2, stage + ' total shown');
  assert.strictEqual(new Set(ids).size, ids.length, 'no duplicates');
  const f2 = E.buildForm(bank, { stage, rng: seeded(7) });
  assert.notDeepStrictEqual(f.order, f2.order, 'order differs between students');
  assert.deepStrictEqual(f.order.slice().sort(), f2.order.slice().sort(), 'same item set');
  // العوائق في المحطة الأخيرة وحدها
  const last = f.stations[f.stations.length - 1];
  assert.strictEqual(last.station.id, 'barriers');
  assert.ok(last.items.every(i => i.role === 'barrier'));
});
assert.strictEqual(scored.filter(i => i.stage === 'both').length, 41, '41 shared scored items');

// 2) القلب: RC4 هو البند العكسي الوحيد
assert.deepStrictEqual(bank.items.filter(i => i.reverse).map(i => i.id), ['RC4']);
let r = {};
bank.items.filter(i => i.facet === 'RC').forEach(i => r[i.id] = 5);
let s = E.score(bank, r, { stage: 'secondary' });
assert.strictEqual(s.facets.RC.mean, Math.round((5 * 5 + 1) / 6 * 100) / 100, 'RC4=5 becomes 1');

// 3) متوسطات الجوانب ونطاقها، ودون درجة كلية
r = {}; scored.forEach(i => r[i.id] = i.reverse ? 1 : 5);
s = E.score(bank, r, { stage: 'intermediate' });
Object.keys(s.facets).forEach(k => assert.strictEqual(s.facets[k].mean, 5, k));
assert.strictEqual(s.capability.strongest, null, 'no strongest when all equal');
assert.deepStrictEqual(s.complexity.high, ['SR', 'FF', 'PR']);
assert.ok(!('total' in s) && !('level' in s.capability), 'no total score, no level');

// 4) الجانب الأعلى والأدنى نسبيا
r = {}; scored.forEach(i => r[i.id] = 3);
bank.items.filter(i => i.facet === 'OK').forEach(i => r[i.id] = 5);
bank.items.filter(i => i.facet === 'LM').forEach(i => r[i.id] = 1);
s = E.score(bank, r, { stage: 'secondary' });
assert.strictEqual(s.capability.strongest, 'OK'); assert.strictEqual(s.capability.weakest, 'LM');
// فرق أقل من نصف درجة: لا يُعرض شيء
bank.items.filter(i => i.facet === 'OK').forEach(i => r[i.id] = 3); r.OK1 = 5;  // OK = 3.33
s = E.score(bank, r, { stage: 'secondary' });
assert.strictEqual(s.capability.strongest, null, 'gap < 0.5 → no strongest'); assert.strictEqual(s.capability.weakest, 'LM');
assert.deepStrictEqual(s.complexity.high, []);

// 5) العوائق: العدد داخل النسخة، وCN5 خارج العدد
r = {}; bank.items.filter(i => i.role === 'barrier').forEach(i => r[i.id] = 4);
s = E.score(bank, r, { stage: 'intermediate' });
assert.strictEqual(s.barriers.countedTotal, 4); assert.strictEqual(s.barriers.presentCount, 4);
assert.ok(!s.barriers.present.includes('CN5') && !s.barriers.big.includes('CN5'));
s = E.score(bank, r, { stage: 'secondary' });
assert.strictEqual(s.barriers.countedTotal, 6); assert.strictEqual(s.barriers.presentCount, 6);
r.CN1 = 2; s = E.score(bank, r, { stage: 'secondary' });
assert.strictEqual(s.barriers.presentCount, 5);

// 6) الدعم لا يدخل في أي جانب
r = {}; scored.forEach(i => r[i.id] = 3); r.SP1 = 5; r.SP2 = 1;
s = E.score(bank, r, { stage: 'secondary' });
assert.deepStrictEqual(s.support, { SP1: 5, SP2: 1 });
assert.strictEqual(s.facets.SR.mean, 3); assert.strictEqual(s.facets.FF.mean, 3);

// 7) الجودة
r = {}; scored.forEach(i => r[i.id] = 4); r.AT1 = 4; r.AT2 = 1;
s = E.score(bank, r, { stage: 'secondary', durationSec: 300, itemsShown: 55 });
assert.strictEqual(s.quality.attentionPass, true); assert.strictEqual(s.quality.straightline, true); assert.strictEqual(s.quality.fast, false);
r.AT2 = 3; s = E.score(bank, r, { stage: 'secondary', durationSec: 60, itemsShown: 55 });
assert.strictEqual(s.quality.attentionPass, false); assert.strictEqual(s.quality.fast, true);

// 8) إعادة بناء النموذج من ترتيب محفوظ
const f0 = E.buildForm(bank, { stage: 'intermediate', rng: seeded(3) });
const f1 = E.formFromOrder(bank, f0.order);
assert.deepStrictEqual(f1.stations.map(s => s.items.map(i => i.id)), f0.stations.map(s => s.items.map(i => i.id)));

// 9) النموذج المختصر: أربع عبارات لكل جانب في كل مرحلة
const keep = new Set(bank.forms.short);
const sb = Object.assign({}, bank, { items: bank.items.filter(i => keep.has(i.id)) });
[['intermediate', 39], ['secondary', 41]].forEach(([stage, n]) => {
  const f = E.buildForm(sb, { stage, rng: seeded(5) });
  assert.strictEqual(f.order.length, n, stage + ' short total');
  ['SK', 'OK', 'LM', 'DS', 'RC', 'SR', 'FF', 'PR'].forEach(fc => assert.strictEqual(sb.items.filter(i => i.facet === fc && f.order.includes(i.id)).length, 4, stage + ' ' + fc));
});
assert.strictEqual(sb.items.filter(i => i.role === 'scored' && i.stage === 'both').length, 30, '30 shared scored items in short form');

// 10) نموذج التجربة الاستطلاعية: خمس عبارات لكل جانب عدا FF (أربع)
const k5 = new Set(bank.forms.pilot5);
const pb = Object.assign({}, bank, { items: bank.items.filter(i => k5.has(i.id)) });
[['intermediate', 46], ['secondary', 48]].forEach(([stage, n]) => {
  const f = E.buildForm(pb, { stage, rng: seeded(9) });
  assert.strictEqual(f.order.length, n, stage + ' pilot5 total');
  ['SK', 'OK', 'LM', 'DS', 'RC', 'SR', 'PR'].forEach(fc => assert.strictEqual(pb.items.filter(i => i.facet === fc && f.order.includes(i.id)).length, 5, stage + ' ' + fc));
  assert.strictEqual(pb.items.filter(i => i.facet === 'FF' && f.order.includes(i.id)).length, 4);
});

console.log('engine tests passed');
