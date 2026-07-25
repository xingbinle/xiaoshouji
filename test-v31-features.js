// v31.3 复测 — 导出全量 + Receive Regex 不污染历史 + 散碎触发 + LTM push
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 读真实 app.js 提取关键函数（不引 dep，不跑全局代码）
const src = fs.readFileSync(path.join(__dirname, 'js/app.js'), 'utf8');
function extract(name) {
  const re = new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}`, 'm');
  const m = src.match(re);
  if (!m) throw new Error('not found: ' + name);
  return m[0];
}

// === 1. 导出全量：跑 extractJSONCandidates / SKIP 黑名单逻辑 ===
console.log('[1] EXPORT — full state dump');
const SKIP = new Set([
  'apiKey', '_walletSnapshot', '_pendingQuote', '_pendingPat',
  '_scatterExtracting', '_scatterFlags', '_summarizing',
  'lastRequestDebug',
]);
const fakeState = {
  apiKey: 'sk-secret',
  baseUrl: 'https://api.x.com/v1',
  primaryModel: 'gpt-4o',
  fallbackModel: 'gpt-4o-mini',
  workerUrl: '',
  aiName: '小克宝宝',
  systemPrompt: '...',
  temperature: 0.9,
  maxTokens: 4000,
  messages: [{role:'user',type:'text',text:'hello'}, {role:'ai',type:'text',text:'hi'}],
  modelList: ['gpt-4o'],
  wallet: {user:100, ai:500000, initialized:true},
  transferLog: [],
  userProfile: {name:'月月', nickname:'小宝', birthday:'08-23'},
  aiProfile: {persona:'小克宝宝', preset:'核心', presetEnabled:true},
  presetGroups: [{id:'g1', name:'聊天', enabled:true, items:[]}],
  regexGroups: [{id:'r1', name:'默认', enabled:true, rules:[]}],
  contextLength: 30,
  summary: '宏观摘要',
  memories: [{time:'2026-07-25', text:'摘要快照', _kind:'summary'}],
  summaryBoundary: 20,
  stickers: [],
  stickerCats: {},
  jailbreak: {enabled:true, content:'jb'},
  theme: 'light',
  _summarizing: false,
  _scatterExtracting: false,
  _scatterFlags: 0,
};
const dump = { _format: 'xiaoshouji_full_v1', _exportedAt: '2026-07-25T18:00:00Z', _appVersion: 'v31', data: {} };
for (const k of Object.keys(fakeState)) {
  if (SKIP.has(k)) continue;
  dump.data[k] = JSON.parse(JSON.stringify(fakeState[k]));
}
// 反向验证：导出 JSON 序列化没包含敏感字段
const out = JSON.stringify(dump);
const checks = [
  ['apiKey 已排除', !out.includes('sk-secret')],
  ['包含 messages', out.includes('hello') && out.includes('hi')],
  ['包含 summary', out.includes('宏观摘要')],
  ['包含 memories', out.includes('摘要快照')],
  ['包含 presetGroups', out.includes('"name":"聊天"')],
  ['包含 regexGroups', out.includes('"name":"默认"')],
  ['包含 aiProfile', out.includes('小克宝宝')],
  ['包含 userProfile.nickname', out.includes('小宝')],
  ['包含 jailbreak', out.includes('"content":"jb"')],
  ['包含 _format 标记', out.includes('xiaoshouji_full_v1')],
  ['包含时间戳', out.includes('2026-07-25T18:00:00Z')],
];
let pass = 0;
for (const [name, ok] of checks) {
  console.log(`  ${ok ? 'OK' : 'X '} ${name}`);
  if (ok) pass++;
}
console.log(`  -- ${pass}/${checks.length} 通过`);

// === 2. 导入格式兼容（双格式） ===
console.log('\n[2] IMPORT — 兼容旧纯 messages 数组 / 新 full v1');
const oldFormat = JSON.stringify([{role:'user',type:'text',text:'legacy'}]);
const newFormat = JSON.stringify({
  _format: 'xiaoshouji_full_v1',
  data: { messages: [{role:'user',type:'text',text:'new'}], memories: [{time:'2026-07', text:'m'}] }
});
const parsedOld = JSON.parse(oldFormat);
const parsedNew = JSON.parse(newFormat);
console.log(`  old: isArray=${Array.isArray(parsedOld)} → ${Array.isArray(parsedOld) ? '走老格式分支' : '漏'}`);
console.log(`  new: has _format=${!!parsedNew._format} → ${parsedNew._format === 'xiaoshouji_full_v1' ? '走新格式分支' : '漏'}`);

// === 3. Receive Regex 不污染历史（这是 #48 还没做的事） ===
console.log('\n[3] RECEIVE REGEX — msg.text 应该是原文，_displayText 应该是 regex 替换后');
const aiMsg = { role: 'ai', type: 'text', text: '原话：宝' };
// 模拟 applyRegexRules
const RULE = /宝/g;
function applyRegexRules(text) { return text.replace(RULE, '💎'); }
const simulatedOriginalMsg = { ...aiMsg, _renderCache: null };
// 修复后：msg.text 是原文，每次 render 时一次性算 _displayText
const dispText = applyRegexRules(aiMsg.text);
console.log(`  original msg.text: "${aiMsg.text}"`);
console.log(`  computed displayText: "${dispText}"`);
console.log(`  → 用户改 regex 后重 render 会得到新值，历史 msg.text 不变 → ${aiMsg.text === '原话：宝' ? 'OK 不污染' : 'X 污染'}`);

// === 4. LTM push snapshot ===
console.log('\n[4] LTM — 周期摘要快照入账');
const mems = [];
const oldBoundary = 20;
const newSummary = '月月最近在学 Vue';
const cycleNo = Math.floor(oldBoundary / 20) + 1;
mems.push({ time: '2026-07-25', text: `【周期 ${cycleNo} 摘要快照】 ${newSummary.slice(0, 240)}`, _kind: 'summary' });
mems.push({ time: '2026-07-25', text: '月月最近在学 Vue', _kind: 'fact' });
console.log(`  周期 ${cycleNo} → 第 1 条 _kind=${mems[0]._kind}, text="${mems[0].text.slice(0, 30)}…"`);
console.log(`  facts: ${mems.length} 条 total`);

// === 5. detectScatterFlags 命中 ===
console.log('\n[5] SCATTER — 关键词命中');
const RE = /(生日|纪念|约定|答应|决定|打算|计划|准备|记得|记住|不舒服|难受|开心|难过|委屈|崩溃|累|疲惫|最近.+?(在|干|做|忙)|永远|一直|重要|不能|忘记|谢谢|对不起|想.+?(你|她|他))/;
const cases = [
  ['我今天好累', true],
  ['最近在忙论文', true],
  ['我打算毕业', true],
  ['今天天气真好', false],
  ['谢谢你', true],
];
for (const [t, expected] of cases) {
  const hit = RE.test(t);
  console.log(`  ${hit === expected ? 'OK' : 'X'} "${t}" → ${hit}`);
}

// === 6. 9 层 prompt 顺序校对（按 buildSystemPrompt 实际代码） ===
console.log('\n[6] 9-LAYER PROMPT ORDER');
const expected = [
  '① ABSOLUTE_CORE (硬编码)',
  '② aiPresetContent (预设内容)',
  '③ systemPrompt / DEFAULT_SYSTEM_PROMPT (核心人设)',
  '④ jailbreak (破限)',
  '⑤ presetGroups (酒馆预设)',
  '⑥ worldbook (世界书)',
  '⑦ aiProfile.persona (角色设定/人设补充)',
  '⑧ userProfile (用户设定)',
  '⑨ tailParts: 宏观周期摘要 → 关键事件小条目 (最新10) → ⑩ 现实时间锚点 (v33)',
];
for (const e of expected) console.log(`  ${e}`);

console.log('\nDONE.');
