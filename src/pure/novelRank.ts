/**
 * 「下载书籍」搜索结果的**排序**（#426）—— 纯逻辑，无 obsidian / 无 DOM，可单测。
 *
 * 用户原话：「下载搜索网文界面要显示序号、**最新章节排列**搜索出的网文」
 * ⇒ 平铺的结果按**最新章节的章号倒序**排（连载进度越靠后越靠前），章号相同则保持原有先后。
 *
 * 🔴 口径（按真实书源的样态定的，见 `_probe426.cjs` 的实测）：
 *    `正文 废柴逆袭_第325章：红尘影，终成梦（大结局）` → 325
 *    `第七章 得手臂、混战`                              → 7（**中文数字**）
 *    `新书元尊已在起点上传，欢迎大家阅读。` / `1` / `第一卷人物一览表（未全）` → 0（**取不到就当 0**）
 * ⚠️ 只认「第 N 章/节/回/话/集/篇」——「第一卷」**不算**（卷号与章号不是一个量级，混着排会乱）。
 * ⚠️ 取**最后一个**匹配：有些源把「正文 废柴逆袭_第325章…」这种前缀也带进来，前面的字里可能还有数字。
 * ⛔ 别退化成「串里随便找个数字」—— `2024`、`（未全）` 这类都会被误当章号。
 */

/** 阿拉伯数字章号（`第325章` / `第 325 节`） */
const AR_NO = /第\s*([0-9]{1,6})\s*[章节回话集篇]/g;
/** 中文数字章号（`第七章` / `第一百零八回`） */
const CN_NO = /第\s*([零〇一二三四五六七八九十百千万两]{1,8})\s*[章节回话集篇]/g;

const CN_DIGIT: Record<string, number> = {
    零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4,
    五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};
const CN_UNIT: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };

/**
 * 中文数字 → 阿拉伯数字（只覆盖章节号会用到的写法，别当通用转换用）。
 * `七`→7 / `十二`→12 / `二十三`→23 / `一百零八`→108 / `一千二百三十四`→1234 / `一万二千`→12000。
 * ⚠️ 认不出的字**跳过**（不抛）：书源里的「最新章节」是站点给的自由文本，脏数据不能炸掉搜索。
 */
export function chineseNumber(text: string): number {
    let total = 0;
    let num = 0;
    for (const ch of String(text ?? '')) {
        if (ch in CN_DIGIT) {
            num = CN_DIGIT[ch];
        } else if (ch in CN_UNIT) {
            // 「十二」这种省略了「一」的写法：单位前没有数字就按 1 算
            total += (num || 1) * CN_UNIT[ch];
            num = 0;
        } else if (ch === '万') {
            total = (total + num) * 10000;
            num = 0;
        }
    }
    return total + num;
}

/** 取串里**最后一个**「第 N 章」的 N；中英文写法都认；取不到 ⇒ 0 */
function lastMatchNo(re: RegExp, text: string, cn: boolean): number {
    re.lastIndex = 0;
    let last: string | null = null;
    for (;;) {
        const m = re.exec(text);
        if (!m) break;
        last = m[1];
    }
    if (last === null) return 0;
    return cn ? chineseNumber(last) : Number(last);
}

/**
 * 从「最新章节」串里取章号（0 = 这条没给出可用章号 ⇒ 排序时垫底，但**照样展示**）。
 * ⚠️ 阿拉伯数字优先：`第325章` 里的「第」后面直接是数字，中英两套正则不会同时命中同一位点，
 *    但先跑阿拉伯可以在「第 2024 章」这类串上避免中文那套的误解。
 */
export function latestChapterNo(text: string): number {
    const s = String(text ?? '');
    if (!s) return 0;
    const ar = lastMatchNo(AR_NO, s, false);
    if (ar > 0) return ar;
    return lastMatchNo(CN_NO, s, true);
}

/**
 * 按「最新章节章号」**倒序**排（#426）。章号取不到（0）的排在最后；章号相同 ⇒ **保持原有先后**
 * （原序 = 各源返回顺序，稳定排序让同章号的结果不会在每次搜索时乱跳）。
 * ⚠️ 入参是任意行类型 —— 用 `latestOf` 取值器解耦（组件那边的行是 `{ hit, source }` 包装体）。
 */
export function sortByLatestChapter<T>(rows: readonly T[], latestOf: (row: T) => string): T[] {
    return rows
        .map((row, i) => ({ row, i, no: latestChapterNo(latestOf(row)) }))
        .sort((a, b) => b.no - a.no || a.i - b.i)
        .map((x) => x.row);
}
