/**
 * 多任务进度卡片：**纯逻辑**（不碰 DOM、不碰计时器）。
 *
 * 🔴 用户 m09805 逐字：「音乐条目从B站下载音频能不能多线程，右下角悬浮球进度框如加个待下载3个
 *    （列出三个下载进度条，要区分每个下载的是什么标题，再加个如1MB/s等展示速度）」
 *
 * 为什么需要「任务组」而不是「一个球一个任务」：
 * 原来 `services/biliDownloadService` 只有一个 `ball` 变量，第二首歌一开下载就把第一首的球
 * **顶掉**（`startProgressBall` 是单例，新任务接管旧任务）—— 并行下载时用户只能看到最后一首，
 * 前面几首的进度凭空消失。所以这里把「一个球」升级成「一球多行」：
 * 球只有一张，行有 N 行，每行是一个独立任务。
 *
 * ## 三条口径
 *
 *  ⑴ **行是可增删的**：任务开始就插一行（⛔ 不等第一次进度回调 —— 用户切走笔记时也得看得见
 *     「有 3 个在排队」），结束时把这一行标成完成/失败而不是立刻删掉（否则卡片会在用户眼皮下
 *     突然少一行，看起来像丢任务）。真正的移除交给调用方（收尾停留期之后）。
 *  ⑵ **排序稳定**：新增行永远追加在末尾，⛔ 不按百分比/速度重排 —— 行在用户眼皮底下跳来跳去
 *     比顺序不完美更糟（浏览器下载面板也是这个口径）。
 *  ⑶ **汇总口径**：小球的球心与环形进度取**所有未收尾任务的平均百分比**；只要有一个任务没有
 *     百分比（`null`），汇总就是 `null`（走不确定态）。⛔ 不要「跳过 null 只平均有的」
 *     —— 那会让「3 个任务里 1 个有进度」显示成 100%，看着像快好了其实还早。
 */

/** 一条任务的收尾态（`running` = 还在跑） */
export type TaskPhase = 'running' | 'done' | 'fail';

/** 进度卡片上的一行。 */
export interface ProgressTaskRow {
    /** 稳定 id（同一任务多次 update 必须复用，⛔ 别用标题当 key —— 同名的两首歌会串行） */
    id: string;
    /** 行标题，如「七里香」 */
    title: string;
    /** 0..100；`null` = 只有阶段、没有可算的百分比 */
    percent: number | null;
    /** 阶段文案，如「正在从 B 站下载音频…」 */
    label?: string;
    /** 速度文案，如「1.2 MB/s」；无则空 */
    speed?: string;
    /** 细节文案，如「12.3 / 45.6 MB」 */
    detail?: string;
    /** 收尾态 */
    phase: TaskPhase;
}

/**
 * 进度条填充比例（0..100）。
 *
 * ⚠️ 无百分比时返回 `null`（渲染层换成不确定态），⛔ 不返 0（看着像卡死）。
 */
export function taskBarPercent(percent: number | null | undefined): number | null {
    if (percent === null || percent === undefined) return null;
    if (!Number.isFinite(percent)) return null;
    return Math.min(100, Math.max(0, Math.round(percent)));
}

/**
 * 卡片标题：**只在没有任务时**才用兜底文案，有 N 个任务时显示「N 个任务正在下载」。
 *
 * ⚠️ 收尾阶段（全部 done/fail）改成「已完成 3 个任务」之类的汇总，⛔ 别还挂着「正在下载」。
 */
export function tasksTitle(rows: readonly ProgressTaskRow[], fallback = '进行中'): string {
    if (rows.length === 0) return fallback;
    const running = rows.filter((r) => r.phase === 'running').length;
    if (running > 0) return rows.length === 1 ? rows[0].title : `${running} 个任务正在下载`;
    const failed = rows.filter((r) => r.phase === 'fail').length;
    if (failed === 0) return `${rows.length} 个任务已完成`;
    if (failed === rows.length) return `${rows.length} 个任务失败`;
    return `${rows.length} 个任务结束（${failed} 个失败）`;
}

