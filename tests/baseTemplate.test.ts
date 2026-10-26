// Bases（.base）模板生成器的守卫（2026-10-20）
//
// 🔴 本文件的核心是**写侧交叉校验**：模板里出现的每一个属性名，都必须在
//    `data/noteGenerator.entryFrontmatter` 的实际输出里出现过。
//
// 为什么必须自动校验：Bases 对未知属性名**不报错**，只是那一列恒空。
// 一旦有人给模板加了个 `bookKind` 之类的列（catalog 里有、frontmatter 没有），
// 用户在 Obsidian 里只会看到一片空白 —— 这种 bug 在 tsc 和单测之外活得很久，
// 只能靠「拿真 frontmatter 的键集合去减」来拦。
import { describe, it, expect } from 'vitest';
import { entryFrontmatter } from 'data/noteGenerator';
import { ENTRY_TYPE_LABELS, ENTRY_TYPES, type EntryType, type MediaEntry } from 'data/types';
import { buildBaseTemplate, baseNotesFolder, baseTemplatePath, baseTemplateFile, baseSnippetPath, BASE_TEMPLATE_FILE_LEGACY, BASE_SNIPPET_FILE, IMAGE_ASPECT_RATIO, COMMUNITY_SCORE_PROP, posterCardSizeForColumns } from 'pure/baseTemplate';
import { POSTER_CARD_MIN_WIDTHS } from 'pure/posterGrid';
import { MEDIA_STATUSES, STATUS_LABELS } from 'pure/status';
// 🔴 真 YAML 解析器 —— 这是本文件唯一的**真门**。理由见下面「整份文件必须能被真 YAML 解析器 parse」那条。
import { parse as parseYaml } from 'yaml';

const CTX = { libraryDir: 'ReelLudic', pluginVersion: '1.4.0' };

/** 填满所有与 frontmatter 有关的字段（与 tests/metaFields.test.ts 同款；各 type 独有字段由生成器自己门控） */
function fullEntry(type: EntryType): MediaEntry {
    return {
        id: 'e1',
        type,
        title: '标题',
        status: 'watching',
        rating: 4,
        year: 2020,
        genres: ['题材'],
        cast: ['演员'],
        director: '导演',
        screenwriter: ['编剧'],
        country: '中国',
        language: '中文',
        durationMin: 100,
        aliases: ['又名'],
        author: '作者',
        artist: '画师',
        translator: '译者',
        publisher: '出版社',
        producer: '出品方',
        isbn: '9780000000000',
        binding: '平装',
        price: '¥ 68',
        series: '系列名',
        seriesIndex: 1,
        platform: 'PC',
        developer: '开发商',
        album: '专辑名',
        poster: '封面/x.jpg',
        tags: ['标签'],
        links: [],
        notes: '',
        watchedDate: '2024-03-08',
        plannedDate: '2024-04-09',
        pageCount: 320,
        readMinutes: 90,
        playtimeMinutes: 120,
        readingProgress: { page: 10, totalPage: 100 },
        progress: { season: 1, episode: 3, totalEpisodes: 12, history: [] },
        createdAt: '2026-08-25T00:00:00.000Z',
        updatedAt: '2026-08-25T00:00:00.000Z',
    };
}

/**
 * 笔记类型子目录名（`笔记/` 下那一层）—— **测试侧独立复算**，不从被测模块 import。
 * 为什么要独立：如果两边共用同一个函数，「漏了某个目录」这类错误会同时出现在实现和断言里，
 * 守卫就成了空转。这里直接用 frontmatter 的类型枚举 + 书籍三分类的字面量。
 * ⚠️ 改这里之前先看 `src/data/types.ts` 的 ENTRY_TYPE_DIRS 与 `src/pure/dirs.ts` 的 BOOK_KIND_DIRS。
 */
function actualNoteDirs(): string[] {
    return ['movie', 'teleplay', 'animation', 'book', 'novel', 'comic', 'game', 'music'];
}

/** 六个类型实际写出的 frontmatter 顶层键（`file.` 前缀的 Bases 内置属性不算，见测试内注释） */
function actualFrontmatterKeys(): Set<string> {    const out = new Set<string>();
    for (const t of ['movie', 'tv', 'anime', 'book', 'game', 'music'] as EntryType[]) {
        const body = /^---\n([\s\S]*?)\n---/.exec(entryFrontmatter(fullEntry(t)))?.[1] ?? '';
        for (const line of body.split('\n')) {
            const idx = line.indexOf(':');
            if (idx > 0) out.add(line.slice(0, idx).trim());
        }
    }
    return out;
}

/** 从生成的 .base 里抠出所有 `order: - xxx` 的列键（Bases 的属性模式就是 order） */
function columnKeys(yaml: string): string[] {
    const keys: string[] = [];
    let inColumns = false;
    for (const line of yaml.split('\n')) {
        const t = line.trim();
        if (t === 'order:') {
            inColumns = true;
            continue;
        }
        if (inColumns && t.startsWith('- ')) {
            keys.push(t.slice(2).trim());
            continue;
        }
        // 遇到非列表项即离开 columns 区（下一次 columns: 会重新进入）
        if (inColumns && t && !t.startsWith('- ')) inColumns = false;
    }
    return keys;
}

/** 从 `filters: - 'note.xxx …'` 里抠出被引用的 note 属性名 */
function referencedNoteProps(yaml: string): string[] {
    const out: string[] = [];
    for (const m of yaml.matchAll(/'(note\.[A-Za-z_][\w\u4e00-\u9fa5]*)'/g)) out.push(m[1]);
    return out;
}

