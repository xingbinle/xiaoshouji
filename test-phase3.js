/* 第三期功能自检测试（node test-phase3.js）
   覆盖：单用户固定 PIN 加密模块 SecureCrypto
   关键场景：单 PIN 解锁 / 错误 PIN / 密文循环 / 篡改检测 */

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

// localStorage 简易 mock
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
  // ========== 1. 初次状态 ==========
  global.localStorage = makeLS();
  check('初始 isSetup() = false', Sec.isSetup() === false);
  check('初始 isUnlocked() = false', Sec.isUnlocked() === false);

  // ========== 2. ensureSetup：写入 verifier + 自动解锁 ==========
  await Sec.ensureSetup();
  check('ensureSetup 后 isSetup() = true', Sec.isSetup() === true);
  check('ensureSetup 后 isUnlocked() = true', Sec.isUnlocked() === true);

  // ========== 3. lock + 正确 PIN 解锁 ==========
  Sec.lock();
  check('lock 后 isUnlocked() = false', Sec.isUnlocked() === false);

  // 真实 PIN（硬编码常量）
  const REAL_PIN = Buffer.from('MDYxMDE2', 'base64').toString('utf8'); // 061016
  const ok1 = await Sec.unlock(REAL_PIN);
  check('正确 PIN 解锁成功', ok1 === true);
  check('解锁后 isUnlocked() = true', Sec.isUnlocked() === true);

  // ========== 4. 错误 PIN 必须失败 ==========
  const ok2 = await Sec.unlock('061017');
  check('错误 PIN 解锁失败', ok2 === false);
  check('错误 PIN 后 isUnlocked() = false', Sec.isUnlocked() === false);

  // 重新解锁（为后续测试）
  await Sec.unlock(REAL_PIN);

  // ========== 5. encryptState / decryptState 循环还原 ==========
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

  // ========== 6. 同 PIN 多次加密 iv 不同（随机 IV 必不同） ==========
  const enc2 = await Sec.encryptState({ hello: 'world' });
  check('同 PIN 两次加密 iv 不同', enc.iv !== enc2.iv);
  check('同 PIN 两次加密 ct 不同（IV 变了 → ct 也变）', enc.ct !== enc2.ct);

  // ========== 7. 篡改密文 → GCM 校验失败 ==========
  const tampered = { iv: enc.iv, ct: enc.ct.slice(0, -2) + (enc.ct.slice(-2) === 'AA' ? 'BB' : 'AA') };
  let tamperErr = null;
  try { await Sec.decryptState(tampered); } catch (e) { tamperErr = e; }
  check('篡改密文触发 GCM 解密失败', tamperErr !== null);

  // ========== 8. 未解锁时调用 encryptState 应抛错 ==========
  Sec.lock();
  let lockedErr = null;
  try { await Sec.encryptState({ a: 1 }); } catch (e) { lockedErr = e; }
  check('未解锁 encryptState 抛错', lockedErr !== null);

  // ========== 9. 跨会话解锁：重建 localStorage + 重新 unlock ==========
  //   验证固定 PIN + 固定 salt 在新会话中能正常解锁
  global.localStorage = makeLS();
  await Sec.ensureSetup();
  Sec.lock();
  const crossOk = await Sec.unlock(REAL_PIN);
  check('跨会话用正确 PIN 仍能解锁', crossOk === true);

  console.log(`\n完成：${failures === 0 ? '✅ 全部通过' : '❌ ' + failures + ' 项失败'}`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => {
  console.error('测试异常：', e);
  process.exit(1);
});