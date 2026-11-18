// ⑤（用户 m03052）：B站音乐下载「后台继续」—— 下载所有权从弹窗移到插件层。
//
// 🔴 用户原话（逐字）：「给音乐从B站下载并转录的加个后台下载退出弹窗也能继续下载，
//    样式复用下载模型的那个悬浮球和进度框」
//
// 为什么必须单独一个服务（而不是在 `MusicDownload.svelte` 里加个「不取消」）：
//   `pickBili()` 现在把 `downloadingId / stage / stagePct` 全存在**组件状态**里 —— 弹窗一关，
//   Svelte 组件销毁，这些量连同 `await` 的续体一起没了（`finally` 照跑，但没人再画进度）。
//   所以「后台继续」的本质是**所有权上移**：任务在插件层跑，弹窗只是众多订阅者之一，
//   关掉弹窗 = 少一个订阅者，任务照跑、进度改由悬浮球展示。
//
// 三条硬口径：
//  ⑴ **幂等去重**：同一 `bvid` 正在跑就复用那一条，⛔ 不重复起第二次（否则同一首歌写两份文件）。
//  ⑵ **进度球单例**：`startProgressBall` 本身就是单例（新任务接管旧的），这里只负责给它喂
//     阶段与百分比；⛔ 不要每首歌新起一个球。
//  ⑶ **完成/失败必须留住结果**：任务结束后弹窗早已关掉，用户回来时要能看到「下好了/为什么失败」
//     —— 于是 `lastOutcomeRef` 里留最近一次结局，弹窗重开时读它回显。
//
// 🔴 变量名带 `Ref` 后缀是**必须的**（m03052 实测）：模块级 `let last` 会与
//    `main.ts` 里 `libraryDisplayName` 的局部 `let last` 重名，esbuild 为避让把它改名成 `last2`
//    ⇒ `assert-symbols` 里那条锚 `const last = normalizeLibraryDirInput(...)` 的产物判据当场变红。
//    ⛔ 别为了「名字更好看」改回 `last`。

import type { BiliVideo } from 'pure/dl/bilibili';
import type { DownloadProgressCallback } from 'services/dl';
import { startProgressBall, type ProgressBallHandle } from 'services/progressBall';

/** 一次 B站下载的结局（供「关掉弹窗再回来」时回显） */
export interface BiliDownloadOutcome {
    bvid: string;
    ok: boolean;
    message: string;
    relPath?: string;
    /** 结束时刻（毫秒），弹窗用它判断「这是刚才那次吗」 */
    at: number;
}

interface RunningTask {
    bvid: string;
    promise: Promise<BiliDownloadOutcome>;
}

/** 真正的下载实现（由插件注入 = `main.dlBiliDownload`）+ 进度回调 */
export interface BiliDownloadRunner {
    (video: BiliVideo, onProgress?: DownloadProgressCallback, songTitle?: string): Promise<{ ok: boolean; message: string; relPath?: string }>;
}

/** 听到进度的订阅者（弹窗在开着时挂一个，关掉就摘掉） */
export type BiliProgressListener = (bvid: string, percent: number | null, label: string) => void;
/** 听到结局的订阅者（同上，但只在收尾时叫一次） */
export type BiliOutcomeListener = (outcome: BiliDownloadOutcome) => void;

const running = new Map<string, RunningTask>();
const progressListeners = new Set<BiliProgressListener>();
const outcomeListeners = new Set<BiliOutcomeListener>();
let lastOutcomeRef: BiliDownloadOutcome | null = null;
let ball: ProgressBallHandle | null = null;

/** 结束后「结局」保留多久（用户 m10634 抱怨「点一下就消失」⇒ 给足时间回来看） */
const OUTCOME_KEEP_MS = 5 * 60 * 1000;

function endBall(ok: boolean, message: string): void {
    if (!ball) return;
    const b = ball;
    ball = null;
    if (ok) b.done(message);
    else b.fail(message);
}

/**
 * 起一次 B站下载（已在跑就返回那一条的 promise）。
 *
 * `songTitle` = 条目歌名（落盘文件名用它，为空才回落 B站视频标题 —— 口径见 `buildBiliAudioFilename`）。
 */
