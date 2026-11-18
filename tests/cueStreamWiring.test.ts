// 字幕 AI 总结 · 流式接线守卫（用户 m09565 ①-8）
//
// 🔴 为什么这层要源码级守卫：真流式是「三层必须同时接通」的事 ——
//    服务层有 `generateStream`、宿主有 `cueSummarizeStream`、视图有 `cueSummaryStream`。
//    任何一层掉线都不会让类型报错（它们全是可选字段 / 同构返回值），
//    界面只会静默退回「等十几秒再一次出全字」，用户以为需求没做。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => readFileSync(resolve(ROOT, rel), 'utf8');
/** 剥注释再做全文匹配：本仓注释里到处写着旧写法，不剥会被自己的文档打穿。 */
const stripComments = (s: string): string =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const MAIN = stripComments(read('main.ts'));
const PAGE = stripComments(read('src/views/EpisodePageView.ts'));
const SVC = stripComments(read('src/services/cueSummary.ts'));
const HTTP = stripComments(read('src/services/nodeHttp.ts'));
const CSS = stripComments(read('styles.css'));

describe('① 服务层：buildCueSummaryBody 支持 stream 且默认 false', () => {
    it('第 5 个参数是 stream，显式写成 `stream === true`', () => {
        expect(SVC).toContain('generateStream(');
        expect(SVC).toContain('buildCueSummaryBody(input, provider, prompt, model, true)');
    });

    it('⚠️ 请求体里必须显式写 stream（键集合被既有单测钉成 messages/model/stream）', () => {
        const PURE = stripComments(read('src/pure/cueSummary.ts'));
        expect(PURE).toContain('stream: stream === true,');
        /**
         * ⛔ 别退回写死 false —— 那会让流式静默失效。
         * ⚠️ 反向守卫**必须限定在 buildCueSummaryBody 函数体内**：
         *    同一个文件里 `buildCueAskBody` 那份请求体是**应该**写死 `stream: false` 的
         *    （提问要一次性整段答案，流式反而会把话拆碎）。
         *    写成文件级「禁止出现 stream: false」会稳定误报 —— 守卫必须先划清作用域。
         */
        const i = PURE.indexOf('export function buildCueSummaryBody(');
        expect(i).toBeGreaterThan(-1);
        const body = PURE.slice(i, PURE.indexOf('function asString('));
        expect(body).toContain('stream: stream === true,');
        expect(body).not.toMatch(/stream:\s*false/);
    });

    it('解析用模型正文（collector.raw），⛔ 不是原始 SSE 字节', () => {
        expect(SVC).toContain('const modelText = collector.raw');
        // 反向守卫：解析调用那一行不能直接吃 res.text
        expect(SVC).not.toMatch(/parseCueSummaryResult\(\s*res\.text\s*\)/);
    });

    it('没有流式通道时退回非流式（功能不消失）', () => {
        expect(SVC).toMatch(/if\s*\(!this\.deps\.httpStream\)\s*\{/);
        expect(SVC).toContain('await this.generate(input)');
    });

    it('收到 [DONE] 就主动断开（shouldStop 接 sawDone）', () => {
        expect(SVC).toContain('shouldStop: () => collector.sawDone');
    });

    it('已经吐过字之后失败不静默清空、不误报「模型未返回可用结果」', () => {
        expect(SVC).toContain('emitted && res.stopped');
        expect(SVC).toContain('if (!emitted) this.deps.notify');
    });
});

describe('② 传输层：nodeHttpPostStream 的三条硬约束', () => {
    it('用 StringDecoder 防多字节中文被 TCP 切半', () => {
        expect(HTTP).toContain("require('string_decoder')");
        expect(HTTP).toContain('decoder.write(');
        // 收尾要把残留半个字符吐出来
        expect(HTTP).toContain('decoder.end()');
    });

    it('⛔ 不重试（重试会让界面文字从头再来一遍）', () => {
        const fn = HTTP.slice(HTTP.indexOf('export async function nodeHttpPostStream'));
        const body = fn.slice(0, fn.indexOf('\n}\n') + 3);
        expect(body).not.toContain('retry(');
    });

    it('POST 必须显式给 Content-Length（否则 Node 用 chunked，网关会 400）', () => {
        const fn = HTTP.slice(HTTP.indexOf('export async function nodeHttpPostStream'));
        expect(fn.slice(0, 1400)).toContain("h['Content-Length']");
        expect(fn.slice(0, 1400)).toContain("h.Accept = 'text/event-stream'");
    });

    it('shouldStop 命中后必须 destroy 再收尾（不 destroy 连接会挂到服务端超时）', () => {
        const fn = HTTP.slice(HTTP.indexOf('export async function nodeHttpPostStream'));
        const i = fn.indexOf('if (opts.shouldStop?.())');
        expect(i).toBeGreaterThan(-1);
        const seg = fn.slice(i, i + 700);
        expect(seg).toContain('res.destroy()');
        expect(seg.indexOf('res.destroy()')).toBeLessThan(seg.indexOf('finish()'));
    });
});

describe('③ 宿主层：main.ts 接线', () => {
    it('有 cueSummarizeStream，且走 generateStream', () => {
        expect(MAIN).toContain('cueSummarizeStream(');
        expect(MAIN).toContain('.generateStream(input, onPartial)');
    });

    it('httpStream 只在桌面端注入（移动端没有 require("https")）', () => {
        const i = MAIN.indexOf('httpStream: Platform.isDesktopApp');
        expect(i).toBeGreaterThan(-1);
        expect(MAIN.slice(i, i + 900)).toContain('nodeHttpPostStream(');
        // 非桌面端必须给 undefined ⇒ 服务层自动退回非流式
        expect(MAIN.slice(i, i + 900)).toContain(': undefined');
    });

    it('pageCtx 上有 cueSummaryStream 落点', () => {
        expect(MAIN).toContain('cueSummaryStream: (input, onPartial) =>');
    });
});

describe('④ 视图层：就地追加，⛔ 不每次重建面板', () => {
    it('generateCueAi 优先走流式，没注入才退回一次性', () => {
        expect(PAGE).toContain('const fnStream = this.pageCtx?.cueSummaryStream;');
        expect(PAGE).toMatch(/got = fnStream \? await fnStream\(input, onPartial\) : await fn!\(input\);/);
    });

    it('🔴 onPartial 只改已挂好的节点，⛔ 不调 showCueAiPanel 重建', () => {
        const i = PAGE.indexOf('const onPartial = (summary: string): void => {');
        expect(i).toBeGreaterThan(-1);
        const seg = PAGE.slice(i, i + 520);
        /**
         * 🔴 契约又变了一次（2026-11-13，用户 m15513 逐字）：
         *    「AI总结输出动效不要打字机动效了一次输出完毕就行」
         *    ⇒ **取消一切逐字动画**，`onPartial` 收到多少就整段写进节点。
         *    历史（⛔ 别回头）：早先 `onPartial` 只更新 target、显示交给 rAF 节奏器
         *    （`cuePaceStep` 匀速推进 shown），收尾还有 `buildCueTypewriter` 再吐一遍 ——
         *    两条通道连同 `pure/typewriter` / `pure/cuePacer` 都已删除。
         *    ⚠️ 仍然**不重建面板**：那会丢输入焦点、清空用户正在打的提问。
         */
        expect(seg).toContain('liveTarget = summary;');
        expect(seg).toContain('liveShown.textContent = liveTarget;');
        // 反向守卫：⛔ 别再引入逐字节奏（rAF / 打字机 / 切片写文本）
        expect(seg).not.toContain('requestAnimationFrame');
        expect(seg).not.toContain('typewriter');
        expect(seg).not.toContain('cuePace');
        expect(seg).not.toContain('.textContent = liveTarget.slice');
        // 反向守卫：流式回调里出现重建面板 = 提问框闪、焦点被夺
        expect(seg).not.toContain('showCueAiPanel(');
        expect(seg).not.toContain('destroyCueAiPanel(');
    });

    it('🔴 打字机通道整体下线（方法 / 字段 / 纯模块 / 死样式）', () => {
        // 收尾整段打字机与它的 rAF 字段都已删除
        expect(PAGE).not.toContain('buildCueTypewriter');
        expect(PAGE).not.toContain('destroyCueTypewriter');
        expect(PAGE).not.toContain('cueTypeTimer');
        // 纯模块只服务这一处 ⇒ 整模块删除，⛔ 别留孤儿 import
        expect(PAGE).not.toContain("from 'pure/typewriter'");
        expect(PAGE).not.toContain("from 'pure/cuePacer'");
        // 总结落点直接整段渲染，不再挂 `.rl-tw` 打字机结构
        expect(PAGE).toContain("body.createDiv({ cls: 'rl-epp-cueai-sum', text: result.summary });");
        expect(CSS).not.toContain('.rl-tw-shown');
        expect(CSS).not.toContain('.rl-tw-rest');
    });

    it('换集/换字幕后迟到的片段要丢弃（cueSrc 闸门）', () => {
        const i = PAGE.indexOf('const onPartial = (summary: string): void => {');
        expect(PAGE.slice(i, i + 200)).toContain('if (this.cueSrc !== key) return;');
    });

    it('落点类名是 rl-epp-cueai-live', () => {
        expect(PAGE).toContain("cls: 'rl-epp-cueai-live'");
    });

    it('🔴 加载态不借核心 `is-loading`（会画出一条横向蓝条）', () => {
        /**
         * 真机截图（`_shot/rd/cue-stream.png`，2026-11-12）里流式文字上方多出一条横向蓝线。
         * 根因不是我们的 CSS —— 是 **Obsidian 核心** app.css:4282-4291：
         *   `.is-loading::before { content:' '; position:absolute; top:0; height:3px;
         *                          background-color: var(--interactive-accent);
         *                          animation: 1000ms ease-in-out 300ms infinite progress-bar; }`
         * 我们的 `.rl-epp-cueai-body` 加载态挂了 `is-loading` 就直接白捡这条进度条。
         * ⇒ 必须用自有命名空间 `is-cueai-wait`，⛔ 别再借核心类名。
         */
        const i = PAGE.indexOf('if (this.cueAiLoading) {');
        expect(i).toBeGreaterThan(-1);
        const seg = PAGE.slice(i, i + 1200);
        expect(seg).toContain("body.addClass('is-cueai-wait');");
        expect(seg).not.toContain("body.addClass('is-loading')");
    });
});

describe('⑤ 样式：流式行不撑坏布局 + 尊重减少动效', () => {
    it('is-streaming 改成块级（否则长文本往右挤出横向滚动条）', () => {
        expect(CSS).toMatch(/\.rl-epp-cueai-loading\.is-streaming\s*\{[^}]*display:\s*block/);
    });

    it('.rl-epp-cueai-live 可换行 + 预留光标', () => {
        const i = CSS.indexOf('.rl-epp-cueai-live {');
        expect(i).toBeGreaterThan(-1);
        const seg = CSS.slice(i, i + 900);
        expect(seg).toContain('overflow-wrap: anywhere');
        expect(seg).toContain('white-space: pre-wrap');
        /**
         * 🔴 必须 `display: inline`，⛔ 不是 block。
         *    真机截图（`_shot/rd/cue-stream.png`，2026-11-12）暴露块级两个视觉缺陷：
         *    ① 独占一行 ⇒ 转圈菊花孤零零在上一行、正文另起一行，像加载失败；
         *    ② 横向填满容器 ⇒ `border-right` 光标贴在**容器右缘**而不是字尾。
         *    换行由 `overflow-wrap` 负责，不需要 block。
         */
        expect(seg).toMatch(/display:\s*inline\s*;/);
        expect(seg).not.toMatch(/display:\s*block\s*;/);
    });

    it('prefers-reduced-motion 下不闪光标', () => {
        expect(CSS).toContain('prefers-reduced-motion: reduce');
        /**
         * ⚠️ 定位方式：先找 `.rl-epp-cueai-live` 规则，再从它**往后**找紧邻的那个
         *    减少动效块。本仓 styles.css 里有 10 个 `@media (prefers-reduced-motion)`，
         *    用 `indexOf` 会命中最早的、用 `lastIndexOf` 会命中最后的，
         *    两种都会稳定误报 —— 只有「相对本规则的位置」才唯一。
         */
        const live = CSS.indexOf('.rl-epp-cueai-live {');
        expect(live).toBeGreaterThan(-1);
        const at = CSS.indexOf('@media (prefers-reduced-motion: reduce)', live);
        expect(at).toBeGreaterThan(live);
        // 中间不能夹着别的规则块结束（否则说明这个媒体查询已经属于后面别的组件）
        expect(CSS.slice(live, at)).toContain('@keyframes rl-cueai-caret');
        expect(CSS.slice(at, at + 400)).toContain('.rl-epp-cueai-live');
    });
});