describe('baseTemplate · 路径口径', () => {
    it('笔记目录 = {libraryDir}/笔记（与 main.ts 组装 EntryService 的口径一致）', () => {
        expect(baseNotesFolder('ReelLudic')).toBe('ReelLudic/笔记');
        expect(baseNotesFolder('我的库')).toBe('我的库/笔记');
    });

    it('libraryDir 有前导/尾部斜杠或反斜杠时归一（不留双斜杠、不留前导斜杠）', () => {
        expect(baseNotesFolder('/ReelLudic/')).toBe('ReelLudic/笔记');
        expect(baseNotesFolder('ReelLudic\\\\')).toBe('ReelLudic/笔记');
        expect(baseNotesFolder('')).toBe('ReelLudic/笔记');
    });

    it('🔴 模板文件名跟着媒体库目录名走（#690）：{libraryDir}/{目录名}.base', () => {
        expect(baseTemplatePath('ReelLudic')).toBe('ReelLudic/ReelLudic.base');
        expect(baseTemplatePath('媒体库')).toBe('媒体库/媒体库.base');
        expect(baseTemplatePath('我的库/')).toBe('我的库/我的库.base');
        expect(baseTemplatePath('')).toBe('ReelLudic/ReelLudic.base');
        // ⚠️ 目录名恰好等于旧硬编码名时，路径必须**逐字相同**（老文件原地复用，不多出一份）
        expect(baseTemplatePath('ReelLudic')).toBe(`ReelLudic/${BASE_TEMPLATE_FILE_LEGACY}`);
        // 🔴 含子目录时取**最后一级**目录名（用户 #690：「文件夹名叫什么就什么」，明确否掉 `媒体库-子库.base`）
        // ⛔ 不要再把整条路径的斜杠换成连字符 —— 那是上一版被用户打回的写法
        expect(baseTemplatePath('媒体库\\子库')).toBe('媒体库/子库/子库.base');
        expect(baseTemplatePath('a/b/深库/')).toBe('a/b/深库/深库.base');
        expect(baseTemplateFile('媒体库/子库')).toBe('子库.base');
    });

    it('🔴 样式片段必须落进 .obsidian/snippets/ 才会被 Obsidian 收进「CSS 代码片段」', () => {
        // ⛔ 跟着 .base 丢在媒体库里是不生效的 —— 那是「做了样式但看不到效果」的唯一原因
        expect(baseSnippetPath()).toBe(`.obsidian/snippets/${BASE_SNIPPET_FILE}`);
    });
});

describe('🔴 baseTemplate · 属性名必须真实存在于 frontmatter（Bases 不会报错，只会整列空）', () => {
    const actual = actualFrontmatterKeys();
    const yaml = buildBaseTemplate(CTX);

    it('测试用的样本确实覆盖了核心键（否则下面的断言是空转）', () => {
        for (const k of ['title', 'type', 'status', 'rating', 'banner', 'progress_percent', 'reading_page']) {
            expect(actual.has(k), `样本 frontmatter 里居然没有 ${k}`).toBe(true);
        }
    });

    it('columns 里的每个键都在 frontmatter 输出里', () => {
        const cols = columnKeys(yaml);
        expect(cols.length).toBeGreaterThan(0);
        const ghost = cols.filter((c) => !actual.has(c));
        expect(ghost, `模板列了 frontmatter 里没有的键（这些列在 Bases 里会恒定为空）：${ghost.join(', ')}`).toEqual([]);
    });

    it('filters 里引用的 note.xxx 也都在 frontmatter 输出里（type/status 除外 —— 它们是表达式比较的对象）', () => {
        const refs = [...new Set(referencedNoteProps(yaml))].map((r) => r.slice('note.'.length));
        const ghost = refs.filter((r) => !actual.has(r));
        expect(ghost, `filters 引用了 frontmatter 里没有的键：${ghost.join(', ')}`).toEqual([]);
    });

    it('template 里没有出现 catalog 独有、frontmatter 并不写的字段', () => {
        // 这几项是**已知陷阱**：catalog.json 有、entryFrontmatter 不写 ⇒ 写进模板就是恒空列。
        for (const trap of ['bookKind', 'musicKind', 'aiSummary', 'aiHighlights', 'summary']) {
            expect(columnKeys(yaml), `${trap} 不在 frontmatter 里，不能作为 Bases 列`).not.toContain(trap);
        }
    });
});

