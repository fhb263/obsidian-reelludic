
import { AI_PROVIDER_ICON, type AiIcon } from 'pure/aiIcons';
import { AI_PROVIDER_OFF, normalizeProvider, type AiProviderChoice } from 'pure/translate';
import { safeSetIcon } from '../services/safeIcon';

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
