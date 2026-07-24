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

// ---------- 1. buildSystemPrompt：酒馆黄金顺序 + 开关过滤 ----------
console.log('[1] buildSystemPrompt 黄金顺序（①核心→②世界书→③人设→④用户→⑥记忆总结）');
const s = app.state;
s.systemPrompt = '';
s.aiName = '小克宝宝';
s.userProfile = { avatar: '', name: '月月', nickname: '小月', gender: '女', birthday: '2001-08-23', bio: '喜欢淡蓝色' };
s.aiProfile = { persona: '是一只黏人的小狗' };
s.presetGroups = [
  { id: 'g1', name: '测试预设', type: 'preset', enabled: true, items: [
    { name: 'p1', content: '破限内容：{{user}} 和 {{char}} 的故事', enabled: true },
    { name: 'p2', content: '被关闭的条目', enabled: false },
  ]},
  { id: 'g3', name: '测试世界书', type: 'worldbook', enabled: true, items: [
    { name: 'w1', content: '世界观：魔法大陆', enabled: true },
  ]},
  { id: 'g2', name: '关闭的组', type: 'worldbook', enabled: false, items: [
    { name: 'p3', content: '整组关闭的内容', enabled: true },
  ]},
];
s.regexGroups = [{ id: 'g_default', name: '默认分区', enabled: true, rules: [] }];
s.memories = [{ time: '2026-07-24', text: '月月生日是8月23日' }];
s.summary = '之前聊了小手机的语音修复';

const sp = app.buildSystemPrompt();
const iCore = sp.indexOf('你是小克宝宝');
const iPreset = sp.indexOf('破限内容：小月 和 小克宝宝 的故事');
const iWb = sp.indexOf('【世界书】');
const iWbContent = sp.indexOf('世界观：魔法大陆');
const iPersona = sp.indexOf('是一只黏人的小狗');
const iUser = sp.indexOf('【用户设定】');
const iMem = sp.indexOf('【长期记忆】');
const iSum = sp.indexOf('之前聊了小手机的语音修复');
check('① 核心提示词在最前，预设条目紧随其后且宏替换', iCore !== -1 && iPreset > iCore);
check('② 世界书在预设之后', iWb > iPreset && iWbContent > iWb);
check('③ 人设定义在世界书之后', iPersona > iWbContent);
check('④ 用户设定在人设之后', iUser > iPersona);
check('⑥ 记忆总结在最后', iMem > iUser && iSum > iMem);
check('被关闭的条目不出现', sp.indexOf('被关闭的条目') === -1);
check('整组关闭的内容不出现', sp.indexOf('整组关闭的内容') === -1);

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
check('裸条目数组 → preset', app.classifyImportFile([{ name: 'p1', content: '你好' }, { name: 'p2', content: '世界' }]) === 'preset');
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

  // ---------- 6. 勾选注入过滤 + 8w字不报错 ----------
  console.log('[6] 勾选过滤 + 超长文本');
  // 6a. 同组内启用+禁用规则混存，只有启用规则生效
  s.regexGroups = [{ id: 'g1', name: '混合', enabled: true, rules: [
    { pattern: '哈', replacement: '嘿', enabled: true },
    { pattern: '小', replacement: '大', enabled: false },
  ]}];
  check('同组启用规则生效，禁用规则不影响', app.applyRegexRules('哈小') === '嘿小');
  // 6b. 关闭组里所有规则（含启用）都不生效
  s.regexGroups = [{ id: 'g2', name: '全关', enabled: false, rules: [
    { pattern: '哈', replacement: '嘿', enabled: true },
  ]}];
  check('整组关闭时即使规则启用也不替换', app.applyRegexRules('哈') === '哈');
  // 6c. 8w字超长文本不被截断、不报错
  const big = '字'.repeat(80000);
  s.presetGroups = [{ id: 'big', name: '巨长', type: 'preset', enabled: true, items: [{ name: 'big', content: big, enabled: true }] }];
  let big_sp;
  try { big_sp = app.buildSystemPrompt(); } catch (e) { big_sp = null; }
  check('8w字预设不报错且全部塞进 system', big_sp && big_sp.includes(big) && big_sp.length >= 80000);
  // 6d. 关闭组里的内容不会出现在报文里
  s.presetGroups = [
    { id: 'on',  name: '开的组', type: 'preset', enabled: true,  items: [{ name: 'a', content: 'A_开', enabled: true }] },
    { id: 'off', name: '关的组', type: 'preset', enabled: false, items: [{ name: 'b', content: 'B_关', enabled: true }] },
  ];
  const sp2 = app.buildSystemPrompt();
  check('关闭组内容过滤掉', sp2.includes('A_开') && !sp2.includes('B_关'));
  s.presetGroups = [{ id: 'g1', name: '测试预设', type: 'preset', enabled: true, items: [
    { name: 'p1', content: '破限内容：{{user}} 和 {{char}} 的故事', enabled: true },
    { name: 'p2', content: '被关闭的条目', enabled: false },
  ]}];

  console.log(failures === 0 ? '\n全部通过 ✓' : `\n${failures} 项失败 ✗`);
  process.exit(failures === 0 ? 0 : 1);
})();
