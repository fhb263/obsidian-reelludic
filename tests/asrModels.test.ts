import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
    ASR_DOWNLOAD_TMP_SUFFIX,
    ASR_MODEL_BASE,
    ASR_MODEL_MIRROR_BASE,
    ASR_MODEL_PRESETS,
    ASR_MODEL_SITE,
    ASR_MODEL_SITE_MIRROR,
    downloadLooksComplete,
    downloadPercent,
    formatBytes,
    joinDir,
    manualDownloadTip,
    presetByFileName,
    presetOf,
    presetSizeLabel,
    tmpPathFor,
} from 'pure/asrModels';

describe('ASR_MODEL_PRESETS', () => {
    it('六档齐全且档位唯一', () => {
        expect(ASR_MODEL_PRESETS).toHaveLength(6);
        const tiers = ASR_MODEL_PRESETS.map((p) => p.tier);
        expect(new Set(tiers).size).toBe(6);
        expect([...tiers].sort()).toEqual(['base', 'large-v3', 'medium', 'small', 'tiny', 'turbo']);
    });

    it('顺序必须是体积从小到大（用户 m09123：「按小从大列出来」）', () => {
        const sizes = ASR_MODEL_PRESETS.map((p) => p.bytes);
        expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
    });

    it('推荐档只有 base 一个（中间那档，用户第一眼看到的不是最小也不是最大）', () => {
        expect(ASR_MODEL_PRESETS.filter((p) => p.recommended)).toHaveLength(1);
        expect(ASR_MODEL_PRESETS.find((p) => p.recommended)?.tier).toBe('base');
    });

    it('体积写死值被钉住（改了必须同步实测）', () => {
        const byTier = Object.fromEntries(ASR_MODEL_PRESETS.map((p) => [p.tier, p.bytes]));
        expect(byTier.tiny).toBe(77691713);
        expect(byTier.base).toBe(147951465);
        expect(byTier.small).toBe(487601967);
        expect(byTier.medium).toBe(1533763059);
        // 用户需求文档「12 档模型表」写 1.6GB，实测 1624555275（curl -sIL 经 hf-mirror）
        expect(byTier.turbo).toBe(1624555275);
        expect(byTier['large-v3']).toBe(3095033483);
    });

    it('地址都在官方基址下且以文件名结尾', () => {
        for (const p of ASR_MODEL_PRESETS) {
            expect(p.url.startsWith(ASR_MODEL_BASE)).toBe(true);
            expect(p.url.endsWith(`/${p.fileName}`)).toBe(true);
            expect(p.fileName.endsWith('.bin')).toBe(true);
        }
    });

    it('主标题必须是上游原始档位名（用户 m09123：⛔ 不自造「极速版」这类名字）', () => {
        for (const p of ASR_MODEL_PRESETS) {
            expect(p.title).toBe(p.tier);
            // 🔴 turbo 是唯一例外：上游文件就叫 `ggml-large-v3-turbo.bin`（⛔ 不是 ggml-turbo.bin）。
            //    文件名与 tier 不一致是上游的事实，`presetByFileName` 按 fileName 精确比对，
            //    所以这里必须允许这个特例 —— 否则用户手填该路径会被认成「自定义模型」。
            const expected = p.tier === 'turbo' ? 'ggml-large-v3-turbo.bin' : `ggml-${p.tier}.bin`;
            expect(p.fileName).toBe(expected);
        }
    });

    it('标题与场景都非空', () => {
        for (const p of ASR_MODEL_PRESETS) {
            expect(p.title.trim().length).toBeGreaterThan(0);
            expect(p.scene.trim().length).toBeGreaterThan(0);
            expect(p.subtitle.trim().length).toBeGreaterThan(0);
        }
    });
});

describe('presetOf', () => {
    it('按档位取到', () => {
        expect(presetOf('base')?.fileName).toBe('ggml-base.bin');
        expect(presetOf('large-v3')?.bytes).toBe(3095033483);
    });

    it('非法档位返回 null（⛔ 不抛）', () => {
        expect(presetOf('huge')).toBeNull();
        expect(presetOf('')).toBeNull();
    });
});