/**
 * 汇总百分比（球心与环形用）。
 *
 * 🔴 口径见文件头⑶：**任何一个 running 任务没有百分比 ⇒ 汇总 `null`**。
 *   ⛔ 不要只平均「有百分比的那几个」—— 3 个任务里 2 个不知道进度、1 个到了 100%，
 *   平均出来是 100%，用户会以为全都下完了。
 *
 * 全部收尾时：全成功 ⇒ 100；有失败 ⇒ `null`（不确定，别显示 100% 掩盖失败）。
 */
export function tasksPercent(rows: readonly ProgressTaskRow[]): number | null {
    if (rows.length === 0) return null;
    const running = rows.filter((r) => r.phase === 'running');
    if (running.length === 0) {
        return rows.some((r) => r.phase === 'fail') ? null : 100;
    }
    let sum = 0;
    for (const r of running) {
        const p = taskBarPercent(r.percent);
        if (p === null) return null;
        sum += p;
    }
    return Math.round(sum / running.length);
}

/**
 * 卡片底部细节（速度 / 细节汇总）。
 *
 * 单任务 ⇒ 直用那一行的（与原单任务卡片文案一致，⛔ 别变成「1 个任务：…」这种啰嗦说法）。
 * 多任务 ⇒ 「已完成 2 / 3 · 1.2 MB/s」：**速度只汇总正在跑的那些**，⛔ 别把已完成任务
 * 的历史速度也加进去（那会让总数虚高、且收尾后还在跳）。
 */
export function tasksDetail(rows: readonly ProgressTaskRow[]): string {
    if (rows.length === 0) return '';
    if (rows.length === 1) {
        const r = rows[0];
        return [r.detail, r.speed].filter(Boolean).join(' · ');
    }
    const done = rows.filter((r) => r.phase === 'done').length;
    const failed = rows.filter((r) => r.phase === 'fail').length;
    const parts: string[] = [];
    parts.push(failed > 0 ? `已完成 ${done} · 失败 ${failed}` : `已完成 ${done} / ${rows.length}`);
    // 速度只算还在跑的
    const speed = speedSummary(rows);
    if (speed) parts.push(speed);
    return parts.join(' · ');
}

/**
 * 把各行速度文案合成一个总数（`1.2 MB/s` + `800 KB/s` ⇒ `2.0 MB/s`）。
 *
 * ⚠️ 认不出的单位**跳过而不是当 0**（宁可少算，也不要把「2.0 MB/s」写成一个假的准确值）。
 * 只支持 B/s / KB/s / MB/s / GB/s 四档 —— yt-dlp 输出的就是这几档。
 */
export function speedSummary(rows: readonly ProgressTaskRow[]): string {
    let bytes = 0;
    let counted = 0;
    for (const r of rows) {
        if (r.phase !== 'running') continue;
        const n = parseSpeedBytes(r.speed);
        if (n === null) continue;
        bytes += n;
        counted++;
    }
    if (counted === 0) return '';
    return formatSpeedBytes(bytes);
}

/** `/^\s*([\d.]+)\s*([KMGT]?i?B)\/s\s*$/i` 里的数字 → 字节/秒；认不出返 `null` */
export function parseSpeedBytes(text: string | undefined): number | null {
    const m = /([\d.]+)\s*([KMGT]?)i?B\s*\/\s*s/i.exec(String(text ?? ''));
    if (!m) return null;
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n < 0) return null;
    const unit = (m[2] ?? '').toUpperCase();
    const mul = unit === 'K' ? 1024 : unit === 'M' ? 1024 ** 2 : unit === 'G' ? 1024 ** 3 : unit === 'T' ? 1024 ** 4 : 1;
    return n * mul;
}

/**
 * 把「阶段 · 速度」的合并文案拆回两段。
 *
 * 🔴 为什么要有这个函数：`services/dl` 的进度回调签名是 **(percent, label) 两参**
 * （转写 / 试听 / 四平台下载 / yt-dlp 全在用），m09805 只为一首歌的速度去改那个共享签名
 * 会波及十几处调用点。折中做法：产生端把速度拼在 label 尾部（`正在下载… · 1.2 MB/s`），
 * 消费端用这个函数拆开 —— 拆分规则放在纯逻辑里，才好单测。
 *
 * ⚠️ 只认**末段**且形如 `<数字> <单位>/s` 的片段（`isSpeedToken`）。
 *    阶段文案里本身含 `·` 的情况（如「已完成 2 / 3 · …」）不会被误拆。
 */
