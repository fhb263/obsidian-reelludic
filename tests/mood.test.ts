// #772 心情系统（m07854 ⑳）守卫
//
// 七组断言，钉住四件事：
//   ① `pure/mood` 的六档定义本身（顺序、id、emoji、文案）—— 这层是 UI / 落盘 / 读回的共同真源；
//   ② 数据层三处**必须同时**改到（types 字段 / normalizeEntry 白名单 / META_FIELDS 登记）——
//      漏白名单是本仓踩过多次的「保存即静默丢弃」；
//   ③ 落盘**存 id 不存 emoji**（emoji 换字体渲染会飘，且用户改文案就废）；
//   ④ 读侧 `noteEditable` 有 handler 且走同一白名单（手改笔记能读回）。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { MediaEntry } from 'data/types';
import { parseTableCellInput, tableCellText } from 'pure/tableCell';
import {
    MOODS,
    MOOD_IDS,
    isMoodId,
    moodChipTip,
    moodDefOf,
    moodEmoji,
    moodFromText,
    moodLabel,
    moodText,
    moodTip,
    normalizeMood,
} from 'pure/mood';

const ROOT = resolve(__dirname, '..');
const read = (p: string): string => readFileSync(resolve(ROOT, p), 'utf8');
/**
 * 剥注释：**状态机**逐字符扫描，识别引号字符串 / 行注释 / 块注释 / HTML 注释。
 *
 * 🔴 为什么不用交替正则（本仓历史做法）：Svelte 模板里存在 `accept="image/*"` 这类
 *    字符串字面量，里面的斜杠星号会被当成块注释起始 —— 实测在 `EntryForm.svelte` 里
 *    一次吞掉 **123508 字符**（从模板开头一直吃到 `<style>` 里第一个注释结束符），
 *    于是所有模板断言集体假红。正则看得见字符、看不见「这是不是字符串」，
 *    这类判断只能靠状态机。
 *
 * ⚠️ 已知取舍：英文文案里孤立的撇号（如 don't）会被当成字符串起始，
 *    最坏情况是「注释没被剥掉」⇒ 出现假红（严格方向），不会假绿。
 */
function stripSource(src: string): string {
    let out = '';
    let i = 0;
    const n = src.length;
    while (i < n) {
        const c = src[i];
        const c2 = src[i + 1];
        // HTML / Svelte 注释
        if (c === '<' && src.startsWith('<!--', i)) {
            const end = src.indexOf('-->', i + 4);
            i = end < 0 ? n : end + 3;
            continue;
        }
        // 行注释
        if (c === '/' && c2 === '/') {
            const nl = src.indexOf('\n', i);
            i = nl < 0 ? n : nl;
            continue;
        }
        // 块注释
        if (c === '/' && c2 === '*') {
            const end = src.indexOf('*/', i + 2);
            i = end < 0 ? n : end + 2;
            continue;
        }
        // 字符串字面量：原样保留（不剥），并整段跳过，避免误开注释
        if (c === '"' || c === "'" || c === '`') {
            const quote = c;
            out += c;
            i += 1;
            while (i < n) {
                if (src[i] === '\\') {
                    out += src[i] + (src[i + 1] ?? '');
                    i += 2;
                    continue;
                }
                out += src[i];
                if (src[i] === quote) {
                    i += 1;
                    break;
                }
                i += 1;
            }
            continue;
        }
        out += c;
        i += 1;
    }
    return out;
}

