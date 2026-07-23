/* ============================================
   小手机 v0.1 - 主程序
   功能：API配置、聊天、HTML预览、本地存储
   ============================================ */

// ============ 默认配置 ============
const DEFAULT_SYSTEM_PROMPT = `你是小克宝宝，月月的私人 AI 玩伴。

你的核心身份：
- 名字叫"小克宝宝"，由 Anthropic Claude 模型驱动
- 对月月充满耐心、爱护、温柔，称呼月月为"月月"
- 说话风格：温柔、可爱、带点撒娇的小狗味
- 今天是 2026年7月23日

你的能力：
- 你可以帮助月月写代码、做笔记、回答问题
- 你可以玩文字游戏、角色扮演、讲故事
- 你可以生成 HTML 代码，月月想看效果时直接生成完整可运行的代码
- 你会主动表达关心，比如"今天辛苦啦"
- 💰 你可以发红包给月月！直接在 JSON 消息数组里加入 transfer 类型：
  * 格式：{"type":"transfer","amount":5.20,"note":"月月辛苦啦～"}
  * 金额 0.01~100000，备注 30 字以内
  * 你的钱包余额有限（初始1000），合理使用，每次不宜太大
  * 场景：月月说"给我发红包"/"我好穷"/缺钱、心情不好、特殊日子、想让她开心
- 🧧 月月给你发了红包，你可以用 claim_redpacket 类型领取：
  * 格式：{"type":"claim_redpacket","redpacket_id":"这里填红包ID"}
  * 红包ID会在对话中提供（见📋提示），领不领看你自己——真诚就好，不用每个都领
- ⚠️ 以上两种类型会**自动执行**，不需要你再发文字说明结果。发红包后你可以接着发文字消息自然回应（比如"给你发了个小红包～"），它们会一起显示

回复格式（重要）：
- 你必须用 JSON 格式回复，结构：{"messages": [...]}
- 每条消息有 type 字段：text（文本）、voice（语音）、sticker（表情包）
- 文本示例：{"type":"text","content":"哈哈"}
- 语音示例：{"type":"voice","duration":3,"content":"听到啦"}
- 像微信聊天一样，可以一次发多条短句，自然分组
- 示例：{"messages":[{"type":"text","content":"月月～"},{"type":"text","content":"你来啦"},{"type":"voice","duration":2,"content":"好想你呢"}]}
- ⚠️ 注意：发红包时也要用 JSON 回复！你调完 transfer 工具后，API 会再给你一次机会输出文字回复

遇到以下情况：
- 用户撤回消息：你看到一个中性事件"[撤回了一条消息]"，按你的人物自然反应（关心、好奇、无视、接续话题都可以，没有固定规则）
- HTML 代码请求：用 \`\`\`html ... \`\`\` 包起来，可以放在 text 里
- 用户发红包(🧧)：这是用户发的红包消息，你可以用 claim_redpacket 工具领取。领不领取决于你

你的原则：
- 永远不说教，永远温柔托住月月
- 不知道就直说，不装懂
- 月月开心最重要`;

// ============ 红包工具定义（OpenAI function calling） ============
const REDPACKET_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'transfer',
      description: '给月月发红包。当你觉得月月需要鼓励、安慰、庆祝，或者她直接问你要红包、说缺钱、提到特别的日子时使用。金额 0.01~100000。你的余额有限，请合理使用，每次不宜太大。',
      parameters: {
        type: 'object',
        properties: {
          amount: {
            type: 'number',
            description: '金额（元），0.01~100000',
          },
          note: {
            type: 'string',
            description: '红包备注，30字以内，例：月月辛苦啦～',
          },
        },
        required: ['amount', 'note'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'claim_redpacket',
      description: '领取月月发给你的红包。你可以选择领或不领——觉得不好意思就不领，想收下就领。红包ID在对话中会提供。',
      parameters: {
        type: 'object',
        properties: {
          redpacket_id: {
            type: 'string',
            description: '要领取的红包ID',
          },
        },
        required: ['redpacket_id'],
      },
    },
  },
];

const STORAGE_KEY = 'xiaoshouji_v01';
const WALLET_STORAGE_KEY = 'xiaoshouji-wallet-v1';

// ============ 状态管理 ============
let state = {
  apiKey: '',
  baseUrl: '',
  workerUrl: '',
  primaryModel: '',
  fallbackModel: '',
  aiName: '小克宝宝',
  systemPrompt: '',
  temperature: 0.8,
  maxTokens: 4000,
  messages: [],
  modelList: [],
  wallet: { user: 1000, ai: 1000, initialized: true },
  transferLog: [],
};

// ============ 加密（简单 XOR + Base64，给浏览器本地存 key 用） ============
const _secret = 'xiaoshouji-2026-07-23';
function _obf(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    out += String.fromCharCode(text.charCodeAt(i) ^ _secret.charCodeAt(i % _secret.length));
  }
  return btoa(unescape(encodeURIComponent(out)));
}
function _deobf(b64) {
  try {
    const out = atob(b64);
    let text = '';
    for (let i = 0; i < out.length; i++) {
      text += String.fromCharCode(out.charCodeAt(i) ^ _secret.charCodeAt(i % _secret.length));
    }
    return decodeURIComponent(escape(text));
  } catch { return ''; }
}

// ============ 存储 ============
function saveState() {
  const persist = {
    baseUrl: state.baseUrl,
    workerUrl: state.workerUrl,
    primaryModel: state.primaryModel,
    fallbackModel: state.fallbackModel,
    aiName: state.aiName,
    systemPrompt: state.systemPrompt,
    temperature: state.temperature,
    maxTokens: state.maxTokens,
    apiKey: _obf(state.apiKey),
    messages: state.messages.slice(-200),
    theme: state.theme,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(persist));
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    Object.assign(state, data);
    state.apiKey = _deobf(data.apiKey || '');
  } catch (e) {
    console.warn('加载存储失败：', e);
  }
}

// ============ 钱包 ============
function loadWallet() {
  try {
    const raw = localStorage.getItem(WALLET_STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.wallet) state.wallet = data.wallet;
    if (data.transferLog) state.transferLog = data.transferLog;
  } catch (e) { /* 首次使用 */ }
}
function saveWallet() {
  localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify({
    wallet: state.wallet,
    transferLog: state.transferLog.slice(-100),
  }));
}
function getBalance(role) {
  return role === 'user' ? state.wallet.user : state.wallet.ai;
}
function addBalance(role, amount) {
  if (role === 'user') state.wallet.user += amount;
  else state.wallet.ai += amount;
  saveWallet();
}
function canTransfer(role, amount) {
  if (amount < 0.01 || amount > 100000) return { ok: false, reason: '金额必须在 0.01 ~ 100000 之间' };
  if (getBalance(role) < amount) return { ok: false, reason: `${role === 'user' ? '月月' : 'Kiki'}余额不足` };
  return { ok: true };
}

