<script lang="ts">
    /**
     * 「下载书籍」弹窗的内容（#414 建立；#417 加直链那一路；#419 加「书源检索」；
     * #422 续四：直链那条通道整体撤除；**#423：整块重构成「现代界面」**）。
     *
     * ⚠️ 本节注释里**不写那两个撤掉的类名 / 那个功能名**：产物不剥注释，而反向守卫正是拿它们去核
     *    「有没有长回来」——写进来就是自撞红（本批实测，本仓记过多次）。
     *
     * 🔴 四条口径：
     *  · 数据**全部经注入的 props**（组件不碰 vault、不碰网络、不读 settings）—— 真源在 `main.openBookDownloader`；
     *  · **输入即搜**（#423）：停止输入 `SEARCH_DEBOUNCE_MS` 后自动检索、回车立即搜，⛔ 不设「搜索」按钮
     *    —— 与「下载歌曲」弹窗（用户 2026-09-28 定的「敲一个字就实时搜索」）同一口径；
     *  · **不静默**：某源 0 条 / 请求失败 / 规则是脚本，全部带明确原因显示（⛔ 不假装「没有这本书」）；
     *  · 🔴 技术性的失败原因**先折成人话**（`novelFailText`：`getaddrinfo ENOENT host` → 「连不上该站点」），
     *    原文放进 `data-tip` 悬浮可看 —— ⛔ 别把英文报错糊在列表上（用户上手第一句就是「太丑了」）。
     *  · 🔴 **#455 只谈本类**：文学窗口只说文学源、网文窗口只说网文源 —— 空态不提另一类有几条、
     *    也没有「整批搬过来」按钮（用户：「两个不同类型的源不可能相通的，用网文源怎么搜文学类书籍
     *    完全是多此一举」）；改分类在设置页（「书籍源凭据」行头那枚）。分类名一律写 `SIMPLE_LABEL[kind]`
     *    —— 写成 `SIMPLE_LABEL` 会在界面上印出 `[object Object]`。
     *
     * ⛔ 注释里**别写出任何具体站点的域名**：断言有反向守卫锚它们（撤掉的东西不许长回来）。
     */
    import { novelElapsedText, novelProgressPercent, novelProgressText } from 'pure/novelPack';
    import { sortByLatestChapter } from 'pure/novelRank';
    import { SOURCE_KIND_LABEL, novelFailText, type NovelSourceSummary, type SourceKind } from 'pure/sourceRule';
    /**
     * 🔴 #428 并发度**只有这一份真源**（`services/novelSource` 里那个常量 = 抓章层的默认值）
     *    —— 进度文案里的数字必须与**真正在跑的那个数**一致，⛔ 别在这里另写一个字面量 50：
     *    改了常量而文案不跟着变，用户看到的就成了一块假铭牌。
     */
    import { NOVEL_CHAPTER_CONCURRENCY, type NovelSearchHit, type NovelSourceSearchResult, type NovelTocItem } from 'services/novelSource';
    import Icon from './Icon.svelte';

    /** 下载成功 ⇒ 把路径交给宿主（表单据此填「书籍文件」并写回条目）。
     *  🔴 P1-C：第二参 = 抓到的**章节名清单**（一行一章）—— 表单**只对文学**条目写回「目录」。 */
    export let onPicked: (relPath: string, tocText?: string) => void;

    // ── #419 网文面（全部注入；默认实现 = 空，便于组件单独渲染）──
    /**
     * 🔴 #422：当前条目的书源的**分类**（`novel` 网络文学 / `book` 经典文学），由宿主按入口给出。
     *    它决定**只用**哪一类的源（`shown`）——🔴 #439 起**不再回退到另一类**（见 `shown`）。
     */
    export let kind: SourceKind = 'novel';
    /** 分类在「条目侧」的说法（空态那句「还没有 XX 的书源」用；⛔ 别拿 `SOURCE_KIND_LABEL`（那是「…源」）硬拼） */
    const SIMPLE_LABEL: Record<SourceKind, string> = { novel: '网文', book: '经典文学' };
    /** 已导入书源的摘要（**全量，每条带 `kind`**；本类怎么算由本组件做 —— 见 `shown`） */
    export let novelSources: () => NovelSourceSummary[] = () => [];
    // 🔴 #455 **`novelMoveAll`（把另一类整批搬进本类）已退场** —— 用户：
    //    「两个不同类型的源不可能相通的，用网文源怎么搜文学类书籍完全是多此一举」。
    //    ⇒ 本弹窗**只谈本类**：文学窗口不出现网文源的条数、也不出现搬运按钮。
    //    ⚠️ 改分类的能力**没删**，只是搬回它该在的地方 = 「设置 › 元数据源配置 › 书籍源凭据」
    //    行头那枚（`Settings.ts` 仍走 `moveAllNovelSources`）。⛔ 别在这里再长出第二个搬运入口。
    /** 多源搜索（渐进上报：任一源先回来就先渲染）；只搜 `kind` 那一类的源 */
    export let novelSearch: (
        keyword: string,
        kind: SourceKind,
        onPartial?: (r: NovelSourceSearchResult[]) => void,
    ) => Promise<NovelSourceSearchResult[]> = async () => [];
    /**
     * 取一本书的目录。
     * 🔴 #457 **文学源适配**：`wholePage` = 这本书**没解析出目录**（文学/公版源常是「整本书一个页面」）
     * ⇒ 宿主已回退成「整页一章」，`note` 是原来的失败原因 —— 必须显示给用户，⛔ 别静默当普通目录。
     */
    export let novelToc: (
        hit: NovelSearchHit,
    ) => Promise<{ items: NovelTocItem[]; error?: string; wholePage?: boolean; note?: string }> = async () => ({ items: [] });
    /**
     * 抓整本并落盘（`format` = 成品格式）。
     * 🔴 P1-C 补上 `tocText`（章节名清单，宿主只对文学条目写回）；
     *    🔴 #428 补上 `cancelled` —— 用户取消**不是**失败，面板据此走中性提示（⛔ 别再糊一行红字）。
     */
    export let novelDownload: (req: {
        hit: NovelSearchHit;
        from: number;
        to: number;
        format: 'txt' | 'epub';
        onProgress: (done: number, total: number, failed: number) => void;
    }) => Promise<{ ok: boolean; message: string; relPath?: string; tocText?: string; cancelled?: boolean }> = async () => ({ ok: false, message: '' });
    /**
     * 取消抓取（长书动辄上千章，没有取消就会卡住整个弹窗）。
     * 🔴 #428：**宿主侧已经改成「当帧生效」**（`CancelToken`），这里只负责把「点了」这件事
     *    立刻画出来 —— 在此之前点下去界面上一个像素都不动，用户的原话就是「点击无反应」。
     */
    export let novelCancel: () => void = () => {};
    /**
     * 就地导入书源：把**已经读到的文本**交给宿主解析合并（#425 起改成"组件读文件、宿主只解析"）。
     * 🔴 之所以不让宿主自己弹文件框：`<label>` + `<input type="file">` 必须挂在**调用方的 DOM** 上
     *    （见 `services/filePick` 的说明 —— 前两轮「点了没反应」都出在"宿主 JS 建 input"那条路上）。
     * 🔴 #422：导进**当前分类**（`kind`）—— 在文学条目里导的源就该归文学，否则刚导完搜不到、
     *    用户会以为导入失败。
     */
    export let novelImport: (text: string, kind: SourceKind) => { ok: boolean; message: string } = () => ({ ok: false, message: '' });

    /** 导入中（禁按钮，防连点两次弹两个选择框） */
    let importing = false;
    /** 导入结果 / 失败原因（就地显示；空 = 没提示） */
    let importNote = '';
    let importBad = false;
    /**
     * 导入成功后**逼 `sources` 重算**用。
     * 🔴 `$: sources = novelSources()` 的依赖是「无」⇒ 宿主改了 settings 它**不会**重跑，
     *    面板会一直停在「还没有书源」。必须借一个计数器把它拉起来。
     */
    let srcBump = 0;

    // ── 书源那一路 ──
    /**
     * 输入即搜的防抖时长。
     * 🔴 比「下载歌曲」的 300ms 略长：那边打的是音乐平台 API，这边是**对每个源真发一次请求**
     *    （多源并发 3、单请求 15s 超时）⇒ 停顿久一点再发，别把源站打急。
     */
    const SEARCH_DEBOUNCE_MS = 400;
    let searchTimer: ReturnType<typeof setTimeout> | null = null;
    /**
     * 🔴 每轮检索一个序号：用户接着敲字后，**上一轮在飞的响应一律丢弃**。
     *    没有它，慢的那个源回来晚一步就会把新结果覆盖成旧关键词的（多源渐进上报时必然出现）。
     */
    let searchSeq = 0;
    /** 正在飞的关键词（同一关键词不重复发 —— 省一次多源请求） */
    let inFlightQuery = '';

    /** 书源下拉：`all` = 全部；否则是源名 */
    let pickedSource = 'all';
    let kw = '';
    let searching = false;
    let searched = false;
    let results: NovelSourceSearchResult[] = [];
    /** 失败原因那块折叠区是否展开（默认收起 —— 技术原因不该糊在结果列表上） */
    let failsOpen = false;
    /** 选中要下的那本书（空 ⇒ 还在结果列表） */
    let picked: NovelSearchHit | null = null;
    let tocLoading = false;
    let toc: NovelTocItem[] = [];
    let from = 1;
    let to = 1;
    /** #457 整页回退的说明（空 = 正常目录）；⛔ 别删 —— 回退必须让用户看见原因 */
    let wholeNote = '';
    let downloading = false;
    /**
     * 🔴 #428「已经按了取消」—— 只为一件事：**让点击当帧可见**。
     *    旧版点下去毫无变化（宿主那条路要等在飞的请求，最长一整章的超时），用户的原话是「点击无反应」。
     *    现在按下即：按钮禁用 + 文案变「取消中…」+ 进度文字变「正在取消…」（进度条停止动画）。
     */
    let cancelling = false;
    /** 本次在下的格式（只为把按钮文案改成「下载中…」时知道是哪一个） */
    let dlFormat: 'txt' | 'epub' = 'txt';
    let prog = { done: 0, total: 0, failed: 0 };
    /**
     * 🔴 #429 **真实进度百分比**（0~100）—— 分母是总章数、分子是**已处理（成功 + 失败）**。
     *    ⚠️ 只算成功的话，一本有失败章的书会永远停在 99%（失败章本轮不会再重试，它们也是「翻篇了」）。
     *    真源在 `pure/novelPack.novelProgressPercent`（纯逻辑 + 单测），⛔ 别在这里内联除法。
     */
    $: pct = novelProgressPercent(prog.done, prog.failed, prog.total);
    let tip = '';
    /**
     * 下载**成功**后的完成提示（#429，用户点名：「完成后加个提示例如：完成！总耗时 68.96 s」）。
     * 它占的是**进度条那一格**（`{:else if doneNote}`）—— 用户盯进度条的那只眼睛就在那儿，
     * ⛔ 别把它塞到底部去跟落盘回执挤一块。
     * ⚠️ 只在**成功**时置值：取消有自己的中性提示（`tip`），失败有自己的红字（`err`）。
     */
    let doneNote = '';
    let err = '';

    $: sources = (srcBump, novelSources());
    /**
     * 🔴 #439 **翻面**：本类就是本类，**不再回退到另一类**。
     *
     * 旧口径（#422 续二）是「本类为空 ⇒ 列全部 + 一行小字」。它当年的用途是真的：
     * 用户那 11 条书源被一次误点整批变成 `book`，在网文条目里**面板一条都不显示**，
     * 他看到的是「之前导入的书源全不见了、要重新导入」（数据其实一条没少）。
     *
     * ⚠️ 但那个兜底有代价，而且代价后来变成了主要观感：分类**标错**时它把问题从
     * 「看不见」升级成「**错着用**」—— 用户下文学时冒出 11 条网文源（搜索结果**不带任何提示**，
     * 那行小字只在静态列表上有）⇒ 看起来就是「文学窗口在用网文源」。
     *
     * ✅ 现在：`shown` 直接等于本类 ⇒ 面板与搜索**永远同一批源**（⛔ 别只改一侧：缺一即
     *    「看得见搜不到」或「搜得到看不见」；宿主 `main.searchNovel` 同口径）；
     *    本类为空 ⇒ 走**空态**，且空态**只说本类**（#455 起不再提另一类 —— 见下）。
     *
     * 🔴 #455（用户：「两个不同类型的源不可能相通的，用网文源怎么搜文学类书籍完全是多此一举」）：
     *    空态里原来还有「你在「网络文学源」里有 N 条 + 整批搬过来」那一段 —— **已撤**。
     *    两类源本就互不相通，在文学窗口里谈网文源只会让人以为两者可以混用；
     *    改分类是**管理动作**，归属地是设置页（见 prop 区那段说明）。所以本组件**一个跨类数字都不再读**。
     */
    $: mine = sources.filter((s) => s.kind === kind);
    /** 面板与搜索用的那批源 —— 就是本类（⛔ 别再写成 `mine.length ? mine : sources`） */
    $: shown = mine;
    $: shownResults = pickedSource === 'all' ? results : results.filter((r) => r.sourceName === pickedSource);
    /** 失败的源（收进折叠区）与有结果的源（正常列）—— 分开渲染，别让报错冲垮列表 */
    $: failedResults = shownResults.filter((r) => !!r.error);
    $: okResults = shownResults.filter((r) => !r.error);
    /**
     * 🔴 #423 **平铺**（不再按源两级分组）：每行右端一枚**来源胶囊**就够认出处了。
     *    两级分组（源标题 + 其下若干行）在结果多时会拉得很长，而固定高度下那点空间该全给结果。
     * 🔴 #426 **按最新章节的章号倒序**（用户：「显示序号、最新章节排列搜索出的网文」）——
     *    解析与排序的真源在 `pure/novelRank`（纯逻辑 + 单测），⛔ 别在这里内联写 sort / 正则。
     */
    $: flatHits = sortByLatestChapter(
        okResults.reduce<{ hit: NovelSearchHit; source: string }[]>((acc, r) => {
            for (const h of r.hits) acc.push({ hit: h, source: r.sourceName });
            return acc;
        }, []),
        (row) => row.hit.latestChapter
    );
    $: hitCount = flatHits.length;
    $: enabledCount = shown.filter((s) => !s.disabled).length;

    function inputVal(ev: Event): string {
        return (ev.target as HTMLInputElement).value;
    }

    /**
     * 输入即防抖搜索（#423，与「下载歌曲」同一口径）：停止输入后自动检索。
     * ⚠️ **清空输入 ⇒ 回到未搜索态**（并作废在飞的请求）——⛔ 别留着上一个关键词的结果，
     *    那会让用户以为「搜出来的就是现在框里这个词」。
     * 🔴 清空那一支**必须自己把 `searching` 收掉**：在飞那轮的 `finally` 会因序号不匹配而跳过，
     *    不收就永远转圈（本批实测踩到）。
     */
    function scheduleSearch(): void {
        if (searchTimer !== null) clearTimeout(searchTimer);
        if (!kw.trim()) {
            searchTimer = null;
            searchSeq++;
            searching = false;
            inFlightQuery = '';
            results = [];
            searched = false;
            picked = null;
            toc = [];
            return;
        }
        searchTimer = setTimeout(() => {
            searchTimer = null;
            void runSearch();
        }, SEARCH_DEBOUNCE_MS);
    }

    /** 回车 = 不等防抖立即搜 */
    function searchNow(): void {
        if (searchTimer !== null) {
            clearTimeout(searchTimer);
            searchTimer = null;
        }
        void runSearch();
    }

    async function runSearch(): Promise<void> {
        const q = kw.trim();
        if (!q) return;
        // 同一关键词正在飞 ⇒ 不重复发（回车连按 / 防抖与回车撞车时省一次多源请求）
        if (searching && q === inFlightQuery) return;
        const my = ++searchSeq;
        inFlightQuery = q;
        searching = true;
        searched = true;
        err = '';
        tip = '';
        doneNote = '';
        results = [];
        picked = null;
        toc = [];
        try {
            // 渐进上报：任一源先回来就先渲染（⛔ 不等最慢的那个）；过期那轮的直接丢
            const final = await novelSearch(q, kind, (partial) => {
                if (my === searchSeq) results = partial;
            });
            if (my !== searchSeq) return;
            results = final;
        } catch (e) {
            if (my === searchSeq) err = `检索出错：${e instanceof Error ? e.message : String(e)}`;
        } finally {
            if (my === searchSeq) {
                searching = false;
                inFlightQuery = '';
            }
        }
    }

    /** 选中一本书 ⇒ 取目录，然后展开「章节范围 + 开始下载」 */
    async function choose(hit: NovelSearchHit): Promise<void> {
        picked = hit;
        toc = [];
        tocLoading = true;
        err = '';
        tip = '';
        doneNote = '';
        wholeNote = '';
        try {
            const r = await novelToc(hit);
            if (r.error) {
                err = r.error;
                picked = null;
                return;
            }
            toc = r.items;
            // #457：整页回退 ⇒ 把原因留下来给下面那行提示（⛔ 别静默：用户得知道这本书是整页下的）
            // ⚠️ 文案是**界面文本**（不是 markdown），⛔ 别写 `**…**` 这种星号（会原样印出来）
            wholeNote = r.wholePage
                ? `这本书没解析出目录${r.note ? `（${r.note}）` : ''} —— 已按整页处理成一章下载。`
                : '';
            from = 1;
            to = r.items.length;
        } catch (e) {
            err = `取目录出错：${e instanceof Error ? e.message : String(e)}`;
            picked = null;
        } finally {
            tocLoading = false;
        }
    }

    async function startDownload(format: 'txt' | 'epub'): Promise<void> {
        if (!picked || downloading) return;
        downloading = true;
        cancelling = false;
        dlFormat = format;
        err = '';
        tip = '';
        doneNote = '';
        prog = { done: 0, total: to - from + 1, failed: 0 };
        // 🔴 #429 耗时从**按下按钮那一刻**算起（含取目录之外的整段：抓章 + 合成 + 落盘）——
        //    这才对得上用户问的「这次下了多久」。⚠️ 别挪进 `novelDownload` 里：那会让「UI 等待」与
        //    「下载耗时」两个数渐渐分家（弹窗开着的那段空转也是用户真实在等的）。
        const t0 = Date.now();
        try {
            const r = await novelDownload({
                hit: picked,
                from,
                to,
                format,
                onProgress: (done, total, failed) => (prog = { done, total, failed }),
            });
            // 🔴 #428：取消走**中性提示**（`tip`）而不是红字报错 —— 用户主动按的键不是「出错」；
            //    文案由宿主给（它才知道留住了几章），⛔ 别在这里另拼一句。
            if (r.cancelled) tip = r.message;
            else if (r.ok) {
                doneNote = `完成！总耗时 ${novelElapsedText(Date.now() - t0)}`;
                tip = r.message;
                if (r.relPath) onPicked(r.relPath, r.tocText);
            } else {
                err = r.message;
            }
        } catch (e) {
            err = `下载出错：${e instanceof Error ? e.message : String(e)}`;
        } finally {
            downloading = false;
            cancelling = false;
        }
    }

    /**
     * 按「取消」：**先把状态画出来、再通知宿主**（顺序反了就会出现「点了之后还有一小段死寂」）。
     * ⚠️ 重复点直接被 `cancelling` 挡掉（并发抓章下连点两下不该调两次 `stop()`）。
     */
    function requestCancel(): void {
        if (cancelling) return;
        cancelling = true;
        novelCancel();
    }

    /** 从「选书」退回结果列表（保留搜索结果，别让用户重搜一遍） */
    function backToResults(): void {
        picked = null;
        toc = [];
        err = '';
        tip = '';
        doneNote = '';
    }

    /**
     * 拿到用户挑的文件 ⇒ 读文本 ⇒ 交给宿主解析合并（#425）。
     *
     * 🔴 文件选择用 **`<label>` + 内嵌 `<input type="file">`** 的原生关联，⛔ 不走 JS `input.click()`
     *    （两轮「点了没反应」都出在那条路上，原因见 `services/filePick`）。
     * ⚠️ 读完**立刻清空 `input.value`**：不清的话「改了文件再选同一个文件」不会触发 `change`，
     *    表现同样像"点了没反应"。
     */
    async function onImportPick(ev: Event): Promise<void> {
        const input = ev.target as HTMLInputElement;
        const file = input.files?.[0];
        input.value = '';
        if (!file) return;
        importing = true;
        importNote = '';
        try {
            const text = await file.text();
            const r = novelImport(text, kind);
            importBad = !r.ok;
            importNote = r.message;
            if (r.ok) srcBump++;
        } catch (e) {
            importBad = true;
            importNote = `读取文件失败：${e instanceof Error ? e.message : String(e)}`;
        } finally {
            importing = false;
        }
    }
