// 音乐子分类（音乐 / 其他）纯逻辑：归一 + 匹配 + 计数。
// 1.0.3 起收听页签提供【全部 / 音乐 / 其他】子分类 chips（同 pure/bookKind 模式，用户 2026-09-12 需求）。
// 缺省归「music」（展示为「音乐」）：未指定 musicKind 的存量音乐条目不丢失，「其他」（有声书 / 播客等）在表单显式选择。
import type { MusicKind } from 'data/types';

export const MUSIC_KINDS: MusicKind[] = ['music', 'other'];

export const MUSIC_KIND_LABELS: Record<MusicKind, string> = {
    music: '音乐',
    other: '其他',
};

/** 顶部概览量词（子分类 chip 选中非 all 时用；用户 2026-09-12 指定：5 首音乐 / 5 项其他）。
 *  「全部」chip 不用此表——回落 pure/labels.overviewUnitLabel('music') = 「首音乐」。 */
export const MUSIC_KIND_TOP_UNITS: Record<MusicKind, string> = {
    music: '首音乐',
    other: '项其他',
};

// ⚠️ 合法值集合以 MUSIC_KIND_LABELS 的**自有键**为准（与 bookKind 同法，防两处定义漂移）。
const VALID_KINDS = Object.keys(MUSIC_KIND_LABELS) as MusicKind[];

/**
 * 归一音乐分类：合法值原样返回，其余（缺省 / 空值 / 损坏数据）一律归「music」（展示为「音乐」）。
 * ⚠️ 合法值校验用 `Object.keys` 而非 `in`——`in` 会沿原型链查找（教训同 pure/bookKind / themeTokens，有回归测试守）。
 */
export function normalizeMusicKind(raw: unknown): MusicKind {
    return typeof raw === 'string' && (VALID_KINDS as string[]).includes(raw) ? (raw as MusicKind) : 'music';
}

/** 分类匹配：'all' 恒命中；显式 kind 时仅 music 类型参与匹配（其余类型不命中——调用方只在收听页签传 musicKind，从严防语义漏出） */
export function matchesMusicKind(e: { type: string; musicKind?: MusicKind }, kind: 'all' | MusicKind): boolean {
    if (kind === 'all') return true;
    if (e.type !== 'music') return false;
    return normalizeMusicKind(e.musicKind) === kind;
}

/** 三桶计数（只统计 music 类型条目；all = music 总数）——收听页签 chips 数字 */
export function musicKindCounts(entries: ReadonlyArray<{ type: string; musicKind?: MusicKind }>): Record<'all' | MusicKind, number> {
    const out: Record<'all' | MusicKind, number> = { all: 0, music: 0, other: 0 };
    for (const e of entries) {
        if (e.type !== 'music') continue;
        out[normalizeMusicKind(e.musicKind)]++;
        out.all++;
    }
    return out;
}