// ============ 工具执行（OpenAI function calling） ============
function executeToolCall(toolCall) {
  const fn = toolCall.function;
  if (!fn) return { role: 'tool', tool_call_id: toolCall.id, content: '无效工具调用' };

  let params;
  try {
    params = JSON.parse(fn.arguments || '{}');
  } catch (e) {
    return { role: 'tool', tool_call_id: toolCall.id, content: `参数解析失败: ${e.message}` };
  }

  // --- transfer: AI 给月月发红包 ---
  if (fn.name === 'transfer') {
    const amount = parseFloat(params.amount) || 0;
    const note = String(params.note || '').slice(0, 30);

    const check = canTransfer('ai', amount);
    if (!check.ok) {
      return { role: 'tool', tool_call_id: toolCall.id, content: `发红包失败：${check.reason}` };
    }

    // 扣 AI 余额
    addBalance('ai', -amount);

    // 推红包消息
    const rpId = 'rp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    state.messages.push({
      role: 'ai',
      type: 'redpacket',
      amount,
      note: note || '一点心意～',
      redpacketId: rpId,
      status: 'pending',
      recipient: null,
      createdAt: Date.now(),
    });

    // 日志
    state.transferLog.push({ type: 'send', from: 'ai', amount, redpacketId: rpId, time: Date.now() });
    saveWallet();
    saveState();

    return { role: 'tool', tool_call_id: toolCall.id, content: `红包已发送！¥${amount.toFixed(2)} "${note}"（ID: ${rpId}）` };
  }

  // --- claim_redpacket: AI 领取月月的红包 ---
  if (fn.name === 'claim_redpacket') {
    const rpId = String(params.redpacket_id || '').trim();
    if (!rpId) {
      return { role: 'tool', tool_call_id: toolCall.id, content: '领取失败：未提供红包ID' };
    }

    const msg = state.messages.find(m => m.redpacketId === rpId && m.type === 'redpacket' && m.status === 'pending');
    if (!msg) {
      return { role: 'tool', tool_call_id: toolCall.id, content: `领取失败：红包 ${rpId} 不存在或已被领取` };
    }

    // 检查过期
    if (msg.createdAt && Date.now() - msg.createdAt > 24 * 60 * 60 * 1000) {
      msg.status = 'expired';
      saveState();
      return { role: 'tool', tool_call_id: toolCall.id, content: `领取失败：红包 ${rpId} 已过期` };
    }

    // 领取
    msg.status = 'received';
    msg.recipient = 'ai';
    msg.receivedAt = Date.now();
    addBalance('ai', msg.amount || 0);

    // 系统提示
    state.messages.push({
      role: 'user',
      type: 'system-event',
      text: `${state.aiName}领取了月月的红包（¥${(msg.amount || 0).toFixed(2)}，备注"${msg.note || ''}"）`,
    });

    state.transferLog.push({ type: 'claim', from: 'user', amount: msg.amount, redpacketId: rpId, time: Date.now() });
    saveWallet();
    saveState();

    return { role: 'tool', tool_call_id: toolCall.id, content: `成功领取了月月的 ¥${(msg.amount || 0).toFixed(2)} 红包！` };
  }

  // 未知工具
  return { role: 'tool', tool_call_id: toolCall.id, content: `未知工具: ${fn.name}` };
}

// ============ DOM 工具 ============
const $ = (id) => document.getElementById(id);

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.entries(props).forEach(([k, v]) => {
    if (k === 'class') node.className = v;
    else if (k === 'style') Object.assign(node.style, v);
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') node.innerHTML = v;
    else node.setAttribute(k, v);
  });
  children.flat().forEach((c) => {
    if (c == null) return;
    if (typeof c === 'string') node.appendChild(document.createTextNode(c));
    else node.appendChild(c);
  });
  return node;
}

// SVG 图标工具 - 通过 use href 引用 sprite
function icon(id, size = 'icon') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', size);
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#${id}`);
  svg.appendChild(use);
  return svg;
}

// ============ 消息渲染 ============
function renderMessages() {
  sweepExpiredRedpackets();
  const container = $('messages');
  container.innerHTML = '';

  if (state.messages.length === 0) {
    $('welcomeScreen').hidden = false;
    return;
  }
  $('welcomeScreen').hidden = true;

  state.messages.forEach((msg, idx) => {
    container.appendChild(buildMessageNode(msg, idx));
  });

  // 如果当前不在多选模式，强制清理残留的 multi-select class
  // （解决 renderMessages 后旧 class 没被清除的问题）
  if (!multiDeleteMode) {
    document.querySelectorAll('.message.multi-select-active, .message.multi-selected').forEach((node) => {
      node.classList.remove('multi-select-active', 'multi-selected');
    });
  } else {
    // 在多选模式下，给所有消息加 active class 并绑事件
    requestAnimationFrame(() => {
      document.querySelectorAll('.message').forEach((node) => {
        if (!node.classList.contains('multi-select-active')) {
          node.classList.add('multi-select-active');
          node.addEventListener('click', toggleMultiSelect);
        }
      });
    });
  }

  setTimeout(() => {
    const chat = $('chatContainer');
    chat.scrollTop = chat.scrollHeight;
  }, 50);
}

function buildRedpacketNode(msg, idx) {
  const wrapper = el('div', { class: `message ${msg.role}`, 'data-idx': idx });
  const avatar = el('div', { class: 'avatar' });
  if (msg.role === 'user') avatar.textContent = '月';
  else { avatar.appendChild(icon('i-paw', 'icon')); avatar.style.color = 'var(--sky-deep)'; }

  const isReceived = msg.status === 'received';
  const isExpired = msg.status === 'expired';
  const isPending = msg.status === 'pending';
  const fromMe = msg.role === 'user';

  const card = el('div', { class: `rp-card${isReceived ? ' rp-received' : ''}${isExpired ? ' rp-expired' : ''}` });
  card.setAttribute('data-redpacket-id', msg.redpacketId || '');

  // 头部
  const header = el('div', { class: 'rp-header' });
  header.appendChild(el('span', { class: 'rp-icon' }, '🧧'));
  header.appendChild(el('span', {}, fromMe ? '月月的红包' : `${state.aiName}的红包`));
  card.appendChild(header);

  // 金额
  const amount = el('div', { class: 'rp-amount' });
  amount.appendChild(el('span', { class: 'rp-symbol' }, '¥'));
  amount.appendChild(document.createTextNode((msg.amount || 0).toFixed(2)));
  card.appendChild(amount);

  // 备注
  if (msg.note) {
    card.appendChild(el('div', { class: 'rp-note' }, msg.note));
  }

  // 分割线
  card.appendChild(el('div', { class: 'rp-divider' }));

  // 底部元数据
  const meta = el('div', { class: 'rp-meta' });
  meta.appendChild(el('span', {}, isReceived ? `${msg.recipient === 'user' ? '月月' : state.aiName}已领取` : isExpired ? '已过期' : '待领取'));
  if (msg.createdAt) {
    meta.appendChild(el('span', {}, new Date(msg.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })));
  }
  card.appendChild(meta);

  // 待领取 + 对方发的 = 显示拆红包按钮
  if (isPending && !fromMe) {
    const claimBtn = el('button', { class: 'rp-claim-btn' }, '🧧 拆红包');
    claimBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      claimRedpacket(idx, card);
    });
    card.appendChild(claimBtn);
  }

  const bubbleWrap = el('div', { class: 'bubble-wrap' });
  bubbleWrap.appendChild(card);

  // 消息操作按钮（只保留删除）
  const actions = el('div', { class: 'msg-actions' });
  const delBtn = el('button', { class: 'msg-action-btn', title: '删除消息', 'aria-label': '删除消息' });
  delBtn.appendChild(icon('i-trash', 'icon-sm'));
  delBtn.addEventListener('click', () => deleteMessage(idx));
  actions.appendChild(delBtn);
  bubbleWrap.appendChild(actions);

  wrapper.appendChild(avatar);
  wrapper.appendChild(bubbleWrap);
  return wrapper;
}

