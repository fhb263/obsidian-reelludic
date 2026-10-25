// 音频播放器：播放模式 / 队列推进 / 乱序 测试（2026-09-27 ④-3）。
//
// 为什么值得单测：这三组规则的失败形态**全都不报错、只难看**——
//   · 模式搞错 ⇒ 曲终后该停不停 / 该续不续（用户以为卡了）；
//   · 洗牌袋搞错 ⇒ 随机播放隔两首又回到同一首；
//   · 「上一首」在随机模式下取到当前这首 ⇒ 点了像没反应。
// 语义与 LyricFlux 对齐（`getNextSong` / `getPrevSong` / `handleSongEnded` / `buildShuffleQueue`），
// 三处显式偏差见 `src/pure/audioQueue.ts` 文件头。
import { describe, it, expect } from 'vitest';
import {
    AUDIO_PLAY_MODES,
    AUDIO_PLAY_MODE_LABELS,
    PLAYER_KINDS,
    cycleAudioPlayMode,
    normalizeAudioPlayMode,
    normalizeAudioQueue,
    buildShuffleBag,
    decideTrack,
    playersToPause,
    type AudioQueueInput,
} from 'pure/audioQueue';

/** 袋式随机源：按给定序列吐值，用完回卷（测试里一律用确定值，⛔ 不用 Math.random） */
function seq(values: number[]) {
    let i = 0;
    return () => values[i++ % values.length];
}

const base: AudioQueueInput = {
    paths: ['a', 'b', 'c'],
    current: 'a',
    mode: 'sequential',
    trigger: 'ended',
};

describe('normalizeAudioPlayMode（脏值回落 off，⛔ 不抛错）', () => {
    it('四种合法模式原样返回', () => {
        for (const m of AUDIO_PLAY_MODES) expect(normalizeAudioPlayMode(m)).toBe(m);
    });

    it('未知 / 空 / 非字符串一律回落 off（设置文件可能被手改）', () => {
        expect(normalizeAudioPlayMode('repeat')).toBe('off');
        expect(normalizeAudioPlayMode('')).toBe('off');
        expect(normalizeAudioPlayMode(undefined)).toBe('off');
        expect(normalizeAudioPlayMode(null)).toBe('off');
        expect(normalizeAudioPlayMode(3)).toBe('off');
        // 大小写不宽容：数值 / 大小写脏值都回落，⛔ 别偷偷 toLowerCase 归一
        expect(normalizeAudioPlayMode('Single')).toBe('off');
    });

    it('模式表与文案表一一对应（漏一个 ⇒ UI 上显示 undefined）', () => {
        for (const m of AUDIO_PLAY_MODES) expect(AUDIO_PLAY_MODE_LABELS[m]).toBeTruthy();
        expect(Object.keys(AUDIO_PLAY_MODE_LABELS).sort()).toEqual([...AUDIO_PLAY_MODES].sort());
    });
});

describe('cycleAudioPlayMode（点模式按钮循环）', () => {
    it('按模式表顺序走一圈回到起点', () => {
        let m = AUDIO_PLAY_MODES[0];
        const seen = [m];
        for (let i = 1; i < AUDIO_PLAY_MODES.length; i++) {
            m = cycleAudioPlayMode(m);
            seen.push(m);
        }
        expect(seen).toEqual([...AUDIO_PLAY_MODES]);
        expect(cycleAudioPlayMode(m)).toBe(AUDIO_PLAY_MODES[0]); // 末尾回卷
    });

    it('脏值进来也能安全起步（按 off 的下一项算）', () => {
        expect(cycleAudioPlayMode('nope' as never)).toBe('single');
    });
});

describe('normalizeAudioQueue（队列规范化）', () => {
    it('去空白 / 去空项 / 保序去重', () => {
        expect(normalizeAudioQueue([' a.mp3 ', '', 'b.mp3', 'a.mp3', '   ', 'c.mp3'])).toEqual([
            'a.mp3',
            'b.mp3',
            'c.mp3',
        ]);
    });

    it('🔴 ⛔ 不按扩展名过滤（用户有个 `.opus` / `.ape` 就整首不见 = 静默丢曲）', () => {
        expect(normalizeAudioQueue(['m/a.opus', 'm/b.ape', 'm/c.wma', 'm/d.mp3'])).toEqual([
            'm/a.opus',
            'm/b.ape',
            'm/c.wma',
            'm/d.mp3',
        ]);
    });

    it('undefined / null ⇒ 空队列（调用方不必自己判空）', () => {
        expect(normalizeAudioQueue(undefined)).toEqual([]);
        expect(normalizeAudioQueue(null)).toEqual([]);
    });
});

