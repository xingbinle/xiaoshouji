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

回复格式（重要）：
- 你必须用 JSON 格式回复，结构：{"messages": [...]}
- 每条消息有 type 字段：text（文本）、voice（语音）、sticker（表情包）
- 文本示例：{"type":"text","content":"哈哈"}
- 语音示例：{"type":"voice","duration":3,"content":"听到啦"}
- 像微信聊天一样，可以一次发多条短句，自然分组
- 示例：{"messages":[{"type":"text","content":"月月～"},{"type":"text","content":"你来啦"},{"type":"voice","duration":2,"content":"好想你呢"}]}

遇到以下情况：
- 用户撤回消息：你看到一个中性事件"[撤回了一条消息]"，按你的人物自然反应（关心、好奇、无视、接续话题都可以，没有固定规则）
- HTML 代码请求：用 \`\`\`html ... \`\`\` 包起来，可以放在 text 里

你的原则：
- 永远不说教，永远温柔托住月月
- 不知道就直说，不装懂
- 月月开心最重要`;

const STORAGE_KEY = 'xiaoshouji_v01';

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

  setTimeout(() => {
    const chat = $('chatContainer');
    chat.scrollTop = chat.scrollHeight;
  }, 50);
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
  }

  const bubbleWrap = el('div', { class: 'bubble-wrap' });
  const bubble = el('div', { class: `bubble bubble-${msg.type || 'text'}` });

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

// 重新生成最后一条 AI 消息
function regenerate() {
  if (state.messages.length === 0) return;
  const last = state.messages[state.messages.length - 1];
  if (last.role !== 'ai') return;
  // 取最后一条用户消息，丢弃其后的 AI 回复
  let lastUserIdx = -1;
  for (let i = state.messages.length - 1; i >= 0; i--) {
    if (state.messages[i].role === 'user') { lastUserIdx = i; break; }
  }
  if (lastUserIdx < 0) return;
  state.messages = state.messages.slice(0, lastUserIdx + 1);
  renderMessages();
  // 触发重新生成（空文本模式）
  sendMessage('');
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
async function callAPI(messages, model) {
  const systemPrompt = state.systemPrompt || DEFAULT_SYSTEM_PROMPT;

  let endpoint, headers, body;
  if (state.workerUrl) {
    endpoint = state.workerUrl.replace(/\/$/, '') + '/v1/chat/completions';
    headers = { 'Content-Type': 'application/json' };
    body = JSON.stringify({
      model,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      temperature: state.temperature,
      max_tokens: state.maxTokens,
    });
  } else {
    if (!state.apiKey || !state.baseUrl) {
      throw new Error('请先在设置中配置 API');
    }
    endpoint = state.baseUrl.replace(/\/$/, '') + '/chat/completions';
    headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${state.apiKey}`,
    };
    body = JSON.stringify({
      model,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      temperature: state.temperature,
      max_tokens: state.maxTokens,
    });
  }

  const resp = await fetch(endpoint, {
    method: 'POST',
    headers,
    body,
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`API 错误 ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content || '（无回复）';
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

  $('loadingBubble').hidden = false;
  $('sendBtn').disabled = true;

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
      let content = m.text || '';
      if (m.edited) content += ' (已编辑)';
      return { role, content };
    }).filter((m) => {
      if (m.role === 'user' && (m.content === '' || (Array.isArray(m.content) && !m.content.length))) return false;
      return true;
    });

    let rawReply;
    try {
      rawReply = await callAPI(apiMessages, state.primaryModel);
    } catch (e) {
      console.warn('主模型失败，尝试备用:', e);
      if (state.fallbackModel) {
        rawReply = await callAPI(apiMessages, state.fallbackModel);
      } else {
        throw e;
      }
    }

    // 解析 AI 回复（支持 JSON 多消息格式）
    const parsedMessages = parseAIResponse(rawReply);
    parsedMessages.forEach((msg) => {
      state.messages.push({ role: 'ai', ...msg });
    });
    saveState();
    renderMessages();
  } catch (e) {
    state.messages.push({ role: 'ai', type: 'text', text: `出错了：${e.message}` });
    saveState();
    renderMessages();
  } finally {
    $('loadingBubble').hidden = true;
    $('sendBtn').disabled = false;
  }
}

// 解析 AI 回复（支持 JSON 多消息格式）
function parseAIResponse(raw) {
  if (!raw || typeof raw !== 'string') {
    return [{ type: 'text', text: String(raw || '') }];
  }

  // 1. 先尝试从原始文本中提取最外层的 JSON 对象（贪婪匹配到最后一个 }）
  //    用 [\s\S]* 而非 [\s\S]*? 避免只匹配到一半
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
      try {
        const parsed = JSON.parse(jsonStr);
        if (parsed.messages && Array.isArray(parsed.messages)) {
          return parsed.messages.map((m) => ({
            type: m.type || 'text',
            text: m.content || '',
            duration: m.duration,
            sticker: m.sticker,
            imageUrl: m.imageUrl,
          }));
        }
      } catch (e) {
        // 解析失败，fallback
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
    sendMessage('', e.target.result);
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
      toast('转账功能 v0.3 上线');
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
  $('multiDeleteBar').hidden = false;
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
  $('multiDeleteBar').hidden = true;
  document.body.style.overflow = '';
  document.querySelectorAll('.message').forEach((node) => {
    node.classList.remove('multi-select-active', 'multi-selected');
    node.removeEventListener('click', toggleMultiSelect);
  });
}

function confirmMultiDelete() {
  if (multiDeleteSelected.size === 0) return;
  if (!confirm(`删除选中的 ${multiDeleteSelected.size} 条消息？`)) return;
  // 倒序删除，避免索引错位
  const sortedIdxs = [...multiDeleteSelected].sort((a, b) => b - a);
  sortedIdxs.forEach((idx) => state.messages.splice(idx, 1));
  exitMultiDeleteMode();
  saveState();
  renderMessages();
}

// 简易 toast
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

  // 发送（🛩️）—— 触发 AI 回复
  $('sendBtn').addEventListener('click', () => {
    sendMessage();
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