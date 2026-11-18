import { describe, expect, it } from 'vitest';
import {
    BALL_IDLE_ARC,
    actionLabel,
    arcRatio,
    ballTitle,
    ballText,
    ballTip,
    barPercent,
    clampPercent,
    endTip,
    nextMode,
    shortLabel,
} from 'pure/progressBall';

describe('clampPercent', () => {
    it('正常值取整并夹到 0..100', () => {
        expect(clampPercent(0)).toBe(0);
        expect(clampPercent(50.4)).toBe(50);
        expect(clampPercent(50.6)).toBe(51);
        expect(clampPercent(100)).toBe(100);
        expect(clampPercent(-5)).toBe(0);
        expect(clampPercent(180)).toBe(100);
    });

    it('缺值 / 非有限数返回 null，⛔ 不是 0（0% 是「真的一点没做」的假结论）', () => {
        expect(clampPercent(null)).toBeNull();
        expect(clampPercent(undefined)).toBeNull();
        expect(clampPercent(Number.NaN)).toBeNull();
        expect(clampPercent(Number.POSITIVE_INFINITY)).toBeNull();
    });
});

describe('ballText', () => {
    it('有百分比给「N%」', () => {
        expect(ballText(0)).toBe('0%');
        expect(ballText(42)).toBe('42%');
        expect(ballText(100)).toBe('100%');
    });

    it('无百分比给省略号，不伪造 0%', () => {
        expect(ballText(null)).toBe('…');
    });
});

describe('ballTip', () => {
    it('阶段 + 细节 + 百分比三段用 · 串起来', () => {
        expect(ballTip({ label: '正在本地识别', percent: 40, detail: '1:20 / 5:00' }))
            .toBe('正在本地识别 · 1:20 / 5:00 · 40%');
    });

    it('无百分比时说「进行中」', () => {
        expect(ballTip({ label: '正在提取音频', percent: null })).toBe('正在提取音频 · 进行中');
    });

    it('缺 label / detail 时不留空段与多余分隔符', () => {
        expect(ballTip({ label: '', percent: 30 })).toBe('30%');
        expect(ballTip({ label: '下载中', percent: 30, detail: '' })).toBe('下载中 · 30%');
    });
});

describe('shortLabel', () => {
    it('短文案原样返回', () => {
        expect(shortLabel('正在识别')).toBe('正在识别');
        expect(shortLabel('')).toBe('');
        expect(shortLabel('   ')).toBe('');
    });

    it('超长按码点截断并加省略号', () => {
        const out = shortLabel('正在本地识别这段很长的阶段说明文字');
        expect(out.endsWith('…')).toBe(true);
        expect(Array.from(out).length).toBe(15); // 14 个字 + 省略号
    });

    it('自定义上限生效', () => {
        expect(shortLabel('abcdefghij', 3)).toBe('abc…');
    });

    it('截断不会把代理对劈成半个字符', () => {
        const text = '🎬🎵😀🎧🎼🎹🎺🎻🥁📻📼📽️🎞️📺';
        const out = shortLabel(text, 4);
        // 4 个码点 + 省略号
        expect(Array.from(out).length).toBe(5);
        expect(out.startsWith('🎬🎵😀🎧')).toBe(true);
    });
});

describe('endTip', () => {
    it('完成 / 失败各自带不带消息两种情况', () => {
        expect(endTip('done')).toBe('完成');
        expect(endTip('done', '字幕已保存')).toBe('完成：字幕已保存');
        expect(endTip('fail')).toBe('失败');
        expect(endTip('fail', '引擎未配置')).toBe('失败：引擎未配置');
    });
});

describe('arcRatio', () => {
    it('有百分比时按比例走弧', () => {
        expect(arcRatio(0)).toBe(0);
        expect(arcRatio(50)).toBeCloseTo(0.5, 10);
        expect(arcRatio(100)).toBe(1);
    });

    it('无百分比时留一小段固定弧（否则球看起来是空的，像没启动）', () => {
        expect(arcRatio(null)).toBe(BALL_IDLE_ARC);
        expect(BALL_IDLE_ARC).toBeGreaterThan(0);
        expect(BALL_IDLE_ARC).toBeLessThan(0.5);
    });

    it('百分比计越界时走夹取后的值', () => {
        expect(arcRatio(-10)).toBe(0);
        expect(arcRatio(999)).toBe(1);
    });
});

describe('nextMode（m10634：点击不再是销毁）', () => {
    it('任务在跑时，点一下在卡片与小球之间来回切', () => {
        expect(nextMode('card', false)).toBe('pill');
        expect(nextMode('pill', false)).toBe('card');
    });

    it('收尾态返回 null —— 那时点一下才等于关掉', () => {
        expect(nextMode('card', true)).toBeNull();
        expect(nextMode('pill', true)).toBeNull();
    });
});

