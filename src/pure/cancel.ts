/**
 * 取消令牌（#428）—— 「**立刻**停下来」的可中断等待。
 *
 * 🔴 起因是用户实测的两句话：「取消按钮点击无反应」「我点了叉才退出但能保存」。两条根因都落在这一层：
 *
 *  ⑴ **在飞的请求不可中断**：`services/nodeHttp` 建在 Node 原生 https 上，**没有 abort**；
 *     而旧的取消标志只在「下一章开头」才被读一次 ⇒ 用户点下去之后，最长要等完整的一章
 *     （`NOVEL_TIMEOUT_MS` × 页数 × 重试次数 + 重试间隔，量级是分钟）才可能看见任何变化。
 *     ⇒ 解法不是去掐 socket（做不到），而是**不再等它**：把每次网络 `await` 与 `token.wait()` 一起
 *     race，取消的瞬间**立即**抛出去收尾。底层连接仍在跑完，但没人挂在它上面 —— 感知延迟从「分钟级」降到「零」。
 *
 *  ⑵ **取消必须一路冒到调用方**（`CancelledError`），由调用方决定「什么都不落盘」。
 *     ⛔ 别再把剩余章标成 `failed: 已取消` 然后在同一个函数里照常合成文件 ——
 *     那正是「取消了却还能保存」。剩余章一律**留在 `pending`**（它们没失败，只是还没抓）。
 *
 * ⚠️ 本模块只造 promise，⛔ 不碰计时器 / 网络 / vault / DOM ⇒ 单测不需要 fake timer。
 */

/**
 * 取消哨兵。
 * 🔴 调用方靠 `instanceof CancelledError` 分辨「用户取消」与「真的出错」——
 *    ⛔ 别拿 `message` 字符串比对（文案随时会被改，一改就静默失配）。
 */
export class CancelledError extends Error {
    constructor() {
        super('已取消');
        this.name = 'ReelLudicCancelled';
    }
}

export interface CancelToken {
    /** 是否已请求取消（**同步读**——热循环里用这个，⛔ 别 `await`） */
    readonly stopped: boolean;
    /** 取消时 resolve（**永不 reject**）；多次调用拿到同一个 promise */
    wait(): Promise<void>;
    /** 请求取消（幂等：重复调不会做第二次事，也不会报错） */
    stop(): void;
}

/** 造一个令牌。`stop()` 与 `wait()` 一一对应，取消后所有等在 `wait()` 上的人**同一微任务**醒过来。 */
export function createCancelToken(): CancelToken {
    let stopped = false;
    let fire: (() => void) | null = null;
    const cancelled = new Promise<void>((resolve) => {
        fire = resolve;
    });
    return {
        get stopped(): boolean {
            return stopped;
        },
        wait: () => cancelled,
        stop(): void {
            if (stopped) return;
            stopped = true;
            fire?.();
        },
    };
}

/**
 * 把一次等待（网络请求 / 重试间隔 / 抓章的 sleep）与取消信号 race：
 * **取消 ⇒ 立刻抛 `CancelledError`**（原 promise 随后 resolve/reject 都不再有人听）。
 *
 * ⚠️ 不传令牌 ⇒ **原样透传**（搜索 / 目录那两条路保持旧行为，一字不动）。
 * ⚠️ 已经取消过的令牌 ⇒ 连 race 都不必进，直接抛（省一次无意义的等待）。
 */
export function raceCancel<T>(p: Promise<T>, token?: CancelToken): Promise<T> {
    if (!token) return p;
    if (token.stopped) return Promise.reject(new CancelledError());
    // `bail` 落败后**必然**在取消那一刻 reject；`Promise.race` 已给它挂了处理函数，
    // 不会变成 unhandled rejection（⛔ 别再加一层 `void bail.catch(...)` 的空壳）。
    const bail = token.wait().then<never>(() => {
        throw new CancelledError();
    });
    return Promise.race([p, bail]);
}
