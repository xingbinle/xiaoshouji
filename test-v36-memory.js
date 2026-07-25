// v36 复测 — Conversation State / Progress + 实时状态栏
const fs = require('fs');
const path = require('path');

const appSrc = fs.readFileSync(path.join(__dirname, 'js/app.js'), 'utf8');
const swSrc = fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const cssSrc = fs.readFileSync(path.join(__dirname, 'css/style.css'), 'utf8');

function check(name, ok) {
  console.log(`  ${ok ? '✓' : '✗'} ${name}`);
  return ok ? 1 : 0;
}

let pass = 0;
let total = 0;

console.log('[v36 Memory Engine]');

// 1. 版本一致性
const appVersion = appSrc.match(/const APP_VERSION = '([^']+)'/);
const swVersion = swSrc.match(/const APP_VERSION_FOR_SW = '([^']+)'/);
const cacheName = swSrc.match(/const CACHE_NAME = '([^']+)'/);
total++; pass += check('APP_VERSION 与 SW 版本一致且为 v36',
  appVersion && swVersion && appVersion[1] === swVersion[1] && appVersion[1] === 'v37' &&
  cacheName && cacheName[1].includes('v37'));

// 2. Prompt 层：连续性规则加入 DEFAULT_SYSTEM_PROMPT
total++; pass += check('DEFAULT_SYSTEM_PROMPT 含 Conversation Continuity 规则',
  appSrc.includes('【Conversation Continuity · 聊天连续性铁律】'));

// 3. buildSystemPrompt 注入 State / Progress 且顺序正确（State → Progress → 区域A → 区域B）
total++; pass += check('buildSystemPrompt 注入 Conversation State',
  appSrc.includes('【Conversation State · 当前会话状态】'));
total++; pass += check('buildSystemPrompt 注入 Conversation Progress',
  appSrc.includes('【Conversation Progress · 当前聊天进度】'));

const stateIdx = appSrc.indexOf('【Conversation State · 当前会话状态】');
const progressIdx = appSrc.indexOf('【Conversation Progress · 当前聊天进度】');
const regionAIdx = appSrc.indexOf('【宏观周期摘要 · 长线记忆】');
const regionBIdx = appSrc.indexOf('【关键事件小条目 · 长线记忆】');
total++; pass += check('注入顺序：State < Progress < 区域A < 区域B',
  stateIdx > 0 && progressIdx > stateIdx && regionAIdx > progressIdx && regionBIdx > regionAIdx);

// 4. 后台 State 生成函数存在
total++; pass += check('generateConversationState 函数存在',
  /function\s+generateConversationState\s*\(/.test(appSrc));
total++; pass += check('State 生成 prompt 要求输出 conversationState JSON',
  appSrc.includes('"conversationState"') && appSrc.includes('"conversationProgress"'));

// 5. 数据模型与持久化
total++; pass += check('state 初始化 conversationState / conversationProgress / roundCount',
  appSrc.includes('conversationState: {') && appSrc.includes('conversationProgress: {') && appSrc.includes('roundCount: 0'));
total++; pass += check('_buildPersist 持久化会话状态字段',
  appSrc.includes('conversationState: state.conversationState') && appSrc.includes('conversationProgress: state.conversationProgress'));

// 6. UI：状态栏 HTML/CSS/JS
total++; pass += check('index.html 含状态栏 heart 按钮',
  htmlSrc.includes('solStatusHeart'));
total++; pass += check('index.html 含可展开状态面板',
  htmlSrc.includes('solStatusPanel'));
total++; pass += check('style.css 定义状态栏样式',
  cssSrc.includes('.sol-status-bar') && cssSrc.includes('.sol-status-ecg-line'));
total++; pass += check('app.js 定义 renderStatusBar / toggleStatusPanel',
  /function\s+renderStatusBar\s*\(/.test(appSrc) && /function\s+toggleStatusPanel\s*\(/.test(appSrc));

console.log(`\n${pass === total ? '✅' : '❌'} v36 memory: ${pass}/${total} 通过`);
process.exit(pass === total ? 0 : 1);
