// AI 图标渲染（#479 建立，**#480 提升为共享模块**）：设置页的「用途」行与拣选弹窗两处共用。
//
// 🔴 这段逻辑**只留一份**的理由 —— 两类图标的 fill 策略**不同**，混一条就出墨块：
//    品牌标（LobeHub Icons，MIT）是**填充式**（源 SVG 即 `fill="currentColor"`）⇒ 靠 `color` 上色；
//    内置标（Lucide）是**描边式**（`.svg-icon { fill: none; stroke: currentColor }`）。
//    ⛔ 绝不写无差别的 `.rl-ai-icon path { fill: … }`（本仓在「网络搜索浮层」栽过同形）。
import { setIcon } from 'obsidian';
import { AI_PROVIDER_ICON, type AiIcon } from 'pure/aiIcons';
import { AI_PROVIDER_OFF, normalizeProvider, type AiProviderChoice } from 'pure/translate';

/** 挂内置图标并**吞掉异常**（`setIcon` 遇未知名是**静默失败**：留一个空白 span、零报错） */
function safeSetIcon(el: HTMLElement, icon: string): void {
    try {
        setIcon(el, icon);
    } catch {
        // 图标不可用：忽略
    }
}

/** 把一颗 AI 图标画进 `host`（品牌标自绘 / 内置标走 `setIcon`，按 `kind` 分治） */
export function renderAiIcon(host: HTMLElement, icon: AiIcon): void {
    host.empty();
    host.addClass('rl-ai-icon');
    if (icon.kind === 'builtin') {
        host.addClass('rl-ai-icon-builtin');
        safeSetIcon(host, icon.id);
        return;
    }
    host.addClass('rl-ai-icon-brand');
    const svg = host.createSvg('svg', {
        attr: { viewBox: icon.viewBox, fill: 'currentColor', 'fill-rule': 'evenodd', 'aria-hidden': 'true', focusable: 'false' },
    });
    const path = svg.createSvg('path', { attr: { d: icon.d } });
    if (icon.clipRule) path.setAttribute('clip-rule', 'evenodd');
}

/**
 * 「服务商」选择器里的图标：三家 chat 服务商走品牌标；「不启用」没有品牌标 ⇒ 内置 `ban`
 * （已在 `app.js` 图标表用 `_probe_lucide.cjs` 实测存在）。
 */
export function aiChoiceIcon(v: AiProviderChoice): AiIcon {
    return v === AI_PROVIDER_OFF ? { kind: 'builtin', id: 'ban' } : AI_PROVIDER_ICON[normalizeProvider(v)];
}