describe('formatBytes', () => {
    it('小于 1KB 用 B', () => {
        expect(formatBytes(512)).toBe('512B');
    });

    it('小于 1MB 用 KB', () => {
        expect(formatBytes(2048)).toBe('2KB');
    });

    it('两位数 MB 保留一位小数', () => {
        expect(formatBytes(77691713)).toBe('74.1MB');
    });

    it('三位数 MB 不要小数', () => {
        expect(formatBytes(487601967)).toBe('465MB');
    });

    it('非法值给「未知」（⛔ 不显示 NaN）', () => {
        expect(formatBytes(Number.NaN)).toBe('未知');
        expect(formatBytes(-1)).toBe('未知');
    });

    it('presetSizeLabel 走同一套', () => {
        // 索引 1 现在是 base（141MB）—— 五档按体积从小到大排，tiny 在索引 0
        expect(presetSizeLabel(ASR_MODEL_PRESETS[1])).toBe('141MB');
        expect(presetSizeLabel(ASR_MODEL_PRESETS[0])).toBe('74.1MB');
    });
});

describe('downloadPercent', () => {
    it('正常换算取整', () => {
        expect(downloadPercent(50, 200)).toBe(25);
    });

    it('总长为 0 返回 null（⛔ 不画停在 0% 的条）', () => {
        expect(downloadPercent(10, 0)).toBeNull();
        expect(downloadPercent(10, -5)).toBeNull();
    });

    it('非有限数返回 null', () => {
        expect(downloadPercent(Number.NaN, 100)).toBeNull();
        expect(downloadPercent(10, Number.NaN)).toBeNull();
    });

    it('夹在 0..100', () => {
        expect(downloadPercent(999, 100)).toBe(100);
        expect(downloadPercent(-5, 100)).toBe(0);
    });
});

describe('downloadLooksComplete', () => {
    it('完全相等为真', () => {
        expect(downloadLooksComplete(1000, 1000)).toBe(true);
    });

    it('差几 KB 也算完整（镜像追加尾部字节）', () => {
        // 用大文件表达「几千字节的相对偏差」：2% 容差在 465MB 上是 9.7MB
        const total = 487601967;
        expect(downloadLooksComplete(total + 4096, total)).toBe(true);
    });

    it('差几十个百分点为假（真断流）', () => {
        expect(downloadLooksComplete(500, 1000)).toBe(false);
    });

    it('零字节为假', () => {
        expect(downloadLooksComplete(0, 1000)).toBe(false);
    });

    it('期望值非法为假', () => {
        expect(downloadLooksComplete(100, 0)).toBe(false);
        expect(downloadLooksComplete(100, Number.NaN)).toBe(false);
    });

    it('大文件按 2% 容差（465MB 允许约 9.7MB 偏差）', () => {
        const total = 487601967;
        expect(downloadLooksComplete(total - 9_000_000, total)).toBe(true);
        expect(downloadLooksComplete(total - 20_000_000, total)).toBe(false);
    });
});

describe('joinDir / tmpPathFor', () => {
    it('反斜杠目录用反斜杠拼', () => {
        expect(joinDir('C:\\models', 'a.bin')).toBe('C:\\models\\a.bin');
    });

    it('正斜杠目录用正斜杠拼', () => {
        expect(joinDir('/home/u/models', 'a.bin')).toBe('/home/u/models/a.bin');
    });

    it('尾部有分隔符不双写', () => {
        expect(joinDir('C:\\models\\', 'a.bin')).toBe('C:\\models\\a.bin');
    });

    it('空目录只返回文件名', () => {
        expect(joinDir('', 'a.bin')).toBe('a.bin');
    });

    it('临时路径带 .part 后缀', () => {
        expect(tmpPathFor('/x/a.bin')).toBe(`/x/a.bin${ASR_DOWNLOAD_TMP_SUFFIX}`);
        expect(ASR_DOWNLOAD_TMP_SUFFIX).toBe('.part');
    });
});

