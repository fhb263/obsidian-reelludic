// 往年年度报告索引（纯逻辑，无 obsidian 依赖，可单测）
// 报告路径形如 {libraryDir}/报告/YYYY-年度总结.md（生成方：pure/report.yearReportPath）。
// pure 层只负责「文件名 → 年份解析 + 降序罗列」，目录前缀过滤由调用方（vault 文件列表）负责。

/** 从报告文件路径解析年份；非 `YYYY-年度总结.md` 命名返回 null */
export function parseReportYear(path: string): number | null {
    const m = /(?:^|\/)(\d{4})-年度总结\.md$/.exec(path);
    if (!m) return null;
    const y = Number(m[1]);
    return Number.isInteger(y) && y >= 1000 && y <= 9999 ? y : null;
}

/** 罗列年度报告（含年份与完整路径），年份降序；非法命名自动剔除 */
export function listReportYears(paths: string[]): { year: number; path: string }[] {
    const out: { year: number; path: string }[] = [];
    for (const p of paths) {
        const y = parseReportYear(p);
        if (y !== null) out.push({ year: y, path: p });
    }
    return out.sort((a, b) => b.year - a.year);
}