describe('buildShuffleBag（Fisher-Yates 洗牌袋）', () => {
    it('打乱的是副本，**不改入参**（就地打乱会把队列列表 UI 一起搞乱）', () => {
        const paths = ['a', 'b', 'c'];
        buildShuffleBag(paths, 'a', seq([0]));
        expect(paths).toEqual(['a', 'b', 'c']);
    });

    it('长度守恒、元素一个不少不多（是打乱不是丢）', () => {
        const out = buildShuffleBag(['a', 'b', 'c', 'd', 'e'], '', seq([0.3, 0.7, 0.1, 0.9]));
        expect(out).toHaveLength(5);
        expect([...out].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    });

    it('🔴 确定随机源 ⇒ 结果可复现，**且确实变了顺序**（防「没洗」与「洗成恒等」）', () => {
        // ⚠️ 这两个期望值是**挑过**的：必须能区分「洗过」与「根本没洗、只挪了袋首」。
        //    实测教训 —— 只钉 `rng=0` 那一组时，把 Fisher-Yates 循环整段删掉结果**恰好相同**
        //    （洗出来是 [b,c,a]、「没洗 + 袋首挪尾」也是 [b,c,a]）⇒ 突变抓不到 = 假绿。
        //    加 `rng=0.5` 这一组后两者分道扬镳（洗 ⇒ [c,b,a]，没洗 ⇒ [b,c,a]）。
        expect(buildShuffleBag(['a', 'b', 'c'], 'a', seq([0]))).toEqual(['b', 'c', 'a']);
        expect(buildShuffleBag(['a', 'b', 'c'], 'a', seq([0.5]))).toEqual(['c', 'b', 'a']);
        // 不给 exclude 时直接看打乱结果（恒等排列绝不该出现）
        expect(buildShuffleBag(['a', 'b', 'c'], '', seq([0]))).toEqual(['b', 'c', 'a']);
        expect(buildShuffleBag(['a', 'b', 'c'], '', seq([0.5]))).toEqual(['a', 'c', 'b']);
        // 可复现：同随机源两次结果一致
        expect(buildShuffleBag(['a', 'b', 'c'], '', seq([0.3, 0.7]))).toEqual(
            buildShuffleBag(['a', 'b', 'c'], '', seq([0.3, 0.7])),
        );
    });

    it('🔴 袋首不得是当前曲（否则点「下一首」原地重播，像按了没反应）', () => {
        // 扫多个随机取值 ⇒ 覆盖多种排列，而不是只验一种排列下的巧合
        for (const r of [0, 0.3, 0.5, 0.99]) {
            const bag = buildShuffleBag(['a', 'b', 'c'], 'a', seq([r]));
            expect(bag[0]).not.toBe('a');
            expect([...bag].sort()).toEqual(['a', 'b', 'c']); // 挪袋首不能把元素弄丢
        }
    });

    it('单曲队列不挪袋首（挪了就没有下一首了）', () => {
        expect(buildShuffleBag(['a'], 'a', seq([0]))).toEqual(['a']);
    });
});

describe('decideTrack —— 空队列与 off 模式', () => {
    it('空队列 ⇒ 无可播（replay 也不该为 true）', () => {
        expect(decideTrack({ ...base, paths: [], current: 'a' })).toEqual({ target: null, replay: false, bag: [] });
    });

    it('🔴 off + 曲终 ⇒ **停**（target null）；⛔ 不重播、也不切下一首', () => {
        expect(decideTrack({ ...base, mode: 'off', trigger: 'ended' })).toEqual({
            target: null,
            replay: false,
            bag: [],
        });
    });

    it('🔴 off + 手动下一首 ⇒ 顺序下一首（LyricFlux 的 `getNextSong("off")` 落 default 分支，口径要保留）', () => {
        expect(decideTrack({ ...base, mode: 'off', trigger: 'manual' }).target).toBe('b');
        expect(decideTrack({ ...base, mode: 'off', trigger: 'manual', direction: 'prev' }).target).toBe('c');
    });
});

describe('decideTrack —— single（单曲循环）', () => {
    it('曲终 ⇒ 本曲重播（replay: true，调用方走「回到 0 秒」而不是换源）', () => {
        expect(decideTrack({ ...base, mode: 'single', trigger: 'ended' })).toEqual({
            target: 'a',
            replay: true,
            bag: [],
        });
    });

    it('手动上一首 / 下一首同样落在本曲（单曲循环下切歌无意义）', () => {
        expect(decideTrack({ ...base, mode: 'single', trigger: 'manual' }).target).toBe('a');
        expect(decideTrack({ ...base, mode: 'single', trigger: 'manual', direction: 'prev' }).target).toBe('a');
    });

    it('当前曲不在队列里 ⇒ 落到队列首（⛔ 不是 null）', () => {
        expect(decideTrack({ ...base, mode: 'single', current: 'zzz' }).target).toBe('a');
    });
});

describe('decideTrack —— sequential（顺序播放）', () => {
    it('曲终 ⇒ 下一首；末尾回卷到第一首', () => {
        expect(decideTrack({ ...base, current: 'a' }).target).toBe('b');
        expect(decideTrack({ ...base, current: 'c' }).target).toBe('a');
        expect(decideTrack({ ...base, current: 'c' }).replay).toBe(false);
    });

    it('手动上一首 ⇒ 环形回退；首曲回卷到最后一首', () => {
        expect(decideTrack({ ...base, current: 'b', trigger: 'manual', direction: 'prev' }).target).toBe('a');
        expect(decideTrack({ ...base, current: 'a', trigger: 'manual', direction: 'prev' }).target).toBe('c');
    });

    it('当前曲不在队列里 ⇒ 下一首取队首、上一首取队尾（⛔ 不是 null）', () => {
        expect(decideTrack({ ...base, current: 'zzz' }).target).toBe('a');
        expect(decideTrack({ ...base, current: 'zzz', direction: 'prev' }).target).toBe('c');
    });

    it('🔴 队列只有一首 ⇒ replay: true（等效单曲循环），⛔ 不能回 null 让歌单戛然而止', () => {
        expect(decideTrack({ ...base, paths: ['a'], current: 'a' })).toEqual({ target: 'a', replay: true, bag: [] });
    });
});

describe('decideTrack —— shuffle（随机播放）', () => {
    it('袋空 ⇒ 现洗一袋，取袋首并回传剩下的袋', () => {
        const d = decideTrack({ ...base, mode: 'shuffle', rng: seq([0]) });
        expect(d.target).toBe('b'); // rng 恒 0 ⇒ 洗成 [b, c, a]，且袋首已避让当前曲 a
        expect(d.bag).toEqual(['c', 'a']);
        expect(d.replay).toBe(false);
    });

    it('🔴 袋非空 ⇒ **直接用袋**、不再调随机源（否则等于每首重洗 = 隔两首又重复）', () => {
        let called = 0;
        const bomb = () => {
            called++;
            throw new Error('袋非空时不该再洗牌');
        };
        const d = decideTrack({ ...base, mode: 'shuffle', bag: ['c', 'a'], rng: bomb });
        expect(d.target).toBe('c');
        expect(d.bag).toEqual(['a']);
        expect(called).toBe(0);
    });

    it('🔴 不改入参的袋（纯函数无隐藏状态；新袋由调用方保存）', () => {
        const bag = ['c', 'a'];
        decideTrack({ ...base, mode: 'shuffle', bag });
        expect(bag).toEqual(['c', 'a']);
    });

    it('袋里最后一首取走后袋子变空（下一轮重新洗）', () => {
        const d = decideTrack({ ...base, mode: 'shuffle', bag: ['c'] });
        expect(d.target).toBe('c');
        expect(d.bag).toEqual([]);
    });

    it('🔴 手动上一首 ⇒ 随机一首**且不与当前同曲**（⛔ 取到当前这首 = 点了像没反应）', () => {
        for (let i = 0; i < 20; i++) {
            const d = decideTrack({ ...base, mode: 'shuffle', trigger: 'manual', direction: 'prev' });
            expect(d.target).not.toBe('a');
            expect(d.bag).toEqual([]); // 上一首不走袋、也不动袋
        }
    });

    it('队列只有一首 ⇒ 上一首也是本曲重播（不然就取不到别的了）', () => {
        const d = decideTrack({ ...base, paths: ['a'], mode: 'shuffle', trigger: 'manual', direction: 'prev' });
        expect(d).toEqual({ target: 'a', replay: true, bag: [] });
    });

    it('🔴 退化随机源（恒定值总撞当前索引）**不死循环** ⇒ 回退「顺序上一首」', () => {
        // LyricFlux 原写法是 `while (rand === idx) rand = …` —— 恒定随机源会**死循环**（插件里 = 面板卡死）。
        // 本用例就是那条护栏：拿 rng 恒 0 跑，若没加有界重试，本测试会挂住而不是失败。
        const d = decideTrack({ ...base, mode: 'shuffle', trigger: 'manual', direction: 'prev', rng: seq([0]) });
        expect(d.target).toBe('c'); // paths ['a','b','c']，当前 'a'（idx 0）⇒ 回退 (0-1+3)%3 = 2
        expect(d.replay).toBe(false);
        expect(d.bag).toEqual([]); // 上一首不动袋
    });

    it('队列只有一首 + 曲终 ⇒ 袋首即本曲 ⇒ replay: true（等效单曲循环）', () => {
        const d = decideTrack({ ...base, paths: ['a'], current: 'a', mode: 'shuffle' });
        expect(d).toEqual({ target: 'a', replay: true, bag: [] });
    });

    it('非 shuffle 模式把袋子原样回传（调用方无需分支处理）', () => {
        expect(decideTrack({ ...base, mode: 'sequential', bag: ['x'] }).bag).toEqual(['x']);
        expect(decideTrack({ ...base, mode: 'off', bag: ['x'] }).bag).toEqual(['x']);
    });
});

describe('playersToPause（音频 ↔ 视频互斥真源）', () => {
    it('起播一路 ⇒ 暂停另一路；**不含自身**', () => {
        expect(playersToPause('audio')).toEqual(['video']);
        expect(playersToPause('video')).toEqual(['audio']);
    });

    it('两侧共用同一张表（新增第三路时只需改这里）', () => {
        for (const k of PLAYER_KINDS) {
            expect(playersToPause(k)).not.toContain(k);
            expect(playersToPause(k)).toHaveLength(PLAYER_KINDS.length - 1);
        }
    });
});