describe('presetByFileName', () => {
    it('三档都能从文件名认出来', () => {
        for (const p of ASR_MODEL_PRESETS) {
            expect(presetByFileName(p.fileName)).toBe(p);
        }
    });

    it('认 Windows 反斜杠路径', () => {
        const p = ASR_MODEL_PRESETS[0];
        expect(presetByFileName(`C:\\Users\\k\\models\\${p.fileName}`)).toBe(p);
    });

    it('认 POSIX 正斜杠路径', () => {
        const p = ASR_MODEL_PRESETS[0];
        expect(presetByFileName(`/home/k/models/${p.fileName}`)).toBe(p);
    });

    it('大小写不敏感', () => {
        const p = ASR_MODEL_PRESETS[0];
        expect(presetByFileName(`/x/${p.fileName.toUpperCase()}`)).toBe(p);
    });

    it('空串 / 纯空白 / 只有目录返回 null', () => {
        expect(presetByFileName('')).toBeNull();
        expect(presetByFileName('   ')).toBeNull();
        expect(presetByFileName('C:\\models\\')).toBeNull();
    });

    it('不认非预设文件（用户自带的模型）', () => {
        // large-v3 从 m09123 起是合法档位，所以换一个真不存在的名字来验这条
        expect(presetByFileName('/x/ggml-custom.bin')).toBeNull();
        expect(presetByFileName('/x/ggml-base-en.bin')).toBeNull();
    });

    it('不做前缀匹配（base 不能被 base-en 之类误认）', () => {
        expect(presetByFileName('/x/ggml-base-en.bin')).toBeNull();
        expect(presetByFileName('/x/ggml-base-extra.bin')).toBeNull();
    });
});

// 🔴 2026-11-13 用户指令：「给语音转文字的模型页加下载模型官网路径，可让用户自己手动下载并配置对应的路径」。
describe('手动下载官网路径（2026-11-13 用户指令）', () => {
    it('官网路径指向**仓库页面**而不是单个文件直链（直链点开即下载、看不出是哪个仓库）', () => {
        expect(ASR_MODEL_SITE).toBe('https://huggingface.co/ggerganov/whisper.cpp/tree/main');
        // ⛔ 不能是 /resolve/ 直链
        expect(ASR_MODEL_SITE).not.toContain('/resolve/');
        expect(ASR_MODEL_SITE).not.toMatch(/\.bin$/);
    });

    it('镜像路径与官网同仓同路径（只换域名，能靠字符串替换得出）', () => {
        expect(ASR_MODEL_SITE_MIRROR).toBe('https://hf-mirror.com/ggerganov/whisper.cpp/tree/main');
        expect(ASR_MODEL_SITE_MIRROR.replace('https://hf-mirror.com', 'https://huggingface.co')).toBe(ASR_MODEL_SITE);
    });

    it('两条路径与下载基址同源（换仓库时三处一起改）', () => {
        for (const base of [ASR_MODEL_BASE, ASR_MODEL_MIRROR_BASE]) {
            const repo = base.replace(/\/(resolve|tree)\/main$/, '');
            expect(ASR_MODEL_SITE.startsWith(repo) || ASR_MODEL_SITE_MIRROR.startsWith(repo)).toBe(true);
        }
    });

    it('提示文案给全三件事：官网地址、具体文件名、下完怎么用上', () => {
        const tip = manualDownloadTip(ASR_MODEL_PRESETS[0]);
        expect(tip).toContain(ASR_MODEL_SITE);
        expect(tip).toContain(ASR_MODEL_SITE_MIRROR);
        expect(tip).toContain(ASR_MODEL_PRESETS[0].fileName);
        expect(tip).toContain(presetSizeLabel(ASR_MODEL_PRESETS[0]));
        expect(tip).toContain('选择本地模型文件');
        // 国内直连官网不通这件事必须写出来，否则用户点开白屏就以为是插件坏了
        expect(tip).toContain('镜像');
    });

    it('不给 preset 时也能用：不点名某一档，但两个地址与用法仍在', () => {
        const tip = manualDownloadTip();
        expect(tip).toContain(ASR_MODEL_SITE);
        expect(tip).toContain(ASR_MODEL_SITE_MIRROR);
        expect(tip).toContain('.bin');
        expect(tip).toContain('选择本地模型文件');
    });

    it('每档的文件名都能在提示里被点名（逐档都要能照着下）', () => {
        for (const p of ASR_MODEL_PRESETS) {
            expect(manualDownloadTip(p)).toContain(p.fileName);
        }
    });
});

