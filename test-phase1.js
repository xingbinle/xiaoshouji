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
  state, SUMMARY_CHUNK, APP_VERSION,
  buildSystemPrompt, applyRegexRules, maybeRollSummary, serializeMessagesForAPI,
  classifyImportFile, normalizeRegexRules, normalizeWorldbook,
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

// ---------- 1. buildSystemPrompt：分组注入 + 顺序 + 宏 + 开关过滤 ----------
console.log('[1] buildSystemPrompt 组装管线（分组版）');
const s = app.state;
s.systemPrompt = '';
s.aiName = '小克宝宝';
s.userProfile = { avatar: '', name: '月月', nickname: '小月', gender: '女', birthday: '2001-08-23', bio: '喜欢淡蓝色' };
s.aiProfile = { persona: '是一只黏人的小狗' };
s.presetGroups = [
  { id: 'g1', name: '测试预设', type: 'preset', enabled: true, items: [
    { name: 'p1', content: '预设内容：{{user}} 和 {{char}} 的故事', enabled: true },
    { name: 'p2', content: '被关闭的条目', enabled: false },
  ]},
  { id: 'g2', name: '关闭的组', type: 'worldbook', enabled: false, items: [
    { name: 'p3', content: '整组关闭的内容', enabled: true },
  ]},
];
s.regexGroups = [{ id: 'g_default', name: '默认分区', enabled: true, rules: [] }];
s.memories = [{ time: '2026-07-24', text: '月月生日是8月23日' }];
s.summary = '之前聊了小手机的语音修复';

const sp = app.buildSystemPrompt();
const iPreset = sp.indexOf('预设内容：小月 和 小克宝宝 的故事');
const iDefault = sp.indexOf('你是小克宝宝');
const iPersona = sp.indexOf('是一只黏人的小狗');
const iUser = sp.indexOf('【用户设定】');
const iMem = sp.indexOf('【长期记忆】');
const iSum = sp.indexOf('之前聊了小手机的语音修复');
check('启用分组的启用条目进入且宏替换', iPreset !== -1);
check('被关闭的条目不出现', sp.indexOf('被关闭的条目') === -1);
check('整组关闭的内容不出现', sp.indexOf('整组关闭的内容') === -1);
check('顺序：预设 < 默认人设 < 补充设定 < 用户设定 < 长期记忆 < 总结',
  iPreset < iDefault && iDefault < iPersona && iPersona < iUser && iUser < iMem && iMem < iSum);

// ---------- 2. applyRegexRules：分区应用 + 开关 ----------
console.log('[2] applyRegexRules 正则分区');
s.regexGroups = [
  { id: 'g1', name: '默认', enabled: true, rules: [
    { pattern: '宝贝', replacement: '月月', enabled: true },
    { pattern: '(', replacement: 'x', enabled: true },     // 非法正则，应跳过
    { pattern: '小狗', replacement: '大狗', enabled: false }, // 未启用
  ]},
  { id: 'g2', name: '关闭的区', enabled: false, rules: [
    { pattern: '你好', replacement: '再见', enabled: true },
  ]},
];
const out = app.applyRegexRules('宝贝和小狗说你好');
check('启用分区的启用规则生效', out.indexOf('月月') !== -1);
check('未启用/关闭分区/非法规则都不动', out === '宝贝和小狗说你好'.replace('宝贝', '月月'));

// ---------- 3. 导入文件自动分类 ----------
console.log('[3] classifyImportFile 自动分类');
check('酒馆预设 → preset', app.classifyImportFile({ prompts: [{ name: 'a', content: 'b' }] }) === 'preset');
check('世界书(entries对象) → worldbook', app.classifyImportFile({ entries: { 0: { content: 'x' } } }) === 'worldbook');
check('世界书(entries数组) → worldbook', app.classifyImportFile({ entries: [{ content: 'x' }] }) === 'worldbook');
check('酒馆正则数组 → regex', app.classifyImportFile([{ scriptName: 'r1', findRegex: 'a', replaceString: 'b' }]) === 'regex');
check('单条正则对象 → regex', app.classifyImportFile({ findRegex: 'a', replaceString: 'b' }) === 'regex');
check('不认识的对象 → null', app.classifyImportFile({ foo: 1 }) === null);

const nr = app.normalizeRegexRules([{ scriptName: 'r1', findRegex: '宝(.+?)宝', replaceString: '月$1月', trimStrings: true }]);
check('酒馆正则字段映射（findRegex/replaceString）', nr.length === 1 && nr[0].pattern === '宝(.+?)宝' && nr[0].replacement === '月$1月' && nr[0].name === 'r1');

const wb = app.normalizeWorldbook({ entries: { 0: { comment: '条目A', content: '内容A', disable: true }, 1: { keys: ['k1'], content: '内容B' } } });
check('世界书条目归一化 + disable→enabled', wb.length === 2 && wb[0].name === '条目A' && wb[0].enabled === false && wb[1].name === 'k1' && wb[1].enabled === true);

// ---------- 4. maybeRollSummary：30条触发 + 记忆提取 + 幂等 ----------
console.log('[4] maybeRollSummary 滚动总结');
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

  // ---------- 5. 版本一致性：APP_VERSION ↔ sw.js CACHE_NAME ----------
  console.log('[5] 版本一致性');
  const swSrc = fs.readFileSync(__dirname + '/sw.js', 'utf8');
  const swVer = (swSrc.match(/CACHE_NAME = 'xiaoshouji-(v\d+)'/) || [])[1];
  check(`APP_VERSION(${app.APP_VERSION}) === CACHE_NAME(${swVer})`, swVer === app.APP_VERSION);

  console.log(failures === 0 ? '\n全部通过 ✓' : `\n${failures} 项失败 ✗`);
  process.exit(failures === 0 ? 0 : 1);
})();