</script>

<div class="rl-bd">
    {#if !shown.length}
        <!-- 🔴 #439 空态：**本类 0 条**。原来这里的分支是「本类为空也照样列另一类」（已撤，见 `shown`）。
             🔴 #455 **空态只说本类**：原来还有「你在「网络文学源」里有 N 条 + 整批搬过来」那一段 —— 已撤。
                两类源互不相通，在文学窗口里报网文源的条数/摆搬运按钮，读起来就是「这两类可以混着用」
                （用户：「两个不同类型的源不可能相通的，用网文源怎么搜文学类书籍完全是多此一举」）。
                改分类回归设置页（下面那行说明里有指路），⛔ 别把搬运按钮长回这里。
             ⚠️ 兜底当年防的是「面板空着、像书源全丢了」⇒ 那份信息由下面这段文字接手，⛔ 不是一删了之。
             ⚠️ 分类名走 `SIMPLE_LABEL[kind]`（**带下标**）—— 写成 `SIMPLE_LABEL` 会在界面上印出
                `[object Object]`（#455 修正的一处真 bug，断言有反向守卫）。 -->
        <div class="rl-bd-note">
            还没有{SIMPLE_LABEL[kind]}的书源 —— 书源由你自备，导入一份 .json 规则文件即可按书源搜书：
        </div>
        <div class="rl-bd-note">
            <!-- 🔴 #425：`<label>` 内嵌 `<input type="file">` 的**原生**文件选择 ——
                 点 label 由浏览器内部转发激活，且 input 用 `.rl-file-pick` 铺满整块
                 ⇒ 用户其实是直接点在 input 上。⛔ 别改回 JS `input.click()`。
                 ⚠️ **不挂任何 click handler**：外层只是普通说明行、没有可冒泡的点击语义；
                    挂了反而会让 Svelte 报 a11y 警告（可见非交互元素带 click 要有键盘处理）。 -->
            <label class="rl-btn rl-bd-inline rl-file-label">
                {importing ? '导入中…' : '导入书源…'}
                <input
                    class="rl-file-pick"
                    type="file"
                    accept=".json,application/json"
                    disabled={importing}
                    on:change={onImportPick} />
            </label>
            （导入的源会归到「{SOURCE_KIND_LABEL[kind]}」；分类改错了可在「设置 › 元数据源配置 › 书籍源凭据」里整批改，启用 / 停用 / 删除也在那儿。）
        </div>
    {:else}

        <!-- 搜索行：**源下拉 + 输入框并排**（用户 2026-09-29：「把下拉框并排搜索框」）。
             ⛔ 没有「搜索」按钮 —— 输入即搜（见 `scheduleSearch`）。框内左侧一枚放大镜照 Obsidian 原生搜索框。 -->
        <div class="rl-bd-search">
            <select class="rl-input rl-bd-sel" bind:value={pickedSource} disabled={downloading}>
                <!-- 🔴 #455：文案从「全部书源」改成「本类全部」—— 下拉里本来就只有本类源（`shown`），
                     叫「全部」会让人以为网文源也在这一份里（用户这一轮点的就是「两类不相通」这件事）。 -->
                <option value="all">本类全部（{enabledCount} 个启用）</option>
                {#each shown as s (s.host + s.name)}
                    <option value={s.name} disabled={s.disabled}>{s.name}{s.disabled ? '（已停用）' : ''}</option>
                {/each}
            </select>
            <span class="rl-bd-find">
                <Icon icon="search" size={14} />
                <input
                    class="rl-input"
                    type="text"
                    value={kw}
                    placeholder="输入书名 / 作者，边打边搜"
                    spellcheck="false"
                    disabled={downloading}
                    on:input={(ev) => {
                        kw = inputVal(ev);
                        scheduleSearch();
                    }}
                    on:keydown={(ev) => {
                        if (ev.key !== 'Enter') return;
                        ev.preventDefault();
                        searchNow();
                    }} />
            </span>
        </div>
    {/if}

    <!-- 导入结果就地显示（成功与失败都在这），⛔ 不要在 `!shown.length` 分支里 —— 成功后那个分支就没了 -->
    {#if importNote}
        <div class="rl-bd-note" class:is-warn={importBad}>{importNote}</div>
    {/if}

    <!-- 抓取进度条（照「下载歌曲」那套的外形）。
         🔴 #429 **改成真实进度**：抓章层每抓完一章就 `onProgress` 回调一次 ⇒ 我们**有**分子和分母
             （`prog.done` / `prog.failed` / `prog.total`），⛔ 不必再退回「不确定态来回跑」那种假动画
             （旧注释写的「本仓传输层没有流式回调」说的是**单次请求**没有流式回调，与**逐章**回调是两回事）。
         百分比放在**进度条右边**（用户点名），数字定宽 + `tabular-nums` ⇒ 1→2 位数跳动时不左右抖。
         🔴 `cancelling` 一置位 ⇒ 文案与按钮同时换成「取消中…」—— 这是「点了应该有反应」的全部；
             真正的中断发生在宿主侧（令牌），这里只是把它画出来。 -->
    {#if downloading}
        <div class="rl-bd-progress">
            <div class="rl-bd-progress-row">
                <div class="rl-bd-progress-track"><div class="rl-bd-progress-fill" style="width:{pct}%"></div></div>
                <span class="rl-bd-progress-pct">{pct}%</span>
            </div>
            <div class="rl-bd-progress-text">
                {novelProgressText(prog.done, prog.total)}
                {#if prog.failed} · 失败 {prog.failed}{/if}
                {#if cancelling} · 正在取消…{:else} · 正在抓取（{NOVEL_CHAPTER_CONCURRENCY} 并发）{/if}
                <button class="rl-btn rl-bd-inline" disabled={cancelling} on:click={requestCancel}>
                    {cancelling ? '取消中…' : '取消'}
                </button>
            </div>
        </div>
    {:else if doneNote}
        <!-- #429 完成提示**占进度条这一格**：用户盯进度条的那只眼睛就在这儿。
             ⚠️ 只表示「下完了」；文件落在哪、几章、什么格式仍由底部的 `tip` 交代（两处各司其职）。 -->
        <div class="rl-bd-note is-ok rl-bd-done">{doneNote}</div>
    {/if}

    {#if picked}
        <!-- 选中态 = **一件独立卡片**（#423）：⛔ 别再退回「结果列表下面追加一段」——
             那样用户看不出「现在是在挑章节、还是还在搜」。 -->
        <div class="rl-bd-picked">
            <button class="rl-bd-back" disabled={downloading} on:click={backToResults}>
                <Icon icon="arrow-left" size={13} />
                <span>返回搜索结果</span>
            </button>
            <div>
                <div class="rl-bd-picked-t">{picked.title}</div>
                {#if picked.author || toc.length}
                    <div class="rl-bd-picked-m">
                        {picked.author}{#if picked.author && toc.length} · {/if}{#if toc.length}共 {toc.length} 章{/if}
                    </div>
                {/if}
            </div>
            {#if tocLoading}
                <div class="rl-bd-note"><span class="rl-spinner"></span> 正在取目录…</div>
            {:else}
                {#if wholeNote}
                    <!-- 🔴 #457 整页回退：**原因必须说清楚**（文学/公版源常是「整本书一个页面」）。
                         只有一章 ⇒ 不再摆「章节 X 到 Y」那排数字框（没有可选范围，摆着是噪音）。 -->
                    <div class="rl-bd-note is-warn">{wholeNote}</div>
                {/if}
                {#if !wholeNote}
                    <div class="rl-bd-nums">
                        <span class="rl-bd-lbl">章节</span>
                        <input class="rl-input rl-bd-num" type="number" min="1" max={toc.length} bind:value={from} disabled={downloading} />
                        <span class="rl-bd-lbl">到</span>
                        <input class="rl-input rl-bd-num" type="number" min="1" max={toc.length} bind:value={to} disabled={downloading} />
                        <span class="rl-bd-hint">共 {toc.length} 章</span>
                    </div>
                {/if}
                <div class="rl-bd-acts">
                    <button
                        class="rl-btn mod-cta"
                        disabled={downloading || to < 1}
                        on:click={() => void startDownload('epub')}
                        data-tip="带目录的电子书（推荐）">
                        {downloading && dlFormat === 'epub' ? '下载中…' : '下载 EPUB'}
                    </button>
                    <button
                        class="rl-btn"
                        disabled={downloading || to < 1}
                        on:click={() => void startDownload('txt')}
                        data-tip="纯文本（通用）">
                        {downloading && dlFormat === 'txt' ? '下载中…' : '下载 TXT'}
                    </button>
                </div>
            {/if}
        </div>
    {:else if shown.length}
        <!-- 结果区**固定高度 + 内部滚动**（同「下载歌曲」）：边搜边出也不改变布局高度，输入框不会被顶走。 -->
        <div class="rl-bd-body">
            <div class="rl-bd-head">
                <span class="rl-bd-head-t">搜索结果</span>
                <span class="rl-bd-head-m">
                    {#if searching}检索中…{:else if searched}{hitCount} 条 · {okResults.length} 个源{/if}
                </span>
            </div>
            <!-- 🔴 #456：这里原来还有一句与输入框占位**逐字相同**的提示 —— 已删
                 （用户：「两个提示…输入框占位一个搜索结果下面一个太杂了」）。
                 ⛔ 别把那句提示写进本文件的任何注释：断言的反向守卫锚的是它的字面量。
                 ⇒ 未检索时结果区**留白**（提示只在输入框占位里说一次），因此下面两个分支都要带 `searched` 判据
                 —— ⛔ 别退回「不判 `searched` 就直接说没找到」，那会把「还没搜」显示成「搜了但没结果」。 -->
            {#if searching && !flatHits.length}
                <div class="rl-bd-note"><span class="rl-spinner"></span> 正在检索 {enabledCount} 个源…</div>
            {:else if searched && !flatHits.length}
                <div class="rl-bd-note is-warn">没有找到匹配的书。可以换个关键词（试试作者名），或者改书名里的生僻字。</div>
            {:else if flatHits.length}
                {#each flatHits as row, i (row.hit.bookUrl)}
                    <!-- 🔴 整行可点（#422 续四）：原来每行右侧挂一枚「选择」，十条结果就是十枚重复按钮。
                         🔴 #423：行改**横向**布局 —— 这是「居中 bug」的根治（见样式里那段说明）。
                         🔴 #426：行首加**序号**（用户点名）。 -->
                    <button class="rl-bd-hit" on:click={() => void choose(row.hit)} data-tip="选这本 → 挑章节范围">
                        <span class="rl-bd-no">{i + 1}</span>
                        <span class="rl-bd-row-main">
                            <span class="rl-bd-name">{row.hit.title}</span>
                            <span class="rl-bd-meta">{row.hit.author}{#if row.hit.author && row.hit.latestChapter} · {/if}{row.hit.latestChapter}</span>
                        </span>
                        <span class="rl-bd-tag">{row.source}</span>
                        <span class="rl-bd-go"><Icon icon="arrow-right" size={14} /></span>
                    </button>
                {/each}
            {/if}
        </div>

        <!-- 🔴 #422 续四 → #423 **位置从结果区上方移到弹窗底部**：失败是排查用的次要信息，
             不该占着结果的空间（用户上手说「太丑了」最直接的一处）。 -->
        {#if failedResults.length}
            <div class="rl-bd-fails">
                <button class="rl-bd-fails-head" on:click={() => (failsOpen = !failsOpen)} aria-expanded={failsOpen}>
                    <span class="rl-bd-fails-caret" class:is-open={failsOpen}>▸</span>
                    <span>{failedResults.length} 个源没能搜索</span>
                </button>
                {#if failsOpen}
                    <div class="rl-bd-fails-body">
                        {#each failedResults as r (r.sourceName)}
                            <!-- 悬浮看原文（`data-tip`）——列表里只放折好的那句话 -->
                            <div class="rl-bd-fail" data-tip={r.error}>
                                <span class="rl-bd-fail-src">{r.sourceName}</span>
                                <span class="rl-bd-fail-why">{novelFailText(r.error ?? '')}</span>
                            </div>
                        {/each}
                    </div>
                {/if}
            </div>
        {/if}
    {/if}

    {#if tip}<div class="rl-bd-note is-ok">{tip}</div>{/if}
    {#if err}<div class="rl-bd-note is-warn">{err}</div>{/if}
</div>

<style>
    /* 视觉照「下载歌曲」弹窗（`.rl-dl-*`，当年整块搬自 `obsidian-lyricflux` 的定稿观感）：
       搜索结果区固定高度 + 内部滚动 / 每项是卡片 / 24×24 图标按钮 / 胶囊标签。
       ⛔ 两处若哪天要一起改，先考虑上移成 `styles.css` 的全局类，别各改一半。 */
    .rl-bd {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }
    /* 搜索行：**源下拉 + 输入框并排**（用户 2026-09-29 点名）。
       🔴 **没有「搜索」按钮** —— 输入即防抖搜索（用户 2026-09-29：「能不能做自动搜索…就能去掉搜索按钮了」）。 */
    /* 🔴 #456 用户点名：「搜索框和下拉框要呈现 2/3 占满全弹窗」⇒ 两个控件**铺满整行**，
       比例 **下拉 : 搜索框 = 1 : 2**（搜索框约 2/3）。⛔ 别退回 `flex: 0 0 auto` + `max-width: 40%`
       —— 那样下拉按内容宽浮动、搜索框吃剩下的，同一个弹窗换个源名就换一次比例。 */
    .rl-bd-search {
        display: flex;
        gap: 8px;
        align-items: center;
        width: 100%;
    }
    /* 源下拉：占 1/3（`min-width: 0` 让超长源名在框内截断，⛔ 不撑破整行）。
       ⚠️ 两级前缀：`.rl-input` 是全局类，同特异性下谁后写谁赢、跨表顺序不可控。 */
    .rl-bd .rl-bd-sel {
        flex: 1 1 33.333%;
        width: auto;
        min-width: 0;
        max-width: none;
    }
    .rl-bd-find {
        flex: 2 1 66.666%;
        min-width: 0;
        position: relative;
        display: flex;
        align-items: center;
    }
    /* 🔴 #456 两件控件**等高**（下拉的原生高度与输入框差一截，并排时上沿/下沿各错半像素，很显脏）。
        ⛔ 只在**本弹窗**写 height：编辑表单那边有自己的节奏，别拿全局 `.rl-input` 去改它。 */
    .rl-bd-search .rl-input {
        height: 30px;
        box-sizing: border-box;
    }
    /* 🔴 #456 搜索框要**铺满它那 2/3 的槽**：`<input>` 不写 `width` 时按 `size`（20 字符 ≈ 184px）
       定宽，槽再宽它也杵在左边 —— 用户看到的就是「搜索框右边空一截」。
       判据：`.rl-bd-find` 的宽度 == 里面 input 的宽度（仿真页 ep456 实测两处相等）。 */
    .rl-bd-find .rl-input {
        flex: 1;
        min-width: 0;
        padding-left: 29px;
    }
    .rl-bd-find :global(.rl-icon) {
        position: absolute;
        left: 9px;
        color: var(--text-faint);
        pointer-events: none;
    }
    /* 结果区**固定高度 + 内部滚动**（同「下载歌曲」）：边搜边出也不改变布局高度。 */
    .rl-bd-body {
        display: flex;
        flex-direction: column;
        gap: 6px;
        height: min(320px, 45vh);
        overflow-y: auto;
        padding-right: 2px;
    }
    .rl-bd-head {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 0 2px 2px;
    }
    .rl-bd-head-t {
        flex: 1;
        min-width: 0;
        font-size: var(--font-ui-small);
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .rl-bd-head-m {
        flex: none;
        color: var(--text-muted);
        font-size: var(--font-ui-smaller);
    }
    /* 🔴 结果项 = 整行可点的**卡片**。
       🔴 #423 **居中 bug 的根治**：行从「纵向 flex」改成**横向**，并且把宿主会压上来的三条一起显式声明 ——
          Obsidian 核心对 `button` 铺了 `align-items: center` + `justify-content: center` +
          `text-align: center`；以前只写了 `display: flex; flex-direction: column`，那三条**不冲突、
          一起生效** ⇒ 纵列的两个 span 各自缩到内容宽度、被水平居中（用户截图里书名/作者缩在行中间）。
        ⇒ 这四条（display / align-items / justify-content / text-align）**一个都不能少**：
          `align-items:center` 现在是我们要的（横向布局下的垂直居中），`justify-content:flex-start` 压掉水平居中，
          `text-align:left` 管住文字。⚠️ 只留 `display:flex` 就会复发。 */
    .rl-bd .rl-bd-hit {
        display: flex;
        align-items: center;
        justify-content: flex-start;
        gap: 8px;
        width: 100%;
        padding: 8px 10px;
        text-align: left;
        border: 1px solid transparent;
        border-radius: 6px;
        background: var(--background-secondary);
        box-shadow: none;
        color: inherit;
        font-family: inherit;
        font-size: inherit;
        cursor: pointer;
    }
    .rl-bd .rl-bd-hit:hover {
        background: var(--background-modifier-hover);
        border-color: var(--background-modifier-border-hover);
    }
    /* ⛔ 核心 `button:not(.clickable-icon)` 的特异性高过单类 ⇒ 上面两条必须带 `.rl-bd ` 前缀 */
    /* 🔴 #426 序号（用户点名「要显示序号」）—— 定宽右对齐 + `tabular-nums`：
       1 / 10 / 100 位数不同也各占一格、后面对齐不跳（普通数字是比例宽，会左右抖）。 */
    .rl-bd .rl-bd-no {
        flex: 0 0 auto;
        min-width: 1.8em;
        text-align: right;
        color: var(--text-faint);
        font-size: var(--font-ui-smaller);
        font-variant-numeric: tabular-nums;
    }
    .rl-bd-row-main {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
        flex: 1;
    }
    .rl-bd-name,
    .rl-bd-meta {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .rl-bd-name {
        font-size: var(--font-ui-small);
        font-weight: 600;
    }
    .rl-bd-meta {
        color: var(--text-muted);
        font-size: var(--font-ui-smaller);
    }
    /* 来源胶囊（#423 起每行都带 —— 它是「平铺不再分组」的补偿） */
    .rl-bd-tag {
        flex: none;
        padding: 0 6px;
        border-radius: 10px;
        background: var(--background-modifier-hover);
        color: var(--text-muted);
        font-size: var(--font-ui-smaller);
        line-height: 16px;
        white-space: nowrap;
    }
    .rl-bd-go {
        flex: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        color: var(--text-muted);
    }
    /* 悬停时箭头变绿 = 「点它进去」的提示（与「下载歌曲」行内动作按钮同一套色语） */
    .rl-bd .rl-bd-hit:hover .rl-bd-go {
        color: var(--color-green, var(--interactive-accent));
    }
    /* 抓取进度条（照「下载歌曲」那套的外形）。🔴 #429 起是**真实进度** —— 见模板上方那段说明。 */
    .rl-bd-progress {
        display: flex;
        flex-direction: column;
        gap: 3px;
    }
    /* 进度条 + 百分比**同一行**（用户点名「进度条右边加个百分比」）：
       条吃满剩余宽度、百分比定宽贴在右边。 */
    .rl-bd-progress-row {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .rl-bd-progress-track {
        flex: 1;
        min-width: 0;
        height: 6px;
        border-radius: 3px;
        background: var(--background-modifier-border);
        overflow: hidden;
    }
    /* ⚠️ 刻意**不加 `transition: width`** —— 50 并发下回调每秒来几十次，补间只会让条子**落后于真值**
       （看着像卡住），而这正是本批要治的那个观感。 */
    .rl-bd-progress-fill {
        height: 100%;
        width: 0;
        border-radius: 3px;
        background: var(--text-accent);
    }
    /* 百分比数字：定宽 + `tabular-nums` ⇒ 1% → 10% → 100% 位数变化时不左右抖 */
    .rl-bd-progress-pct {
        flex: 0 0 auto;
        min-width: 34px;
        text-align: right;
        color: var(--text-muted);
        font-size: var(--font-ui-smaller);
        font-variant-numeric: tabular-nums;
    }
    .rl-bd-progress-text {
        color: var(--text-muted);
        font-size: var(--font-ui-smaller);
    }
    /* 完成提示（#429）—— 只加粗前半句「完成！总耗时 X」，后面的路径回执仍走普通 `.rl-bd-note` */
    .rl-bd-done {
        color: var(--text-accent);
        font-weight: 600;
    }
    /* ⛔ 不确定态那套（那条 `.is-indeterminate` 规则 + 它配套的 `@keyframes`）已随真实进度**整体退场**，
       别只把它注释掉留着 —— 有反向守卫钉着它不许回潮。
       ⚠️ 本注释刻意**不写出那两个被禁的完整标识符**：注释会进产物，写进去就是自撞红（本仓记过多次）。 */
    /* 选中态卡片：书名 / 作者·章数 / 章节范围 / 两个下载按钮 */
    .rl-bd-picked {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 10px 12px;
        border: 1px solid var(--background-modifier-border);
        border-radius: 6px;
        background: var(--background-secondary);
    }
    .rl-bd .rl-bd-back {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        align-self: flex-start;
        padding: 0;
        border: none;
        background: transparent;
        box-shadow: none;
        color: var(--text-muted);
        font-family: inherit;
        font-size: var(--font-ui-smaller);
        cursor: pointer;
    }
    .rl-bd .rl-bd-back:hover {
        color: var(--interactive-accent);
    }
    .rl-bd-picked-t {
        font-size: var(--font-ui-small);
        font-weight: 600;
    }
    .rl-bd-picked-m {
        color: var(--text-muted);
        font-size: var(--font-ui-smaller);
    }
    .rl-bd-nums {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
    }
    .rl-bd-lbl {
        font-size: var(--font-ui-smaller);
        color: var(--text-muted);
    }
    .rl-bd-num {
        flex: 0 0 76px;
        min-width: 64px;
        max-width: 84px;
    }
    .rl-bd-hint {
        font-size: var(--font-ui-smaller);
        color: var(--text-faint);
    }
    .rl-bd-acts {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
    }
    .rl-bd-inline {
        flex: 0 0 auto;
    }
    .rl-bd-note {
        font-size: var(--font-ui-smaller);
        color: var(--text-muted);
        /* 说明行可能挺长 ⇒ 允许换行，别撑破弹窗 */
        overflow-wrap: anywhere;
    }
    .rl-bd-note.is-ok {
        color: var(--text-accent);
    }
    .rl-bd-note.is-warn {
        color: var(--text-error);
    }
    /* 🔴 失败源折叠区：**弹窗底部**一行小字，展开后限高滚动（10 个源也撑不破弹窗）。 */
    .rl-bd-fails {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding-top: 6px;
        border-top: 1px solid var(--background-modifier-border);
    }
    .rl-bd .rl-bd-fails-head {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
        padding: 2px;
        text-align: left;
        border: none;
        border-radius: var(--radius-s);
        background: transparent;
        box-shadow: none;
        color: var(--text-muted);
        font-family: inherit;
        font-size: var(--font-ui-smaller);
        cursor: pointer;
    }
    .rl-bd .rl-bd-fails-head:hover {
        color: var(--text-normal);
    }
    .rl-bd-fails-caret {
        flex: none;
        transition: transform 0.12s ease;
    }
    .rl-bd-fails-caret.is-open {
        display: inline-block;
        transform: rotate(90deg);
    }
    .rl-bd-fails-body {
        display: flex;
        flex-direction: column;
        gap: 2px;
        max-height: 120px;
        overflow-y: auto;
        padding: 2px;
    }
    .rl-bd-fail {
        display: flex;
        gap: 8px;
        font-size: var(--font-ui-smaller);
        color: var(--text-muted);
    }
    .rl-bd-fail-src {
        flex: 0 0 auto;
        color: var(--text-normal);
    }
    .rl-bd-fail-why {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
</style>
