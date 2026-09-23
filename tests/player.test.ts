import { describe, it, expect } from 'vitest';
import {
    formatTime,
    clampSeek,
    ratioToSeconds,
    secondsToRatio,
    SPEED_STEPS,
    formatSpeed,
    clampVolume,
    resolveKeyAction,
    shouldResume,
    nextEpisodeText,
    hoverTipText,
    episodeLabel,
    SEEK_STEP,
    SEEK_STEP_LARGE,
} from 'pure/player';

describe('formatTime', () => {
    it('不足一小时用 m:ss', () => {
        expect(formatTime(0)).toBe('0:00');
        expect(formatTime(5)).toBe('0:05');
        expect(formatTime(65)).toBe('1:05');
        expect(formatTime(3599)).toBe('59:59');
    });
    it('满一小时用 h:mm:ss', () => {
        expect(formatTime(3600)).toBe('1:00:00');
        expect(formatTime(3725)).toBe('1:02:05');
    });
    it('小数向下取整（不因浮点多一秒）', () => {
        expect(formatTime(59.99)).toBe('0:59');
    });
    it('非法/负数/NaN 归 0:00', () => {
        expect(formatTime(NaN)).toBe('0:00');
        expect(formatTime(-3)).toBe('0:00');
        expect(formatTime(Infinity)).toBe('0:00');
    });
});

describe('clampSeek', () => {
    it('夹在 0..duration 内', () => {
        expect(clampSeek(-5, 100)).toBe(0);
        expect(clampSeek(150, 100)).toBe(100);
        expect(clampSeek(30, 100)).toBe(30);
    });
    it('duration 未知（0/NaN）时只做下界保护', () => {
        expect(clampSeek(30, 0)).toBe(30);
        expect(clampSeek(-1, NaN)).toBe(0);
    });
});

describe('进度与时间换算', () => {
    it('ratioToSeconds 双向可逆', () => {
        expect(ratioToSeconds(0.5, 200)).toBe(100);
        expect(secondsToRatio(100, 200)).toBe(0.5);
    });
    it('越界比例被夹紧', () => {
        expect(ratioToSeconds(-1, 200)).toBe(0);
        expect(ratioToSeconds(2, 200)).toBe(200);
        expect(secondsToRatio(500, 200)).toBe(1);
    });
    it('duration 未知时不产生 NaN（返回 0）', () => {
        expect(ratioToSeconds(0.5, 0)).toBe(0);
        expect(secondsToRatio(10, 0)).toBe(0);
    });
});

describe('倍速', () => {
    it('档位表固定', () => {
        expect(SPEED_STEPS).toEqual([0.5, 0.75, 1, 1.25, 1.5, 2]);
    });
    // 「点击循环」（cycleSpeed）口径已于 2026-09-18 撤销：倍速改由浮层面板选档（见 tests/playerMenu.test.ts），
    // 该函数随之从 pure/player 删除 —— 项目惯例不留死代码。
    it('文案保留合理小数位', () => {
        expect(formatSpeed(1)).toBe('1×');
        expect(formatSpeed(1.25)).toBe('1.25×');
        expect(formatSpeed(0.5)).toBe('0.5×');
        expect(formatSpeed(1.75)).toBe('1.75×');
    });
});

describe('音量', () => {
    it('夹在 0..1', () => {
        expect(clampVolume(-0.2)).toBe(0);
        expect(clampVolume(1.4)).toBe(1);
        expect(clampVolume(0.35)).toBe(0.35);
    });
    it('NaN 归 0', () => {
        expect(clampVolume(NaN)).toBe(0);
    });
});

