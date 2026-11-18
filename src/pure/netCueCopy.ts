/**
 * 🔴 网络集「没拿到字幕」空态的文案，按平台 + **失败原因** 分岔。
 *
 * 用户 2026-11-11（m06406 ④）逐字要求两种状态：
 *  - 状态一（未填 Cookie / Cookie 过期）：标题「未能获取到本集字幕」，说明指向
 *    「设置 > 搜索配置 > 网络播放源凭据 > B站/Youtube」去重填 Cookie；
 *  - 状态二（Cookie 有效但解析失败）：标题「字幕加载失败」，说明讲「未能解析出字幕轨」。
 *  并**删掉**原来那个「去 B 站/Youtube 看这一集」出口按钮。
 *
 * 为什么必须靠 `reason` 而不是猜：
 *  - 两种状态在界面上长得一样（都是「没字幕」），但**用户该做的事完全不同** ——
 *    一个去重填 Cookie，一个重填也没用（源视频本来就没轨）。猜错就是让人白折腾。
 *  - 唯一可靠的判据只有一处：`fetchBiliSubtitle` 的 `onDiag` 回的 `login_mid`
 *    （0 = B 站按未登录处理）。旧的实现把它压成 `null`，视图层因此无从分辨。
 *
 * ⚠️ `reason` 为 `null`/`undefined`（宿主没给）时按**状态二**渲染：
 *    宁可让用户以为「源视频没字幕」，也不能喊「你的 Cookie 失效了」——
 *    后者是会被用户照着去改设置的错误指挥。
 *
 * ⚠️ 处方路径（2026-11-11 核对）：B 站 Cookie 填在「设置 › 搜索配置 › 网络播放源凭据 › B站」
 *    （`src/Settings.ts:1832` 的 `createGroupSection(parent, '网络播放源凭据', …)`）。
 *    ⛔ 改设置页组名/页签时就回来同步这句（全仓处方文案的同一纪律）。
 */
import { isYouTubeUrl } from './youtube';

/**
 * 「没拿到字幕」的原因。由宿主侧（`main.ts` 的 `biliSubtitleFor` / `ytSubtitleFor`）判定。
 *
 *  - `no-cookie`      设置里压根没填 Cookie（本机必然 0 条，且发请求也是白发）
 *  - `cookie-invalid` 填了，但 B 站按未登录处理（`login_mid === 0`）/ YouTube 侧取不到登录态
 *  - `no-track`       登录态正常，但这支视频确实没有字幕轨
 *  - `other`          网络 / 风控 / 解析异常等归不到上面的情况
 */
export type NetCueFailReason = 'no-cookie' | 'cookie-invalid' | 'no-track' | 'other';

export interface NetCueEmptyCopy {
    /** 空态标题 */
    title: string;
    /** 空态说明（按平台 + 原因分岔） */
    desc: string;
    /**
     * 语义标记：`auth` = 用户该去改 Cookie；`parse` = 改 Cookie 也没用。
     * 视图层据此决定图标（`key` vs `file-warning`），⛔ 不要靠 title 文本反推。
     */
    state: 'auth' | 'parse';
}

/** 平台名。非 YouTube 一律按 B 站处理 —— 网络集现在只有这两站。 */
export function netCuePlatform(url: unknown): 'YouTube' | 'B 站' {
    return isYt(url) ? 'YouTube' : 'B 站';
}

/** 这个原因是不是「Cookie 没填 / 失效」那一类（决定说哪套话）。 */
export function isAuthFailReason(reason: NetCueFailReason | null | undefined): boolean {
    return reason === 'no-cookie' || reason === 'cookie-invalid';
}

/** ⛔ 形参收 `unknown`：调用方拿的是 `ctx.urls[i]`，可能是 undefined/脏数据，这里不许抛。 */
function isYt(url: unknown): boolean {
    return isYouTubeUrl(String(url ?? ''));
}

/**
 * 生成空态文案。
 *
 * @param url    这一集的网络地址（决定说「B站」还是「YouTube」）
 * @param reason 宿主判定的失败原因；缺失时按「解析失败」渲染（见文件头注释）
 */
export function netCueEmptyCopy(url: unknown, reason?: NetCueFailReason | null): NetCueEmptyCopy {
    // ⚠️ 站名按用户原话写「B站」/「YouTube」，⛔ 别改回带空格的「B 站」——
    //    这句是逐字文案，用户的原文就是「B站/Youtube」这种连写。
    const label = isYt(url) ? 'YouTube' : 'B站';

    if (isAuthFailReason(reason)) {
        return {
            title: '未能获取到本集字幕',
            desc:
                `无法加载当前剧集的字幕。可能由于该集原生无字幕，或设置中的 ${label} Cookie 已失效。` +
                `请前往「设置 > 搜索配置 > 网络播放源凭据 > ${label}」重新填写 Cookie 后重试。`,
            state: 'auth',
        };
    }

    return {
        title: '字幕加载失败',
        desc: '当前播放源未能解析出字幕轨。此问题通常由源视频原生无字幕、接口频控或其他问题导致。',
        state: 'parse',
    };
}