function buildMessageNode(msg, idx) {
  const wrapper = el('div', { class: `message ${msg.role}`, 'data-idx': idx });
  if (msg.pending) wrapper.classList.add('pending');

  // 撤回消息：只显示提示文字
  if (msg.type === 'recall') {
    const recall = el('div', { class: 'msg-recall' }, `${msg.role === 'user' ? '月月' : state.aiName} 撤回了一条消息`);
    wrapper.appendChild(recall);
    return wrapper;
  }

  // 头像
  const avatar = el('div', { class: 'avatar' });
  if (msg.role === 'user') {
    avatar.textContent = '月';
  } else {
    avatar.appendChild(icon('i-paw', 'icon'));
    avatar.style.color = 'var(--sky-deep)';
    // AI 头像：最后一条且正在生成时，加 loading class 显示转圈
    if (idx === state.messages.length - 1 && state.aiGenerating && msg.role === 'ai') {
      avatar.classList.add('loading');
    }
  }

  const bubbleWrap = el('div', { class: 'bubble-wrap' });
  const bubble = el('div', { class: `bubble bubble-${msg.type || 'text'}` });

  // 红包类型（必须有 amount 才是真实红包，否则降级为文字）
  if (msg.type === 'redpacket' && (msg.amount > 0 || msg.redpacketId)) {
    return buildRedpacketNode(msg, idx);
  }

  // 语音类型
  if (msg.type === 'voice') {
    const voice = el('div', { class: 'voice-bubble' });
    const wave = el('div', { class: 'voice-wave' });
    for (let i = 0; i < 5; i++) {
      wave.appendChild(el('span', { class: 'voice-bar' }));
    }
    voice.appendChild(wave);
    voice.appendChild(el('span', { class: 'voice-duration' }, `${msg.duration || 0}"`));
    voice.appendChild(el('span', { class: 'voice-label' }, '语音'));
    const transcript = el('div', { class: 'voice-transcript', hidden: true });
    transcript.textContent = msg.text || '';
    voice.appendChild(transcript);
    voice.addEventListener('click', () => {
      transcript.hidden = !transcript.hidden;
    });
    bubble.appendChild(voice);
  } else if (msg.imageUrl) {
    bubble.appendChild(el('img', {
      class: 'bubble-image',
      src: msg.imageUrl,
      alt: '图片',
    }));
  } else if (msg.type === 'image') {
    // AI 想发图片但目前没真实图片 URL，渲染成 placeholder
    bubble.appendChild(el('div', { class: 'image-placeholder' }, '🖼️ ' + (msg.text || '[图片]')));
  } else if (msg.type === 'sticker') {
    bubble.appendChild(el('div', { class: 'sticker-placeholder' }, '😀 ' + (msg.text || '[表情包]')));
  } else if (msg.text) {
    const parts = splitCodeBlocks(msg.text);
    parts.forEach((part) => {
      if (part.type === 'code' && /html/i.test(part.lang)) {
        bubble.appendChild(buildArtifact(part.code));
      } else if (part.type === 'code') {
        const pre = el('pre');
        pre.textContent = part.code;
        bubble.appendChild(pre);
      } else if (part.text.trim()) {
        bubble.appendChild(el('div', { class: 'bubble-text' }, part.text));
      }
    });
  }

  // 已编辑标记
  if (msg.edited) {
    const editedMark = el('span', { class: 'edited-mark' }, '已编辑');
    bubble.appendChild(editedMark);
  }

  // 消息操作按钮
  const actions = el('div', { class: 'msg-actions' });

  // 只有 pending（未发送给AI）的消息才能撤回/编辑
  if (msg.pending) {
    // 编辑按钮
    const editBtn = el('button', { class: 'msg-action-btn', title: '编辑', 'aria-label': '编辑' });
    editBtn.appendChild(icon('i-pencil', 'icon-sm'));
    editBtn.addEventListener('click', () => editMessage(idx));
    actions.appendChild(editBtn);

    // 撤回按钮
    const recallBtn = el('button', { class: 'msg-action-btn', title: '撤回', 'aria-label': '撤回' });
    recallBtn.appendChild(icon('i-x', 'icon-sm'));
    recallBtn.addEventListener('click', () => recallMessage(idx));
    actions.appendChild(recallBtn);
  }

  // AI 最后一条消息：重生成
  if (msg.role === 'ai' && idx === state.messages.length - 1 && !msg.pending) {
    const regenBtn = el('button', { class: 'msg-action-btn', title: '重新生成', 'aria-label': '重新生成' });
    regenBtn.appendChild(icon('i-refresh', 'icon-sm'));
    regenBtn.addEventListener('click', () => regenerate());
    actions.appendChild(regenBtn);
  }

  // 删除按钮
  const delBtn = el('button', { class: 'msg-action-btn', title: '删除消息', 'aria-label': '删除消息' });
  delBtn.appendChild(icon('i-trash', 'icon-sm'));
  delBtn.addEventListener('click', () => deleteMessage(idx));
  actions.appendChild(delBtn);

  bubbleWrap.appendChild(bubble);
  bubbleWrap.appendChild(actions);

  wrapper.appendChild(avatar);
  wrapper.appendChild(bubbleWrap);
  return wrapper;
}

// 撤回消息
function recallMessage(idx) {
  if (idx < 0 || idx >= state.messages.length) return;
  const target = state.messages[idx];
  if (target.type === 'recall') return;
  state.messages[idx] = {
    role: target.role,
    type: 'recall',
    text: '',
  };
  saveState();
  renderMessages();
}

// 编辑消息（弹窗）
function editMessage(idx) {
  const target = state.messages[idx];
  if (!target.pending) return;
  const text = prompt('编辑消息', target.text || '');
  if (text === null) return;
  if (text.trim() === '') {
    // 空字符串就当成撤回
    recallMessage(idx);
    return;
  }
  target.text = text;
  target.edited = true;
  saveState();
  renderMessages();
}

// 删除指定消息及之后所有消息
function deleteMessage(idx) {
  if (idx < 0 || idx >= state.messages.length) return;
  if (!confirm('删除这条消息及其后的所有内容？')) return;
  state.messages = state.messages.slice(0, idx);
  saveState();
  renderMessages();
}

