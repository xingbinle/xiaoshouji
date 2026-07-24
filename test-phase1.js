/* 第一期功能自检测试（node test-phase1.js）
   方法：整文件 eval app.js（顶层无 DOM 访问，只 stub document/localStorage），
   末尾追加 module.exports 导出要测的函数。 */

const fs = require('fs');

// ---- stub 浏览器环境 ----
global.document = { addEventListener: () => {} };
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

let src = fs.readFileSync(__dirname + '/js/app.js', 'utf8');
src += `
module.exports = {
  state, SUMMARY_CHUNK,
  buildSystemPrompt, applyRegexRules, maybeRollSummary, serializeMessagesForAPI,
  _setCallAPI: (f) => { callAPI = f; },
};`;

const mod = { exports: {} };
new Function('module', 'exports', 'require', src)(mod, mod.exports, require);
const app = mod.exports;

let failures = 0;
function check(name, cond) {
  if (cond) console.log('  ✓', name);
  else { failures++; console.error('  ✗', name); }
}

// ---------- 1. buildSystemPrompt：顺序 + 宏 + 勾选过滤 ----------
console.log('[1] buildSystemPrompt 组装管线');
const s = app.state;
s.systemPrompt = '';
s.aiName = '小克宝宝';
s.userProfile = { avatar: '', name: '月月', nickname: '小月', gender: '女', birthday: '2001-08-23', bio: '喜欢淡蓝色' };
s.aiProfile = { persona: '是一只黏人的小狗' };
s.preset = {
  name: '测试预设',
  prompts: [
    { name: 'p1', content: '预设内容：{{user}} 和 {{char}} 的故事', enabled: true },
    { name: 'p2', content: '被关闭的条目', enabled: false },
  ],
};
s.regexRules = [];
s.memories = [{ time: '2026-07-24', text: '月月生日是8月23日' }];
s.summary = '之前聊了小手机的语音修复';

const sp = app.buildSystemPrompt();
const iPreset = sp.indexOf('预设内容：小月 和 小克宝宝 的故事');
const iDefault = sp.indexOf('你是小克宝宝');
const iPersona = sp.indexOf('是一只黏人的小狗');
const iUser = sp.indexOf('【用户设定】');
const iMem = sp.indexOf('【长期记忆】');
const iSum = sp.indexOf('之前聊了小手机的语音修复');
check('预设已启用条目进入且宏替换', iPreset !== -1);
check('被关闭的预设条目不出现', sp.indexOf('被关闭的条目') === -1);
check('顺序：预设 < 默认人设 < 补充设定 < 用户设定 < 长期记忆 < 总结',
  iPreset < iDefault && iDefault < iPersona && iPersona < iUser && iUser < iMem && iMem < iSum);

// ---------- 2. applyRegexRules：替换 + 坏规则跳过 ----------
console.log('[2] applyRegexRules 正则替换');
s.regexRules = [
  { pattern: '宝贝', replacement: '月月', enabled: true },
  { pattern: '(', replacement: 'x', enabled: true },   // 非法正则，应跳过
  { pattern: '小狗', replacement: '大狗', enabled: false }, // 未启用
];
const out = app.applyRegexRules('宝贝和小狗');
check('启用规则生效', out === '月月和小狗');
check('非法规则不炸、未启用不动', out.indexOf('x') === -1 && out.indexOf('大狗') === -1);

// ---------- 3. maybeRollSummary：30条触发 + 记忆提取 + 幂等 ----------
console.log('[3] maybeRollSummary 滚动总结');
(async () => {
  s.messages = [];
  for (let i = 0; i < 30; i++) {
    s.messages.push({ role: i % 2 ? 'ai' : 'user', type: 'text', text: `消息${i}` });
  }
  s.summaryBoundary = 0;
  s.summary = '';
  s.memories = [];
  s.primaryModel = 'test-model';
  s.apiKey = 'k';
  let calls = 0;
  app._setCallAPI(async () => {
    calls++;
    return { content: '{"summary":"合并后的新总结","memories":["月月喜欢淡蓝色"]}' };
  });

  await app.maybeRollSummary();
  check('总结已更新', s.summary === '合并后的新总结');
  check('长期记忆已提取', s.memories.length === 1 && s.memories[0].text === '月月喜欢淡蓝色');
  check('边界前移 30', s.summaryBoundary === 30);
  check('调用了 1 次 API', calls === 1);

  await app.maybeRollSummary(); // 没有新消息，不该再调
  check('不足 30 条不再调用', calls === 1);

  // 边界钳位：删消息后边界越界 → 自动拉回
  s.summaryBoundary = 50;
  await app.maybeRollSummary();
  check('边界越界自动钳位', s.summaryBoundary <= s.messages.length);

  // 模型不按格式输出 → 原文兜底
  s.messages = s.messages.concat(Array.from({ length: 30 }, (_, i) => ({ role: 'user', type: 'text', text: 'x' + i })));
  s.summaryBoundary = 0;
  app._setCallAPI(async () => ({ content: '这不是JSON，直接是一段总结' }));
  await app.maybeRollSummary();
  check('非JSON输出原文兜底', s.summary === '这不是JSON，直接是一段总结');

  console.log(failures === 0 ? '\n全部通过 ✓' : `\n${failures} 项失败 ✗`);
  process.exit(failures === 0 ? 0 : 1);
})();
