import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeItem, findPatterns, generateBrief, askLibrary } from '../server/intelligence.js';
const item = (overrides = {}) => ({ id: 'one', competitorName: 'Example brand', kind: 'organic', platform: 'instagram', format: 'instagram_reel', caption: 'How to find content ideas. Join our coaching program. Our client tested this workflow.', transcriptStatus: 'unavailable', transcript: null, outlierScore: 2, sourceUrl: 'https://www.instagram.com/reel/example/', ...overrides });
test('missing transcripts are never fabricated and written opening is explicitly identified', () => {
  const result = analyzeItem(item());
  assert.equal(result.hook, '');
  assert.equal(result.hookSource, 'Transcript unavailable');
  assert.match(result.hookTypeBasis, /Written opening/);
  assert.equal(result.offer, 'Join our coaching program.');
});
test('retrieved transcript hooks are verbatim', () => {
  const result = analyzeItem(item({ transcriptStatus: 'available', transcript: 'Why is content so difficult? Here is my process.' }));
  assert.equal(result.hook, 'Why is content so difficult?');
  assert.equal(result.hookType, 'Question');
});
test('pattern signals never mix paid longevity and unlike organic formats, or missing and zero', () => {
  const result = findPatterns([item(), item(), item({ id: 'two', format: 'youtube_video', platform: 'youtube', outlierScore: 20 }), item({ id: 'three', kind: 'paid', format: 'ad_video', activeDays: 100 }), item({ id: 'four', outlierScore: null }), item({ id: 'five', outlierScore: 0 })]);
  assert.equal(result.itemCount, 5);
  const pillars = result.patterns.filter(pattern => pattern.category === 'Content pillar');
  assert.equal(pillars.length, 3);
  const reel = pillars.find(pattern => pattern.signalType.startsWith('Instagram Reel'));
  assert.equal(reel.averageSignal, 1);
  assert.equal(reel.count, 3);
  assert.equal(reel.signalCount, 2);
  assert.equal(reel.frequency, 1);
});
test('duration questions return every matching active ad with source citations', async () => {
  const result = await askLibrary({ items: [item({ id: 'ad1', kind: 'paid', active: true, activeDays: 61 }), item({ id: 'ad2', kind: 'paid', active: true, activeDays: 60 }), item({ id: 'ad3', kind: 'paid', active: false, activeDays: 99 })], question: 'Show me every ad running for more than 60 days.' });
  assert.deepEqual(result.citations.map(ref => ref.itemId), ['ad1']);
  assert.match(result.answer, /61 active days/);
  assert.match(result.answer, /\[ad1\]/);
});
test('competitor queries constrain citations to that competitor', async () => {
  const result = await askLibrary({ items: [item(), item({ id: 'other', competitorName: 'Other brand' })], question: 'What offers is Example brand promoting?' });
  assert.deepEqual(result.citations.map(ref => ref.itemId), ['one']);
  assert.match(result.answer, /Join our coaching program/);
});
test('empty evidence and content gaps never become asserted facts', async () => {
  const empty = await askLibrary({ items: [], question: 'What works?' });
  assert.equal(empty.insufficient, true);
  assert.deepEqual(empty.citations, []);
  const gaps = await askLibrary({ items: [item()], question: 'What gaps are competitors ignoring?' });
  assert.equal(gaps.insufficient, true);
  assert.match(gaps.answer, /cannot prove/);
});
test('all creative formats separate source evidence from original execution', async () => {
  for (const format of ['paid_ad', 'short', 'carousel', 'youtube_video']) {
    const brief = await generateBrief({ items: [item()], format, audience: 'Growth operators', offer: 'Content planning service', objective: 'Help clients plan useful content' }, { apiKey: '' });
    assert.equal(brief.sourceEvidence.length, 1);
    assert.equal(brief.references[0].itemId, 'one');
    assert.match(brief.sourceEvidence[0].evidence, /How to find content ideas/);
    assert.equal(brief.adaptation.audience, 'Growth operators');
    assert.ok(brief.adaptation.structure.length >= 4);
    assert.ok(brief.adaptation.shotList.length >= 4);
    assert.match(brief.adaptation.proofPlan, /Gather evidence/);
    assert.notEqual(brief.adaptation.hook, analyzeItem(item()).captionOpening);
  }
});
test('briefs require real stored references', async () => {
  await assert.rejects(generateBrief({ items: [], format: 'short' }), /Save at least/);
});
test('AI failures preserve deterministic brief and never echo provider errors or credentials', async () => {
  const brief = await generateBrief({ items: [item()], format: 'short' }, { apiKey: 'secret-do-not-echo', fetch: async () => { throw new Error('secret-do-not-echo'); } });
  assert.match(brief.warning, /AI generation was unavailable/);
  assert.ok(!JSON.stringify(brief).includes('secret-do-not-echo'));
  assert.equal(brief.references[0].itemId, 'one');
});
test('unsafe original URLs cannot be returned as executable citations', async () => {
  const result = await askLibrary({ items: [item({ sourceUrl: 'javascript:alert(1)' })], question: 'What offers are promoted?' });
  assert.equal(result.citations[0].url, '');
});
test('AI copy that repeats a long source passage is rejected', async () => {
  const source = item({ caption: 'The secret mechanism behind this is a sequence of ten highly specific moves we learned while building our consulting practice.' });
  const adaptation = { objective: 'Help clients', audience: 'Operators', angle: 'A fresh angle', hook: source.caption, proofPlan: 'Collect proof.', cta: 'Reply with a question.', structure: ['Start', 'Demonstrate'], shotList: ['Camera', 'Screen'] };
  const brief = await generateBrief({ items: [source], format: 'short' }, { apiKey: 'test-only', fetch: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(adaptation) } }] }) }) });
  assert.equal(brief.mode, 'Evidence-guided production template');
  assert.notEqual(brief.adaptation.hook, source.caption);
  assert.match(brief.warning, /failed validation/);
});
test('category patterns group distinct testimonial statements under the same mechanism', () => {
  const result = findPatterns([item({ caption: 'Watch this testimonial from our customer.' }), item({ id: 'two', caption: 'A new testimonial describes the experience.' })]);
  const proof = result.patterns.find(pattern => pattern.category === 'Proof mechanism');
  assert.equal(proof.label, 'Testimonial');
  assert.equal(proof.count, 2);
});
