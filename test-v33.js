/* v33 功能自检测试（node test-v33.js）
   1. sanitizer：voice 后的 text/sticker 照删，但 redpacket/transfer 必须存活（红包修复）
   2. 双区迁移：旧 _kind:summary 混存条目 → state.summaries（A区），facts 留 memories（B区）
   3. buildSystemPrompt 末尾槽位：宏观周期摘要 + 最新10条小条目 + 现实时间锚点（顺序=月月 spec）
   4. realTimeAnchor：精确到分钟 + 含星期 + {{user}} 宏可替换
   方法同 test-phase1.js：整文件 eval + stub。 */

const fs = require('fs');

global.document = { addEventListener: () => {} };
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

let src = fs.readFileSync(__dirname + '/js/app.js', 'utf8');
src += `
module.exports = {
  state, APP_VERSION, MEMORIES_SEND_LIMIT,
  sanitizeAIMessages, buildSystemPrompt, realTimeAnchor, _applyLoaded,
};`;

const mod = { exports: {} };
new Function('module', 'exports', 'require', src)(mod, mod.exports, require);
const app = mod.exports;

let failures = 0;
function check(name, cond) {
  if (cond) console.log('  ✓', name);
  else { failures++; console.error('  ✗', name); }
}

// ---------- 1. sanitizer：红包不被 voice 单条铁律误删 ----------
console.log('[1] sanitizer 红包存活');
{
  const msgs = [
    { type: 'voice', duration: 3, text: '你太好啦' },
    { type: 'redpacket', amount: 13.14, note: '一生一世', redpacketId: 'rp_1' },
    { type: 'text', text: '给你回了个1314～' },
    { type: 'sticker', name: '哭哭' },
  ];
  const out = app.sanitizeAIMessages(msgs);
  check('redpacket 在 voice 后存活', out.some(m => m.type === 'redpacket' && m.amount === 13.14));
  check('voice 本体保留', out[0] && out[0].type === 'voice');
}
{
  // voice 紧跟 text/sticker：单条铁律仍然生效
  const out = app.sanitizeAIMessages([
    { type: 'voice', duration: 3, text: '哼' },
    { type: 'text', text: '多余的话' },
    { type: 'sticker', name: '哭哭' },
  ]);
  check('voice 紧跟的 text 仍被删', !out.some(m => m.type === 'text'));
  check('voice 紧跟的 sticker 仍被删', !out.some(m => m.type === 'sticker'));
}
{
  // quote 复读剥离不回归
  const out = app.sanitizeAIMessages([
    { type: 'quote', from: '月月', text: '宝宝' },
    { type: 'text', text: '宝宝，我才不会讨厌～' },
  ]);
  check('quote 复读前缀仍被剥掉', out[1] && out[1].text === '我才不会讨厌～');
}

// ---------- 2. 双区迁移 ----------
console.log('[2] 双区独立架构迁移');
{
  app.state.memories = [
    { time: '2026-07-20', text: '【周期 1 摘要快照】 她们很甜', _kind: 'summary' },
    { time: '2026-07-21', text: '月月生日 8月23日', _kind: 'fact' },
    { time: '2026-07-22', text: '【周期 2 摘要快照】 更甜了', _kind: 'summary' },
  ];
  app.state.summaries = undefined;
  app._applyLoaded({});
  check('A区 summaries 拿到 2 条快照', app.state.summaries.length === 2);
  check('B区 memories 只剩 1 条 fact', app.state.memories.length === 1 && app.state.memories[0]._kind === 'fact');
  check('快照文本原样保留', app.state.summaries[0].text.indexOf('周期 1 摘要快照') !== -1);
  // 二次加载不重复迁移
  app._applyLoaded({});
  check('幂等：二次加载 summaries 仍 2 条', app.state.summaries.length === 2);
}

// ---------- 3. 末尾槽位：摘要 + 小条目 + 时间锚点 ----------
console.log('[3] Payload 长期记忆发送规则');
{
  app.state.userProfile = { nickname: '月月' };
  app.state.aiName = 'Kiki';
  app.state.systemPrompt = '';
  app.state.aiProfile = { persona: '', preset: '', presetEnabled: false };
  app.state.jailbreak = { enabled: false, content: '' };
  app.state.presetGroups = [];
  app.state.stickers = [];
  app.state.summary = 'Kiki 和月月感情稳定升温';
  app.state.memories = Array.from({ length: 15 }, (_, i) => ({ time: '2026-07-25', text: `事件${i + 1}` }));
  const sys = app.buildSystemPrompt();

  const iSum = sys.indexOf('【宏观周期摘要 · 长线记忆】');
  const iMem = sys.indexOf('【关键事件小条目 · 长线记忆】');
  const iTime = sys.indexOf('【现实时间锚点 · 系统底层常驻】');
  check('宏观周期摘要块存在', iSum !== -1 && sys.indexOf('Kiki 和月月感情稳定升温') !== -1);
  check('关键事件小条目块存在', iMem !== -1);
  check('时间锚点块存在', iTime !== -1);
  check('顺序：摘要 → 小条目 → 时间锚点', iSum < iMem && iMem < iTime);
  check('小条目只发最新 10 条', sys.indexOf('事件6') !== -1 && sys.indexOf('事件5\n') === -1 && sys.indexOf('- [2026-07-25] 事件5') === -1);
  check('旧【长期记忆】块名已退役', sys.indexOf('【长期记忆】\n') === -1);
  check('旧【之前聊天的总结】块名已退役', sys.indexOf('【之前聊天的总结】') === -1);
}

// ---------- 4. 现实时间锚点 ----------
console.log('[4] 现实时间精确感知');
{
  const anchor = app.realTimeAnchor();
  const now = new Date();
  const week = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][now.getDay()];
  check('含年月日', anchor.indexOf(`${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`) !== -1);
  check('含星期', anchor.indexOf(week) !== -1);
  const mm = String(now.getMinutes()).padStart(2, '0');
  check('精确到分钟', anchor.indexOf(`${now.getHours()}点${mm}分`) !== -1);
  const sys = app.buildSystemPrompt();
  check('锚点已注入 system prompt 且 {{user}} 宏已替换', sys.indexOf('{{user}}') === -1 || sys.indexOf('现实时间锚点') === -1);
}

// ---------- 5. 版本一致性 ----------
console.log('[5] 版本一致性');
{
  const swSrc = fs.readFileSync(__dirname + '/sw.js', 'utf8');
  const swVer = (swSrc.match(/CACHE_NAME = 'xiaoshouji-(v\d+)/) || [])[1];
  check(`APP_VERSION(${app.APP_VERSION}) === CACHE_NAME(${swVer})`, swVer === app.APP_VERSION);
}

console.log(failures ? `\n❌ ${failures} 项失败` : '\n✅ v33 全部通过');
process.exit(failures ? 1 : 0);
