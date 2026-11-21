/**
 * 「这条网络集能不能在**插件里就地播」的**唯一判据**（纯逻辑，可单测）——
 * 具体就是「能不能挂上官方 iframe 内嵌播放器」。
 *
 * 🔴 2026-11-24 用户裁定（逐字）：「将网络集用插件播放器播放的全部功能和样式全部从插件移除，
 *    但有官方 iframe 内嵌播放的不要移除」⇒ `canPlayNetInline` 的语义已经从
 *    「值得进内置播放器**试取流**」变成「**有官方内嵌地址可播**」：
 *    插件不再有任何自取流 / MSE / 本地代理的能力，网络集只有官方 iframe 这一条路。
 *    ⛔ 别把取流那半套接回来（`services/biliMse` / `biliStream` / `pure/biliDash` / `ytMux`
 *    已随该裁定整文件删除，备份在桌面 `_reelludic-removed-net-player-backup-*`）。
 *
 * 🔴 为什么必须单独一个模块，而不是在调用点写 `canEmbedBili(u) || isYouTubeUrl(u)`：
 *    这个条件在**四个**放行闸门上各要用一次（宿主两处 `openEpisodeOrExternal` /
 *    `openEpisodePageFor` 的单集兜底；选集页两处 `pendingNetStart` 消费 / 选集格点击）。
 *    手写四份的必然结局是「改了三个漏一个」—— 本项目已经因为同类漂移栽过（见
 *    `pure/episodeAssoc.ts` 文件头「三处入口共用一份」那条）。⇒ 只留这一份。
 *
 * ⚠️ 与 `canEmbedBili` 的分工仍然要分清（⛔ 别合并成一个谓词）：
 *    - `canEmbedBili(u)` = 「能拼出 **B 站** iframe 地址」；
 *    - `canPlayNetInline` = 「有官方内嵌可播」= B 站 iframe **或** YouTube `/embed/`。
 *    YouTube 不是 `canEmbedBili` 的子集，这就是本模块存在的理由。
 *
 * ⚠️ 返回 `false` 不代表「打不开」—— 只代表「插件里播不了，交宿主开浏览器」。
 *
 * 🔴 2026-11（本次）新增**第三条路**：`canPlayDirectLink`（见下）。
 *    网盘直链（mp4/webm/mov/ogv）不挂 iframe，而是灌进现成的 `<video>`。
 *    它与本模块的主判据**各自独立**，理由写在 `canPlayDirectLink` 的注释里。
 */

import { biliEmbedUrl, canEmbedBili } from 'pure/biliEmbed';
import { isDirectPlayableVideoUrl } from 'pure/webdav';
import { isYouTubeUrl, youTubeIdOf } from 'pure/youtube';

/**
 * 这条网络地址能不能在插件里用官方 iframe 播。
 *
 * @param url 网络集地址（可空；空/非字符串一律 false）
 */
export function canPlayNetInline(url: unknown): boolean {
    const s = typeof url === 'string' ? url : '';
    if (!s) return false;
    return canEmbedBili(s) || isYouTubeUrl(s);
}

/**
 * 这条网络地址能不能**直接灌进内置 `<video>`**（第三条路：http(s) 直链）。
 *
 * 🔴 与 `canPlayNetInline` 是**两条独立的路，⛔ 别合并**：
 *    - `canPlayNetInline` = 「有官方 iframe 可挂」（B 站 / YouTube），挂的是 `<iframe>`；
 *    - `canPlayDirectLink` = 「有个能解的直链」（mp4/webm/mov/ogv），灌的是现成 `<video>`。
 *    合并的后果很具体：`canPlayNetInline` 被四个闸门共用（见文件头），
 *    往里加一条「随便什么 .mp4 都算能内嵌」，会让选集格点击、宿主单集兜底
 *    全都改道去挂 `<iframe>` —— 而 mp4 直链挂 iframe 就是一块**空白页**。
 *
 * 与 2026-11-24 裁定不冲突的那一半：裁掉的是自取流（DASH/MSE/yt-dlp 合流），
 * 直链 `<video>` 没有取流逻辑；用户在本次会话重新拍板选了「可解码的直链内置」。
 * ⚠️ 判据只是**必要条件**（扩展名）：HEVC 编码的 mp4 照样解不了，
 *    所以 `VideoPlayerView` 的 `error` 兜底那条路必须留着。
 */
export function canPlayDirectLink(url: unknown): boolean {
    return isDirectPlayableVideoUrl(url);
}

/** 官方内嵌播放器的一条路：地址 + 工具条上该显示的来源名。 */
export interface NetOfficialEmbed {
    /** 直接灌给 `<iframe src>` 的官方播放器地址 */
    embedUrl: string;
    /** 工具条标题用的站点名（'B站' / 'YouTube'） */
    label: string;
}

