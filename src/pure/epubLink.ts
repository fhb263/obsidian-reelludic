// 阅读器链接解析（纯逻辑，无 obsidian 依赖，可单测）。
// 背景（2026-09-16 用户报障）：EPUB 正文渲染在 srcdoc iframe 里，书内 <a href> 未拦截时
// 浏览器会在该 iframe 内导航（chapter2.xhtml#x 在 srcdoc 下必然加载失败）→ iframe 变**空白页**；
// 若此时处于沉浸模式，「点正文空白唤回上下栏」的监听挂在旧文档上、随导航一起失效 → 无法退出。
// 因此必须在 frame 文档内拦截所有链接点击，并把它翻译成阅读器动作。

/** 链接解析结果（拦截后要执行的动作） */
export type EpubLinkTarget =
    /** 同章锚点（#x）：滚动到该元素 */
    | { kind: 'fragment'; fragment: string }
    /** 跨章链接：跳到第 index 章（可带 fragment） */
    | { kind: 'chapter'; index: number; fragment: string }
    /** 外部链接（http/https/mailto）：交给系统浏览器 */
    | { kind: 'external'; href: string }
    /** 解析不出目标（既不是锚点也不是已知章节）：只拦住导航，不做动作 */
    | { kind: 'unknown' };

/** 归一路径：去掉 fragment、合并多余分隔符、去掉 ./，并尽量做百分号解码后比较 */
function normPath(p: string): string {
    const decoded = (() => {
        try {
            return decodeURIComponent(p);
        } catch {
            return p;
        }
    })();
    return decoded
        .split('/')
        .filter((seg) => seg !== '' && seg !== '.')
        .join('/');
}

/**
 * 把 iframe 内的 href 解析成阅读器动作。
 * @param href        原始 href（可能是 '#x' / 'chapter2.xhtml#x' / '../Text/c2.xhtml' / 'https://…'）
 * @param chapterHrefs 章节文件路径表（顺序 = 章节序号）
 */
export function resolveEpubHref(href: string, chapterHrefs: string[]): EpubLinkTarget {
    const raw = (href ?? '').trim();
    if (!raw) return { kind: 'unknown' };
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^file:/i.test(raw)) {
        // 带协议的：http/https/mailto/… 交给系统；file: 之类不处理（仍会被拦截，见 unknown 分支语义）
        return /^(https?|mailto):/i.test(raw) ? { kind: 'external', href: raw } : { kind: 'unknown' };
    }
    const hashIdx = raw.indexOf('#');
    const path = hashIdx >= 0 ? raw.slice(0, hashIdx) : raw;
    const fragment = hashIdx >= 0 ? raw.slice(hashIdx + 1) : '';
    const target = normPath(path);
    if (!target) return fragment ? { kind: 'fragment', fragment } : { kind: 'unknown' };
    const refs = chapterHrefs.map(normPath);
    let idx = refs.indexOf(target);
    if (idx < 0) {
        // 相对路径写法差异（../Text/c2.xhtml vs Text/c2.xhtml）→ 退化为按文件名匹配
        const base = target.split('/').pop() ?? target;
        idx = refs.findIndex((r) => (r.split('/').pop() ?? '') === base);
    }
    if (idx < 0) return { kind: 'unknown' };
    return { kind: 'chapter', index: idx, fragment };
}
