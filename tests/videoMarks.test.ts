// 进度条打点/标记的纯逻辑（`pure/videoMarks`）：从条目笔记解析出「时间戳点」→ 过滤到当前集 → 换算成百分比 → 命中判定。
//
// 为什么是纯模块：这些判据全都**没有 DOM/vault 依赖**，但每一条都容易静默出错，必须单测钉死：
//   ① 只认两区（`## 时间戳` / `## 截图`）—— 正文/摘抄区里的链接**不许**被当成标记
//   ② **认链接目标、不认显示文字** —— 老笔记里 `[7:46·回到视频](…)` 与新格式 `[7:46](…)` 都要认
//   ③ 多集：库外深链按 `ep` 过滤；**库内链接只有文件名**（可能带 `<…>` 与 URL 编码）→ 按文件名比
//   ④ 行号要准（「在笔记中打开」要滚到那一行）
//   ⑤ 卡片展开后**指针停在卡片上**时不许重算/收起（否则按钮点不动 —— 见文件末尾那组用例）
import { describe, expect, it } from 'vitest';
import {
    MARK_SECTIONS,
    hitMark,
    inBarBand,
    markCaption,
    markPct,
    marksForEpisode,
    parseNoteMarks,
    pointerOnCard,
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

    it('区名单就是「时间戳 / 截图」两项（改这里等于改数据来源）', () => {
        expect([...MARK_SECTIONS]).toEqual(['时间戳', '截图']);
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

describe('pure/videoMarks markPct / hitMark', () => {
    it('百分比：按总时长折算并夹在 0~1；总时长未知（0/负）→ 0', () => {
        expect(markPct(30, 120)).toBeCloseTo(0.25);
        expect(markPct(-5, 120)).toBe(0);
        expect(markPct(999, 120)).toBe(1);
        expect(markPct(30, 0)).toBe(0);
    });

    it('命中判定：容差内取最近的一个；容差外 → -1（点空白不该跳）', () => {
        expect(hitMark([0.1, 0.5], 0.12, 0.05)).toBe(0); // 命中 0.1
        expect(hitMark([0.5, 0.52], 0.515, 0.05)).toBe(1); // 两个都在容差内 → 取最近的（0.52 距 0.005 < 0.5 距 0.015）
        expect(hitMark([0.1, 0.5], 0.3, 0.05)).toBe(-1); // 都不在容差内
        expect(hitMark([], 0.5, 0.1)).toBe(-1);
    });
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

describe('pure/videoMarks pointerOnCard（卡片展开后「指针停在卡片上」的判据）', () => {
    // 🔴 用户 2026-09-19 实测报障：「小圆点悬浮后，点『在笔记中打开』点不动」。
    //    根因就是这条判据缺失 —— 卡片画在**进度条上方**（`bottom: 22px`），指针必须从条上**向上**移进
    //    卡片才能按到按钮；这段位移期间：
    //      ① `pointerleave` 触发 → 旧代码把卡片 `hidden` 掉（卡片在眼前消失）
    //      ② `pointermove` 触发 → 旧代码 `tip.empty()` **重建卡片** ⇒ 按钮在 mousedown 与 mouseup
    //         之间被换掉 ⇒ 浏览器**不合成 click**（按钮永远点不动）
    //    ⇒ 判据抽成纯函数：「指针是否落在卡片矩形内（含容差）」= true 时**既不重算也不收起**。
    const card = { left: 100, top: 200, right: 300, bottom: 260 };

    it('卡片没展开（null）→ false（普通悬停照旧显示时间气泡）', () => {
        expect(pointerOnCard(null, 150, 230)).toBe(false);
    });

    it('指针落在卡片内 → true', () => {
        expect(pointerOnCard(card, 150, 230)).toBe(true);
        expect(pointerOnCard(card, 100, 200)).toBe(true); // 左上角
        expect(pointerOnCard(card, 300, 260)).toBe(true); // 右下角
    });

    it('容差 4px：贴着边缘（手抖）仍算在卡片上；再远一点就不算', () => {
        expect(pointerOnCard(card, 302, 262)).toBe(true); // 外扩 2px
        expect(pointerOnCard(card, 96, 196)).toBe(true); // 外扩 4px（正好落在容差上）
        expect(pointerOnCard(card, 90, 190)).toBe(false); // 外扩 10px → 不算
        expect(pointerOnCard(card, 150, 300)).toBe(false); // 卡片下方（进度条那一侧）→ 不算
    });

    it('🔴 没量到尺寸（`display:none` 时 rect 全 0）→ false —— 否则会把整条进度条都当成卡片', () => {
        expect(pointerOnCard({ left: 0, top: 0, right: 0, bottom: 0 }, 0, 0)).toBe(false);
        expect(pointerOnCard({ left: 10, top: 10, right: 10, bottom: 40 }, 10, 20)).toBe(false);
    });
});

describe('pure/videoMarks inBarBand（右键命中的**纵向**门控）', () => {
    // 🔴 2026-09-19 用户改判：打开方式从「卡片里的按钮」换成「悬停出卡片 → **右键**打开」。
    //    右键必须挂在播放器 **root** 上 —— 因为卡片是 `pointer-events: none`，卡片空白处的命中目标是
    //    **底层 video**（无头 Chrome 实测 `elementFromPoint`），事件根本不经过进度条。
    //    代价：**画面任何位置右键都会进到处理器里** ⇒ 必须用两道门控夹回进度条附近
    //    （横向 = `hitMark` 的 8px 容差；纵向 = 本函数），否则会吞掉用户在画面别处的正常右键菜单。
    const top = 700;
    const bottom = 714;

    it('落在进度条带内 → true', () => {
        expect(inBarBand(700, top, bottom)).toBe(true);
        expect(inBarBand(707, top, bottom)).toBe(true);
        expect(inBarBand(714, top, bottom)).toBe(true);
    });

    it('上下各 40px 之内 → true（卡片就悬在条上方，右键卡片要算命中）', () => {
        expect(inBarBand(660, top, bottom)).toBe(true); // 上方 40px
        expect(inBarBand(754, top, bottom)).toBe(true); // 下方 40px
    });

    it('🔴 出了带外（画面别处右键）→ false —— 不许吞掉系统右键菜单', () => {
        expect(inBarBand(659, top, bottom)).toBe(false);
        expect(inBarBand(755, top, bottom)).toBe(false);
        expect(inBarBand(300, top, bottom)).toBe(false); // 画面中部
    });

    it('非法值 → false（量不到 rect 时别误判）', () => {
        expect(inBarBand(NaN, top, bottom)).toBe(false);
        expect(inBarBand(700, NaN, bottom)).toBe(false);
    });
});