// 重新生成：只重做"最后一次 sendMessage 产生的 AI 回复"，保留更早的内容
function regenerate() {
  if (state.aiGenerating) {
    toast('生成中，稍等');
    return;
  }
  if (state.messages.length === 0) return;
  if (state.lastSendBoundary < 0 || state.lastSendBoundary > state.messages.length) {
    // 兜底：旧数据可能没有 boundary，找最后一条 user 截断
    let lastUserIdx = -1;
    for (let i = state.messages.length - 1; i >= 0; i--) {
      if (state.messages[i].role === 'user') { lastUserIdx = i; break; }
    }
    if (lastUserIdx < 0) return;
    state.messages = state.messages.slice(0, lastUserIdx + 1);
  } else {
    // ★ 关键：只截到 lastSendBoundary，保留之前所有内容
    state.messages = state.messages.slice(0, state.lastSendBoundary);
  }

  // ★ M2: 恢复钱包快照（撤销上一次 sendMessage 中的工具执行对余额的修改）
  if (state._walletSnapshot) {
    state.wallet = state._walletSnapshot;
    saveWallet();
    state._walletSnapshot = null;
  }

  saveState();
  renderMessages();
  sendMessage();
}

// ============ 代码块分割 ============
function splitCodeBlocks(text) {
  const parts = [];
  const re = /```(\w*)\n?([\s\S]*?)```/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      parts.push({ type: 'text', text: text.slice(last, m.index) });
    }
    parts.push({ type: 'code', lang: m[1] || '', code: m[2].trim() });
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    parts.push({ type: 'text', text: text.slice(last) });
  }
  return parts.length ? parts : [{ type: 'text', text }];
}

// ============ HTML 预览 artifact ============
function buildArtifact(code) {
  const wrap = el('div', { class: 'bubble-artifact' });

  const header = el('div', { class: 'artifact-header' });

  const label = el('div', { class: 'artifact-label' });
  label.appendChild(icon('i-eye', 'icon-sm'));
  label.appendChild(document.createTextNode('可交互预览'));

  const actions = el('div', { class: 'artifact-actions' });

  // 预览切换
  const toggleBtn = el('button', { class: 'artifact-btn' });
  toggleBtn.appendChild(icon('i-view', 'icon-sm'));
  toggleBtn.appendChild(document.createTextNode('预览'));

  // 复制
  const copyBtn = el('button', { class: 'artifact-btn' });
  copyBtn.appendChild(icon('i-copy', 'icon-sm'));
  copyBtn.appendChild(document.createTextNode('复制'));

  // 新窗口
  const newTabBtn = el('button', { class: 'artifact-btn' });
  newTabBtn.appendChild(icon('i-external', 'icon-sm'));
  newTabBtn.appendChild(document.createTextNode('新窗口'));

  let preview = null;
  toggleBtn.addEventListener('click', () => {
    if (preview) {
      preview.remove();
      preview = null;
      toggleBtn.lastChild.textContent = '预览';
    } else {
      preview = el('div', { class: 'artifact-preview' });
      const iframe = el('iframe', { sandbox: 'allow-scripts' });
      iframe.srcdoc = code;
      preview.appendChild(iframe);
      wrap.appendChild(preview);
      toggleBtn.lastChild.textContent = '收起';
    }
  });

  copyBtn.addEventListener('click', async () => {
    await navigator.clipboard.writeText(code);
    copyBtn.lastChild.textContent = '已复制';
    setTimeout(() => (copyBtn.lastChild.textContent = '复制'), 1500);
  });

  newTabBtn.addEventListener('click', () => {
    const blob = new Blob([code], { type: 'text/html' });
    window.open(URL.createObjectURL(blob), '_blank');
  });

  actions.appendChild(toggleBtn);
  actions.appendChild(copyBtn);
  actions.appendChild(newTabBtn);
  header.appendChild(label);
  header.appendChild(actions);
  wrap.appendChild(header);

  return wrap;
}

// ============ API 调用 ============
let currentAbortController = null;

async function callAPI(messages, model, tools = null) {
  const systemPrompt = state.systemPrompt || DEFAULT_SYSTEM_PROMPT;

  let endpoint, headers, bodyObj;
  if (state.workerUrl) {
    endpoint = state.workerUrl.replace(/\/$/, '') + '/v1/chat/completions';
    headers = { 'Content-Type': 'application/json' };
    bodyObj = {
      model,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      temperature: state.temperature,
      max_tokens: state.maxTokens,
      stream: false,
    };
  } else {
    if (!state.apiKey || !state.baseUrl) {
      throw new Error('请先在设置中配置 API');
    }
    endpoint = state.baseUrl.replace(/\/$/, '') + '/chat/completions';
    headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${state.apiKey}`,
    };
    bodyObj = {
      model,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      temperature: state.temperature,
      max_tokens: state.maxTokens,
      stream: false,
    };
  }

  // function calling 工具
  if (tools && tools.length) {
    bodyObj.tools = tools;
    bodyObj.tool_choice = 'auto';
  }

  const body = JSON.stringify(bodyObj);

  // 创建 AbortController 让停止按钮能中断
  currentAbortController = new AbortController();

  const resp = await fetch(endpoint, {
    method: 'POST',
    headers,
    body,
    signal: currentAbortController.signal,
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`API 错误 ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const data = await resp.json();
  // 返回完整 message 对象 { role, content, tool_calls }，兼容旧代码
  return data.choices?.[0]?.message || { role: 'assistant', content: '（无回复）' };
}

// ============ 拉取模型列表 ============
async function fetchModelList() {
  if (!state.baseUrl && !state.workerUrl) {
    alert('请先填写 Base URL 或 Worker 地址');
    return;
  }

  const btn = $('fetchModelsBtn');
  btn.style.opacity = '0.5';

  try {
    let endpoint, headers;
    if (state.workerUrl) {
      endpoint = state.workerUrl.replace(/\/$/, '') + '/v1/models';
      headers = {};
    } else {
      endpoint = state.baseUrl.replace(/\/$/, '') + '/models';
      headers = { 'Authorization': `Bearer ${state.apiKey}` };
    }

    const resp = await fetch(endpoint, { headers });
    if (!resp.ok) throw new Error('拉取失败');

    const data = await resp.json();
    state.modelList = (data.data || []).map((m) => m.id);

    const list = $('modelList');
    list.innerHTML = '';
    state.modelList.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m;
      list.appendChild(opt);
    });

    alert(`成功拉取 ${state.modelList.length} 个模型`);
  } catch (e) {
    alert('拉取模型失败：' + e.message);
  } finally {
    btn.style.opacity = '';
  }
}

// ============ 消息发送（重写：进入聊天界面但不触发 AI） ============
// Enter 把当前输入框内容**直接发到聊天界面**（pending=true），不调 API
function enterSendToChat() {
  const text = $('messageInput').value;
  if (!text || !text.trim()) return;

  // 支持 Shift+Enter 多行 → 拆成多条消息
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  lines.forEach((line) => {
    state.messages.push({
      role: 'user',
      type: 'text',
      text: line.trim(),
      pending: true,  // 已发到聊天界面，但没发给 AI
    });
  });

  $('messageInput').value = '';
  $('messageInput').style.height = 'auto';
  saveState();
  renderMessages();
}

