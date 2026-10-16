// 阅读器键位（#351）：空格 / ↑↓ 的**唯一真源**。
//
// 两个阅读器（TXT / EPUB）各挂一份 keydown，但判定只此一份 —— 否则「两边行为不一致」几乎必然发生。
//
// 三条口径：
//   ⑴ 空格**按优先级**分发：正在朗读 → 控朗读；否则自动在跑 → 控自动；都没开 → 什么都不做
//      （不能凭空开始朗读，也不该在阅读器里替宿主翻页）；
//   ⑵ ↑↓ 调速**只在自动运行时**接管（不开自动时 ↑↓ 是宿主的卷动键，抢了会很难受）；
//   ⑶ 带 Ctrl / Meta / Alt 一律放行（那是宿主与系统的快捷键）。
//
// ⚠️ **不终局**：`preventDefault` 由调用方按返回的动作决定（本模块不碰事件对象）。

export type ReaderHotkeyAction = 'tts-toggle' | 'auto-toggle' | 'auto-faster' | 'auto-slower';

export interface ReaderHotkeyCtx {
    /** 朗读正在跑（含暂停中） */
    ttsOn: boolean;
    /** 自动滚动 / 自动翻页开着 */
    autoOn: boolean;
}

export interface ReaderHotkeyMods {
    ctrl?: boolean;
    meta?: boolean;
    alt?: boolean;
}

/** 修饰键放行：交给宿主 / 系统 */
function hasModifier(mods?: ReaderHotkeyMods): boolean {
    return !!(mods && (mods.ctrl || mods.meta || mods.alt));
}

/**
 * 键 → 动作。返回 `null` = **不接管**（调用方不要 `preventDefault`）。
 * ⚠️ 参数按最小面收：只认 `key` 与三个修饰键，方便单测直接喂字面量。
 */
export function resolveReaderHotkey(key: string, ctx: ReaderHotkeyCtx, mods?: ReaderHotkeyMods): ReaderHotkeyAction | null {
    if (hasModifier(mods)) return null;
    if (!ctx) return null;
    if (key === ' ' || key === 'Spacebar') {
        if (ctx.ttsOn) return 'tts-toggle';
        if (ctx.autoOn) return 'auto-toggle';
        return null;
    }
    if (key === 'ArrowUp' || key === 'ArrowDown') {
        // 朗读中不接管：语速的入口在弹窗里（弹窗还有音调与音量 —— 半边键盘半边弹窗只会更难用）
        if (ctx.ttsOn || !ctx.autoOn) return null;
        return key === 'ArrowUp' ? 'auto-faster' : 'auto-slower';
    }
    return null;
}

/**
 * 事件目标是否在「打字中」（输入框 / 文本域 / contenteditable）。
 * 🔴 阅读器里有笔记编辑框与搜索框 —— 不判这个，用户在那里敲空格就会把朗读切掉。
 * ⚠️ 只读 `tagName` / `isContentEditable`（不 `instanceof`），便于单测喂纯对象。
 */
export function isTypingTarget(el: unknown): boolean {
    if (!el || typeof el !== 'object') return false;
    const t = el as { tagName?: unknown; isContentEditable?: unknown };
    const tag = typeof t.tagName === 'string' ? t.tagName.toUpperCase() : '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return t.isContentEditable === true;
}
