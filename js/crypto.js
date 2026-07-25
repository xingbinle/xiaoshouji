/* ============================================
   小手机 v0.3 · 端到端加密模块
   保护：聊天历史 / 人物设定 / 记忆总结 / 破限 / 正则 / 预设
   不保护：表情包 / 图片 / 头像 / API Key（仅本地）
   算法：AES-GCM 256 + PBKDF2-SHA256 100k 迭代
   ============================================ */

const SECURE_KEY = 'xiaoshouji_secure_v1';
const ITERATIONS = 100000;
const AUTH_TOKEN = 'xiaoshouji-auth-v1-💖-yueyue-kiki';

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

  // 首次设置主密码（生成 salt + verifier 存 localStorage，密钥仅留在内存）
  async setupMasterPassword(password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(password, salt);
    const { iv, ct } = await aesEncrypt(AUTH_TOKEN, key);
    const meta = { salt: bufToB64(salt), iv, ct, version: 1, created: Date.now() };
    localStorage.setItem(SECURE_KEY, JSON.stringify(meta));
    _masterKey = key;
    return meta;
  },

  // 用主密码解锁（核对 verifier），成功则把密钥放进内存
  async unlock(password) {
    const raw = localStorage.getItem(SECURE_KEY);
    if (!raw) return false;
    let meta;
    try { meta = JSON.parse(raw); } catch (e) { return false; }
    try {
      const salt = new Uint8Array(b64ToBuf(meta.salt));
      const key = await deriveKey(password, salt);
      const pt = await aesDecrypt(meta.ct, meta.iv, key);
      if (pt !== AUTH_TOKEN) { _masterKey = null; return false; }
      _masterKey = key;
      return true;
    } catch (e) {
      _masterKey = null; // GCM 校验失败 = 密码错，确保旧密钥失效
      return false;
    }
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
