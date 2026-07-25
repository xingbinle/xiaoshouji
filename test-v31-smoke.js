// ponytail smoke test: 只验关键数据变换，不调 API
// 1. detectScatterFlags 命中行为
// 2. SCATTER_KEYWORDS 大类命中
// 3. extractJSONCandidates 解析包在 markdown/前后杂讯里的 JSON
// 4. LTM 内存推入逻辑（手工模拟一次 push）

// === 1) extractJSONCandidates / tryParseJSON ===
function extractJSONCandidates(raw) {
  const out = [];
  const re = /\{[\s\S]*?"summary"[\s\S]*?\}/g;
  let m;
  while ((m = re.exec(raw)) !== null) out.push(m[0]);
  return out;
}
function tryParseJSON(text) {
  try { return JSON.parse(text); } catch { return null; }
}

// Markdown 围栏 + 杂讯
const rawAI = `
好的，这是你要的结果：
\`\`\`json
{"summary":"她们聊了很多","memories":["月月最近在忙论文"]}
\`\`\`
`;
const cands = extractJSONCandidates(rawAI);
console.log('1. extractJSONCandidates:', cands.length, 'candidates');
const parsed = cands.length ? tryParseJSON(cands[0]) : null;
console.log('   parsed summary:', parsed && parsed.summary);
console.log('   parsed memories:', parsed && parsed.memories);

// === 2) detectScatterFlags ===
const SCATTER_KEYWORDS = /(生日|纪念|约定|答应|决定|打算|计划|准备|记得|记住|不舒服|难受|开心|难过|委屈|崩溃|累|疲惫|最近.+?(在|干|做|忙)|永远|一直|重要|不能|忘记|谢谢|对不起|想.+?(你|她|他))/;
function detectScatterFlags(text) {
  if (!text || typeof text !== 'string') return null;
  const m = text.match(SCATTER_KEYWORDS);
  return m ? m[0] : null;
}
const cases = [
  ['我今天好累', '累'],
  ['我生日是 3月7日', '生日'],
  ['我们约定周末见面', '约定'],
  ['今天天气不错', null],
  ['我打算这周末去爬山', '打算'],
  ['最近在忙论文', '最近'],
  ['谢谢你一直陪着我', '谢谢'],
];
console.log('\n2. detectScatterFlags:');
for (const [text, expected] of cases) {
  const hit = detectScatterFlags(text);
  const ok = hit === expected ? '✓' : '✗';
  console.log(`   ${ok} "${text}" → ${hit || 'null'} (期望: ${expected})`);
}

// === 3) LTM snapshot push 模拟 ===
const state = { memories: [] };
const SUMMARY_CHUNK = 20;
const oldBoundary = 20;
const newSummary = '月月最近一直在聊学业压力，希望 Kiki 多关心她';
const stamp = '2026-07-25';
const cycleNo = Math.floor(oldBoundary / SUMMARY_CHUNK) + 1;
state.memories.push({
  time: stamp,
  text: `【周期 ${cycleNo} 摘要快照】 ${newSummary.slice(0, 240)}`,
  _kind: 'summary',
});
const facts = ['月月最近在忙论文', '她这段时间情绪有点压抑'];
facts.forEach(t => state.memories.push({ time: stamp, text: t, _kind: 'fact' }));
console.log('\n3. LTM push 后:');
console.log('   总记忆条目:', state.memories.length);
console.log('   第一条:', state.memories[0].text);
console.log('   has _kind=summary:', state.memories[0]._kind === 'summary');

// === 4) 推送策略: buildSystemPrompt 只发最近 10 条 ===
state.memories = state.memories.concat(Array.from({length: 60}, (_, i) => ({
  time: '2026-07', text: `filler-${i}`, _kind: 'fact',
})));
const MEMORIES_SEND_LIMIT = 10;
const recent = state.memories.slice(-MEMORIES_SEND_LIMIT);
console.log('\n4. 推送策略 slice(-10):');
console.log('   准备发送 memories:', recent.length, '条 (state.memories 实际', state.memories.length, '条)');
console.log('   内容依次:', recent.map(m => m.kind || m._kind || 'fact').join(','));

// === 5) exportChats 的 SKIP 字段生效验证 ===
const SKIP = new Set([
  'apiKey', '_walletSnapshot', '_pendingQuote', '_pendingPat',
  '_scatterExtracting', '_scatterFlags', '_summarizing',
  'lastRequestDebug',
]);
const fakeState = {
  apiKey: 'sk-xxx',
  baseUrl: 'https://api.example.com/v1',
  primaryModel: 'gpt-4o-mini',
  messages: [{role:'user',type:'text',text:'hi'}],
  summary: '宏观摘要',
  memories: [{time:'2026-07',text:'mem'}],
  presetGroups: [{name:'p'}],
  regexGroups: [{name:'r'}],
  jailbreak: {enabled:true, content:'jb'},
  aiProfile: {persona:'p', preset:'pre'},
  userProfile: {name:'月月'},
  _summarizing: false,
};
const dump = { _format: 'xiaoshouji_full_v1', data: {} };
for (const k of Object.keys(fakeState)) {
  if (SKIP.has(k)) continue;
  dump.data[k] = JSON.parse(JSON.stringify(fakeState[k]));
}
console.log('\n5. export dump 字段:');
console.log('   包含的字段:', Object.keys(dump.data).join(', '));
console.log('   apiKey 已排除:', !('apiKey' in dump.data) ? '✓' : '✗');
console.log('   messages 包含:', dump.data.messages?.length, '条');
console.log('   presetGroups 包含:', dump.data.presetGroups?.length, '个');
console.log('   regexGroups 包含:', dump.data.regexGroups?.length, '个');
console.log('   长线记忆:', dump.data.memories?.length, '条');
console.log('   aiProfile:', !!dump.data.aiProfile);
console.log('   userProfile:', !!dump.data.userProfile);
console.log('   jailbreak:', !!dump.data.jailbreak);
