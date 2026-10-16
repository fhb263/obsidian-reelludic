// 音乐子分类纯逻辑：1.0.3.1 起音乐不再分子类（用户 2026-09-13 裁定删除「其他」）。
// 沿革：1.0.3 收听页签曾提供【全部 / 音乐 / 其他】chips（其他 = 有声书 / 播客等）；
// 1.0.3.1 起页签子分类行与表单「音乐分类」选择整体下线，音乐 = 单一类目。
// 字段 musicKind 按 schema append-only 保留（合法值仅 music），归一兜底把存量 other / 损坏值并入「music」——条目不丢。
import type { MusicKind } from 'data/types';

/** 合法音乐分类（单一值；catalog 白名单校验与读取端归一共用本表，防两处定义漂移） */
export const MUSIC_KINDS: MusicKind[] = ['music'];

/**
 * 归一音乐分类：合法值原样返回，其余（缺省 / 空值 / 已下线的 other / 损坏数据）一律归「music」。
 * ⚠️ 合法值校验用数组 includes 而非 `in`——`in` 会沿原型链查找（教训同 pure/bookKind / themeTokens，有回归测试守）。
 */
export function normalizeMusicKind(raw: unknown): MusicKind {
    return typeof raw === 'string' && (MUSIC_KINDS as string[]).includes(raw) ? (raw as MusicKind) : 'music';
}