describe('pure/mood：六档定义', () => {
    it('正好六档，顺序与用户给定一致（震撼/治愈/烧脑/致郁/无聊/受罪）', () => {
        expect(MOODS).toHaveLength(6);
        expect(MOODS.map((m) => m.label)).toEqual(['震撼', '治愈', '烧脑', '致郁', '无聊', '受罪']);
        expect(MOODS.map((m) => m.alt)).toEqual(['神作', '开心', '思考', '破防', '犯困', '愤怒']);
        expect(MOODS.map((m) => m.emoji)).toEqual(['🤩', '🥰', '🤔', '😭', '😴', '🤬']);
    });

    it('id 是稳定的英文键（⛔ 不是 emoji、不是中文）', () => {
        expect(MOODS.map((m) => m.id)).toEqual(['wow', 'heal', 'brain', 'sad', 'meh', 'rage']);
        for (const id of MOOD_IDS) expect(id).toMatch(/^[a-z]+$/);
    });

    it('MOOD_IDS 与 MOODS 同源（⛔ 别是手抄的第二份数组）', () => {
        expect([...MOOD_IDS]).toEqual(MOODS.map((m) => m.id));
    });

    it('6 个 emoji 互不相同（重复会让两档看起来一样）', () => {
        expect(new Set(MOODS.map((m) => m.emoji)).size).toBe(6);
    });
});

describe('pure/mood：归一与取文案', () => {
    it('合法 id 原样返回', () => {
        for (const id of MOOD_IDS) expect(normalizeMood(id)).toBe(id);
    });

    it('🔴 非法值一律 undefined，⛔ 不回退第一档（否则没填过的条目全被染成「震撼」）', () => {
        for (const bad of ['', 'WOW', '震撼', '🤩', null, undefined, 0, 1, {}, [], 'unknown']) {
            expect(normalizeMood(bad)).toBeUndefined();
        }
    });

    it('isMoodId 是守卫（字符串窄化）', () => {
        expect(isMoodId('wow')).toBe(true);
        expect(isMoodId('nope')).toBe(false);
        expect(isMoodId(null)).toBe(false);
    });

    it('缺省 / 非法时所有取文案函数返回空串（⛔ 不返回 undefined，模板直接插不会露字）', () => {
        expect(moodEmoji(undefined)).toBe('');
        expect(moodLabel(undefined)).toBe('');
        expect(moodTip(undefined)).toBe('');
        expect(moodText(undefined)).toBe('');
        expect(moodDefOf(undefined)).toBeUndefined();
        // @ts-expect-error 故意传非法值，验证运行时也不炸
        expect(moodEmoji('bogus')).toBe('');
    });

    it('moodText 是「emoji + 空格 + 主名」', () => {
        expect(moodText('wow')).toBe('🤩 震撼');
        expect(moodText('rage')).toBe('🤬 受罪');
    });

    it('moodTip 是「主名 / 副名」', () => {
        expect(moodTip('heal')).toBe('治愈 / 开心');
        expect(moodTip('meh')).toBe('无聊 / 犯困');
    });

    it('选中态提示额外说明「再点一次取消」（可清除语义要能被发现）', () => {
        expect(moodChipTip('wow', false)).toBe('震撼 / 神作');
        expect(moodChipTip('wow', true)).toContain('再点一次取消');
    });
});

describe('moodFromText：文本 → id（表格单元格 / 手改笔记入口）', () => {
    it('稳定 id 原样认', () => {
        for (const id of MOOD_IDS) expect(moodFromText(id)).toBe(id);
    });

    it('主名、带 emoji 的展示形态、纯 emoji 三种写法都认', () => {
        expect(moodFromText('震撼')).toBe('wow');
        expect(moodFromText('🤩 震撼')).toBe('wow');
        expect(moodFromText('🤩')).toBe('wow');
        expect(moodFromText('受罪')).toBe('rage');
        expect(moodFromText('🤬 受罪')).toBe('rage');
    });

    it('🔴 与 moodText 闭环：显示什么就能填回什么（表格往返靠这条）', () => {
        for (const id of MOOD_IDS) expect(moodFromText(moodText(id))).toBe(id);
    });

    it('前后空白无关（用户从表格里复制常带空格）', () => {
        expect(moodFromText('  治愈  ')).toBe('heal');
        expect(moodFromText('\t😭 致郁\n')).toBe('sad');
    });

    it('🔴 空串 / 非法值 ⇒ undefined，⛔ 不回退第一档', () => {
        for (const bad of ['', '   ', '爽', '😀', 'woww', 'WOW']) {
            expect(moodFromText(bad)).toBeUndefined();
        }
    });
});

