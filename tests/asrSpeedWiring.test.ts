import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 🔴 用户 m10754 原文：「语音转文字的下载模型的进度浮球有没有同样的逻辑，如标 1MB/s 速度
 *    和多线下载，还有我没看到官网链接在哪里可点击跳转下载并关联各自框啊」。
 *
 * 三个问题分别对应三件必须钉住的事实：
 *  ⑴ 速度：要真的从 `received` 喂进速率计再拼回 label —— 只加一个 `speed` 变量不接线等于没做；
 *  ② 多线下载：`asrModelDownload` 的分片并发**本来就有**，这里守它不许被顺手删掉；
 *  ③ 官网链接：必须画在**用户看得见的**安装弹窗里（原 `AsrEngineModal` 已无调用方）。
 *
 * ⚠️ 全部用源码守卫（本仓既有惯例）：跑一次真实 465MB 下载是不可能的，
 *    能钉住的是「有没有这条线」。
 */

const ROOT = resolve(__dirname, '..');
const read = (p: string): string => readFileSync(resolve(ROOT, p), 'utf8');

const whisper = read('src/services/whisperRuntime.ts');
const bundle = read('src/services/asrBundleInstall.ts');
const model = read('src/services/asrModelDownload.ts');
const mainSrc = read('main.ts');
const modal = read('src/modals/AsrInstallModal.ts');
const css = read('styles.css');

describe('🔴 m10754 ① 运行时安装（whisperRuntime）必须显示实时速度', () => {
    it('接了速率计，并用 speedSuffix 拼进 label', () => {
        expect(whisper).toContain("import { createSpeedMeter, speedSuffix } from 'pure/speedMeter';");
        expect(whisper).toContain('const meter = createSpeedMeter();');
        expect(whisper).toContain('const speed = meter.sample(received);');
        expect(whisper).toContain('`${installLabel(\'download\')}${speedSuffix(speed)}`');
    });

    it('换地址/重试前 reset（否则会把上一个连接的速度带过来）', () => {
        const seg = whisper.slice(whisper.indexOf('for (let i = 0; i < urls.length'), whisper.indexOf('if (cancelled) {'));
        expect(seg).toContain('meter.reset();');
        // reset 必须在下载之前（顺序反了等于没重置）
        expect(seg.indexOf('meter.reset();')).toBeLessThan(seg.indexOf('await deps.download('));
    });
});

describe('🔴 m10754 ① 整包安装（asrBundleInstall）必须显示实时速度', () => {
    it('接了速率计，每个文件前 reset', () => {
        expect(bundle).toContain("import { createSpeedMeter, speedSuffix } from 'pure/speedMeter';");
        expect(bundle).toContain('const meter = createSpeedMeter();');
        expect(bundle).toContain('meter.reset();');
        expect(bundle).toContain('const speed = meter.sample(received);');
        expect(bundle).toContain('${speedSuffix(speed)}');
    });

    it('reset 在 deps.download 之前（跨文件不串味）', () => {
        const i = bundle.indexOf('const speed = meter.sample(received);');
        const stepStart = bundle.lastIndexOf('meter.reset();', i);
        expect(stepStart).toBeGreaterThan(-1);
        expect(stepStart).toBeLessThan(i);
    });
});

describe('🔴 m10754 ① 模型下载（main.runWhisperInstall）必须显示实时速度', () => {
    it('模型是 4MB~2952MB 的大头，回调要拿 received 换速度', () => {
        expect(mainSrc).toContain("import { createSpeedMeter, speedSuffix } from 'pure/speedMeter';");
        expect(mainSrc).toContain('const modelMeter = createSpeedMeter();');
        expect(mainSrc).toContain('const speed = modelMeter.sample(received);');
        expect(mainSrc).toContain('${speedSuffix(speed)}');
    });

    it('⛔ 不许退回「只有 pct、把 received 丢掉」的旧写法', () => {
        expect(mainSrc).not.toContain('(pct) => onStep(1, pct ?? 0, `正在下载 ${preset.title} 模型…`)');
    });
});

describe('🔴 m10754 ② 多线下载：分片并发不许被删', () => {
    it('asrModelDownload 仍走 planChunks / chunkedPercent', () => {
        expect(model).toContain("from 'pure/asrDownloadPlan'");
        expect(model).toContain('planChunks');
        expect(model).toContain('chunkedPercent');
    });
});

describe('🔴 m10754 ③ 官网 / 镜像链接必须画在现役安装弹窗里', () => {
    it('弹窗画了官网与国内镜像两个入口', () => {
        expect(modal).toContain("import { formatBytes, ASR_MODEL_SITE, ASR_MODEL_SITE_MIRROR } from 'pure/asrModels';");
        expect(modal).toContain('private renderManualLinks(host: HTMLElement): void {');
        expect(modal).toContain('this.renderManualLinks(contentEl);');
        expect(modal).toContain("{ label: '官网', url: ASR_MODEL_SITE },");
        expect(modal).toContain("{ label: '国内镜像', url: ASR_MODEL_SITE_MIRROR },");
        // 网址原样显示（可复制），⛔ 不做省略号截断
        expect(modal).toContain("cls: 'rl-asr-install-manual-url', text: it.url");
    });

    it('「打开」走宿主注入的外部跳转，⛔ 不在弹窗里裸 window.open', () => {
        expect(modal).toContain('onOpenExternal?: (url: string) => void;');
        expect(modal).toContain('if (cb) cb(it.url);');
        // window.open 只允许作为回调缺失时的兜底
        const m = /else window\.open\(it\.url, '_blank'\);/.test(modal);
        expect(m).toBe(true);
    });

    it('宿主把 onOpenExternal 接进弹窗（走统一出口 openExternalUrl）', () => {
        expect(mainSrc).toContain('onOpenExternal: (url: string) => this.openExternalUrl(url),');
    });

    it('样式齐（缺 .rl-asr-install-manual-url 的话网址会挤成一团）', () => {
        for (const cls of [
            '.rl-asr-install-manual {',
            '.rl-asr-install-manual-head {',
            '.rl-asr-install-manual-lead {',
            '.rl-asr-install-manual-row {',
            '.rl-asr-install-manual-tag {',
            '.rl-asr-install-manual-url {',
        ]) {
            expect(css).toContain(cls);
        }
    });
});
