/**
 * 阅读器「区域截图」纯逻辑（2026-10-23 用户指令：「给 TXT/EUPB/PDF 阅读器加个区域截图回填笔记功能」）。
 *
 * 分工：
 *   · 本模块只管**几何与文案**（框选矩形归一、笔记块拼装、文件名/标签），不碰 DOM、不碰 electron。
 *   · 取像素在 `modals/ShotOverlay` + 宿主 `main.ts:saveReaderShot`（`capturePage` 通道）。
 *   · 落盘与写笔记同样在宿主（笔记文件的唯一拥有者是 `EntryService`，⛔ 别在面板里 `vault.modify`）。
 *
 * 🔴 为什么用 `capturePage(rect)` 而不是 canvas / html2canvas（2026-10-23 真机实证）：
 *   · PDF 页是 canvas，能 `toDataURL`；但 TXT/EPUB 是**文本层**（EPUB 还在 iframe 里），
 *     光栅化要 `html2canvas`（本仓没有）或 `foreignObject`（会丢样式、跨 iframe 更不可靠）。
 *   · Electron 的 `webContents.capturePage({x,y,width,height})` 在本机实测**精确命中**
 *     （传 200×150 得 200×150），且返回的 PNG 是**真实合成像素** ⇒ 三端一条通道、EPUB 的 iframe 也天然覆盖。
 *   · 该 API 的矩形单位是 **DIP（= CSS px）**，与 `getBoundingClientRect()` 同尺，故⛔ 不要乘 `devicePixelRatio`。
 */

/** 阅读截图写进笔记的区段名。🔴 改这里必须同步 `pure/excerpt.ANNOTATION_SECTIONS`（否则模板重写会整区抹掉）。 */
export const SHOT_SECTION_READER = '阅读截图';

/** 框选矩形（CSS px，相对视口左上角）—— 直接喂给 `capturePage`。 */
export interface ShotRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** 可选定位信息：PDF 只有页码（`page`），TXT/EPUB 有章节 + 百分比（`chapter`/`pct`）。 */
export interface ShotLoc {
    page?: number;
    chapter?: number;
    pct?: number;
}

/** 最小可截面积（CSS px）。小于这个尺寸多半是误点/手抖，返回 null 让调用方静默放弃。 */
export const SHOT_MIN_SIZE = 12;

/**
 * 把「一次拖拽」归一成可截的矩形：自动摆正方向（可从右下往左上拖）、钳制进容器、过小返回 null。
 *
 * `bounds` 是**允许截图的区域**（阅读器正文容器的视口矩形）—— 钳制在这里有两层意思：
 *   ① 别把工具栏/侧栏截进去（用户框到外面也只是白边）；
 *   ② `capturePage` 传越界矩形会得到黑边（窗口外没有像素）。
 */
export function normalizeShotRect(
    drag: { x1: number; y1: number; x2: number; y2: number },
    bounds: { left: number; top: number; right: number; bottom: number },
    min = SHOT_MIN_SIZE,
): ShotRect | null {
    const left = Math.min(drag.x1, drag.x2);
    const right = Math.max(drag.x1, drag.x2);
    const top = Math.min(drag.y1, drag.y2);
    const bottom = Math.max(drag.y1, drag.y2);
    const x = Math.max(bounds.left, Math.min(left, bounds.right));
    const y = Math.max(bounds.top, Math.min(top, bounds.bottom));
    const x2 = Math.min(bounds.right, Math.max(right, bounds.left));
    const y2 = Math.min(bounds.bottom, Math.max(bottom, bounds.top));
    const width = Math.round(x2 - x);
    const height = Math.round(y2 - y);
    if (width < min || height < min) return null;
    return { x: Math.round(x), y: Math.round(y), width, height };
}

