/* 第二期功能自检测试（node test-phase2.js）
   覆盖：表情包清单解析 / system 注入 / sticker·inner·pat 解析与序列化回环
   方法同 test-phase1.js：整文件 eval app.js（stub document/localStorage），末尾追加导出。 */

const fs = require('fs');

global.document = { addEventListener: () => {} };
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

let src = fs.readFileSync(__dirname + '/js/app.js', 'utf8');
src += `
module.exports = {
  state,
  parseAIResponse, serializeMessagesForAPI, buildSystemPrompt,
  parseStickerText, findStickerByName, enabledStickerPrompt,
};`;

const mod = { exports: {} };
new Function('module', 'exports', 'require', src)(mod, mod.exports, require);
const app = mod.exports;

let failures = 0;
function check(name, cond) {
  if (cond) console.log('  ✓', name);
  else { failures++; console.error('  ✗', name); }
}

const s = app.state;
s.aiName = 'Kiki';
s.systemPrompt = '';
s.userProfile = { nickname: '宝', patSuffix: '' };
s.aiProfile = { patSuffix: '' };
s.jailbreak = { enabled: false, content: '' };
s.presetGroups = [];
s.regexGroups = [];
s.memories = [];
s.summary = '';
s.stickers = [
  { id: 'a', name: '哭哭', cat: '日常', enabled: true, source: 'url', url: 'http://x/1.gif' },
  { id: 'b', name: '贴贴', cat: '日常', enabled: false, source: 'url', url: 'http://x/2.gif' },
  { id: 'c', name: '猫猫拳', cat: '猫猫', enabled: true, source: 'local', url: '' },
];
s.stickerCats = { 日常: true, 猫猫: false };

// ---------- 1. parseStickerText：两种格式 + 无效行 ----------
console.log('[1] parseStickerText 清单解析');
const rows = app.parseStickerText('哭哭：http://a/1.gif\n贴贴: http://a/2.gif\nhttp://a/3.gif 猫猫拳\n这就是一行字\n');
check('名字：URL（中文冒号）', rows.some(r => r.name === '哭哭' && r.url === 'http://a/1.gif'));
check('名字: URL（英文冒号）', rows.some(r => r.name === '贴贴' && r.url === 'http://a/2.gif'));
check('URL 名字（docx 格式）', rows.some(r => r.name === '猫猫拳' && r.url === 'http://a/3.gif'));
check('无效行跳过', rows.length === 3);

// ---------- 2. enabledStickerPrompt：分类×条目双开关 ----------
console.log('[2] 表情清单注入过滤');
const prompt = app.enabledStickerPrompt();
check('启用条目出现', prompt.indexOf('哭哭') !== -1);
check('条目级关闭不出现', prompt.indexOf('贴贴') === -1);
check('分类级关闭不出现', prompt.indexOf('猫猫拳') === -1);
check('空库返回空串', (() => { const b = s.stickers; s.stickers = []; const r = app.enabledStickerPrompt() === ''; s.stickers = b; return r; })());

// ---------- 3. buildSystemPrompt：表情清单在末尾槽位 ----------
console.log('[3] 表情清单进 system 末尾');
const sp = app.buildSystemPrompt();
check('【可用表情包】注入', sp.indexOf('【可用表情包】') !== -1);
check('清单使用说明附带', sp.indexOf('{"type":"sticker","name":"名字"}') !== -1);

// ---------- 4. parseAIResponse：sticker(name) / inner / pat ----------
console.log('[4] 新协议解析');
const parsed = app.parseAIResponse('{"messages":[' +
  '{"type":"text","content":"宝～","inner":"好想她"},' +
  '{"type":"sticker","name":"哭哭"},' +
  '{"type":"voice","duration":3,"content":"呜","inner":"委屈"},' +
  '{"type":"pat"}' +
  ']}');
check('text 带 inner', parsed[0].type === 'text' && parsed[0].inner === '好想她');
check('sticker 解析出 name', parsed[1].type === 'sticker' && parsed[1].sticker === '哭哭');
check('voice 也带 inner', parsed[2].type === 'voice' && parsed[2].inner === '委屈');
check('pat 生成灰色提示（默认后缀）', parsed[3].type === 'pat' && parsed[3].text === 'Kiki拍了拍你的肩膀');
s.aiProfile.patSuffix = '的腰';
check('pat 自定义后缀生效', app.parseAIResponse('{"messages":[{"type":"pat"}]}')[0].text === 'Kiki拍了拍你的腰');
s.aiProfile.patSuffix = '';
// 旧数据兜底：只有 sticker 描述字段
check('旧版 sticker 字段兜底', app.parseAIResponse('{"messages":[{"type":"sticker","sticker":"小狗感动哭"}]}')[0].sticker === '小狗感动哭');

// ---------- 5. 序列化回环：新类型打包进 {"messages":[...]} 示范 ----------
console.log('[5] 历史序列化（示范效应）');
const api = app.serializeMessagesForAPI([
  { role: 'user', type: 'pat', text: '你拍了拍Kiki的小脑袋' },
  { role: 'ai', type: 'text', text: '呜', inner: '开心' },
  { role: 'ai', type: 'sticker', sticker: '哭哭', text: '哭哭' },
  { role: 'ai', type: 'pat', text: 'Kiki拍了拍你的肩膀' },
  { role: 'user', type: 'sticker', sticker: '贴贴', text: '贴贴' },
]);
check('三条 API 消息（user / assistant组 / user）', api.length === 3 && api[0].role === 'user' && api[1].role === 'assistant' && api[2].role === 'user');
check('用户拍一拍 → 文本事件', api[0].content.indexOf('你拍了拍Kiki的小脑袋') !== -1);
check('用户表情包 → [表情包：名]', api[2].content === '[表情包：贴贴]');
const aiGroup = JSON.parse(api[1].content).messages;
check('AI text 保留 inner', aiGroup[0].type === 'text' && aiGroup[0].inner === '开心');
check('AI sticker 回 name 协议', aiGroup[1].type === 'sticker' && aiGroup[1].name === '哭哭');
check('AI pat 原样回环', aiGroup[2].type === 'pat');

// ---------- 6. findStickerByName ----------
console.log('[6] 表情查找');
check('按名找到', app.findStickerByName('哭哭') && app.findStickerByName('哭哭').url === 'http://x/1.gif');
check('找不到返回 null', app.findStickerByName('不存在') === null);

console.log(failures === 0 ? '\n全部通过 ✓' : `\n${failures} 项失败 ✗`);
process.exit(failures === 0 ? 0 : 1);
