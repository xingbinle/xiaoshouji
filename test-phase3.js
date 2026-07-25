/* 第三期功能自检测试（node test-phase3.js）
   覆盖：端到端加密模块 SecureCrypto（AES-GCM 256 + PBKDF2-SHA256）
   关键场景：设置/解锁/错误密码/密文循环/不同密码不同密文 */

const fs = require('fs');
const { webcrypto } = require('crypto');

// Node 端补齐浏览器 Web Crypto API + window
global.crypto = webcrypto;
global.window = {};

let src = fs.readFileSync(__dirname + '/js/crypto.js', 'utf8');
src += `
module.exports = SecureCrypto;`;

const mod = { exports: {} };
new Function('module', 'exports', 'require', src)(mod, mod.exports, require);
const Sec = mod.exports;

// localStorage 简易 mock（每个测试用例新建一份避免污染）
function makeLS() {
  const data = {};
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
  };
}

let failures = 0;
function check(name, cond) {
  if (cond) console.log('  ✓', name);
  else { failures++; console.error('  ✗', name); }
}

async function run() {
  // ========== 1. 初次状态：未设置 ==========
  global.localStorage = makeLS();
  check('初始 isSetup() = false', Sec.isSetup() === false);
  check('初始 isUnlocked() = false', Sec.isUnlocked() === false);

  // ========== 2. setupMasterPassword：写入 verifier + 自动解锁 ==========
  await Sec.setupMasterPassword('月月123');
  check('setup 后 isSetup() = true', Sec.isSetup() === true);
  check('setup 后 isUnlocked() = true', Sec.isUnlocked() === true);

  // ========== 3. lock 后重新解锁 ==========
  Sec.lock();
  check('lock 后 isUnlocked() = false', Sec.isUnlocked() === false);

  const ok1 = await Sec.unlock('月月123');
  check('正确密码解锁成功', ok1 === true);
  check('解锁后 isUnlocked() = true', Sec.isUnlocked() === true);

  const ok2 = await Sec.unlock('月月124');
  check('错误密码解锁失败', ok2 === false);
  check('错误密码后仍 isUnlocked() = false', Sec.isUnlocked() === false);

  // 重新用对的密码解锁（为后续测试）
  await Sec.unlock('月月123');

  // ========== 4. encryptState / decryptState 循环还原 ==========
  const sampleState = {
    messages: [{ role: 'user', text: '你好' }, { role: 'ai', text: '月月好~' }],
    summary: '她喜欢喝奶茶',
    memories: [{ time: '2026-07-25', text: '猫叫小克' }],
    userProfile: { name: '月月', patSuffix: '的小脑袋' },
    apiKey: 'sk-secret-12345',
  };
  const enc = await Sec.encryptState(sampleState);
  check('encryptState 返回 iv+ct', !!enc.iv && !!enc.ct);
  check('iv 是字符串', typeof enc.iv === 'string');
  check('ct 是字符串', typeof enc.ct === 'string');

  const dec = await Sec.decryptState(enc);
  check('decryptState 解出 messages 长度一致', dec.messages.length === sampleState.messages.length);
  check('decryptState 解出第一条 text', dec.messages[0].text === '你好');
  check('decryptState 解出 summary', dec.summary === '她喜欢喝奶茶');
  check('decryptState 解出 memories[0].text', dec.memories[0].text === '猫叫小克');
  check('decryptState 解出 apiKey', dec.apiKey === 'sk-secret-12345');

  // ========== 5. 不同 salt → 不同密文（同一明文） ==========
  Sec.lock();
  await Sec.setupMasterPassword('password-A');
  const encA = await Sec.encryptState({ hello: 'world' });
  Sec.lock();
  // 完全独立的 setup（salt 必然不同）
  global.localStorage = makeLS();
  await Sec.setupMasterPassword('password-B');
  const encB = await Sec.encryptState({ hello: 'world' });
  check('不同 setup 出来的密文 iv 不同', encA.iv !== encB.iv);
  check('不同 setup 出来的密文 ct 不同', encA.ct !== encB.ct);

  // ========== 6. 篡改密文 → GCM 校验失败 ==========
  Sec.lock();
  await Sec.unlock('password-A').catch(() => {});
  // 拿到 encA 的密文，把 ct 改一个字节
  const tampered = { iv: encA.iv, ct: encA.ct.slice(0, -2) + (encA.ct.slice(-2) === 'AA' ? 'BB' : 'AA') };
  let tamperErr = null;
  try { await Sec.decryptState(tampered); } catch (e) { tamperErr = e; }
  check('篡改密文触发 GCM 解密失败', tamperErr !== null);

  // ========== 7. 未解锁时调用 encryptState 应抛错 ==========
  Sec.lock();
  let lockedErr = null;
  try { await Sec.encryptState({ a: 1 }); } catch (e) { lockedErr = e; }
  check('未解锁 encryptState 抛错', lockedErr !== null);

  // ========== 8. 解锁后调 setupMasterPassword 应能覆盖旧 verifier ==========
  await Sec.unlock('password-A');
  Sec.lock();
  await Sec.setupMasterPassword('password-A-new');
  const oldOk = await Sec.unlock('password-A');
  check('旧密码在新 setup 后失败', oldOk === false);
  const newOk = await Sec.unlock('password-A-new');
  check('新密码能解锁', newOk === true);

  console.log(`\n完成：${failures === 0 ? '✅ 全部通过' : '❌ ' + failures + ' 项失败'}`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => {
  console.error('测试异常：', e);
  process.exit(1);
});