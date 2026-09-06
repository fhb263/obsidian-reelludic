// 剧集文件名 → 集号解析（纯逻辑，可单测）：「从文件夹批量检索剧集本地路径」用。
// 支持常见命名：第N集/第N话、S01E05、E05、Episode 05、[05]、分隔符包围的 1..3 位数字段（01 / - 05 / _ 12）。
// 防误判：4 位年份（1999/2015）不匹配 1..3 位数字段；720p/1080p 等分辨率（紧跟 p/P 的数字段）排除；
// 规则按优先级尝试，首个命中即返回；均未命中 → undefined（调用方跳过并计数「未识别」）。
const RULES: ((base: string) => number | undefined)[] = [
    // 1) 第N集 / 第N话 / 第 N 話（中文习惯，最明确）
    (b) => {
        const m = /第\s*(\d{1,3})\s*[集话話]/.exec(b);
        return m ? parseInt(m[1], 10) : undefined;
    },
    // 2) Episode 05 / EP 05
    (b) => {
        const m = /[Ee][Pp]isode\s*(\d{1,3})(?!\d)/.exec(b);
        return m ? parseInt(m[1], 10) : undefined;
    },
    // 3) S01E05（取 E 后数字）/ E05（前界需非字母数字，防词中字母 e）/ 05 前有非字母数字
    (b) => {
        const m = /(?:^|[\s._[(-])(?:S\d{1,2})?[Ee](\d{1,3})(?!\d)/.exec(b);
        return m ? parseInt(m[1], 10) : undefined;
    },
    // 4) 分隔符包围的 1..3 位数字段（取最后一个有效候选：排除紧跟 p/P 的分辨率段）
    (b) => {
        const cands: { v: number; end: number }[] = [];
        const re = /(?:^|[\s._[(-])(\d{1,3})(?![0-9])/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(b)) !== null) {
            const next = b[m.index + m[0].length] ?? '';
            // 紧跟 p/P（720p、480p）→ 分辨率，排除
            if (/^[pP]$/.test(next)) continue;
            cands.push({ v: parseInt(m[1], 10), end: m.index + m[0].length });
        }
        if (cands.length === 0) return undefined;
        // 取最后一个有效候选（同串多候选时最靠后的数字段更接近集号语义）；
        // 4 位年份/1080p 因长度 >3 天然不进入候选，无需额外排除
        return cands[cands.length - 1].v;
    },
];

/**
 * 从文件名解析集号（1..999）。传入「不含扩展名」或含扩展名均可（数字段规则只关心文件名主体）。
 * 返回 undefined = 无法可靠识别（跳过）。
 */
export function parseEpisodeNumber(filename: string): number | undefined {
    const base = filename.replace(/\.[A-Za-z0-9]+$/, '');
    for (const rule of RULES) {
        const v = rule(base);
        if (v !== undefined && v >= 1 && v <= 999) return v;
    }
    return undefined;
}

export interface ScannedEpisode {
    ep: number;
    name: string;
}

/** 批量解析（调用方已按视频扩展名过滤）：返回按文件名出现的原始顺序（供上层排序/保位填集） */
export function scanEpisodeNumbers(names: string[]): ScannedEpisode[] {
    const out: ScannedEpisode[] = [];
    for (const name of names) {
        const ep = parseEpisodeNumber(name);
        if (ep !== undefined) out.push({ ep, name });
    }
    return out;
}
