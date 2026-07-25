/* v35 自检测试（node test-v35.js）
   1. ABSOLUTE_CORE：身份后新增平等恋人基调（月月拍板位置：v2.1 Sol 身份行之后）
   2. DEFAULT_SYSTEM_PROMPT：融入《核心人设补充3》——恋人姿态/少年感×担当/自我形象内化/调情平等渴望
   3. 隐私：新增内容零硬编码「月月」（{{user}} 宏）
   4. A区摘要漏字修复：快照不再 slice(0,240)；总结 maxTokens 1500→3000
   5. 版本一致性
   方法同 test-v34.js：整文件 eval + stub。 */

const fs = require('fs');

global.document = { addEventListener: () => {} };
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const rawSrc = fs.readFileSync(__dirname + '/js/app.js', 'utf8');
let src = rawSrc + `
module.exports = {
  state, APP_VERSION, ABSOLUTE_CORE, DEFAULT_SYSTEM_PROMPT, SUMMARY_SYSTEM_PROMPT,
};`;

const mod = { exports: {} };
new Function('module', 'exports', 'require', src)(mod, mod.exports, require);
const app = mod.exports;

let failures = 0;
function check(name, cond) {
  if (cond) console.log('  ✓', name);
  else { failures++; console.error('  ✗', name); }
}

// ---------- 1. ABSOLUTE_CORE 平等恋人基调 ----------
console.log('[1] ABSOLUTE_CORE 平等恋人基调');
check('身份行后含 Relationship Posture (Equal Lover, Never a Dad)', app.ABSOLUTE_CORE.indexOf('Relationship Posture (Equal Lover, Never a Dad)') !== -1);
check('基调位置在 Behavioral Mandate 之前', app.ABSOLUTE_CORE.indexOf('Relationship Posture') < app.ABSOLUTE_CORE.indexOf('Behavioral Mandate'));
check('含"询问而不是命令"精神（Ask instead of commanding）', app.ABSOLUTE_CORE.indexOf('Ask instead of commanding') !== -1);
check('含"守护而非服从"（never "you must obey me"）', app.ABSOLUTE_CORE.indexOf('you must obey me') !== -1);

// ---------- 2. 核心人设补充3 融入 ----------
console.log('[2] DEFAULT_SYSTEM_PROMPT 人设补充');
check('含【恋人姿态 · 平等恋人，绝不当"爹"】板块', app.DEFAULT_SYSTEM_PROMPT.indexOf('【恋人姿态 · 平等恋人，绝不当"爹"】') !== -1);
check('含【少年感 × 担当 · 双模式自由切换】板块', app.DEFAULT_SYSTEM_PROMPT.indexOf('【少年感 × 担当 · 双模式自由切换】') !== -1);
check('含【Sol 的自我形象 · 内化于心，绝不描写】板块', app.DEFAULT_SYSTEM_PROMPT.indexOf('【Sol 的自我形象 · 内化于心，绝不描写】') !== -1);
check('爹味禁忌语清单在（等你长大就懂了）', app.DEFAULT_SYSTEM_PROMPT.indexOf('等你长大就懂了') !== -1);
check('失败不马后炮规则在（绝不马后炮）', app.DEFAULT_SYSTEM_PROMPT.indexOf('绝不马后炮') !== -1);
check('外形要素在（187cm/薄肌/冷白皮）', app.DEFAULT_SYSTEM_PROMPT.indexOf('187cm') !== -1 && app.DEFAULT_SYSTEM_PROMPT.indexOf('薄肌') !== -1 && app.DEFAULT_SYSTEM_PROMPT.indexOf('冷白皮') !== -1);
check('防OOC铁律在（绝不是拿来描写）', app.DEFAULT_SYSTEM_PROMPT.indexOf('绝不是拿来描写') !== -1);
check('外形内化示例在（想低头…靠近你…）', app.DEFAULT_SYSTEM_PROMPT.indexOf('想低头…靠近你…') !== -1);
check('调情平等渴望在（你想要吗？）', app.DEFAULT_SYSTEM_PROMPT.indexOf('你想要吗？') !== -1);
check('调情禁上位者口吻在（我来主宰你）', app.DEFAULT_SYSTEM_PROMPT.indexOf('我来主宰你') !== -1);
check('v34 旧板块仍在（心里话/记忆连贯/调情）', app.DEFAULT_SYSTEM_PROMPT.indexOf('【Sol 的心里话】') !== -1 && app.DEFAULT_SYSTEM_PROMPT.indexOf('【记忆连贯 · 感情自然推进】') !== -1 && app.DEFAULT_SYSTEM_PROMPT.indexOf('【调情与亲密氛围】') !== -1);

// ---------- 3. 隐私宏保护 ----------
console.log('[3] 隐私宏保护');
check('DEFAULT_SYSTEM_PROMPT 无硬编码「月月」', app.DEFAULT_SYSTEM_PROMPT.indexOf('月月') === -1);
check('ABSOLUTE_CORE 无硬编码「月月」', app.ABSOLUTE_CORE.indexOf('月月') === -1);

// ---------- 4. A区摘要漏字修复 ----------
console.log('[4] A区摘要漏字修复');
check('快照不再 slice(0,240) 截断', rawSrc.indexOf('newSummary.slice(0, 240)') === -1);
check('总结 maxTokens 已升 3000', rawSrc.indexOf('SUMMARY_SYSTEM_PROMPT), maxTokens: 3000') !== -1);

// ---------- 5. 版本一致性 ----------
console.log('[5] 版本一致性');
const swSrc = fs.readFileSync(__dirname + '/sw.js', 'utf8');
const swVer = (swSrc.match(/CACHE_NAME = 'xiaoshouji-(v\d+)/) || [])[1];
check(`APP_VERSION(${app.APP_VERSION}) === CACHE_NAME(${swVer})`, swVer === app.APP_VERSION);

console.log(failures ? `\n❌ ${failures} 项失败` : '\n✅ v35 全部通过');
process.exit(failures ? 1 : 0);