export function splitLabelSpeed(label: string | undefined): { label: string; speed: string } {
    const raw = String(label ?? '');
    const parts = raw.split(' · ');
    if (parts.length > 1) {
        const last = parts[parts.length - 1];
        if (isSpeedToken(last)) {
            return { label: parts.slice(0, -1).join(' · '), speed: last.trim() };
        }
    }
    return { label: raw, speed: '' };
}

/** 一个片段是不是「速度」（`1.2 MB/s` / `800 KB/s` / `12 B/s`） */
export function isSpeedToken(token: string): boolean {
    return /^\s*[\d.]+\s*[KMGT]?i?B\s*\/\s*s\s*$/i.test(String(token ?? ''));
}

/** 字节/秒 → 人读文案（与 `formatSpeedBytes` 同一档：B/KB/MB/GB，一位小数） */
export function formatSpeedBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '';
    const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    let v = bytes;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
        v /= 1024;
        i++;
    }
    // 1 位小数：`1.2 MB/s`；整数就不带 `.0`（`800 KB/s` 而不是 `800.0 KB/s`）
    const text = i === 0 ? String(Math.round(v)) : v >= 100 ? v.toFixed(0) : v.toFixed(1);
    return `${text} ${units[i]}`;
}

/**
 * 把一个新行插进列表（同 id 存在则**替换**，保持原位置）。
 *
 * ⚠️ 替换而不是追加：同一任务第二次 update 不该多出一行。
 */
export function upsertTaskRow(rows: readonly ProgressTaskRow[], row: ProgressTaskRow): ProgressTaskRow[] {
    const i = rows.findIndex((r) => r.id === row.id);
    if (i < 0) return [...rows, row];
    const next = rows.slice();
    next[i] = row;
    return next;
}

/** 把某一行标成收尾（`done`/`fail`），保留 title 与最终百分比 */
export function finishTaskRow(
    rows: readonly ProgressTaskRow[],
    id: string,
    phase: Exclude<TaskPhase, 'running'>,
    detail?: string,
): ProgressTaskRow[] {
    const i = rows.findIndex((r) => r.id === id);
    if (i < 0) return rows.slice();
    const next = rows.slice();
    const cur = next[i];
    next[i] = {
        ...cur,
        phase,
        // 成功 ⇒ 100%；失败 ⇒ 停在原百分比（⛔ 归零会看起来像「白下了一趟」）
        percent: phase === 'done' ? 100 : cur.percent,
        label: phase === 'done' ? '已完成' : '失败',
        speed: '',
        detail: detail ?? cur.detail ?? '',
    };
    return next;
}

/** 摘掉一行（收尾停留期结束后）；不存在则原样返回 */
export function removeTaskRow(rows: readonly ProgressTaskRow[], id: string): ProgressTaskRow[] {
    const next = rows.filter((r) => r.id !== id);
    return next.length === rows.length ? rows.slice() : next;
}

/** 还该不该保留这张卡片：一行都没有 ⇒ 该关掉 */
export function tasksAlive(rows: readonly ProgressTaskRow[]): boolean {
    return rows.length > 0;
}

/**
 * 一行在卡片上的无障碍/提示文案（`title` 属性与读屏共用）。
 * 例：`七里香 · 正在从 B 站下载音频… · 42% · 1.2 MB/s`
 * ⚠️ 收尾行不带百分比（`✓ 已完成`），⛔ 别残留 87% 让人以为还在跑。
 */
export function taskRowTip(row: ProgressTaskRow): string {
    const parts: string[] = [row.title];
    if (row.phase === 'done') {
        parts.push('✓ 已完成');
    } else if (row.phase === 'fail') {
        parts.push('✕ 失败');
    } else {
        if (row.label) parts.push(row.label);
        const p = taskBarPercent(row.percent);
        parts.push(p === null ? '进行中' : `${p}%`);
    }
    if (row.speed) parts.push(row.speed);
    return parts.join(' · ');
}
