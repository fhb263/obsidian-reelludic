// 接口耗时测量与超时控制（纯逻辑，无 obsidian 依赖，可单测）

/** 耗时区间阈值（ms）：≤NORMAL 正常 / ≤SLOW 偏慢 / >SLOW 不可用 */
export const NORMAL_MS = 1000;
export const SLOW_MS = 3000;
/** 测试连接总超时（ms）：超时即判定不可用 */
export const TIMEOUT_MS = 10000;

/** 测量结果：始终携带 elapsedMs（无论成功/失败） */
export interface TimedResult<T> {
    elapsedMs: number;
    result: T;
}

/** 带耗时的错误：measure 捕获的失败会附带起点到抛错时刻的耗时 */
export class TimedError extends Error {
    readonly elapsedMs: number;
    constructor(cause: unknown, elapsedMs: number) {
        super(cause instanceof Error ? cause.message : String(cause));
        this.name = 'TimedError';
        this.elapsedMs = elapsedMs;
    }
}

/** 测量异步函数完整链路耗时：起点=调用前，终点=resolve/reject；失败抛 TimedError（带耗时） */
export async function measure<T>(fn: () => Promise<T>): Promise<TimedResult<T>> {
    const start = performance.now();
    try {
        const result = await fn();
        return { elapsedMs: Math.round(performance.now() - start), result };
    } catch (e) {
        throw new TimedError(e instanceof Error ? e.message : String(e), Math.round(performance.now() - start));
    }
}

/** 超时包装：ms 内未完成则 reject（消息含阈值），提前完成则清除定时器 */
export function withTimeout<T>(promise: Promise<T>, ms: number = TIMEOUT_MS, label = '请求'): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`${label}超时（>${ms}ms）`));
        }, Math.max(1, ms));
        promise.then(
            (v) => {
                clearTimeout(timer);
                resolve(v);
            },
            (e) => {
                clearTimeout(timer);
                reject(e);
            },
        );
    });
}

/** 耗时档位：正常 / 偏慢 / 不可用（供 UI 着色） */
export type TimingLevel = 'normal' | 'slow' | 'fail';

export function timingLevel(elapsedMs: number): TimingLevel {
    if (elapsedMs <= NORMAL_MS) return 'normal';
    if (elapsedMs <= SLOW_MS) return 'slow';
    return 'fail';
}

/** 延时（ms） */
export function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, Math.max(0, ms)));
}

/**
 * 幂等请求重试（参考 obsidian-douban DesktopHttpUtil：GET/HEAD 重试、POST 不重试）：
 * 最多 attempts 次尝试，间隔 delayMs；全部失败抛最后一次错误。
 * 只用于幂等的搜索/探测类 GET 请求，避免对写操作造成重复副作用。
 */
export async function retry<T>(fn: () => Promise<T>, attempts: number = 2, delayMs: number = 400): Promise<T> {
    let lastError: unknown;
    for (let i = 0; i < attempts; i++) {
        try {
            return await fn();
        } catch (e) {
            lastError = e;
            if (i < attempts - 1) await sleep(delayMs);
        }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
