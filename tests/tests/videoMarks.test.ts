// 进度条打点/标记的纯逻辑（`pure/videoMarks`）：从条目笔记解析出「时间戳点」→ 过滤到当前集 → 换算成百分比。
//
// 为什么是纯模块：这些判据全都**没有 DOM/vault 依赖**，但每一条都容易静默出错，必须单测钉死：
//   ① 只认那两区（写入名 `## 单时间戳` / `## 截图时间戳`，外加两个**历史区名** `## 时间戳` / `## 截图`
//      —— #587 改名不改旧笔记 ⇒ 老区里的标记照样读得出来）—— 正文/摘抄区里的链接**不许**被当成标记
//   ② **认链接目标、不认显示文字** —— 老笔记里 `[7:46·回到视频](…)` 与新格式 `[7:46](…)` 都要认
//   ③ 多集：库外深链按 `ep` 过滤；**库内链接只有文件名**（可能带 `<…>` 与 URL 编码）→ 按文件名比
//   ④ 行号要准（抽屉点「在笔记中打开」要滚到那一行）
// ⚠️ 🔴 #634：**进度条的命中判定不在本模块了** —— `hitMark` / `inBarBand` / `pointerOnCard` /
//    `MARK_DENSE_THRESHOLD` 随「进度条不再显示标记 + 取消该跳转笔记功能」一并删除（用户裁定）。
//    ⇒ 那几组用例也已撤（别照旧注释去找它们：file末尾那组讲的是卡片，卡片同样没了）。
import { describe, expect, it } from 'vitest';
import {
    MARK_SECTIONS,
    MARK_SECTION_SHOT,
    MARK_SECTION_SHOT_LEGACY,
    MARK_SECTION_STAMP,
    MARK_SECTION_STAMP_LEGACY,
    markCaption,
    markPct,
    marksForEpisode,
    parseNoteMarks,
} from 'pure/videoMarks';
import { buildTimeLink } from 'pure/videoLink';

const entryLink = (sec: number, ep = 0): string =>
    buildTimeLink({ seconds: sec, entryId: 'e_1', ep }) ?? '';
const vaultLink = (sec: number, file: string): string =>
    buildTimeLink({ seconds: sec, filePath: file }) ?? '';

describe('pure/videoMarks parseNoteMarks', () => {
    it('从「## 时间戳」/「## 截图」两区抽出标记（含种类、秒数、行号）', () => {
        const note = [
            '## 简介', '正文里的 [链接](https://example.com/#t=9) 不算', '',
            '## 时间戳', '', entryLink(466), '',
            '## 截图', '', '![[流浪地球2 7-46.png]]', vaultLink(466, '影片.mp4'), '',
            '## 观看链接', '（暂无链接）',
        ].join('\n');
        const marks = parseNoteMarks(note);
        expect(marks.map((m) => [m.kind, m.seconds])).toEqual([['stamp', 466], ['shot', 466]]);
        // 行号：0 基，指向该行本身
        expect(marks[0].line).toBe(5);
        expect(marks[1].line).toBe(9);
        expect(marks[1].image).toBe('流浪地球2 7-46.png');
        expect(marks[0].image).toBeUndefined();
    });

    it('🔴 只扫这两区：正文 / 摘抄区里的链接一律不算', () => {
        const note = [
            '## 个人评语', vaultLink(5, '影片.mp4'), '',
            '## 摘抄', entryLink(9), '',
            '## 时间戳', '', entryLink(466),
        ].join('\n');
        expect(parseNoteMarks(note).map((m) => m.seconds)).toEqual([466]);
    });

    it('🔴 认「链接目标」不认显示文字：老格式（带「·回到视频」）与新格式都要认', () => {
        const legacy = '[7:46·回到视频](obsidian://reelludic?action=video&entry=e_1&ep=0&t=466)';
        const note = ['## 时间戳', '', legacy, entryLink(60)].join('\n');
        expect(parseNoteMarks(note).map((m) => m.seconds)).toEqual([466, 60]);
    });

    it('缺 `#t=` / 秒数非法 → 跳过（不产出坏标记）', () => {
        const note = [
            '## 时间戳',
            '- 只是文字，没有链接',
            '[有链接但没时间](obsidian://reelludic?action=video&entry=e_1&t=abc)',
            '[外链不接管](https://example.com/v.mp4#t=3)',
            entryLink(7),
        ].join('\n');
        expect(parseNoteMarks(note).map((m) => m.seconds)).toEqual([7]);
    });

    it('空笔记 / 没有这两区 → 空数组', () => {
        expect(parseNoteMarks('')).toEqual([]);
        expect(parseNoteMarks('## 简介\n随便写点什么')).toEqual([]);
    });

    it('区标题带尾随空格、重复出现两区都能读', () => {
        const note = ['## 时间戳  ', '', entryLink(1), '', '## 截图', '', vaultLink(2, 'a.mp4'), '', '## 截图', '', vaultLink(3, 'a.mp4')].join('\n');
        const marks = parseNoteMarks(note);
        expect(marks.map((m) => m.seconds)).toEqual([1, 2, 3]);
        expect(marks.map((m) => m.kind)).toEqual(['stamp', 'shot', 'shot']);
    });

    it('🔴 #587 区名单 = **新名 + 历史名**四项（改这里等于改数据来源；漏掉历史名就是静默丢旧数据）', () => {
        expect(MARK_SECTION_STAMP).toBe('单时间戳');
        expect(MARK_SECTION_SHOT).toBe('截图时间戳');
        expect(MARK_SECTION_STAMP_LEGACY).toBe('时间戳');
        expect(MARK_SECTION_SHOT_LEGACY).toBe('截图');
        expect([...MARK_SECTIONS]).toEqual(['单时间戳', '截图时间戳', '时间戳', '截图']);
    });

    it('🔴 #587 新名两区照样解析（写入已切到新名；老笔记的历史名也仍读得到）', () => {
        const note = [
            '## 单时间戳', '', entryLink(466), '',
            '## 截图时间戳', '', '![[图 7-46.png]]', vaultLink(466, '影片.mp4'), '',
            '## 时间戳', '', entryLink(60), '',
            '## 截图', '', vaultLink(75, '影片.mp4'),
        ].join('\n');
        const marks = parseNoteMarks(note);
        expect(marks.map((m) => [m.kind, m.seconds])).toEqual([
            ['stamp', 466], ['shot', 466], ['stamp', 60], ['shot', 75],
        ]);
        // 新名那两区的种类判定与旧名一致：`## 截图时间戳` 走取图逻辑
        expect(marks[1].image).toBe('图 7-46.png');
    });
});

