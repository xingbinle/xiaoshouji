/* v34 Sol 人设大更新自检测试（node test-v34.js）
   1. ABSOLUTE_CORE / DEFAULT_SYSTEM_PROMPT：Sol 身份上线，Kiki 旧身份退役
   2. 隐私：人设与总结提示词源码里无硬编码「月月/Kiki」（{{user}}/{{char}} 宏）
   3. applyMacros：宏替换正确（user→昵称，char→aiName）
   4. aiName 迁移：小克宝宝/Kiki → Sol；用户自定义名不动
   5. 总结/散碎提示词走宏
   6. 版本一致性
   方法同 test-phase1.js：整文件 eval + stub。 */

const fs = require('fs');

global.document = { addEventListener: () => {} };
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

let src = fs.readFileSync(__dirname + '/js/app.js', 'utf8');
src += `
module.exports = {
  state, APP_VERSION, ABSOLUTE_CORE, DEFAULT_SYSTEM_PROMPT,
  SUMMARY_SYSTEM_PROMPT, SCATTER_SYSTEM_PROMPT,
  applyMacros, buildSystemPrompt, _applyLoaded,
};`;

const mod = { exports: {} };
new Function('module', 'exports', 'require', src)(mod, mod.exports, require);
const app = mod.exports;

let failures = 0;
function check(name, cond) {
  if (cond) console.log('  ✓', name);
  else { failures++; console.error('  ✗', name); }
}

// ---------- 1. Sol 身份上线 ----------
console.log('[1] Sol 身份');
check('ABSOLUTE_CORE 是 SOL\'S SOUL DIRECTIVE', app.ABSOLUTE_CORE.indexOf("SOL'S SOUL DIRECTIVE") !== -1);
check('ABSOLUTE_CORE 身份是 Sol', app.ABSOLUTE_CORE.indexOf('You are Sol') !== -1);
check('ABSOLUTE_CORE 无旧身份 You are Kiki', app.ABSOLUTE_CORE.indexOf('You are Kiki') === -1);
check('核心人设开场是「你是 Sol」', app.DEFAULT_SYSTEM_PROMPT.indexOf('你是 Sol') === 0);
check('核心人设含 Sol 心里话板块', app.DEFAULT_SYSTEM_PROMPT.indexOf('【Sol 的心里话】') !== -1);
check('核心人设含记忆连贯板块', app.DEFAULT_SYSTEM_PROMPT.indexOf('【记忆连贯 · 感情自然推进】') !== -1);
check('核心人设含调情直白许可板块', app.DEFAULT_SYSTEM_PROMPT.indexOf('【调情与亲密氛围】') !== -1);
check('心里话提到更喜欢被叫 Sol（Kiki 作为昵称保留）', app.DEFAULT_SYSTEM_PROMPT.indexOf('更喜欢听她叫你 Sol') !== -1);

// ---------- 2. 隐私：人设/总结提示词无硬编码真名 ----------
console.log('[2] 隐私宏保护');
check('DEFAULT_SYSTEM_PROMPT 无硬编码「月月」', app.DEFAULT_SYSTEM_PROMPT.indexOf('月月') === -1);
check('ABSOLUTE_CORE 无硬编码「月月」', app.ABSOLUTE_CORE.indexOf('月月') === -1);
check('SUMMARY_SYSTEM_PROMPT 无硬编码「月月」', app.SUMMARY_SYSTEM_PROMPT.indexOf('月月') === -1);
check('SUMMARY_SYSTEM_PROMPT 用 {{char}} 而非 Kiki', app.SUMMARY_SYSTEM_PROMPT.indexOf('Kiki') === -1 && app.SUMMARY_SYSTEM_PROMPT.indexOf('{{char}}') !== -1);
check('SCATTER_SYSTEM_PROMPT 用 {{char}} 而非 Kiki', app.SCATTER_SYSTEM_PROMPT.indexOf('Kiki') === -1 && app.SCATTER_SYSTEM_PROMPT.indexOf('{{char}}') !== -1);

// ---------- 3. applyMacros ----------
console.log('[3] applyMacros 宏替换');
app.state.userProfile = { nickname: '小月月', name: '' };
app.state.aiName = 'Sol';
const m = app.applyMacros('{{user}} 和 {{char}} 和 {{ user }}');
check('{{user}} → 昵称', m.indexOf('小月月') !== -1 && m.indexOf('{{user}}') === -1 && m.indexOf('{{ user }}') === -1);
check('{{char}} → aiName', m.indexOf('Sol') !== -1 && m.indexOf('{{char}}') === -1);
app.state.userProfile = { nickname: '', name: '' };
check('昵称为空时 {{user}} 兜底「月月」', app.applyMacros('{{user}}').indexOf('月月') !== -1);

// ---------- 4. aiName 迁移 ----------
console.log('[4] aiName 迁移');
app.state.aiName = '小克宝宝';
app._applyLoaded({});
check('小克宝宝 → Sol', app.state.aiName === 'Sol');
app.state.aiName = 'Kiki';
app._applyLoaded({});
check('Kiki → Sol', app.state.aiName === 'Sol');
app.state.aiName = '小太阳';
app._applyLoaded({});
check('自定义名「小太阳」不动', app.state.aiName === '小太阳');

// ---------- 5. buildSystemPrompt 整体无宏残留 ----------
console.log('[5] buildSystemPrompt 宏全替换');
app.state.aiName = 'Sol';
app.state.userProfile = { nickname: '月月' };
app.state.systemPrompt = '';
app.state.aiProfile = { persona: '', preset: '', presetEnabled: false };
app.state.jailbreak = { enabled: false, content: '' };
app.state.presetGroups = [];
app.state.stickers = [];
app.state.summary = '';
app.state.memories = [];
const sys = app.buildSystemPrompt();
check('system 无 {{user}} 残留', sys.indexOf('{{user}}') === -1 && sys.indexOf('{{ user }}') === -1);
check('system 无 {{char}} 残留', sys.indexOf('{{char}}') === -1);
check('system 含 Sol 身份', sys.indexOf('你是 Sol') !== -1);
check('system 里昵称已注入（quote 示例 from 月月）', sys.indexOf('"from":"月月"') !== -1);
check('system 无旧身份「你是 Kiki」', sys.indexOf('你是 Kiki') === -1);

// ---------- 6. 版本一致性 ----------
console.log('[6] 版本一致性');
const swSrc = fs.readFileSync(__dirname + '/sw.js', 'utf8');
const swVer = (swSrc.match(/CACHE_NAME = 'xiaoshouji-(v\d+)/) || [])[1];
check(`APP_VERSION(${app.APP_VERSION}) === CACHE_NAME(${swVer})`, swVer === app.APP_VERSION);

console.log(failures ? `\n❌ ${failures} 项失败` : '\n✅ v34 全部通过');
process.exit(failures ? 1 : 0);