/**
 * 文件名主干：`<书名> <YYYYMMDD-HHmmss>`（例：`三体 20261023-153012`）。
 *
 * 🔴 2026-10-23 用户指令：「区域截图生成的图片文件名不要是 `书名 截图1` 这类，改成能适配
 *    xRyul/obsidian-image-converter 插件接管的生成形态」。
 *    那个插件的**默认文件命名模板**是 `{notename}-{date:YYYYMMDDHHmmss}`（见其
 *    docs/Variables Reference Guide.md 的 Example 1），即「笔记名 + 紧凑时间戳」。
 *    我们照这个形态产出 ⇒ 用户把 image-converter 的 `file name pattern` 配成同款模板时，
 *    两边的产出**同构**，它按 `{notename}` 规则做转换/改名时认得出来，不会把我们的截图当成异类。
 *
 * 🔴 为什么仍然保留书名前缀，而不是纯时间戳：
 *    书名是这条笔记的唯一线索，纯时间戳在附件目录里等于一堆乱码。
 *
 * 同秒内连拍两张仍会撞名 —— 这种极端情况交给 `getAvailablePathForAttachment` 追加序号兜底
 * （它加的是 ` 1` / ` 2` 后缀，主体仍是「书名 + 时间戳」，同构性不破）。
 *
 * ⛔ 别把时间戳去掉退回「书名 + 截图」：那正是用户报障的形态。
 * ⛔ 也别改成 `{notename}` 之外的模板变量（如 `{imagename}`）—— 本仓没有模板引擎，
 *    image-converter 那个变量表是它自己的 `data.json` 配置，不是我们的运行期依赖。
 */
export function readerShotFileName(title: string, at: Date = new Date()): string {
    const base = sanitizeShotStem(title, '阅读截图');
    return `${base} ${shotStamp(at)}`;
}

/**
 * 时间戳片段 `YYYYMMDD-HHmmss`（本地时区）。
 * 用 `-` 而不是 `:` 分隔时分秒：Windows 文件名不允许冒号，Obsidian 的 `![[…]]` 也会解析错。
 */
export function shotStamp(at: Date = new Date()): string {
    const d = at instanceof Date && Number.isFinite(at.getTime()) ? at : new Date();
    const p2 = (n: number): string => String(n).padStart(2, '0');
    const date = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}`;
    const time = `${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
    return `${date}-${time}`;
}

/** 文件名清洗：去掉路径分隔符与 Obsidian 链接禁用字符（与 `videoLink.sanitizeFileStem` 同口径）。 */
export function sanitizeShotStem(name: string, fallback = ''): string {
    const cleaned = (typeof name === 'string' ? name : '')
        .replace(/\.[a-z0-9]+$/i, '')
        .replace(/[\\/:*?"<>|#^[\]]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return cleaned || fallback;
}

/**
 * 截图块的定位标签：`摘自《书名》· 第 3 页 · 42%`。
 * 逐级省略（没页码就退章节，都没有就只剩书名）—— 与 `pure/excerptCard.excerptCardLocLabel` 同思路，
 * 但**页码优先**：PDF 的章节号是没有意义的，只有页码能回看。
 */
export function readerShotLabel(title: string, loc?: ShotLoc): string {
    const name = (typeof title === 'string' ? title : '').trim() || '未知';
    let out = `摘自《${name}》`;
    if (loc && typeof loc.page === 'number' && Number.isFinite(loc.page) && loc.page > 0) {
        out += ` · 第 ${Math.floor(loc.page)} 页`;
    } else if (loc && typeof loc.chapter === 'number' && Number.isFinite(loc.chapter) && loc.chapter > 0) {
        out += ` · 第 ${Math.floor(loc.chapter)} 章`;
    }
    if (loc && typeof loc.pct === 'number' && Number.isFinite(loc.pct)) {
        const pct = Math.max(0, Math.min(100, Math.round(loc.pct)));
        out += ` · ${pct}%`;
    }
    return out;
}

/**
 * 拼笔记块：`![[图]]` + 一行斜体出处。
 *
 * **fail-closed**：文件名空 ⇒ 返回空串，调用方据此**不写笔记**（宁可留个未引用附件，
 * 也不要在笔记里留一行 `![[]]` 空嵌入 —— 那在阅读视图是个破图框）。
 */
export function readerShotBlock(opts: { fileName: string; label?: string }): string {
    const name = (opts?.fileName ?? '').trim();
    if (!name) return '';
    const embed = `![[${name}]]`;
    const label = (opts.label ?? '').trim();
    return label ? `${embed}\n*${label}*` : embed;
}