describe('pure/videoMarks marksForEpisode', () => {
    const note = [
        '## 时间戳',
        entryLink(10, 0), // 深链 · 第 0 集
        entryLink(20, 1), // 深链 · 第 1 集
        vaultLink(30, '影片 第1集.mp4'),
        vaultLink(40, '目录/影片 第2集.mp4'),
    ].join('\n');
    const marks = parseNoteMarks(note);

    it('库外深链按 `ep` 过滤；库内链接按**文件名**过滤（并与当前集一致）', () => {
        expect(marksForEpisode(marks, { ep: 1, fileName: '影片 第1集.mp4' }).map((m) => m.seconds)).toEqual([20, 30]);
    });

    it('库内链接：`<>` 包裹与 URL 编码都能对上；路径不同但同名也算同一集', () => {
        const enc = parseNoteMarks(['## 时间戳', vaultLink(75, '目录/我的 影片.mp4')].join('\n'));
        expect(marksForEpisode(enc, { ep: 0, fileName: '我的 影片.mp4' }).map((m) => m.seconds)).toEqual([75]);
    });

    it('🔴 别的集的点不许混进来（多集时间轴不同，混画会误导成同一个位置）', () => {
        expect(marksForEpisode(marks, { ep: 0, fileName: '别的影片.mp4' }).map((m) => m.seconds)).toEqual([10]);
        expect(marksForEpisode(marks, { ep: 5, fileName: '' })).toEqual([]);
    });

    it('没给文件名 → 库内点一律不认（宁可不画，也别画错位置）', () => {
        expect(marksForEpisode(marks, { ep: 0 }).map((m) => m.seconds)).toEqual([10]);
    });

    it('保持笔记里的先后顺序，且不改动原数组', () => {
        const before = marks.slice();
        const got = marksForEpisode(marks, { ep: 1, fileName: '影片 第1集.mp4' });
        expect(got.map((m) => m.seconds)).toEqual([20, 30]);
        expect(marks).toEqual(before);
    });
});

describe('pure/videoMarks markPct', () => {
    it('百分比：按总时长折算并夹在 0~1；总时长未知（0/负）→ 0', () => {
        expect(markPct(30, 120)).toBeCloseTo(0.25);
        expect(markPct(-5, 120)).toBe(0);
        expect(markPct(999, 120)).toBe(1);
        expect(markPct(30, 0)).toBe(0);
    });
    // 🔴 #634：`hitMark` / `inBarBand` / `pointerOnCard` / `MARK_DENSE_THRESHOLD` 的用例**已随功能删除** ——
    //    进度条不再画标记圆点、也不再有点击/右键命中判定（用户裁定，见 `pure/videoMarks` 文件头）。
    //    ⛔ 别保留「反正还导出着」的测试：那条导出已被删（本仓「死码不留」），测试会直接编译不过。
});

describe('pure/videoMarks markCaption（悬停卡片里那句「用户手写的补充说明」）', () => {
    it('剥掉链接与图片，只留手写文字；空白压成一个空格', () => {
        expect(markCaption('[7:46](obsidian://reelludic?action=video&entry=e_1&t=466) 这里的配乐很好')).toBe('这里的配乐很好');
        expect(markCaption('![[图 7-46.png]] 顺带截一张')).toBe('顺带截一张');
        expect(markCaption('![[图.png]]\n[7:46](a.mp4#t=466)')).toBe(''); // 只有图与链接 → 没有补充说明
        expect(markCaption('[7:46](a.mp4#t=466)')).toBe('');
        expect(markCaption('')).toBe('');
    });
});