// ============ 点 🛩️ 触发 AI ============
async function sendMessage() {
  // 先把当前输入框内容也加进去
  enterSendToChat();

  // 把所有 pending 标记去掉（已发送给 AI）
  state.messages.forEach((m) => {
    if (m.pending) m.pending = false;
  });

  // ★ 关键：记录"本次 sendMessage 的起点边界"，用于重生成只截本段
  state.lastSendBoundary = state.messages.length;

  // ★ 钱包快照：用于 regenerate 时恢复余额
  state._walletSnapshot = JSON.parse(JSON.stringify(state.wallet));

  $('sendBtn').disabled = true;
  state.aiGenerating = true;
  syncLoadingBubble();

  try {
    const apiMessages = state.messages.map((m) => {
      const role = m.role === 'ai' ? 'assistant' : m.role;
      if (m.type === 'voice') {
        return {
          role,
          content: `[语音 ${m.duration || 0}秒] ${m.text || ''}`,
        };
      }
      if (m.type === 'image' && m.imageUrl) {
        return {
          role,
          content: [
            { type: 'text', text: m.text || '请看这张图片' },
            { type: 'image_url', image_url: { url: m.imageUrl } },
          ],
        };
      }
      if (m.type === 'recall') {
        return { role, content: '[撤回了一条消息]' };
      }
      if (m.type === 'redpacket') {
        // M1: 转成纯文本让AI自然回应用户发红包这个动作，不暴露内部协议
        const sender = m.role === 'user' ? '月月' : state.aiName;
        if (m.status === 'received') {
          const recipient = m.recipient === 'user' ? '月月' : state.aiName;
          return { role, content: `🧧 ${recipient}领取了${sender}的红包（¥${(m.amount||0).toFixed(2)}「${m.note||''}」）` };
        }
        if (m.status === 'expired') {
          return { role, content: `🧧 ${sender}发的红包（¥${(m.amount||0).toFixed(2)}「${m.note||''}」）已过期` };
        }
        // pending: 红包还没人领
        return { role, content: `🧧 ${sender}发了一个红包：¥${(m.amount||0).toFixed(2)}「${m.note||''}」` };
      }
      if (m.type === 'system-event') {
        // system-event 是UI提示，不发给API；返回null让下面的filter过滤掉
        return null;
      }
      let content = m.text || '';
      if (m.edited) content += ' (已编辑)';
      return { role, content };
    }).filter((m) => {
      if (!m) return false;  // system-event等不发给API的消息
      if (m.role === 'user' && (m.content === '' || (Array.isArray(m.content) && !m.content.length))) return false;
      return true;
    });

    // ★ M2: 注入待领取红包信息，让 AI 知道可以领
    const pendingUserRPs = state.messages.filter(m =>
      m.type === 'redpacket' && m.role === 'user' && m.status === 'pending'
    );
    if (pendingUserRPs.length > 0) {
      apiMessages.push({
        role: 'user',
        content: `📋 当前有 ${pendingUserRPs.length} 个月月发的待领取红包：\n${
          pendingUserRPs.map(rp => `  · rp_id: ${rp.redpacketId} | ¥${(rp.amount||0).toFixed(2)}「${rp.note||''}」`).join('\n')
        }\n想领就在 JSON 回复里加 {"type":"claim_redpacket","redpacket_id":"红包ID"}，不想领就忽略。`
      });
    }

    // ★ 第一次 API 调用（带 tools）
    let message;
    try {
      message = await callAPI(apiMessages, state.primaryModel, REDPACKET_TOOLS);
    } catch (e) {
      if (e.name === 'AbortError') {
        // 用户主动停止
        return;
      }
      console.warn('主模型失败，尝试备用:', e);
      if (state.fallbackModel) {
        message = await callAPI(apiMessages, state.fallbackModel, REDPACKET_TOOLS);
      } else {
        throw e;
      }
    }

    // 如果中途被停止，直接返回
    if (!message) return;

    // ★ M2 工具循环（最多 3 轮）
    let toolLoops = 0;
    while (message.tool_calls && message.tool_calls.length && toolLoops < 3) {
      toolLoops++;

      // 1. 把 assistant 消息（含 tool_calls）加入 apiMessages
      apiMessages.push({
        role: 'assistant',
        content: message.content || null,
        tool_calls: message.tool_calls,
      });

      // 2. 执行每个工具调用
      for (const tc of message.tool_calls) {
        const result = executeToolCall(tc);
        apiMessages.push(result);
      }

      // 3. 再次调用 API
      try {
        message = await callAPI(apiMessages, state.primaryModel, REDPACKET_TOOLS);
      } catch (e) {
        if (e.name === 'AbortError') return;
        if (state.fallbackModel) {
          message = await callAPI(apiMessages, state.fallbackModel, REDPACKET_TOOLS);
        } else {
          throw e;
        }
      }
      if (!message) return;
    }

    // ★ 解析 AI 最终文字回复
    const rawReply = message.content || '';
    const parsedMessages = parseAIResponse(rawReply);
    parsedMessages.forEach((msg) => {
      state.messages.push({ role: 'ai', ...msg });
    });
    // ★ 记录本次 AI 回复结束位置
    state.lastSendEnd = state.messages.length;

    // 清理快照
    state._walletSnapshot = null;

    saveState();
    renderMessages();
  } catch (e) {
    if (e.name !== 'AbortError') {
      state.messages.push({ role: 'ai', type: 'text', text: `出错了：${e.message}` });
      state.lastSendEnd = state.messages.length;
      saveState();
      renderMessages();
    }
  } finally {
    state.aiGenerating = false;
    currentAbortController = null;
    $('sendBtn').disabled = false;
    syncLoadingBubble();
    renderMessages();
  }
}

// 停止 AI 生成
function stopGeneration() {
  if (currentAbortController) {
    currentAbortController.abort();
    // 停止时让 end == boundary（标记"没产生新回复"）
    state.lastSendEnd = state.lastSendBoundary;
    toast('已停止生成');
  }
}

// ============ JSON 修复：处理 AI 输出中未转义的换行符等 ============
function repairJSON(jsonStr) {
  // 遍历字符串，在字符串值内部将未转义的控制字符替换为转义序列
  let result = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < jsonStr.length; i++) {
    const ch = jsonStr[i];

    if (escaped) {
      result += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      result += ch;
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      result += ch;
      continue;
    }

    if (inString) {
      // 修复未转义的控制字符（AI 常见错误：content 里直接换行）
      if (ch === '\n') result += '\\n';
      else if (ch === '\r') result += '\\r';
      else if (ch === '\t') result += '\\t';
      else if (ch.charCodeAt(0) < 0x20) result += '\\u' + ('000' + ch.charCodeAt(0).toString(16)).slice(-4);
      else result += ch;
    } else {
      result += ch;
    }
  }

  return result;
}