// 🔴 接线守卫：光有常量和文案不够，得确认「模型页真的画出来了」「宿主真的接上了跳转」。
//    本仓历史上栽过「函数加了没人调」—— 这类 bug 编译不报、跑测试看不见，只能靠文本守卫。
describe('官网路径接线（2026-11-13 用户指令）', () => {
    const ROOT = resolve(__dirname, '..');
    const read = (rel: string): string => readFileSync(resolve(ROOT, rel), 'utf8');

    it('模型页渲染了手动下载区，且网址不是只藏在按钮里', () => {
        const src = read('src/modals/AsrEngineModal.ts');
        expect(src).toContain('renderManualDownload');
        expect(src).toContain('this.renderManualDownload(contentEl)');
        expect(src).toContain('rl-asr-manual');
        // 网址原样显示（可选中复制），⛔ 不是只做成「打开」按钮
        expect(src).toContain('rl-asr-manual-url');
        expect(src).toContain('text: r.url');
        // 两个入口都给：官网 + 国内镜像
        expect(src).toContain('ASR_MODEL_SITE');
        expect(src).toContain('ASR_MODEL_SITE_MIRROR');
        // 逐档列出文件名与体积
        expect(src).toContain('manualDownloadTip');
    });

    it('宿主把 onOpenExternal 接到 openExternalUrl（⛔ 不让弹窗自己 window.open）', () => {
        const mainSrc = read('main.ts');
        const at = mainSrc.indexOf('new AsrEngineModal(');
        expect(at).toBeGreaterThan(0);
        const body = mainSrc.slice(at, at + 1800);
        expect(body).toContain('onOpenExternal: (url) => this.openExternalUrl(url)');
    });

    it('弹窗侧对 onOpenExternal 缺失有兜底（宿主没接也不至于点了没反应）', () => {
        const src = read('src/modals/AsrEngineModal.ts');
        expect(src).toMatch(/opts\.onOpenExternal[\s\S]{0,120}else window\.open/);
    });
});

// 🔴 2026-11-14 用户 m03072 ⑥（逐字）：「给语音转文字的模型页加下载模型官网路径，
//    （可让用户自己手动下载并配置对应的路径）区分一键下载和用户手动点链接下载并配置」。
//    关键在「区分」两个字 —— 旧版把手动下载塞在卡片上方、没有方式名，「选择本地模型文件…」
//    还藏在「展开高级配置」折叠项里，用户根本看不出这是两条并列的路。
describe('两种下载方式必须分开（2026-11-14 用户 m03072 ⑥）', () => {
    const ROOT = resolve(__dirname, '..');
    const read = (rel: string): string => readFileSync(resolve(ROOT, rel), 'utf8');
    const modalSrc = read('src/modals/AsrEngineModal.ts');

    it('两段都有方式名：「方式一：一键下载」「方式二：自己下载后指定本地文件」', () => {
        expect(modalSrc).toContain('方式一：一键下载并启用');
        expect(modalSrc).toContain('方式二：自己下载后指定本地文件');
        expect(modalSrc).toContain('rl-asr-way');
    });

    it('方式一（卡片）在方式二（手动下载区）之前 —— 顺序就是推荐顺序', () => {
        const way1 = modalSrc.indexOf('方式一：一键下载并启用');
        const cards = modalSrc.indexOf('for (const p of ASR_MODEL_PRESETS) this.renderCard(contentEl, p);');
        const way2 = modalSrc.indexOf('方式二：自己下载后指定本地文件');
        expect(way1).toBeGreaterThan(-1);
        expect(cards).toBeGreaterThan(way1);
        expect(way2).toBeGreaterThan(cards);
    });

    it('🔴「选择本地模型文件…」必须在方式二区块内，⛔ 不再只藏在「展开高级配置」里', () => {
        // 手动下载区自己带配置按钮（用户下完文件正好接着点，零跳转）
        expect(modalSrc).toContain('rl-asr-manual-ops');
        const opsAt = modalSrc.indexOf("cls: 'rl-asr-manual-ops'");
        expect(opsAt).toBeGreaterThan(-1);
        const near = modalSrc.slice(opsAt, opsAt + 400);
        expect(near).toContain('选择本地模型文件…');
        // 全文件只允许**一处**配置按钮的创建点：两处 = 用户以为有两个不同功能
        // （⛔ 按「文字出现次数」判会把我自己 JSDoc 里提到的按钮名也算进去 —— 假红过一次）
        const pickBtns = modalSrc.split(`createEl('button', { cls: 'mod-cta', text: '选择本地模型文件…' })`).length - 1;
        expect(pickBtns).toBe(1);
    });

    it('提示文案指向「上面的」按钮，而不是已搬走的折叠项', () => {
        const tip = manualDownloadTip();
        expect(tip).toContain('选择本地模型文件');
        expect(tip).not.toContain('展开高级配置');
    });
});
