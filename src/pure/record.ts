// 通用 JSON 防御工具（services 数据源共用）：未知结构安全读取
// 原为 douban.ts / tmdb.ts / bangumi.ts 各一份重复定义，下沉统一（纯逻辑，TDD 锁定）

/** 将任意值安全转为对象（null/非对象 → {}；数组因 typeof === 'object' 保持原引用） */
export function asRecord(v: unknown): Record<string, unknown> {
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
}

/** 从日期字符串提取年份（YYYY 前缀；非字符串或无匹配 → undefined） */
export function parseYear(dateStr: unknown): number | undefined {
    if (typeof dateStr !== 'string') return undefined;
    const m = /^(\d{4})/.exec(dateStr);
    return m ? Number(m[1]) : undefined;
}