describe('baseTemplate · YAML 结构', () => {
    const yaml = buildBaseTemplate(CTX);

    /**
     * 🔴🔴 这一条是**真门**：整份产物必须能被真 YAML 解析器 parse 成功。
     *
     *    为什么必须有它：用户实测打开 .base 时报
     *    `A block sequence may not be used as an implicit map key at line 44` ——
     *    根因是顶层 `filters → and` 数组里，元素可以是 `{ or: [...] }` 这种嵌套过滤器对象，
     *    它作为**数组元素**必须写成 `- or:`；早先只写了裸 `or:`，被 YAML 当成上一层的映射键，
     *    紧跟着的兄弟 `- 'note.type'` 就成了「序列充当隐式映射键」，整份文件解析失败、所有视图一起打不开。
     *
     *    而**当时 41 条断言全绿** —— 因为它们全是「源码里包含某个字符串」的检查，
     *    没有一条问过「这份文件到底能不能被解析」。下面的逐行形状检查同理，
     *    它们对**缩进语义**一无所知（比如 KEY 白名单会把裸 `or:` 当合法行放行）。
     *    ⇒ 结构类的真值判断交给解析器，逐行检查只当补充说明。
     */
    it('🔴 整份文件必须能被真 YAML 解析器 parse 成功（用户实测过一次解析失败，这条是那道门的补丁）', () => {
        let doc: any;
        expect(() => { doc = parseYaml(yaml); }, `生成的 .base 不是合法 YAML —— Obsidian 会直接报「无法解析数据库文件」`).not.toThrow();
        expect(Object.keys(doc).sort()).toEqual(['filters', 'views']);

        // 顶层 filters：and[0] 必须是 8 目录的 or 节点（对象形态，不是塞了 || 的长字符串），and[1] 是类型守卫
        expect(Array.isArray(doc.filters.and), '顶层 filters 必须是 and 数组').toBe(true);
        const orNode = doc.filters.and.find((n: any) => n && typeof n === 'object' && Array.isArray(n.or));
        expect(orNode, `顶层 filters.and 里找不到 or 节点：${JSON.stringify(doc.filters)}`).toBeTruthy();
        const dirs = actualNoteDirs();
        expect(orNode.or.length, `or 节点该有 ${dirs.length} 个目录，实际 ${JSON.stringify(orNode.or)}`).toBe(dirs.length);
        for (const d of dirs) expect(orNode.or.some((e: any) => typeof e === 'string' && e.includes(`/${d}")`)), `or 节点漏了目录 ${d}`).toBe(true);
        expect(doc.filters.and.some((n: any) => typeof n === 'string' && n.includes('note.type'))).toBe(true);

        // 每个视图的 filters 解析后必须是「字符串 或 单键对象」构成的数组 —— 不允许出现残缺/串行的结构
        const viewsWithFilters = doc.views.filter((v: any) => v.filters !== undefined);
        // ⚠️ 这个下限只是「循环别在空转」，不是「视图该有几个带筛选」。
        //    2026-10-22 把 6 个类型海报墙 + 6 张类型表合并成 2 个按类型分组的视图后，
        //    带 filters 的视图从 24 降到 14（合并掉的 10 个都靠 groupBy 而非 filters 区分），
        //    ⇒ 下限跟着降到 10。真正的语义断言在下面「按类型分段」那几条里。
        expect(viewsWithFilters.length, '视图里几乎都该有 filters').toBeGreaterThanOrEqual(10);
        for (const v of viewsWithFilters) {
            expect(Array.isArray(v.filters.and), `视图「${v.name}」的 filters 必须是 and 数组：${JSON.stringify(v.filters)}`).toBe(true);
            for (const item of v.filters.and) {
                const isStr = typeof item === 'string';
                const isOneKeyObj = item && typeof item === 'object' && Object.keys(item).length === 1 && Array.isArray((item as any)[Object.keys(item)[0]]);
                expect(isStr || isOneKeyObj, `视图「${v.name}」的 filters 元素形态不对：${JSON.stringify(item)}`).toBe(true);
            }
            // 视图内不许抄 8 目录全量范围（那是顶层职责），但允许书籍跨 3 目录
            const flat = JSON.stringify(v.filters);
            expect((flat.match(/file\.inFolder\(/g) ?? []).length, `视图「${v.name}」抄了太多目录`).toBeLessThanOrEqual(3);
        }

        // groupBy 解析后必须是带 property 的对象；cards 视图不写 order
        for (const v of doc.views) {
            if (v.groupBy !== undefined) {
                expect(typeof v.groupBy, `视图「${v.name}」groupBy 解析出来不是对象`).toBe('object');
                expect(typeof v.groupBy.property, `视图「${v.name}」groupBy 缺 property`).toBe('string');
            }
            if (v.type === 'cards') expect(v.order, `cards 视图「${v.name}」不该有 order`).toBeUndefined();
            else expect(Array.isArray(v.order), `table 视图「${v.name}」缺 order 数组`).toBe(true);
        }

        // 视图数守住上限（Bases 靠标签栏切换，太多就没法用）
        expect(doc.views.length).toBeLessThanOrEqual(30);
    });

    /**
     * 🔴🔴 这类视图块级的检查**必须按行看缩进**，不能只 `toContain` 某段字符串。
     *    教训：视图内 filters 曾经渲染成 `filters:and:` / `filters:  - '...'`（缩进前缀被当缩进又拼了一层），
     *    产物是非法 YAML、Obsidian 直接判「无法解析」，而当时 41 条用例**全绿** —— 因为它们只查
     *    「包含某个表达式」，从不查「这一行在 YAML 里合法吗」。下面三条就是对那个缺口的补丁。
     */
    const viewLines = (): { name: string; lines: string[] }[] => {
        const out: { name: string; lines: string[] }[] = [];
        let cur: { name: string; lines: string[] } | null = null;
        for (const line of yaml.split('\n')) {
            const m = /^ {2}- type: \w+$/.exec(line);
            if (m) { cur = { name: '', lines: [] }; out.push(cur); continue; }
            if (cur) { cur.lines.push(line); const n = /^ {4}name: "(.+)"$/.exec(line); if (n) cur.name = n[1]; }
        }
        return out;
    };

    it('🔴 每一行都是合法 YAML 形状（不许出现 `filters:and:` 这种粘连）', () => {
        // 合法形状只有四种：顶层裸键、缩进键、缩进列表项、多行字符串续行。
        // ⚠️ 早先这里的白名单漏了「顶层裸键」（`views:` / `filters:` 没有前导空格），
        //    于是把合法行也报成坏行 —— 断言自己先要写对，否则它只会制造噪声。
        const BARE_KEY = /^[A-Za-z_][\w.]*:(?: .+)?$/;      // views:
        const KEY = /^( +)([A-Za-z_][\w.]*):(?: .+)?$/;       // "      and:"
        const ITEM = /^( +)- .+$/;                              // "        - 'expr'"
        const bad: string[] = [];
        for (const line of yaml.split('\n')) {
            if (!line.trim() || line.startsWith('#')) continue;
            if (BARE_KEY.test(line) || KEY.test(line) || ITEM.test(line)) continue;
            bad.push(line);
        }
        expect(bad, `这些行不是合法 YAML：\n${bad.join('\n')}`).toEqual([]);
    });

    it('🔴 视图内 filters 的缩进必须严格逐层递增（filters → and → 表达式）', () => {
        const withFilters = viewLines().filter((v) => v.lines.some((l) => /^ {4}filters:\s*$/.test(l)));
        expect(withFilters.length).toBeGreaterThanOrEqual(10);
        for (const v of withFilters) {
            const i = v.lines.findIndex((l) => /^ {4}filters:\s*$/.test(l));
            const indentOf = (k: number) => v.lines[k].length - v.lines[k].trimStart().length;
            // filters 下一行必须是 and/or/not —— 不允许「filters: 后面直接跟东西」
            expect(v.lines[i + 1], `视图「${v.name}」的 filters 下面不是逻辑键`).toMatch(/^ {6}(and|or|not):$/);
            // 从 and: 往下，缩进必须**严格递增**直到第一个表达式行；不允许回落或跳级
            let prev = indentOf(i + 1);
            let k = i + 2;
            let sawExpr = false;
            for (; k < v.lines.length; k++) {
                const line = v.lines[k];
                if (!line.trim()) break;
                if (/^ {4}\S/.test(line)) break; // 回到视图的下一层键，结束
                const ind = indentOf(k);
                expect(ind, `视图「${v.name}」第 ${k + 1} 行缩进回落：${JSON.stringify(line)}`).toBeGreaterThanOrEqual(prev);
                if (/^- /.test(line.trim())) { sawExpr = true; break; }
                expect(ind, `视图「${v.name}」的逻辑键没缩进：${JSON.stringify(line)}`).toBeGreaterThan(prev);
                prev = ind;
            }
            expect(sawExpr, `视图「${v.name}」的 filters 里没有任何表达式`).toBe(true);
        }
    });

    it('🔴 视图自己的 filters 里不重复 8 目录范围（那是顶层的事）', () => {
        // ⚠️ 只扫**视图块内部**。早先直接对整份 YAML 匹配 `^ {8}or:$`，把顶层块和
        //    「书籍跨 book/novel/comic 三目录」的合法嵌套也算进来了 —— 那是对的，不该报。
        for (const v of viewLines()) {
            const folders = v.lines.filter((l) => l.includes('file.inFolder('));
            // 允许：书籍三目录（book/novel/comic）这种「同一类型跨子目录」。禁止：把 8 个目录全抄一遍。
            expect(folders.length, `视图「${v.name}」抄了 ${folders.length} 个目录，范围该只在顶层写`).toBeLessThanOrEqual(3);
            expect(v.lines.some((l) => l.includes(' || file.inFolder(')), `视图「${v.name}」把 or 拍成一行了`).toBe(false);
        }
    });

    it('顶层有 filters 与 views 两个键', () => {
        expect(yaml).toMatch(/^filters:$/m);
        expect(yaml).toMatch(/^views:$/m);
    });

    it('🔴 #690：排序与分组**不再各占一个视图**（用户原话：视图非常长了）', () => {
        // ⛔ 曾经的错法：8 档排序 + 5 档分组铺成 13 个视图。
        //    Bases 的排序/分组是**每个视图自己的**设置，视图菜单里就能切 ⇒ 不需要铺成视图。
        for (const n of ['最近更新 ↓', '最近更新 ↑', '发布日期 ↓', '发布日期 ↑', '标题 A-Z', '标题 Z-A', '个人评分 ↓', '个人评分 ↑']) {
            expect(yaml, `「${n}」不该再单独占一个视图`).not.toContain(`name: "${n}"`);
        }
        const names = [...yaml.matchAll(/^ {4}name: "(.+)"$/gm)].map((m) => m[1]);
        // 视图总数要收得住：早先 36 个（8 档排序 + 5 档分组各占一屏），现在 30 个。
        // ⚠️ 这条是**有意为之**的上限，不是「调到能过」：Bases 的视图切换靠标签栏，超过 30 个就没法用了。
        //    加了视图导致这里失败 ⇒ 先想清楚该砍哪个，别改这个数字。
        expect(names.length, `视图又变多了（${names.length} 个），先想清楚再加`).toBeLessThanOrEqual(30);
        // 排序/分组是**视图内**设置，不该铺成视图：这两个前缀的视图只保留最有代表性的几档
        const groupViews = names.filter((n) => n.startsWith('分组 · '));
        expect(groupViews.length, `「分组 · …」视图过多：${groupViews.join(' / ')}`).toBeLessThanOrEqual(3);
    });

    it('🔴 #690：文件目录范围只写在顶层 filters（All views 区），⛔ 不在每个视图里重复', () => {
        // 用户抱怨「视图非常长」的直接根因：8 个目录的 or 被抄进了每一个视图的 filters。
        // 顶层写一次 = 对所有视图生效（官方语法：两处会 AND 组合）。
        const lines = yaml.split('\n');
        const top = lines.indexOf('filters:');
        expect(top).toBeGreaterThan(-1);
        const viewsAt = lines.indexOf('views:');
        expect(viewsAt).toBeGreaterThan(top);
        const topBlock = lines.slice(top, viewsAt).join('\n');
        // 顶层必须是真正的 or 节点（每个目录一行），不是一条塞了 || 的长字符串
        expect(topBlock).toMatch(/^ {2}and:$/m);
        // 🔴 关键形态：嵌套的 or 对象是 and 数组的**元素**，必须写成 `    - or:`（带列表项短横线）。
        //    写成裸 `    or:` 会被 YAML 当成映射键，下一行 `- 'note.type'` 变成「序列充当隐式映射键」，
        //    整份 .base 解析失败（用户实测报错：A block sequence may not be used as an implicit map key）。
        expect(topBlock, '嵌套 or 必须写成列表项 `- or:`，裸 `or:` 会让整份文件解析失败').toMatch(/^ {4}- or:$/m);
        expect(topBlock, '顶层 and 数组里不许出现裸 `or:`').not.toMatch(/^ {4}or:$/m);
        expect(actualNoteDirs().every((d) => topBlock.includes(`/${d}")`))).toBe(true);

        // 视图区：不许再出现 8 目录的大 or。
        // ⚠️ 这里**不查** `^ {8}or:$` —— 书籍跨 book/novel/comic 三个目录，视图里合法地会有一个 8 空格 or。
        //    真正的越界判据是「视图里抄了几个目录」，交给上面「视图自己的 filters 里不重复 8 目录范围」那条。
        const viewBlock = lines.slice(viewsAt).join('\n');
        expect(viewBlock, '视图里还留着旧的 || 长表达式').not.toContain(' || file.inFolder(');
    });

    it('🔴 #690：groupBy 必须是 object（裸字符串会让整个 .base 无法解析），且键真实存在', () => {
        //    用户实测报错原文：「视图"分组·按类型"中的"groupBy"必须是 object 类型」—— 裸字符串会让
        //    Obsidian 判定**整个 .base 无法解析**，所有视图一起废掉。
        //    用块扫描而不是单行正则：单行正则对「按 = 两行结构」天然永远失败。
        const lines = yaml.split('\n');
        const blocks: string[][] = [];
        for (let i = 0; i < lines.length; i++) {
            if (/^ {4}groupBy:\s*$/.test(lines[i])) {
                const block = [lines[i]];
                let j = i + 1;
                while (j < lines.length && /^ {6}\S/.test(lines[j])) block.push(lines[j++]);
                blocks.push(block);
                i = j - 1;
            } else if (/^ {4}groupBy:\s*\S/.test(lines[i])) {
                blocks.push([lines[i], '<<INLINE>>']); // 裸字符串写法，下面断言会打红
            }
        }
        expect(blocks.length).toBeGreaterThanOrEqual(5);
        const grouped: string[] = [];
        for (const b of blocks) {
            expect(b[1], `groupBy 必须是对象，不能是裸字符串：${b[0]}`).not.toBe('<<INLINE>>');
            expect(b.length, `groupBy 至少要有一行缩进的 property：\n${b.join('\n')}`).toBeGreaterThanOrEqual(2);
            const props = b.slice(1).map((l) => l.trim());
            const propertyLine = props.find((l) => l.startsWith('property: '));
            expect(propertyLine, `groupBy 缺 property：\n${b.join('\n')}`).toBeTruthy();
            const key = propertyLine!.slice('property: '.length).trim();
            grouped.push(key);
            for (const p of props) {
                expect(p, `groupBy 里出现未知键（Bases 只认 property/direction）：${p}`).toMatch(/^(property|direction): /);
            }
        }
        const actual = actualFrontmatterKeys();
        // 🔴 groupBy 写了 frontmatter 里没有的键 ⇒ 整组空，而且 Bases 不报错
        for (const k of grouped) expect(actual.has(k)).toBe(true);
        // ⚠️ 这里**不**断言「必须出现 rating / year」那类清单：分组键是视图规格，会随用户需求增删，
        //    锁死清单等于逼着以后的人把删掉的视图加回来。断言只守不变量：
        //    ① 至少有分组视图 ② 每个键都真实存在（上面那行）③ 用的都是 frontmatter 里的合法键名。
        expect(grouped).toEqual(expect.arrayContaining(['type']));
    });

    it('🔴 #690：「大众评分」只在库里真有 communityScore 时才生成（否则是一个切开全是空行）', () => {
        // 默认（不传 hasCommunityScore）= 不生成
        expect(yaml).not.toContain('name: "大众评分"');
        // 显式传 true 才生成，且排序列指向真实键名
        const withScore = buildBaseTemplate({ ...CTX, hasCommunityScore: true });
        expect(withScore).toContain('name: "大众评分"');
        expect(withScore).toContain(`property: ${COMMUNITY_SCORE_PROP}`);
    });

    it('视图名不重复；table 有 order、cards 有 cardProperties（各自数量对齐视图数）', () => {
        const names = [...yaml.matchAll(/^\s{4}name: "(.+)"$/gm)].map((m) => m[1]);
        expect(names.length).toBeGreaterThanOrEqual(9); // 全部收藏 + 海报墙 + 6 个类型 + 在看中 + 高分
        expect(new Set(names).size).toBe(names.length);
        const types = [...yaml.matchAll(/^\s{2}- type: (\w+)$/gm)].map((m) => m[1]);
        // 🔴 只认 Bases 支持的布局：写错一个字母整个视图回退默认
        expect(types.every((t) => ['table', 'cards', 'list', 'kanban'].includes(t))).toBe(true);
        expect(types.length).toBe(names.length);
        // 🔴 order 只属于 table/list；cards 的卡片属性是 cardProperties。
        //    两边各自对齐视图数 = 同时锁住「cards 别多写 order」和「table 别漏写 order」两个方向。
        const tables = types.filter((t) => t === 'table').length;
        const cards = types.filter((t) => t === 'cards').length;
        expect([...yaml.matchAll(/^\s{4}order:$/gm)].length).toBe(tables);
        expect([...yaml.matchAll(/^\s{4}cardProperties:$/gm)].length).toBe(cards);
    });

    it('🔴 六个类型不再各占一页，而是由「按类型分段」的两个分组视图覆盖（2026-10-22 用户裁定缩视图）', () => {
        // 用户原话：「Bases 视图模板的优化一下，目前视图太多了，缩进每个类型海报墙的排序行」，
        // 选定方案 C（两类都砍）：类型海报墙 + 类型表格各自合并成一个 groupBy: type 的视图。
        //
        // ⛔ 这条断言不是「删掉旧的就算过」—— 旧断言守的是「6 个类型都能直达」，
        //    新方案必须**用别的方式**满足同一个不变量，否则就是拿砍视图当借口丢功能：
        const names = [...yaml.matchAll(/^\s{4}name: "(.+)"$/gm)].map((m) => m[1]);
        // ① 旧的 12 个类型专属视图一个都不能留
        for (const t of ENTRY_TYPES) {
            expect(names, `「全部${ENTRY_TYPE_LABELS[t]}」旧视图应已合并`).not.toContain(`全部${ENTRY_TYPE_LABELS[t]}`);
            expect(names, `「${ENTRY_TYPE_LABELS[t]}海报墙」旧视图应已合并`).not.toContain(`${ENTRY_TYPE_LABELS[t]}海报墙`);
        }
        // ② 取而代之必须有一张 cards + 一张 table 的按类型分组视图，且真的 groupBy: type
        const doc2 = parseYaml(yaml) as any;
        for (const [want, label] of [['cards', '海报墙'], ['table', '表格']] as const) {
            const v = doc2.views.find((x: any) => x.name === (want === 'cards' ? '海报墙 · 按类型分段' : '全部收藏 · 按类型分段'));
            expect(v, `缺「${label} · 按类型分段」视图 —— 6 个类型就没法按类型看了`).toBeTruthy();
            expect(v.type).toBe(want);
            expect(v.groupBy, `「${label} · 按类型分段」必须 groupBy: type 才分得开`).toEqual({ property: 'type', direction: 'ASC' });
        }
        // ③ 类型覆盖度没丢：分组键是 type ⇒ 6 个类型都在同一个视图里，等价于原来 6 页
        expect(ENTRY_TYPES.length).toBe(6);
    });

    it('路径过滤是字面量 vault 相对路径（无反斜杠、无前导斜杠、JSON 双引号包裹）', () => {
        expect(yaml).toContain('file.inFolder("ReelLudic/笔记/movie")');
        expect(yaml).not.toContain('file.inFolder("/');
        expect(yaml).not.toMatch(/file\.inFolder\("[^"]*\\\\/);
    });

    it('🔴 过滤覆盖**所有**笔记子目录（file.inFolder 不递归，只写父目录会一条都匹配不到）', () => {
        // 实测用户库：全部条目都在 笔记/<类型>/ 下（movie 42、animation 41、music 16、game 11、
        // book 10、teleplay 8、comic 2、novel 2），笔记/ 根下没有 .md。
        for (const sub of ['movie', 'teleplay', 'animation', 'book', 'novel', 'comic', 'game', 'music']) {
            expect(yaml, `缺少子目录 ${sub} 的过滤`).toContain(`file.inFolder("ReelLudic/笔记/${sub}")`);
        }
    });

    it('🔴 属性模式用 order 键，⛔ 不能用 columns（Bases 会静默忽略，属性列一列都不显示）', () => {
        expect(yaml).not.toMatch(/^\s*columns:/m);
    });

    it('cards 视图配了封面三项（image / imageFit / imageAspectRatio）', () => {
        expect(yaml).toContain('image: banner');
        expect(yaml).toContain('imageFit: cover');
        expect(yaml).toMatch(/imageAspectRatio: [\d.]+/);
    });

    it('库目录里的中文/空格不会破坏 YAML（引号包裹）', () => {
        const y = buildBaseTemplate({ libraryDir: '我的 收藏', pluginVersion: '1.4.0' });
        expect(y).toContain('file.inFolder("我的 收藏/笔记/movie")');
        expect(y).toContain('file.inFolder("我的 收藏/笔记/animation")');
    });

    it('以换行结尾（编辑器/差异工具友好），且没有 BOM', () => {
        expect(yaml.endsWith('\n')).toBe(true);
        expect(yaml.charCodeAt(0)).not.toBe(0xfeff);
    });

    it('同一输入两次生成的结果完全相同（纯函数、无时间戳抖动）', () => {
        expect(buildBaseTemplate(CTX)).toBe(buildBaseTemplate(CTX));
    });
});

describe('baseTemplate · 视图内容符合用户直觉', () => {
    const yaml = buildBaseTemplate(CTX);

    it('首个视图是「全部海报墙」（收藏库先看封面，用户 2026-10-20 要求与插件观感一致）', () => {
        const first = /^\s{4}name: "(.+)"$/m.exec(yaml)?.[1];
        expect(first).toBe('全部海报墙');
        // 紧跟着必须是 cards（写成 table 就没有封面了）
        expect(yaml.split(/^\s{2}- type: /m)[1]).toMatch(/^cards/);
    });

    it('全景总表「全部收藏」排在所有表格之前', () => {
        const names = [...yaml.matchAll(/^\s{4}name: "(.+)"$/gm)].map((m) => m[1]);
        expect(names).toContain('全部收藏');
        // 原来是「全部收藏 在 全部电影 之前」；类型表合并后旧名不存在了。
        // 不变量改成：全景总表必须排在**任何按类型分段的表**之前（否则一进来就是分类，没有全景）。
        expect(names.indexOf('全部收藏')).toBeLessThan(names.indexOf('全部收藏 · 按类型分段'));
        expect(names.indexOf('全部收藏')).toBeLessThan(names.indexOf('状态 · 想看'));
    });

    it('「高分」用 >= 4 而不是 == 5（查的是「高分」不是「满分」）', () => {
        expect(yaml).toContain("'note.rating >= 4'");
    });

    it('「在看中」用 watching 而非中文标签（frontmatter 写的是英文枚举）', () => {
        expect(yaml).toContain('note.status == "watching"');
        expect(yaml).not.toContain('note.status == "在看"');
    });

    it('每个视图都有 sort（否则 Bases 按文件名排，收藏库看着像乱序）', () => {
        const views = yaml.split(/^\s{2}- type: /m).slice(1);
        expect(views.length).toBeGreaterThan(0);
        // 🔴 排序是**一组**（可多行，从主序到次序），语义断言见下面「排序链」那组用例。
        //    这里只守「不能没有」：有 sort: 键，且紧跟至少一条 `- property:` + `direction:`
        for (const v of views) {
            expect(v, '视图缺 sort').toMatch(/^\s{4}sort:\n\s{6}- property: \w+/m);
            expect(v).toMatch(/^\s{6}- property: \w+\n\s{8}direction: (ASC|DESC)$/m);
        }
    });
});

/**
 * 🔴 排序链（用户 2026-10 附图点名：Obsidian 原生「排序依据」面板里能「+ 添加排序」，
 *    一行 `updated` + `从新到旧`，再加一行就多一个「主序相同时」的比较键）。
 *
 *    落到 `.base` 里就是 `sort:` 数组多一项。本组用例守**链的语义**，不是某个字符串存在：
 *    主序要对得上视图用途、每个键都必须真实存在于 frontmatter（否则 Bases 不报错、只是排了个寂寞）、
 *    同一条链里不许有重复键（后一条会被前一条完全遮住）。
 */
describe('baseTemplate · 排序链（多条件排序 = 原生面板的「+ 添加排序」）', () => {
    const yaml = buildBaseTemplate(CTX);
    const doc = parseYaml(yaml) as any;

    /** 视图名 → 解析后的 sort 数组 */
    const sorts = new Map<string, { property: string; direction: string }[]>();
    for (const v of doc.views) sorts.set(v.name, v.sort ?? []);

    it('🔴 每个视图的 sort 都是数组且至少一项（Bases 的排序本来就是列表，不是裸字符串）', () => {
        expect(sorts.size).toBeGreaterThanOrEqual(20);
        for (const [name, list] of sorts) {
            expect(Array.isArray(list), `视图「${name}」的 sort 不是数组：${JSON.stringify(list)}`).toBe(true);
            expect(list.length, `视图「${name}」没有排序`).toBeGreaterThanOrEqual(1);
        }
    });

    it('🔴 至少有一批视图带**多项**排序 —— 这就是「+ 添加排序」落地的证据（单条排序不算做完这条需求）', () => {
        const multi = [...sorts.entries()].filter(([, l]) => l.length >= 2);
        expect(multi.length, `没有任何视图带多条件排序，需求没落地：${JSON.stringify([...sorts])}`).toBeGreaterThanOrEqual(15);
        // 最常见的形态：主序 + 标题兜底
        expect(multi.some(([, l]) => l.some((k) => k.property === 'title')), '没有一条排序链用 title 兜底').toBe(true);
    });

    it('🔴 排序键都真实存在于 frontmatter（写错键 Bases 不报错，只是排不动）', () => {
        const actual = actualFrontmatterKeys();
        for (const [name, list] of sorts) {
            for (const k of list) {
                expect(typeof k.property, `视图「${name}」的排序项缺 property：${JSON.stringify(k)}`).toBe('string');
                expect(actual.has(k.property), `视图「${name}」按 frontmatter 里没有的键「${k.property}」排（等于没排）`).toBe(true);
                expect(['ASC', 'DESC'], `视图「${name}」的排序方向不对：${JSON.stringify(k)}`).toContain(k.direction);
            }
        }
    });

    it('🔴 同一条排序链里不许重复同一个键（后一条会被前一条完全遮住，纯噪音）', () => {
        for (const [name, list] of sorts) {
            const props = list.map((k) => k.property);
            expect(new Set(props).size, `视图「${name}」的排序链里有重复键：${props.join(' / ')}`).toBe(props.length);
        }
    });

    it('🔴 主序要对该视图的用途（不是一刀切 updated）', () => {
        for (const n of ['高分 · 4 星及以上', '高分 · 满分 5 星']) {
            const list = sorts.get(n)!;
            expect(list[0].property, `「${n}」应该先按评分排`).toBe('rating');
            expect(list[0].direction).toBe('DESC');
        }
        expect(sorts.get('最近添加')![0]).toEqual({ property: 'created', direction: 'DESC' });
        expect(sorts.get('分组 · 按类型')![0]).toEqual({ property: 'title', direction: 'ASC' });
        expect(sorts.get('全部海报墙')![0]).toEqual({ property: 'updated', direction: 'DESC' });
        // 旧断言查的是「全部电影」（6 张类型表已合并，名字没了）。
        // 换成合并后的那张表 —— 它同样是「按最近更新」为主序的浏览型视图。
        expect(sorts.get('全部收藏 · 按类型分段')![0]).toEqual({ property: 'updated', direction: 'DESC' });
        expect(sorts.get('状态 · 在看')![0]).toEqual({ property: 'updated', direction: 'DESC' });
    });

    it('🔴 评分链的第二项是「最近更新」—— 同分里新动的排前面，而不是按文件名碰运气', () => {
        const list = sorts.get('高分 · 4 星及以上')!;
        expect(list.length).toBeGreaterThanOrEqual(3);
        expect(list[1].property).toBe('updated');
        expect(list.some((k) => k.property === 'title'), '评分链缺标题兜底').toBe(true);
    });

    it('🔴 每一条排序都带 direction（⛔ 不写就退回 Bases 默认方向，用户读不懂为什么反了）', () => {
        for (const [name, list] of sorts) {
            for (const k of list) {
                expect(k.direction, `视图「${name}」的「${k.property}」没写方向`).toMatch(/^(ASC|DESC)$/);
            }
        }
    });

    it('「大众评分」那档的排序链主序指向 communityScore（只在生成时才校验，不挡「不生成」那条路径）', () => {
        const withScore = parseYaml(buildBaseTemplate({ ...CTX, hasCommunityScore: true })) as any;
        const v = withScore.views.find((x: any) => x.name === '大众评分');
        expect(v, '开了 hasCommunityScore 却没生成「大众评分」视图').toBeTruthy();
        expect(v.sort[0].property).toBe(COMMUNITY_SCORE_PROP);
        expect(v.sort.length).toBeGreaterThanOrEqual(2);
    });

    it('文件头说明了「排序是一组、可加多条件」（用户照着注释能自己加第三条）', () => {
        expect(yaml).toContain('排序是**一组**，不是一个');
        expect(yaml).toContain('添加排序');
    });
});

describe('baseTemplate · 海报墙与插件观感一致（卡片密度 / 封面比例）', () => {
    it('🔴 海报墙封面是 2:3 竖版 —— imageAspectRatio 是「高/宽」，必须写 1.5', () => {
        const y = buildBaseTemplate(CTX);
        expect(y).toContain('image: banner');
        expect(y).toContain('imageFit: cover');
        // Bases 的 imageAspectRatio 默认 1 = 正方形，值是**高/宽**。插件封面是 aspect-ratio: 2/3（宽/高），
        // ⇒ 高/宽 = 1.5。⛔ 曾经错写成 0.6667，得到的是扁的 3:2 —— 这条断言就是防它回潮。
        expect(IMAGE_ASPECT_RATIO).toBe(1.5);
        expect(y).toContain('imageAspectRatio: 1.5');
        expect(y).not.toContain('imageAspectRatio: 0.6667');
    });

    it('🔴 每张卡片都写 cardProperties：标题 / 年份 / 作者 / 题材 / 状态 / 个人评分', () => {
        const y = buildBaseTemplate(CTX);
        // cards 视图的卡片属性是 cardProperties，⛔ 不是 order（order 只对 table/list 生效）
        const blocks = y.split(/^\s{2}- type: /m).slice(1).filter((b) => b.startsWith('cards'));
        expect(blocks.length).toBeGreaterThan(0);
        for (const b of blocks) expect(b).toContain('    cardProperties:');
        // 六项必须齐：year / genres / status / rating 字面在，作者是一条兜底链
        expect(y).toContain('      - title');
        expect(y).toContain('      - year');
        expect(y).toContain('      - genres');
        expect(y).toContain('      - status');
        expect(y).toContain('      - rating');
        expect(y).toContain('      - note.author || note.artist || note.director || note.developer');
        // ⛔ 「题材」不是 genre / tags；「作者」也不能只写 author（电影只有 director、游戏只有 developer）
        expect(y).not.toContain('      - genre\n');
        expect(y).not.toContain('      - tags');
    });

    it('cards 视图不写 order（order 是 table/list 的列，写了会被静默忽略）', () => {
        const y = buildBaseTemplate(CTX);
        const lines = y.split('\n');
        // ⚠️ 只认「顶层视图边界」：`  - type: xxx`（2 空格）。绝不能切块后对每块用 $/m 锚定 ——
        //    最后一块会一路连到文件尾（含后面的 table 视图），那样扫到的 order: 根本不是这个 cards 的。
        let checked = 0;
        for (let i = 0; i < lines.length; i++) {
            if (!/^ {2}- type: cards$/.test(lines[i])) continue;
            checked++;
            for (let j = i + 1; j < lines.length && !/^ {2}- type: /.test(lines[j]); j++) {
                expect(lines[j].trim(), `cards 视图里不该有 order：\n${lines.slice(i, j + 1).join('\n')}`).not.toBe('order:');
            }
        }
        expect(checked, '一个 cards 视图都没扫到，断言在空转').toBeGreaterThan(0);
    });

    it('海报墙只有两张：全部 + 按类型分段（6 个类型海报墙已按用户裁定合并，⛔ 别再拆回去）', () => {
        const y = buildBaseTemplate(CTX);
        const names = [...y.matchAll(/^\s{4}name: "(.+)"$/gm)].map((m) => m[1]).filter((n) => n.includes('海报墙'));
        expect(names).toEqual(['全部海报墙', '海报墙 · 按类型分段']);
        // 两个海报墙都必须是 cards 类型（写成 table 就没封面了）
        const cardsBlocks = y.split(/^\s{2}- type: /m).slice(1).filter((b) => b.startsWith('cards'));
        expect(cardsBlocks.length).toBeGreaterThanOrEqual(names.length);
        // 「按类型分段」那张必须真带 groupBy: type，否则就是退化成重复的「全部海报墙」
        const doc = parseYaml(y) as any;
        const grouped = doc.views.find((v: any) => v.name === '海报墙 · 按类型分段');
        expect(grouped.groupBy).toEqual({ property: 'type', direction: 'ASC' });
        // 封面三件套不能因为合并掉了
        expect(grouped.image).toBe('banner');
        expect(grouped.imageAspectRatio).toBe(1.5);
    });

    it('🔴 cardSize 跟随插件「海报密度」档（与 pure/posterGrid 同源，不是硬编码）', () => {
        const cases = [
            { density: 'compact', px: POSTER_CARD_MIN_WIDTHS.compact },
            { density: 'standard', px: POSTER_CARD_MIN_WIDTHS.standard },
            { density: 'cozy', px: POSTER_CARD_MIN_WIDTHS.cozy },
        ] as const;
        for (const { density, px } of cases) {
            const y = buildBaseTemplate({ ...CTX, posterDensity: density });
            const sizes = [...y.matchAll(/^\s{4}cardSize: (\d+)$/gm)].map((m) => Number(m[1]));
            expect(sizes.length, `${density} 档应有 cardSize`).toBeGreaterThan(0);
            expect(new Set(sizes)).toEqual(new Set([px]));
        }
    });

    it('🔴 custom（自定义列数）档也要写 cardSize —— 按列数反算，别把用户的档位选择丢掉', () => {
        const y = buildBaseTemplate({ ...CTX, posterDensity: 'custom', posterColumns: 6 });
        const sizes = [...y.matchAll(/^\s{4}cardSize: (\d+)$/gm)].map((m) => Number(m[1]));
        expect(sizes.length).toBeGreaterThan(0);
        expect(new Set(sizes)).toEqual(new Set([posterCardSizeForColumns(6)]));
        expect(y).toContain('自定义列数 6 列');
    });

    it('自定义列数越少卡片越大、越多卡片越小（单调，公式没写反）', () => {
        const cols = [2, 3, 6, 9, 12];
        const px = cols.map((n) => posterCardSizeForColumns(n));
        for (let i = 1; i < px.length; i++) expect(px[i]).toBeLessThan(px[i - 1]);
        // 12 列再密也不会塌成 0
        expect(px[px.length - 1]).toBeGreaterThanOrEqual(80);
    });

    it('用户真实档位（custom / 6 列，2026-10-20 实测 data.json）能算出合理卡片宽', () => {
        const px = posterCardSizeForColumns(6);
        // 6 列约 170px 上下（1080 面板），落在插件三档 150/180/220 的量级内
        expect(px).toBeGreaterThan(140);
        expect(px).toBeLessThan(200);
    });

    it('缺省 posterDensity 时按「标准」档（与插件默认一致）', () => {
        const y = buildBaseTemplate(CTX);
        expect(y).toContain(`cardSize: ${POSTER_CARD_MIN_WIDTHS.standard}`);
    });

    it('文件头说明了密度来源（用户照着注释能改 cardSize）', () => {
        const y = buildBaseTemplate({ ...CTX, posterDensity: 'cozy' });
        expect(y).toContain('卡片密度：跟随插件「海报密度」设置');
        expect(y).toContain('cardSize');
    });
});

describe('baseTemplate · 排序与分组覆盖度', () => {
    const yaml = buildBaseTemplate(CTX);

    it('四个状态各有一个分组视图（与 MEDIA_STATUSES 同源）', () => {
        for (const s of MEDIA_STATUSES) {
            expect(yaml).toContain(`name: "状态 · ${STATUS_LABELS[s]}"`);
            expect(yaml).toContain(`'note.status == "${s}"'`);
        }
    });

    it('排序方向用上了 ASC 与 DESC（有正排有倒排，不是一刀切）', () => {
        expect(yaml).toContain('direction: DESC');
        expect(yaml).toContain('direction: ASC');
    });

    it('高分档拆成「4 星及以上」与「满分」两档', () => {
        expect(yaml).toContain("'note.rating >= 4'");
        expect(yaml).toContain("'note.rating >= 5'");
    });

    it('视图名全库唯一（Bases 按名字切换视图，重名会分不清）', () => {
        const names = [...yaml.matchAll(/^\s{4}name: "(.+)"$/gm)].map((m) => m[1]);
        expect(new Set(names).size).toBe(names.length);
        expect(names.length).toBeGreaterThanOrEqual(20);
    });
});
