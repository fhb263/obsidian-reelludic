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
 * 框选矩形的调整手柄方向（2026-11-13 用户指令：「批注模式下框选后可进行六向调整宽高」）。
 *
 * `n`/`s` 调高、`e`/`w` 调宽，四个角同时调两向 —— 合起来就是用户说的「六向」：
 * 上、下、左、右、以及两个「斜向」（角点）。
 */
export type ShotHandle = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

/** 全部手柄（工具条/浮层的渲染顺序，⛔ 别在面板里另写一份）。 */
export const SHOT_HANDLES: readonly ShotHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** 手柄命中半径（CSS px）—— 太小手感差，太大挡住批注落笔。 */
export const SHOT_HANDLE_HIT = 10;

/**
 * 从一次拖拽造矩形（框选起点 → 当前点），钳制进 `bounds`。
 * 与 `normalizeShotRect` 的差别：这里**不判最小尺寸**（调整过程中允许暂时变很小，松手时才判）。
 */
export function rectFromDrag(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    bounds: { left: number; top: number; right: number; bottom: number },
): ShotRect {
    const left = Math.max(bounds.left, Math.min(Math.min(x1, x2), bounds.right));
    const top = Math.max(bounds.top, Math.min(Math.min(y1, y2), bounds.bottom));
    const right = Math.min(bounds.right, Math.max(Math.max(x1, x2), bounds.left));
    const bottom = Math.min(bounds.bottom, Math.max(Math.max(y1, y2), bounds.top));
    return {
        x: Math.round(left),
        y: Math.round(top),
        width: Math.round(Math.max(0, right - left)),
        height: Math.round(Math.max(0, bottom - top)),
    };
}

/**
 * 命中测试：落在哪个手柄上 / 落在框内 / 都没落。
 *
 * 手柄优先于框内 —— 边角处的「缩一点」比「开始画一笔」更符合直觉（pixpin 同款）。
 * `tol` 是手柄命中半径；框内判定用矩形本身。
 */
export function hitShotHandle(
    rect: ShotRect,
    x: number,
    y: number,
    tol = SHOT_HANDLE_HIT,
): ShotHandle | 'inside' | null {
    const nearLeft = Math.abs(x - rect.x) <= tol;
    const nearRight = Math.abs(x - (rect.x + rect.width)) <= tol;
    const nearTop = Math.abs(y - rect.y) <= tol;
    const nearBottom = Math.abs(y - (rect.y + rect.height)) <= tol;
    const withinX = x >= rect.x - tol && x <= rect.x + rect.width + tol;
    const withinY = y >= rect.y - tol && y <= rect.y + rect.height + tol;
    if (nearLeft && nearTop) return 'nw';
    if (nearRight && nearTop) return 'ne';
    if (nearLeft && nearBottom) return 'sw';
    if (nearRight && nearBottom) return 'se';
    if (nearTop && withinX) return 'n';
    if (nearBottom && withinX) return 's';
    if (nearLeft && withinY) return 'w';
    if (nearRight && withinY) return 'e';
    if (x > rect.x && x < rect.x + rect.width && y > rect.y && y < rect.y + rect.height) return 'inside';
    return null;
}

/**
 * 六向调整：按手柄方向移动对应边，钳制进 `bounds`，并保证不小于 `min`。
 *
 * 🔴 钳制的方向要跟着手柄走：拖 `n` 时只有 `top` 能变，`bottom` 必须钉住 ——
 *    否则用户往上拖，框会「整体上移」而不是「变高」，手感完全不同。
 * 🔴 `min` 的作用是**不让框被拖没**：到下限时只钉住被拖的那条边，另一条边不动。
 */
export function resizeShotRect(
    rect: ShotRect,
    handle: ShotHandle,
    dx: number,
    dy: number,
    bounds: { left: number; top: number; right: number; bottom: number },
    min = SHOT_MIN_SIZE,
): ShotRect {
    let left = rect.x;
    let top = rect.y;
    let right = rect.x + rect.width;
    let bottom = rect.y + rect.height;
    if (handle.includes('w')) left = Math.min(left + dx, right - min);
    if (handle.includes('e')) right = Math.max(right + dx, left + min);
    if (handle.includes('n')) top = Math.min(top + dy, bottom - min);
    if (handle.includes('s')) bottom = Math.max(bottom + dy, top + min);
    left = Math.max(bounds.left, Math.min(left, bounds.right));
    top = Math.max(bounds.top, Math.min(top, bounds.bottom));
    right = Math.min(bounds.right, Math.max(right, bounds.left));
    bottom = Math.min(bounds.bottom, Math.max(bottom, bounds.top));
    // 越界钳制后可能又把宽度压到 min 以下（容器本来就窄）⇒ 至少保住 min 与容器的较小者
    const w = Math.max(Math.min(min, bounds.right - bounds.left), right - left);
    const h = Math.max(Math.min(min, bounds.bottom - bounds.top), bottom - top);
    return { x: Math.round(left), y: Math.round(top), width: Math.round(w), height: Math.round(h) };
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