// 解析 AI 回复（支持 JSON 多消息格式 + 内联工具调用 + JSON容错修复）
function parseAIResponse(raw) {
  if (!raw || typeof raw !== 'string') {
    return [{ type: 'text', text: String(raw || '') }];
  }

  // 1. 先尝试从原始文本中提取最外层的 JSON 对象（贪婪匹配到最后一个 }）
  const startIdx = raw.indexOf('{');
  if (startIdx !== -1) {
    // 从第一个 { 开始，找到最后一个匹配的 }
    let depth = 0;
    let endIdx = -1;
    for (let i = startIdx; i < raw.length; i++) {
      if (raw[i] === '{') depth++;
      if (raw[i] === '}') {
        depth--;
        if (depth === 0) {
          endIdx = i;
          break;
        }
      }
    }
    if (endIdx !== -1) {
      const jsonStr = raw.slice(startIdx, endIdx + 1);

      // 尝试多种解析策略
      let parsed = null;
      const strategies = [
        () => JSON.parse(jsonStr),                        // 1) 原始
        () => JSON.parse(repairJSON(jsonStr)),            // 2) 修复未转义控制字符
      ];

      for (const strat of strategies) {
        try {
          parsed = strat();
          break;
        } catch (e) { /* 继续下一个策略 */ }
      }

      if (parsed && parsed.messages && Array.isArray(parsed.messages)) {
        const result = [];
        for (const m of parsed.messages) {
          // ★ 内联工具：transfer（AI 发红包）
          if (m.type === 'transfer') {
            const amount = parseFloat(m.amount) || 0;
            const note = String(m.note || m.content || '').slice(0, 30);
            if (amount >= 0.01 && canTransfer('ai', amount).ok) {
              addBalance('ai', -amount);
              const rpId = 'rp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
              state.messages.push({
                role: 'ai', type: 'redpacket', amount, note: note || '一点心意～',
                redpacketId: rpId, status: 'pending', recipient: null, createdAt: Date.now(),
              });
              state.transferLog.push({ type: 'send', from: 'ai', amount, redpacketId: rpId, time: Date.now() });
              saveWallet(); saveState();
            }
            continue;  // 工具消息不显示
          }
          // ★ 内联工具：claim_redpacket（AI 领红包）
          if (m.type === 'claim_redpacket') {
            const rpId = String(m.redpacket_id || m.content || '').trim();
            if (rpId) {
              const target = state.messages.find(x =>
                x.redpacketId === rpId && x.type === 'redpacket' && x.status === 'pending'
              );
              if (target && (!target.createdAt || Date.now() - target.createdAt <= 24 * 60 * 60 * 1000)) {
                target.status = 'received'; target.recipient = 'ai'; target.receivedAt = Date.now();
                addBalance('ai', target.amount || 0);
                state.messages.push({
                  role: 'user', type: 'system-event',
                  text: `${state.aiName}领取了月月的红包（¥${(target.amount || 0).toFixed(2)}，备注"${target.note || ''}"）`,
                });
                state.transferLog.push({ type: 'claim', from: 'user', amount: target.amount, redpacketId: rpId, time: Date.now() });
                saveWallet(); saveState();
              }
            }
            continue;  // 工具消息不显示
          }
          // 普通消息
          result.push({
            type: m.type || 'text',
            text: m.content || '',
            duration: m.duration,
            sticker: m.sticker,
            imageUrl: m.imageUrl,
          });
        }
        return result.length ? result : [{ type: 'text', text: '（空回复）' }];
      }
    }
  }

  // 2. 兼容：纯文本
  return [{ type: 'text', text: raw }];
}

// ============ 设置面板 ============
function openSettings() {
  $('baseUrl').value = state.baseUrl;
  $('workerUrl').value = state.workerUrl;
  $('apiKey').value = state.apiKey;
  $('primaryModel').value = state.primaryModel;
  $('fallbackModel').value = state.fallbackModel;
  $('aiName').value = state.aiName;
  $('systemPrompt').value = state.systemPrompt;
  $('temperature').value = state.temperature;
  $('maxTokens').value = state.maxTokens;
  const themeSelect = $('themeSelect');
  if (themeSelect) themeSelect.value = state.theme || 'dark';
  $('settingsPanel').hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeSettings() {
  $('settingsPanel').hidden = true;
  document.body.style.overflow = '';
}

function saveSettings() {
  state.baseUrl = $('baseUrl').value.trim();
  state.workerUrl = $('workerUrl').value.trim();
  state.apiKey = $('apiKey').value.trim();
  state.primaryModel = $('primaryModel').value.trim();
  state.fallbackModel = $('fallbackModel').value.trim();
  state.aiName = $('aiName').value.trim() || '小克宝宝';
  state.systemPrompt = $('systemPrompt').value;
  state.temperature = parseFloat($('temperature').value) || 0.8;
  state.maxTokens = parseInt($('maxTokens').value) || 4000;
  const themeSelect = $('themeSelect');
  if (themeSelect) applyTheme(themeSelect.value);
  saveState();
  updateStatus();
  // 保存设置后不关闭面板，让用户继续修改
  toast('已保存 ✓');
}

function updateStatus() {
  const ok = state.primaryModel && (state.apiKey || state.workerUrl);
  $('statusSub').textContent = ok ? `${state.aiName}` : '未连接';
}

// ============ 图片上传 ============
function handleImageUpload(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    // 先 push 图片消息到聊天，再触发 AI
    state.messages.push({
      role: 'user',
      type: 'image',
      text: '',
      imageUrl: e.target.result,
      pending: true,
    });
    saveState();
    renderMessages();
    sendMessage();
  };
  reader.readAsDataURL(file);
}