/**
 * 「这条网络集在**官方内嵌播放器**里该用哪个地址」—— 插件里唯一的一条播放路。
 *
 * 🔴 2026-11-24 起这是**唯一**分支（用户裁掉了内置播放器）：
 *    以前它只是「设置项 `netInlinePlayer` 关闭时」才走的路，现在恒走它。
 *
 * ⚠️ 真机实测记录（见 `pure/biliEmbed.ts` 文件头）：本机直连 `youtube.com/embed/`
 *    **网络不可达**。用户已知并接受（YouTube 可能是一块白）；能不能用取决于用户的网络环境，
 *    拼不出来（脏数据）就返回 null，调用方退回「在浏览器打开」。
 *
 * 🔴 2026-11-25 用户逐字：「恢复youtube在内嵌iframe的调用」+ 追问后选定
 *    「保持 iframe，我自己在系统层挂代理」⇒ YouTube 这条路**不改网络层**
 *    （iframe 的请求走 Obsidian 渲染进程，插件里的 `ytProxy` 只喂 yt-dlp 子进程，
 *    管不到这里 —— ⛔ 别替用户改会话代理，那会影响整个 Obsidian）。
 *    配套交付的是「**白屏时能说清为什么**」：`netEmbedTitleOf` / `netEmbedFailText` /
 *    `netEmbedFallbackUrl` 三条 —— 它们在纯逻辑层，可单测钉死。
 *
 * @param url 网络集地址（可空）
 */
export function netOfficialEmbed(url: unknown): NetOfficialEmbed | null {
    const s = typeof url === 'string' ? url : '';
    if (!s) return null;
    const bili = biliEmbedUrl(s);
    if (bili) return { embedUrl: bili, label: 'B站' };
    const ytId = youTubeIdOf(s);
    if (ytId) {
        // `rel=0`：别在结尾推荐一堆无关视频；`autoplay=1`：点开就播
        return { embedUrl: `https://www.youtube.com/embed/${ytId}?autoplay=1&rel=0`, label: 'YouTube' };
    }
    return null;
}

/** 内嵌来源（决定标题文案、失败文案，以及有没有备用域名可退）。 */
export type NetEmbedSource = 'bili' | 'youtube';

/**
 * 这条地址的内嵌来源；`null` = 拼不出官方内嵌地址（调用方该走「在浏览器打开」）。
 *
 * ⚠️ 判据必须与 `netOfficialEmbed` / `canPlayNetInline` **永远同步**
 *    （这里刻意复用同一组谓词，⛔ 别另写一份）：顺序也一致 —— 先 B 站后 YouTube。
 *    不同步的后果很具体：界面会出现「标题说 B 站、地址是 YouTube」这种自相矛盾。
 */
export function netEmbedSourceOf(url: unknown): NetEmbedSource | null {
    const s = typeof url === 'string' ? url : '';
    if (!s) return null;
    if (canEmbedBili(s)) return 'bili';
    if (isYouTubeUrl(s)) return 'youtube';
    return null;
}

/**
 * 工具条标题：说清现在挂的是谁家的官方播放器。
 *
 * 🔴 为什么不能再用 `biliEmbed.ts` 的 `NET_BAR_TITLE_FRAME`（'B 站内嵌（取流失败兜底）'）：
 *    ① YouTube 视频挂上去会显示成「B 站…」，与实际播放器对不上；
 *    ② 「取流失败兜底」是内置播放器时代的话术，2026-11-24 取流整条删除后已不成立。
 */
export function netEmbedTitleOf(url: unknown): string {
    const src = netEmbedSourceOf(url);
    if (src === 'youtube') return 'YouTube 官方播放器';
    if (src === 'bili') return 'B 站官方播放器';
    return '官方播放器';
}

/**
 * iframe 加载超时（`EMBED_LOAD_TIMEOUT` 到点还没 `load`）时该显示什么。
 *
 * 🔴 这是「恢复 YouTube 内嵌」的**真正交付物**（2026-11-25 用户选了
 *    「我自己在系统层挂代理」）：YouTube 不通时的表现是一块**纯白**，
 *    而 `X-Frame-Options` 被拒时 Chrome **仍会**触发 `load` ⇒ 看门狗判不出来。
 *    ⇒ 白屏必须**用话说清楚**，否则用户只会认为「插件坏了」。
 *
 * ⚠️ 一定要点明「插件里的代理管不到这里」—— 设置页确实有个 ytProxy，
 *    但它只喂 yt-dlp，那是用户最自然的误解来源。
 */
export function netEmbedFailText(url: unknown): string {
    const src = netEmbedSourceOf(url);
    if (src === 'youtube') {
        return (
            '这个 YouTube 视频没能在播放器里加载出来。' +
            '最常见的原因是这台机器连不上 youtube.com —— 请先确认代理已在**系统层**开启；' +
            '插件设置里的 YouTube 代理只管下载，管不到这里的官方内嵌播放器。'
        );
    }
    if (src === 'bili') {
        return '这个 B 站视频没能在播放器里加载出来 — 可能是网络不通，或 UP 主关闭了站外播放';
    }
    return '这个外链没能在播放器里加载出来 — 可能是网络不通，或对方站点不允许被嵌入';
}

/**
 * 加载失败后值得**自动重试一次**的备用地址；没有备用就 `null`。
 *
 * 🔴 为什么 YouTube 要退 `youtube-nocookie.com`：主域被墙/被区域策略拦时，
 *    无 cookie 域名有时仍在白名单里（也避开第三方 cookie 限制）。同一个视频 id、只换域名，
 *    零风险的一次重试。
 * ⛔ B 站不给备用域名：`player.bilibili.com` 没有等价的第二入口，
 *    乱退只会让「第一次失败 + 第二次也失败」多闪一次白。
 */
export function netEmbedFallbackUrl(url: unknown): string | null {
    const s = typeof url === 'string' ? url : '';
    if (!s) return null;
    if (netEmbedSourceOf(s) !== 'youtube') return null;
    const ytId = youTubeIdOf(s);
    if (!ytId) return null;
    return `https://www.youtube-nocookie.com/embed/${ytId}?autoplay=1&rel=0`;
}