describe('resolveKeyAction（快捷键映射）', () => {
    it('空格切换播放', () => {
        expect(resolveKeyAction(' ', false)).toBe('toggle');
        expect(resolveKeyAction('Space', false)).toBe('toggle');
    });
    it('左右方向键 5 秒，Shift 加速到 30 秒', () => {
        expect(resolveKeyAction('ArrowLeft', false)).toBe('seek:-5');
        expect(resolveKeyAction('ArrowRight', false)).toBe('seek:5');
        expect(resolveKeyAction('ArrowLeft', true)).toBe('seek:-30');
        expect(resolveKeyAction('ArrowRight', true)).toBe('seek:30');
    });
    it('上下方向键调音量、M 静音、F 全屏', () => {
        expect(resolveKeyAction('ArrowUp', false)).toBe('volume:up');
        expect(resolveKeyAction('ArrowDown', false)).toBe('volume:down');
        expect(resolveKeyAction('m', false)).toBe('mute');
        expect(resolveKeyAction('M', false)).toBe('mute');
        expect(resolveKeyAction('f', false)).toBe('fullscreen');
    });
    // #326：时间戳 / 截图用**裸字母**（与 m / f 同款「无修饰键」风格 → 不会与 Obsidian 热键冲突）
    it('T 插入时间戳、S 截取当前帧（裸字母，大小写都认）', () => {
        expect(resolveKeyAction('t', false)).toBe('stamp');
        expect(resolveKeyAction('T', false)).toBe('stamp');
        expect(resolveKeyAction('s', false)).toBe('shot');
        expect(resolveKeyAction('S', false)).toBe('shot');
    });
    it('未映射按键返回 null（交回宿主）', () => {
        expect(resolveKeyAction('a', false)).toBeNull();
        expect(resolveKeyAction('Escape', false)).toBeNull();
        expect(resolveKeyAction('Enter', false)).toBeNull();
    });
    it('步长常量与映射一致', () => {
        expect(SEEK_STEP).toBe(5);
        expect(SEEK_STEP_LARGE).toBe(30);
    });
});

describe('shouldResume（是否续播上次位置）', () => {
    it('太靠前（<5s）不续播', () => {
        expect(shouldResume(3, 600)).toBe(false);
    });
    it('太靠后（距结尾 <10s）不续播，避免一开就播完', () => {
        expect(shouldResume(595, 600)).toBe(false);
    });
    it('中段续播', () => {
        expect(shouldResume(120, 600)).toBe(true);
    });
    it('时长未知时不续播', () => {
        expect(shouldResume(120, 0)).toBe(false);
        expect(shouldResume(120, NaN)).toBe(false);
        expect(shouldResume(NaN, 600)).toBe(false);
    });
});

describe('nextEpisodeText', () => {
    it('倒计时文案', () => {
        expect(nextEpisodeText(5)).toBe('5 秒后播放下一集');
        expect(nextEpisodeText(0)).toBe('即将播放下一集');
        expect(nextEpisodeText(-2)).toBe('即将播放下一集');
    });
});

describe('hoverTipText（进度条悬停预览文案）', () => {
    it('格式为「落点 / 总长」（用户 2026-09-18 要求带总时长）', () => {
        expect(hoverTipText(3, 52)).toBe('0:03 / 0:52');
        expect(hoverTipText(0, 0)).toBe('0:00 / 0:00');
    });
    it('满一小时走 h:mm:ss（与进度数字同口径）', () => {
        expect(hoverTipText(3725, 7200)).toBe('1:02:05 / 2:00:00');
    });
    it('非法值不产生 NaN（时长未知时落 0:00）', () => {
        expect(hoverTipText(Number.NaN, Number.NaN)).toBe('0:00 / 0:00');
        expect(hoverTipText(-5, -1)).toBe('0:00 / 0:00');
    });
});

describe('episodeLabel（集标签：顶栏标题与选集浮层共用）', () => {
    it('剧集：集号 1 基 + 可选集标题', () => {
        expect(episodeLabel({ index: 0, title: '第一话' }, false)).toBe('第 1 集 · 第一话');
        expect(episodeLabel({ index: 2 }, false)).toBe('第 3 集');
    });
    it('电影 / 单文件不出现「第 N 集」', () => {
        expect(episodeLabel({ index: 0, title: '片名' }, true)).toBe('片名');
        expect(episodeLabel({ index: 0 }, true)).toBe('');
    });
    it('集标题为空串时不留下悬空的「· 」', () => {
        expect(episodeLabel({ index: 0, title: '' }, false)).toBe('第 1 集');
    });
});