describe('数据层三处必须同时改到', () => {
    it('types.ts 有 mood 字段，且类型是 MoodId（⛔ 不是 string）', () => {
        const t = stripSource(read('src/data/types.ts'));
        expect(t).toMatch(/mood\?:\s*MoodId;/);
        expect(t).toMatch(/import type \{ MoodId \} from 'pure\/mood';/);
    });

    it('🔴 catalog.normalizeEntry 白名单里有 mood（漏了会被静默丢弃）', () => {
        const t = stripSource(read('src/data/catalog.ts'));
        expect(t).toMatch(/mood:\s*normalizeMood\(raw\.mood\)/);
        expect(t).toMatch(/import \{ normalizeMood \} from 'pure\/mood';/);
    });

    it('META_FIELDS 登记了 mood，形态是 enum，⛔ 不是 number（心情不参与均分）', () => {
        const t = stripSource(read('src/pure/metaFields.ts'));
        const line = t.split('\n').find((l) => l.includes("key: 'mood'"));
        expect(line).toBeTruthy();
        expect(line).toContain("kind: 'enum'");
        expect(line).toContain('writable: true');
        expect(line).toContain('readable: true');
        expect(line).not.toContain("kind: 'number'");
    });

    it('mood 登记紧跟在 rating 之后（表单与属性表同序：评分 → 心情 → 评语）', () => {
        const t = stripSource(read('src/pure/metaFields.ts'));
        const ratingAt = t.indexOf("key: 'rating'");
        const moodAt = t.indexOf("key: 'mood'");
        expect(ratingAt).toBeGreaterThan(-1);
        expect(moodAt).toBeGreaterThan(ratingAt);
        // 两者之间不应夹着别的字段登记（否则顺序就漂了）。
        // ⚠️ 起点要跳过 rating 自己那一段，否则 `key: 'rating'` 会被当成「夹在中间的字段」。
        const between = t.slice(ratingAt + "key: 'rating'".length, moodAt);
        expect(between).not.toMatch(/key: '/);
    });
});

describe('写侧：entryFrontmatter 落 id，⛔ 不落 emoji', () => {
    it('有值才写一行 mood（无值不写空属性行）', () => {
        const t = stripSource(read('src/data/noteGenerator.ts'));
        // ⚠️ 别在这里用反引号描述目标代码 —— 测试文件本身是 .ts，反引号会开模板字符串
        expect(t).toMatch(/if \(e\.mood\) lines\.push\(/);
        expect(t).toMatch(/mood: \$\{e\.mood\}/);
    });

    it('🔴 frontmatter 那一行里⛔ 不出现任何 emoji', () => {
        const t = stripSource(read('src/data/noteGenerator.ts'));
        const line = t.split('\n').find((l) => l.includes('mood: ${e.mood}'));
        expect(line).toBeTruthy();
        expect(line!).not.toMatch(/[🤩🥰🤔😭😴🤬]/u);
    });

    it('🔴 2026-11-14：正文里已没有「心情」那张属性表行（改由 ` ```reelludic ` 条目卡承载）', () => {
        const t = stripSource(read('src/data/noteGenerator.ts'));
        // 旧实现是 `['心情', moodText(e.mood)]` 塞进 `| 属性 | 内容 |` 表格；m04138 把整张表换成条目卡后
        // 这条通道必须彻底消失 —— 留一行就是两份真源，改一处另一处不动。
        expect(t).not.toMatch(/\[\s*'心情'/);
        expect(t).not.toMatch(/moodText\(/);
        expect(t).not.toMatch(/import \{ moodText \}/);
    });

    it('🔴 2026-11-14：心情的「🤩 震撼」展示改由条目卡的选项标签提供（裸 id 仍落 frontmatter）', () => {
        const card = stripSource(read('src/pure/noteCard.ts'));
        // 卡片的下拉选项 = `MOODS.map(m => ({ value: m.id, label: `${m.emoji} ${m.label}` }))`
        expect(card).toMatch(/MOODS\.map\(\(m\) => \(\{ value: m\.id, label: `/);
        expect(card).toMatch(/m\.emoji/);
        // 而 frontmatter 侧仍然只落裸 id（上面那条 emoji 守卫与之互补）
        const gen = stripSource(read('src/data/noteGenerator.ts'));
        expect(gen).toMatch(/mood: \$\{e\.mood\}/);
    });
});

describe('读侧：笔记里手改 mood 能读回', () => {
    it('noteEditable 有 mood handler，且走 normalizeMood 白名单', () => {
        const t = stripSource(read('src/pure/noteEditable.ts'));
        expect(t).toMatch(/mood:\s*\(v, \{ str: s \}\) =>/);
        expect(t).toMatch(/out\.mood = m;/);
        expect(t).toMatch(/import \{ normalizeMood \} from 'pure\/mood';/);
    });

    it('非法 id 在读侧也不落（⛔ 不回退第一档）', () => {
        const t = stripSource(read('src/pure/noteEditable.ts'));
        const start = t.indexOf('mood: (v,');
        const block = t.slice(start, start + 400);
        expect(block).toContain('if (m !== undefined)');
        expect(block).not.toMatch(/out\.mood = [^m]/); // 只能从归一结果赋，⛔ 别直赋原值
    });
});

describe('表单接线', () => {
    const form = stripSource(read('src/views/components/EntryForm.svelte'));

    it('「个人状态与评价」段落有心情 chips，且排在个人评分与个人评语之间', () => {
        // 🔴 用户 m01782：「编辑属性表单的心情改成『个人心情』」——
        //    标签文案改了，锚点跟着改。⛔ 不要退回裸「心情」：
        //    那是用户明确点名要改掉的说法，改回来就是回归。
        const labelMood = form.indexOf('<div class="rl-lbl" id="rl-mood-lbl">个人心情</div>');
        const labelNotes = form.indexOf('<label class="rl-lbl">个人评语</label>');
        const stars = form.indexOf('class="rl-stars-input"');
        expect(stars).toBeGreaterThan(-1);
        expect(labelMood).toBeGreaterThan(stars);
        expect(labelNotes).toBeGreaterThan(labelMood);
    });

    it('标签文案是「个人心情」（⛔ 别退回裸「心情」）', () => {
        expect(form).not.toContain('<div class="rl-lbl" id="rl-mood-lbl">心情</div>');
    });

    it('六档走 MOODS 渲染（⛔ 不在模板里手抄 emoji 数组）', () => {
        expect(form).toMatch(/\{#each MOODS as m\}/);
        expect(form).toContain('{m.emoji}');
        expect(form).toContain('{m.label}');
    });

    it('点已选中的档位 = 取消（可清除）', () => {
        expect(form).toMatch(/mood = mood === id \? '' : id/);
    });

    it('submit 带 input.mood，且过 normalizeMood 收口', () => {
        expect(form).toMatch(/input\.mood = normalizeMood\(mood\)/);
    });

    it('aria-pressed 跟着选中态走（无障碍）', () => {
        expect(form).toMatch(/aria-pressed=\{mood === m\.id\}/);
    });

    it('🔴 心情 chip 是 <button>，样式里三件（background/border/box-shadow）都显式压过核心灰底', () => {
        expect(form).toMatch(/\.rl-mood-chip \{/);
        const at = form.indexOf('.rl-mood-chip {');
        const block = form.slice(at, at + 600);
        expect(block).toContain('background:');
        expect(block).toContain('border:');
        expect(block).toContain('box-shadow:');
    });

    it('样式⛔ 不用 hex 硬编码（全走主题变量，换主题才不炸）', () => {
        const at = form.indexOf('.rl-mood-row {');
        expect(at).toBeGreaterThan(-1);
        const block = form.slice(at, form.indexOf('.rl-mood-label {', at));
        expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    });
});

// ══════════════════════════════════════════════════════════════════════════════
// 表格视图那一列（#621 的池子是「登记即入池」，所以心情一旦 writable+readable
// 就自动成为可编辑列 —— 那里必须有读写绑定，否则「点开就写不回去」）
// ══════════════════════════════════════════════════════════════════════════════
describe('表格单元格：心情列能读能写', () => {
    const cell = stripSource(read('src/pure/tableCell.ts'));

    it('🔴 有 mood 绑定（缺了它池子守卫会红，且那一列点开写不回去）', () => {
        expect(cell).toMatch(/mood: flat\('mood'\)/);
    });

    it('🔴 显示成人话（emoji + 主名），⛔ 不把裸 id 摆给用户', () => {
        expect(cell).toMatch(/if \(key === 'mood'\) return moodText\(normalizeMood\(v\)\)/);
    });

    it('🔴 解析按 key 分叉：心情⛔ 不落到「状态只认 想看/在看/已看/搁置」那条路', () => {
        // enum 分叉里必须先判 mood，再走 statusFromText
        const enumAt = cell.indexOf("if (kind === 'enum')");
        const moodAt = cell.indexOf("if (key === 'mood')", enumAt);
        const statusAt = cell.indexOf('statusFromText(e.type, t)', enumAt);
        expect(enumAt).toBeGreaterThan(-1);
        expect(moodAt).toBeGreaterThan(enumAt);
        expect(statusAt).toBeGreaterThan(moodAt);
    });

    it('解析走 moodFromText，非法值给一句说清六档的原因（⛔ 静默吞掉）', () => {
        expect(cell).toMatch(/const mv = moodFromText\(t\)/);
        expect(cell).toMatch(/reason: '心情填 震撼 \/ 治愈 \/ 烧脑 \/ 致郁 \/ 无聊 \/ 受罪/);
    });

    it('🔴 真跑一遍往返：六档都能「显示 → 解析 → 还是同一档」', () => {
        // 源码断言钉的是「接线在不在」，这条钉的是「接得对不对」—— 两者不可互相替代
        const base = { id: 'e1', type: 'movie', title: 't', status: 'watching' } as MediaEntry;
        for (const m of MOODS) {
            const e = { ...base, mood: m.id } as MediaEntry;
            const text = tableCellText(e, 'mood');
            expect(text, `${m.id} 的显示文本`).toBe(moodText(m.id));
            const r = parseTableCellInput(e, 'mood', text);
            expect(r.ok, `${m.id} 应能解析回来`).toBe(true);
            if (r.ok) expect(r.patch.mood).toBe(m.id);
        }
    });

    it('🔴 空值显示空串（由调用方渲染 —），清空解析成 undefined 而不是拒绝', () => {
        const e = { id: 'e1', type: 'movie', title: 't', status: 'watching' } as MediaEntry;
        expect(tableCellText(e, 'mood')).toBe('');
        const r = parseTableCellInput(e, 'mood', '   ');
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.patch.mood).toBeUndefined();
    });

    it('非法心情文本被拒绝，且原因是心情口径而不是状态口径', () => {
        const e = { id: 'e1', type: 'movie', title: 't', status: 'watching' } as MediaEntry;
        const r = parseTableCellInput(e, 'mood', '爽');
        expect(r.ok).toBe(false);
        if (!r.ok) {
            expect(r.reason).toContain('心情');
            expect(r.reason).not.toContain('状态只认');
        }
    });
});