export function startBiliDownload(runner: BiliDownloadRunner, video: BiliVideo, songTitle?: string): Promise<BiliDownloadOutcome> {
    const bvid = String(video?.bvid ?? '').trim();
    if (!bvid) {
        const bad: BiliDownloadOutcome = { bvid: '', ok: false, message: '这条 B站结果没有 bvid，没法下载', at: Date.now() };
        lastOutcomeRef = bad;
        return Promise.resolve(bad);
    }
    const existing = running.get(bvid);
    if (existing) return existing.promise;

    const task: RunningTask = {
        bvid,
        promise: Promise.resolve({ bvid, ok: false, message: '', at: Date.now() }),
    };
    // 球在**任务开始**就起（⛔ 不是等第一次进度回调才起）—— 用户切走笔记时也已经有球可看
    ball = startProgressBall(`正在下载《${songTitle || video?.title || bvid}》`);
    ball.update({ percent: null, detail: '准备中' });

    // ⚠️ `services/dl` 的 `DownloadProgressCallback` 是 **(percent, label)** 两参，不是
    //    `asrModelDownload` 那个 (percent, received, total) 三参 —— 同名不同签名，写错了 tsc 会直接红。
    //    所以字节数不需要自己拼：`label` 里已经是「12.3 / 45.6 MB」这种现成文案。
    const onProgress: DownloadProgressCallback = (percent, label) => {
        const text = label || (typeof percent === 'number' ? `B站下载 ${Math.round(percent)}%` : 'B站下载中');
        ball?.update({ percent: typeof percent === 'number' ? percent : null, label: 'B站下载', detail: text });
        for (const fn of progressListeners) {
            try {
                fn(bvid, typeof percent === 'number' ? percent : null, text);
            } catch {
                /* 订阅者自己的错不该带崩下载 */
            }
        }
    };

    task.promise = runner(video, onProgress, songTitle)
        .then((r): BiliDownloadOutcome => ({ bvid, ok: r.ok, message: r.message, relPath: r.relPath, at: Date.now() }))
        .catch((e): BiliDownloadOutcome => ({
            bvid,
            ok: false,
            message: `下载失败：${e instanceof Error ? e.message : String(e)}`,
            at: Date.now(),
        }))
        .then((outcome) => {
            running.delete(bvid);
            lastOutcomeRef = outcome;
            // 过了保留期就清掉，避免「上次的失败」永远挂在那儿误导用户
            // ⚠️ 用裸 `setTimeout`（不是 `window.setTimeout`）：这个文件被单测直接跑在 node 环境，
            //    写 `window.` 会 `ReferenceError: window is not defined`。Electron/Obsidian 里
            //    裸 `setTimeout` 同样是全局的，行为一致。
            const at = outcome.at;
            setTimeout(() => {
                if (lastOutcomeRef && lastOutcomeRef.at === at) lastOutcomeRef = null;
            }, OUTCOME_KEEP_MS);
            endBall(outcome.ok, outcome.message);
            for (const fn of outcomeListeners) {
                try {
                    fn(outcome);
                } catch {
                    /* 同上 */
                }
            }
            return outcome;
        });

    running.set(bvid, task);
    return task.promise;
}

/** 某首歌是否正在后台下载（弹窗重开时用它恢复「转圈/禁用」态） */
export function isBiliDownloading(bvid: string): boolean {
    return running.has(String(bvid ?? '').trim());
}

/** 当前正在跑的 bvid 列表（弹窗重开时批量恢复状态） */
export function runningBiliDownloads(): readonly string[] {
    return [...running.keys()];
}

/** 最近一次结局（完成或失败都算）；无则 null */
export function lastBiliOutcome(): BiliDownloadOutcome | null {
    return lastOutcomeRef;
}

/** 订阅进度；返回取消订阅函数（⛔ 弹窗 `onClose` 必须调它，否则关掉的弹窗还在被喂数据） */
export function onBiliProgress(fn: BiliProgressListener): () => void {
    progressListeners.add(fn);
    return () => {
        progressListeners.delete(fn);
    };
}

/** 订阅结局；返回取消订阅函数 */
export function onBiliOutcome(fn: BiliOutcomeListener): () => void {
    outcomeListeners.add(fn);
    return () => {
        outcomeListeners.delete(fn);
    };
}

/** 插件卸载时摘掉球（⛔ 不中止任务 —— 卸载场景任务本来就活不过 reload） */
export function disposeBiliDownloads(): void {
    ball?.dismiss();
    ball = null;
    progressListeners.clear();
    outcomeListeners.clear();
}
