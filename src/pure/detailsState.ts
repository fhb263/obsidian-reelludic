/**
 * 重画一块 DOM 时**保住 `<details>` 的展开状态**。
 *
 * 🔴 为什么需要它（2026-11-06，m08348 之后的真缺陷）：
 *    「沉浸体验 › 语音服务」的卡片装完东西会**原地重画**（只清子节点、复用卡壳），
 *    目的是不整页刷新（那会合上折叠块 + 滚动跳回顶部）。但重画本身也会把
 *    `<details>` 造成初始态 —— 而折叠块的初始态常常是**条件展开**的：
 *      · 「更多设置」类折叠块在「缺程序或缺模型」时自动展开
 *      · 装成功后那个条件恰好变假 ⇒ 折叠块反而合上，用户看不到刚装出来的结果。
 *      这跟「根本不刷新」一样糟。
 *
 * ⚠️ 2026-11-06 晚（m08661，用户选定 A 版三段平铺）之后，音频转文字卡里**已不再有折叠块**
 *    （全部改成平铺）。本模块因此**暂时匹配不到任何元素** —— `rememberOpenFolds` 返回空数组、
 *    `restoreOpenFolds` 什么都不做，零副作用。
 *    🔴 **保留它**的理由：`renderVoiceSection` 是通用壳（STT / TTS 共用），以后任何一侧加回
 *       `details` 都会立刻重新受保护；删掉它就得再踩一次「装完折叠块自己合上」。
 *    ⇒ 所以选择器放宽成「卡内任意 details」，⛔ 不再逐个类名列举（那样每次加折叠块都要改两处）。
 *
 * ⛔ 本模块只做纯 DOM 记号读写，不碰 Obsidian API、不碰 settings —— 所以能被 jsdom 单测钉住。
 * ⚠️ 记号用**元素自身的 class 串**（卡内唯一），⛔ 不用下标：换引擎后折叠块数量会变，下标对不上。
 */

/**
 * 要记住展开状态的折叠块选择器（在传入的 `root` 范围内查找，即「这张卡里的全部折叠块」）。
 *
 * ⚠️ 必须是 `details` 而不是别的：`<details>` 才有浏览器原生的 `open` 属性可读写。
 * 🔴 放宽成裸 `details` 是**故意的** —— 见上方说明，类名枚举会随模板改动悄悄失效。
 */
export const FOLD_SELECTOR = 'details';

/**
 * 收集当前**处于展开状态**的折叠块，返回它们的 class 串（可重放给 `restoreOpenFolds`）。
 *
 * ⚠️ 返回 `string[]` 而不是元素引用：重画会把旧节点丢掉，引用就失效了。
 */
export function rememberOpenFolds(root: ParentNode, selector: string = FOLD_SELECTOR): string[] {
    const out: string[] = [];
    for (const el of Array.from(root.querySelectorAll(selector))) {
        if (!(el instanceof HTMLElement)) continue;
        if (!el.hasAttribute('open')) continue;
        // 空 class 的元素记了也还原不回去（选择器会变成 `details.`），直接跳过
        const cls = el.className.trim();
        if (cls) out.push(cls);
    }
    return out;
}

/**
 * 重画之后把之前展开的折叠块重新展开。
 *
 * @returns 真正还原成功的个数（用于测试断言，生产代码可忽略）
 * ⚠️ 找不到对应元素就**跳过**——换引擎后某些折叠块可能已不存在，⛔ 不许抛错。
 */
export function restoreOpenFolds(root: ParentNode, remembered: readonly string[]): number {
    let n = 0;
    for (const cls of remembered) {
        const sel = `details.${cls.trim().split(/\s+/).join('.')}`;
        const el = root.querySelector(sel);
        if (!el) continue;
        el.setAttribute('open', '');
        n += 1;
    }
    return n;
}
