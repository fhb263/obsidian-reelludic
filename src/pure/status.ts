// 状态枚举与流转校验（纯逻辑，无 obsidian 依赖）
// 四态：想看 → 在看 → 已看；存档（archived）为归档标记，任意状态双向自由进出（弃剧 dropped 已移除，存量由 normalizeEntry 迁移为存档）

export type MediaStatus = 'want' | 'watching' | 'watched' | 'archived';

export const MEDIA_STATUSES: readonly MediaStatus[] = ['want', 'watching', 'watched', 'archived'];

export const STATUS_LABELS: Record<MediaStatus, string> = {
    want: '想看',
    watching: '在看',
    watched: '已看',
    archived: '存档',
};

export function isMediaStatus(v: unknown): v is MediaStatus {
    return typeof v === 'string' && (MEDIA_STATUSES as readonly string[]).includes(v);
}

/**
 * 状态流转规则：
 * - 同状态自转合法
 * - 正向推进：want→watching→watched（want 可直转 watched，一次看完）
 * - 存档双向自由：任意状态 → 存档；存档 → 任意状态（归档标记，可随时恢复）
 * - 其余（回退）不合法
 */
export function canTransition(from: MediaStatus, to: MediaStatus): boolean {
    if (from === to) return true;
    if (from === 'archived' || to === 'archived') return true;
    if (from === 'want') return to === 'watching' || to === 'watched';
    if (from === 'watching') return to === 'watched';
    return false;
}
