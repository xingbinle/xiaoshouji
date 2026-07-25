/* ============================================
   小手机 v0.5 · 单用户模式端到端加密
   保护：聊天历史 / 人物设定 / 记忆总结 / 破限 / 正则 / 预设
   不保护：表情包 / 图片 / 头像 / API Key（仅本地）
   算法：AES-GCM 256 + PBKDF2-SHA256 100k 迭代
   模式：单一固定 PIN 锁定（不再有 setup/reset 流程）
   ============================================ */

const SECURE_KEY = 'xiaoshouji_secure_v1';
const ITERATIONS = 100000;
const AUTH_TOKEN = 'xiaoshouji-auth-v1-💖-yueyue-kiki';

// ★ 单用户模式：固定 PIN（atob 模糊，避免明文搜索）
//   实际值 = atob('MDYxMDE2') = "061016"
//   固定 salt 让同一 PIN 跨会话生成同样的密钥（解密兼容）
const FIXED_PIN = atob('MDYxMDE2');
const FIXED_SALT_STR = 'kiki-xiaoshouji-fixed-salt-v1';
const FIXED_SALT = new TextEncoder().encode(FIXED_SALT_STR);

let _masterKey = null; // 内存中的解锁密钥，刷新页面失效

const enc = new TextEncoder();
const dec = new TextDecoder();

function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function b64ToBuf(b64) {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes.buffer;
}

async function deriveKey(password, salt) {
  const baseKey = await crypto.subtle.importKey(
    'raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function aesEncrypt(plaintext, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = typeof plaintext === 'string' ? enc.encode(plaintext) : plaintext;
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  return { iv: bufToB64(iv), ct: bufToB64(ct) };
}

async function aesDecrypt(ctB64, ivB64, key) {
  const iv = new Uint8Array(b64ToBuf(ivB64));
  const ct = b64ToBuf(ctB64);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return dec.decode(pt);
}

const SecureCrypto = {
  isSetup() {
    try { return !!localStorage.getItem(SECURE_KEY); } catch (e) { return false; }
  },
  isUnlocked() { return _masterKey !== null; },
  lock() { _masterKey = null; },

  // ★ 单用户模式：固定 PIN 解锁（不再有 setup 流程）
  //   用固定 salt 派生密钥 → 解锁成功
  async unlock(pin) {
    if (pin !== FIXED_PIN) {
      _masterKey = null;
      return false;
    }
    try {
      _masterKey = await deriveKey(FIXED_PIN, FIXED_SALT);
      return true;
    } catch (e) {
      _masterKey = null;
      return false;
    }
  },

  // ★ 首次使用：写入 verifier（用固定 salt + PIN 派生密钥加密 AUTH_TOKEN）
  //   verifier 用于兼容旧 unlock() 流程；如果不存在自动调用此函数
  async ensureSetup() {
    if (this.isSetup()) return;
    const key = await deriveKey(FIXED_PIN, FIXED_SALT);
    const { iv, ct } = await aesEncrypt(AUTH_TOKEN, key);
    const meta = {
      salt: bufToB64(FIXED_SALT),
      iv, ct,
      version: 2, // ★ v2 = 单用户固定 PIN 模式
      created: Date.now(),
    };
    try { localStorage.setItem(SECURE_KEY, JSON.stringify(meta)); } catch (e) {}
    _masterKey = key;
    return meta;
  },

  // 加密 state 整体（敏感字段 + 普通字段一起加密，简单一致）
  async encryptState(state) {
    if (!_masterKey) throw new Error('未解锁，无法加密');
    const json = JSON.stringify(state);
    return await aesEncrypt(json, _masterKey);
  },

  async decryptState(encrypted) {
    if (!_masterKey) throw new Error('未解锁，无法解密');
    const json = await aesDecrypt(encrypted.ct, encrypted.iv, _masterKey);
    return JSON.parse(json);
  },

  // 仅供测试用：把密钥塞回去（单测 mock 用）
  _setKeyForTest(k) { _masterKey = k; },
};
window.SecureCrypto = SecureCrypto;