describe('actionLabel', () => {
    it('收起按钮必须写明「任务继续」，否则用户以为点掉就中止了', () => {
        expect(actionLabel('minimize')).toContain('任务继续');
        expect(actionLabel('expand')).toContain('展开');
        expect(actionLabel('cancel')).toBe('取消');
    });

    it('三种动作文案互不相同（别让两个按钮长得一样）', () => {
        const all = [actionLabel('minimize'), actionLabel('expand'), actionLabel('cancel')];
        expect(new Set(all).size).toBe(3);
    });
});

describe('ballTitle', () => {
    it('只给「在做什么」，⛔ 不重复百分比（卡片右下角已经有百分比位）', () => {
        // 🔴 真渲染量测抓到过：标题里也拼百分比 ⇒ 同一张卡上 42% 出现两次，还把标题挤到截断
        expect(ballTitle('正在下载模型')).toBe('正在下载模型');
        expect(ballTitle('正在下载模型')).not.toContain('%');
    });

    it('没有阶段文案时给「进行中」，⛔ 不给空串（空标题会让卡片头部塌成一条线）', () => {
        expect(ballTitle('')).toBe('进行中');
        expect(ballTitle('   ')).toBe('进行中');
    });
});

describe('barPercent', () => {
    it('有百分比走夹取后的整数', () => {
        expect(barPercent(0)).toBe(0);
        expect(barPercent(42.6)).toBe(43);
        expect(barPercent(180)).toBe(100);
    });

    it('无百分比返回 null（渲染层据此走不确定态），⛔ 不返回 0 让条看起来停住', () => {
        expect(barPercent(null)).toBeNull();
        expect(barPercent(Number.NaN)).toBeNull();
    });
});

describe('球心百分比（用户 m07854 ⑨「球内显示百分比波动」）', () => {
    const fs = require('node:fs') as { readFileSync: (p: string, e: string) => string };
    const path = require('node:path') as { resolve: (a: string, b: string) => string };
    const ROOT = path.resolve(__dirname, '..');
    const read = (rel: string): string => fs.readFileSync(path.resolve(ROOT, rel), 'utf8');
    /** 去掉注释再匹配（本仓铁律：#379 / #730 / #731 三次被自己的注释打穿） */
    const strip = (src: string): string => src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');

    const ball = strip(read('src/services/progressBall.ts'));

    it('球心节点建在环里，且排在 svg 之后（svg 是 absolute，文字才吃得到居中格）', () => {
        expect(ball).toMatch(/this\.ringPctEl = ring\.createSpan\(\{ cls: 'rl-pball-ringpct' \}\);/);
        const atSvg = ball.indexOf('ring.appendChild(svg);');
        const atPct = ball.indexOf("this.ringPctEl = ring.createSpan");
        expect(atSvg).toBeGreaterThan(-1);
        expect(atPct).toBeGreaterThan(atSvg);
    });

    it('球心文案与卡片同口径（⛔ 别自己再算一遍，两处不一致比不显示更糟）', () => {
        // paint() 里紧挨着 txtEl 的那句，字面量必须一致
        expect(ball).toMatch(/this\.txtEl\.setText\(pct === null \? '…' : `\$\{pct\}%`\);/);
        expect(ball).toMatch(/this\.ringPctEl\.setText\(pct === null \? '…' : `\$\{pct\}%`\);/);
    });

    it('收尾时球心跟着换成 ✓ / !（⛔ 别留着 87% 这种中途数字）', () => {
        expect(ball).toMatch(/this\.ringPctEl\.setText\(kind === 'done' \? '✓' : '!'\);/);
    });

    it('销毁时把球心指针置空（防悬空引用）', () => {
        expect(ball).toMatch(/this\.ringPctEl = null;/);
    });

    it('样式：环内可用直径约 30px，字号必须压小且用等宽数字防抖', () => {
        const css = strip(read('styles.css'));
        const m = /\.rl-pball-ringpct \{[^}]*\}/.exec(css);
        expect(m).toBeTruthy();
        const rule = m ? m[0] : '';
        expect(rule).toMatch(/font-size:\s*var\(--font-ui-smallest/);
        expect(rule).toMatch(/font-variant-numeric:\s*tabular-nums;/);
        expect(rule).toMatch(/white-space:\s*nowrap;/);
        expect(rule).toMatch(/pointer-events:\s*none;/);
        // ⛔ 不许写死颜色（主题切换会失配）
        expect(rule).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    });
});
