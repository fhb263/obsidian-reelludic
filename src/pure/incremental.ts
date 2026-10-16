// 长列表「滚动到底再加载下一批」的纯逻辑（#556，用户 2026-10-08）。
//
// 用户原话：「如果用户疯狂滚动加载卡片，**限制每 200ms 才执行一次加载判断**，这叫节流。」
//
// 🔴 为什么抽纯模块：滚动处理里能积累状态的只有「已显示到第几条」与「上次判定时刻」，
//    两者都是纯数值 ⇒ 判定放这里、单测锁死；`scroll` 监听与 DOM 读写留在组件里当接线。
// ⚠️ 节流（throttle）与防抖（debounce）**不是一回事**，别互相替换：
//    · 防抖 = 停止触发后才执行一次（用于「输入停止后再请求」，见 MusicDownload 的 300ms 搜索防抖）；
//    · 节流 = 触发期间**至多每 N ms 执行一次**（用于滚动 —— 滚动会连发几十个事件，
//      防抖会把「一直在滚」判成「从没停下」而一次都不加载）。
// ⚠️ 触发余量（`margin`）：不能按「刚好到底」判 —— 触控板惯性、行高取整都会让「到底」那一帧
//    差几个像素，结果是要额外滚一下才加载。留 80px 提前量，手感上就是「快到底时自己接上」。

/** 一屏之外每次追加的卡片数（太小 ⇒ 滚动中频繁追加、抖动；太大 ⇒ 失去分批渲染的意义） */
export const LIST_BATCH = 40;

/** 下一次该显示到第几条（封顶在 `total`，⛔ 不会超过总量） */
export function nextShown(shown: number, total: number, batch: number = LIST_BATCH): number {
    return Math.min(total, Math.max(0, shown) + Math.max(1, batch));
}

/** 是否已滚到「接近底部」（留 `margin` 提前量） */
export function shouldGrow(
    scrollTop: number, clientHeight: number, scrollHeight: number, margin = 80,
): boolean {
    // 内容比容器还短（列表没满一屏）⇒ 不算「接近底部」，避免开屏就把整列灌进去
    if (scrollHeight <= clientHeight) return false;
    return scrollTop + clientHeight >= scrollHeight - margin;
}

/**
 * 节流闸门：距离上次执行是否已过 `gap` ms。
 * ⚠️ `now - lastAt >= gap` 必须写成**差值**判据（⛔ 别写 `now >= lastAt + gap` 的等价格式去挡 0）——
 *    `lastAt` 初值给 `0` 时，开机后第一次滚动（`now` 是几百 ms 级的时间戳）必须**放行**。
 */
export function canGrow(lastAt: number, now: number, gap = 200): boolean {
    return now - lastAt >= gap;
}