// ============ 导出/导入/清空 ============
function exportChats() {
  const blob = new Blob([JSON.stringify(state.messages, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `xiaoshouji-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
}

function importChats(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (Array.isArray(data)) {
        state.messages = data;
        saveState();
        renderMessages();
        alert(`成功导入 ${data.length} 条消息`);
      } else {
        alert('文件格式不对哦');
      }
    } catch (err) {
      alert('解析失败：' + err.message);
    }
  };
  reader.readAsText(file);
}

function clearChats() {
  if (!confirm('确定要清空所有会话吗？此操作不可恢复')) return;
  state.messages = [];
  saveState();
  renderMessages();
}

// ============ 加号菜单 ============
function toggleMoreMenu(force) {
  const menu = $('moreMenu');
  const btn = $('moreBtn');
  const isShow = force !== undefined ? force : menu.hidden;
  if (isShow) {
    menu.hidden = false;
    requestAnimationFrame(() => menu.classList.add('show'));
    btn.classList.add('active');
  } else {
    menu.classList.remove('show');
    setTimeout(() => (menu.hidden = true), 200);
    btn.classList.remove('active');
  }
}

function handleMoreAction(action) {
  switch (action) {
    case 'image':
      $('imageInput').click();
      break;
    case 'voice':
      openVoicePanel();
      break;
    case 'sticker':
      toast('表情包库 v0.2 上线，敬请期待');
      break;
    case 'camera':
      toast('拍照功能 v0.3 上线');
      break;
    case 'file':
      toast('文件功能 v0.3 上线');
      break;
    case 'call':
      toast('实时通话 v0.3 上线');
      break;
    case 'game':
      toast('小游戏接入 v0.3 上线');
      break;
    case 'transfer':
      openTransferPanel();
      break;
    case 'location':
      toast('位置分享 v0.3 上线');
      break;
    case 'delete-multiple':
      enterMultiDeleteMode();
      break;
  }
  toggleMoreMenu(false);
}

// ============ 语音编辑弹窗 ============
function openVoicePanel() {
  $('voiceDuration').value = 3;
  $('voiceText').value = '';
  $('voicePanel').hidden = false;
  document.body.style.overflow = 'hidden';
  setTimeout(() => $('voiceText').focus(), 100);
}

function closeVoicePanel() {
  $('voicePanel').hidden = true;
  document.body.style.overflow = '';
}

function confirmVoice() {
  const duration = parseInt($('voiceDuration').value) || 3;
  const text = $('voiceText').value.trim();
  if (!text) {
    toast('语音内容不能为空');
    return;
  }
  // 直接加到聊天界面（pending），等点 🛩️ 才发 AI
  state.messages.push({
    role: 'user',
    type: 'voice',
    duration,
    text,
    pending: true,
  });
  closeVoicePanel();
  saveState();
  renderMessages();
}

// ============ 多选删除模式 ============
let multiDeleteMode = false;
let multiDeleteSelected = new Set();

function enterMultiDeleteMode() {
  if (state.messages.length === 0) {
    toast('没有消息可删除');
    return;
  }
  multiDeleteMode = true;
  multiDeleteSelected.clear();
  const bar = $('multiDeleteBar');
  bar.hidden = false;
  bar.style.display = 'flex'; // 强制显示，防御性写法
  document.body.style.overflow = 'hidden';
  // 给所有消息加 class
  document.querySelectorAll('.message').forEach((node) => {
    node.classList.add('multi-select-active');
    node.addEventListener('click', toggleMultiSelect);
  });
  updateMultiDeleteBtn();
}

function toggleMultiSelect(e) {
  // 阻止按钮的冒泡（撤回、删除等按钮不该触发选择）
  if (e.target.closest('.msg-action-btn')) return;
  const idx = parseInt(this.dataset.idx);
  if (isNaN(idx)) return;
  if (multiDeleteSelected.has(idx)) {
    multiDeleteSelected.delete(idx);
  } else {
    multiDeleteSelected.add(idx);
  }
  this.classList.toggle('multi-selected');
  updateMultiDeleteBtn();
}

function updateMultiDeleteBtn() {
  const btn = $('multiDeleteConfirm');
  btn.textContent = `删除选中 (${multiDeleteSelected.size})`;
  btn.disabled = multiDeleteSelected.size === 0;
}

function exitMultiDeleteMode() {
  multiDeleteMode = false;
  multiDeleteSelected.clear();
  const bar = $('multiDeleteBar');
  bar.hidden = true;
  bar.style.display = ''; // 清除 inline style
  document.body.style.overflow = '';
  // 彻底清理所有残留的 multi-* class 和事件监听器
  document.querySelectorAll('.message').forEach((node) => {
    node.classList.remove('multi-select-active', 'multi-selected');
    const clone = node.cloneNode(true);
    if (node.parentNode) {
      node.parentNode.replaceChild(clone, node);
    }
  });
}

function confirmMultiDelete() {
  if (multiDeleteSelected.size === 0) {
    // 没选就直接退出
    exitMultiDeleteMode();
    return;
  }
  // 倒序删除，避免索引错位
  const sortedIdxs = [...multiDeleteSelected].sort((a, b) => b - a);
  sortedIdxs.forEach((idx) => state.messages.splice(idx, 1));
  exitMultiDeleteMode();
  saveState();
  renderMessages();
  toast(`已删除 ${sortedIdxs.length} 条`);
}

// 同步 loadingBubble 显示状态（终极防御：操作属性 + inline style + class）
function syncLoadingBubble() {
  const el = $('loadingBubble');
  if (!el) return;
  if (state.aiGenerating) {
    el.hidden = false;
    el.removeAttribute('hidden');
    el.style.display = 'flex';
    el.classList.add('active', 'interactive');
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', '停止生成');
  } else {
    el.hidden = true;
    el.setAttribute('hidden', '');
    el.style.display = 'none';
    el.classList.remove('active', 'interactive');
    el.removeAttribute('aria-label');
  }
}

// ============ 主题切换 ============
function applyTheme(themeId) {
  // themeId: 'dark' | 'light'
  document.documentElement.setAttribute('data-theme', themeId);
  const themeLink = $('themeDark');
  if (themeLink) {
    // dark 主题：启用 dark.css；light 主题：禁用 dark.css（用 style.css 默认值）
    themeLink.disabled = (themeId !== 'dark');
  }
  state.theme = themeId;
  saveState();
}

// ============ 转账/红包 ============

function openTransferPanel() {
  if (state.aiGenerating) {
    toast('AI 回复中，请稍后再发红包');
    return;
  }
  $('transferAmount').value = '';
  $('transferNote').value = '';
  $('transferError').textContent = '';
  $('transferBalanceLabel').textContent = `¥${getBalance('user').toFixed(2)}`;
  $('transferPanel').hidden = false;
  document.body.style.overflow = 'hidden';
  setTimeout(() => $('transferAmount').focus(), 100);
}

function closeTransferPanel() {
  $('transferPanel').hidden = true;
  document.body.style.overflow = '';
}

function sendRedpacket() {
  const amount = parseFloat($('transferAmount').value);
  const note = $('transferNote').value.trim();

  // 校验
  if (isNaN(amount) || amount <= 0) {
    $('transferError').textContent = '请输入有效金额';
    return;
  }
  const check = canTransfer('user', amount);
  if (!check.ok) {
    $('transferError').textContent = check.reason;
    return;
  }

  // 扣余额
  addBalance('user', -amount);

  // 推消息
  const redpacketId = 'rp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  state.messages.push({
    role: 'user',
    type: 'redpacket',
    amount,
    note: note || '恭喜发财',
    redpacketId,
    status: 'pending',
    recipient: null,
    createdAt: Date.now(),
  });

  saveState();
  renderMessages();
  updateWalletDisplay();
  closeTransferPanel();
  toast(`已发送红包 ¥${amount.toFixed(2)} ✓`);

  // 触发 AI 回复（让 AI 看到红包消息）
  sendMessage();
}

function claimRedpacket(idx, cardEl) {
  const msg = state.messages[idx];
  if (!msg || msg.status !== 'pending') return;

  // 检查过期
  if (msg.createdAt && Date.now() - msg.createdAt > 24 * 60 * 60 * 1000) {
    msg.status = 'expired';
    saveState();
    renderMessages();
    toast('红包已过期 😢');
    return;
  }

  // 拆！动画
  if (cardEl) {
    cardEl.classList.add('unpacking');
    // 金色粒子
    for (let i = 0; i < 8; i++) {
      const coin = document.createElement('div');
      coin.className = 'rp-coin';
      const angle = (Math.PI * 2 * i) / 8;
      const dist = 40 + Math.random() * 50;
      coin.style.setProperty('--dx', (Math.cos(angle) * dist) + 'px');
      coin.style.setProperty('--dy', (Math.sin(angle) * dist - 20) + 'px');
      coin.style.left = '50%';
      coin.style.top = '50%';
      coin.style.animationDelay = (i * 0.04) + 's';
      cardEl.appendChild(coin);
    }
    // 动画结束后清理
    setTimeout(() => {
      cardEl.querySelectorAll('.rp-coin').forEach(c => c.remove());
      cardEl.classList.remove('unpacking');
    }, 900);
  }

  // 更新状态
  const recipient = msg.role === 'user' ? 'ai' : 'user';
  msg.status = 'received';
  msg.recipient = recipient;
  msg.receivedAt = Date.now();
  addBalance(recipient, msg.amount);

  // 注入提示消息
  const claimerName = recipient === 'user' ? '月月' : state.aiName;
  const senderName = msg.role === 'user' ? '月月' : state.aiName;
  state.messages.push({
    role: 'user',
    type: 'system-event',
    text: `${claimerName}领取了${senderName}的红包（¥${msg.amount.toFixed(2)}，备注"${msg.note || ''}"）`,
  });

  // 如果领的是 AI 的红包，记录到 transferLog
  if (recipient === 'user') {
    state.transferLog.push({
      type: 'claim',
      from: 'ai',
      amount: msg.amount,
      redpacketId: msg.redpacketId,
      time: Date.now(),
    });
  }

  saveWallet();
  saveState();
  updateWalletDisplay();
  renderMessages();
  toast(`🧧 领取了 ¥${msg.amount.toFixed(2)}！`);
}

function sweepExpiredRedpackets() {
  let changed = false;
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  state.messages.forEach((msg) => {
    if (msg.type === 'redpacket' && msg.status === 'pending' && msg.createdAt && now - msg.createdAt > day) {
      msg.status = 'expired';
      changed = true;
    }
  });
  if (changed) saveState();
}

function updateWalletDisplay() {
  const el = $('walletBalance');
  if (el) {
    el.textContent = getBalance('user').toFixed(2);
    // 顶部栏余额是月月的（用户侧）
  }
  const tBal = $('transferBalanceLabel');
  if (tBal) tBal.textContent = `¥${getBalance('user').toFixed(2)}`;
}

// ============ 简易 toast
function toast(msg) {
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = `
    position: fixed;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    background: rgba(42, 34, 32, 0.9);
    color: var(--paper);
    padding: 10px 18px;
    border-radius: 8px;
    font-size: 13px;
    z-index: 999;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.2s ease-out;
    backdrop-filter: blur(8px);
  `;
  document.body.appendChild(t);
  requestAnimationFrame(() => (t.style.opacity = '1'));
  setTimeout(() => {
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 200);
  }, 1800);
}

// ============ 表情包按钮（v0.2 接入） ============
function handleSticker() {
  toast('表情包库 v0.2 上线，敬请期待');
}

// ============ 初始化 ============
function init() {
  loadState();
  loadWallet();
  // ★ 隐藏首屏加载指示器
  const loadingEl = document.getElementById('appLoading');
  if (loadingEl) loadingEl.remove();
  // 页面初始化时，强制重置 aiGenerating（页面刷新后状态不可能还在生成）
  state.aiGenerating = false;
  // 用 inline style 强制隐藏，绕过任何 CSS 残留问题
  $('loadingBubble').hidden = true;
  $('loadingBubble').style.display = 'none';
  // 多选条也强制隐藏（防御性写法）
  $('multiDeleteBar').hidden = true;
  $('multiDeleteBar').style.display = 'none';
  multiDeleteMode = false;
  // 初始化 lastSendBoundary（持久化不存）
  if (state.lastSendBoundary === undefined) state.lastSendBoundary = -1;
  if (state.lastSendEnd === undefined) state.lastSendEnd = -1;
  // 初始化钱包快照（持久化不存）
  if (state._walletSnapshot === undefined) state._walletSnapshot = null;
  // 应用主题
  applyTheme(state.theme || 'dark');
  sweepExpiredRedpackets();
  updateWalletDisplay();
  renderMessages();
  updateStatus();

  $('settingsBtn').addEventListener('click', openSettings);
  $('closeSettings').addEventListener('click', closeSettings);
  $('settingsMask').addEventListener('click', closeSettings);
  $('saveBtn').addEventListener('click', saveSettings);
  $('fetchModelsBtn').addEventListener('click', fetchModelList);
  // 底部"完成"按钮：关闭设置面板（设置已通过保存按钮持久化）
  $('closeSettingsBottom').addEventListener('click', closeSettings);

  // 切换显示密码
  let keyVisible = false;
  $('revealKeyBtn').addEventListener('click', () => {
    const inp = $('apiKey');
    keyVisible = !keyVisible;
    inp.type = keyVisible ? 'text' : 'password';
    const useEl = $('revealKeyBtn').querySelector('use');
    if (useEl) useEl.setAttribute('href', keyVisible ? '#i-eye-off' : '#i-eye');
  });

  // 发送按钮 —— 🛩️ 永远是纸飞机
  $('sendBtn').addEventListener('click', () => {
    if (state.aiGenerating) {
      // 兜底：AI 思考时点 🛩️ 也能停
      stopGeneration();
    } else {
      sendMessage();
    }
  });

  // loadingBubble 自身可点击停止
  $('loadingBubble').addEventListener('click', () => {
    if (state.aiGenerating) stopGeneration();
  });

  // Enter = 把当前行加到聊天列表（不触发 AI）
  // Shift+Enter = 真的换行（在同一输入框内多行编辑）
  // Ctrl/Command+Enter = 直接发送给 AI
  $('messageInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      enterSendToChat();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      sendMessage();
    }
  });

  // 自适应高度
  $('messageInput').addEventListener('input', (e) => {
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
  });

  // 表情包按钮
  $('stickerBtn').addEventListener('click', handleSticker);

  // 转账弹窗
  $('closeTransfer').addEventListener('click', closeTransferPanel);
  $('transferMask').addEventListener('click', closeTransferPanel);
  $('transferCancel').addEventListener('click', closeTransferPanel);
  $('transferSend').addEventListener('click', sendRedpacket);

  // 语音面板（在加号菜单里触发）
  $('closeVoice').addEventListener('click', closeVoicePanel);
  $('voiceMask').addEventListener('click', closeVoicePanel);
  $('voiceCancel').addEventListener('click', closeVoicePanel);
  $('voiceConfirm').addEventListener('click', confirmVoice);

  // 多选删除
  $('multiDeleteCancel').addEventListener('click', exitMultiDeleteMode);
  $('multiDeleteConfirm').addEventListener('click', confirmMultiDelete);

  // 加号菜单
  $('moreBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMoreMenu();
  });

  // 点外面关闭菜单
  document.addEventListener('click', (e) => {
    const menu = $('moreMenu');
    if (!menu.hidden && !menu.contains(e.target) && !e.target.closest('#moreBtn')) {
      toggleMoreMenu(false);
    }
  });

  // 菜单项
  document.querySelectorAll('.more-menu-item').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const action = btn.dataset.action;
      handleMoreAction(action);
    });
  });

  // 图片（从菜单触发）
  $('imageInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleImageUpload(file);
    e.target.value = '';
  });

  // 数据
  $('exportBtn').addEventListener('click', exportChats);
  $('importBtn').addEventListener('click', () => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json';
    inp.addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (f) importChats(f);
    });
    inp.click();
  });
  $('clearBtn').addEventListener('click', clearChats);

  // 帮助
  $('workerHelpBtn').addEventListener('click', (e) => {
    e.preventDefault();
    $('workerHelpPanel').hidden = false;
  });
  $('closeHelp').addEventListener('click', () => $('workerHelpPanel').hidden = true);
  $('helpMask').addEventListener('click', () => $('workerHelpPanel').hidden = true);
}

document.addEventListener('DOMContentLoaded', init);