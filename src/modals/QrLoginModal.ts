/**
 * 扫码登录弹窗（③-3 B 站 / ③-4 微信读书，2026-11-12 用户 m00353 / m05505）。
 *
 * 🔴 两家的形态**不一样**，别硬凑成一套：
 *    · **B 站** —— 插件内**自绘二维码**（`pure/qrcode` 编码 + `qrSvgPath` 出 SVG）。
 *      用户 m05505 实测：开子窗口会「跳转到浏览器登录 + 触发下载 iBiliPlayer」，
 *      而且子窗口与系统浏览器 session 隔离、已登录也拿不到 Cookie ⇒ 整条改掉。
 *    · **微信读书** —— 仍然**开窗口**：实测它没有任何 HTTP 扫码接口（8 个候选端点全 404），
 *      只能开首页让用户点「登录」用微信扫，我们盯 cookie jar 里的 `wr_name`。
 *
 * 职责边界（别越界）：
 *  · 本弹窗**不写 settings、不刷徽标** —— 成功后一律回调 `opts.onPicked`，
 *    由调用方（`Settings` 的闭包）统一落盘。理由：写盘要连 `saveSettings` +
 *    `clearCredentialStatus` + 行徽标刷新三件事，散在弹窗里就会漏掉其中一件。
 *  · 本弹窗**不判 Cookie 有效** —— 那是「测试连接」的活（`pure/credentialCheck`）。
 *
 * ⚠️ 轮询用 `window.setInterval` + 显式 `clearInterval`：`onClose` 必须停掉，
 *    否则弹窗关了还在打接口（用户看不到任何东西，只看到请求日志在涨）。
 */
import { Modal, Notice, type App } from 'obsidian';
import { applyScrollPref } from 'services/scrollPref';
import { openWereadWindow, pollQrLogin, startBiliQrLogin } from 'services/qrLogin';
import { QR_POLL_INTERVAL_MS, type QrPlatform, type QrPollResult, type QrStartInfo } from 'pure/qrLogin';
import { encodeQr, qrSvgPath } from 'pure/qrcode';
import { setFeedback } from 'ui/components';

/** 两家在弹窗里显示的名字（⛔ 别让调用点各拼一套）。 */
const PLATFORM_LABEL: Record<QrPlatform, string> = {
    bilibili: 'B 站',
    weread: '微信读书',
};

/**
 * 每家「怎么扫」的一句话。
 *
 * ⚠️ B 站：码就在弹窗里，用**手机 B 站客户端**扫，⛔ 别引导去浏览器。
 * ⚠️ 微信读书：窗口打开的是**首页**，用户得自己点页面上的「登录」才会弹出微信二维码。
 *    这句必须写清楚，否则用户对着首页发呆。
 */
const PLATFORM_TIP: Record<QrPlatform, string> = {
    bilibili: '用哔哩哔哩手机客户端扫描下方二维码，并在手机上确认登录。',
    weread: '已打开微信读书首页，请点页面右上角的「登录」→ 用微信扫一扫，登录完成后这里会自动收下 Cookie。',
};

export interface QrLoginPicked {
    /** `name=value; name=value` 形态的 Cookie 头值 */
    cookie: string;
    /** 仅 B 站：`refresh_token`（③-3 硬要求「必须持久化」） */
    refreshToken?: string;
}

export interface QrLoginModalOptions {
    platform: QrPlatform;
    /** 拿到凭据后回调（落盘 + 刷徽标由调用方做） */
    onPicked: (picked: QrLoginPicked) => void;
}

export class QrLoginModal extends Modal {
    /** 轮询定时器（`onClose` 必须清掉） */
    private timer: number | null = null;
    /** 微信读书窗口的句柄（弹窗关掉就一起关，⛔ 别留孤儿窗口） */
    private child: { close: () => void; isClosed: () => boolean } | null = null;
    /** 本次会话的开始时刻（判 TTL 用） */
    private startedAt = 0;
    /** `startBiliQrLogin` 的产物（轮询要用其中的 key） */
    private info: QrStartInfo | null = null;
    /** 是否已经在收尾（防止 done 之后又被打一轮） */
    private settled = false;
    /** B 站二维码的宿主（重新生成时只换这一块，⛔ 别整窗重绘） */
    private qrHost: HTMLElement | null = null;

    constructor(
        app: App,
        private readonly opts: QrLoginModalOptions,
    ) {
        super(app);
    }

    onOpen(): void {
        applyScrollPref(this.modalEl);
        const { contentEl } = this;
        this.titleEl.setText(`扫码登录 · ${PLATFORM_LABEL[this.opts.platform]}`);
        contentEl.addClass('rl-qr-modal');
        contentEl.empty();

        contentEl.createDiv({ cls: 'rl-qr-tip', text: PLATFORM_TIP[this.opts.platform] });
        // B 站：二维码画在这里（微信读书没有码可画，这块保持空）
        this.qrHost = contentEl.createDiv({ cls: 'rl-qr-canvas' });
        const feedback = contentEl.createDiv({ cls: 'rl-qr-feedback' });

        const ops = contentEl.createDiv({ cls: 'rl-qr-ops' });
        const retry = ops.createEl('button', { cls: 'rl-btn', text: '重新生成二维码' });
        retry.addEventListener('click', () => {
            void this.begin(feedback);
        });
        // 🔴 #757（用户 m07156「子窗口登录了，但设置页啥也没反应」）：
        //    微信读书的会话看不出进度，用户不知道该不该继续等。给一颗**立刻读一次**的手动入口，
        //    点一下就把当前 jar 里的登录态读出来 —— 比让用户盯着「等待扫码」猜要诚实。
        if (this.opts.platform === 'weread') {
            const reread = ops.createEl('button', { cls: 'rl-btn', text: '我已在窗口里登录，立即读取' });
            reread.addEventListener('click', () => {
                void this.tick(feedback);
            });
        }
        const cancel = ops.createEl('button', { cls: 'rl-btn', text: '取消' });
        cancel.addEventListener('click', () => this.close());

        void this.begin(feedback);
    }

    onClose(): void {
        this.stopPolling();
        // ⚠️ 子窗口必须跟着关：留着会变成一块没人管的窗口，用户不知道怎么关
        this.child?.close();
        this.child = null;
        this.contentEl.empty();
    }

    /** 起一轮会话：要 key（并画码）或开窗口 → 起轮询。重复调用会先把上一轮停干净。 */
    private async begin(feedback: HTMLElement): Promise<void> {
        this.stopPolling();
        this.child?.close();
        this.child = null;
        this.settled = false;
        this.startedAt = Date.now();

        if (this.opts.platform === 'bilibili') {
            setFeedback(feedback, '正在生成二维码…', 'neutral');
            this.qrHost?.empty();
            let info: QrStartInfo;
            try {
                info = await startBiliQrLogin();
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                setFeedback(feedback, `没能生成二维码：${msg}`, 'warn');
                return;
            }
            this.info = info;
            this.drawQr(info.url);
            setFeedback(feedback, '等待扫码…', 'neutral');
        } else {
            // 微信读书：没有 HTTP 扫码通道 ⇒ 开窗口让用户自己点「登录」
            const win = openWereadWindow();
            if (!win) {
                setFeedback(
                    feedback,
                    '没能打开登录窗口（`@electron/remote` 不可用），请改用手动粘贴 Cookie。',
                    'warn',
                );
                return;
            }
            this.child = win;
            this.info = { platform: 'weread', url: 'https://weread.qq.com/' };
            setFeedback(feedback, '等待扫码…', 'neutral');
        }

        this.timer = window.setInterval(() => {
            void this.tick(feedback);
        }, QR_POLL_INTERVAL_MS);
        // 立刻打一轮：用户手机可能早就对准了
        void this.tick(feedback);
    }

    /**
     * 把 `url` 画成二维码（SVG）。
     *
     * 🔴 用一条 `<path>` 而不是 N 个 `<rect>`：版本 8 的码有两千多个深色模块，
     *    两千个 DOM 节点在设置页里滚动会卡。`viewBox` 设成模块数即可，⛔ 别自己再算缩放。
     * ⚠️ 编码失败（内容过长等）必须**说出来**，⛔ 别留一块空白让用户猜。
     */
    private drawQr(url: string): void {
        const host = this.qrHost;
        if (!host) return;
        host.empty();
        try {
            const matrix = encodeQr(url, { ec: 'M' });
            const NS = 'http://www.w3.org/2000/svg';
            const svg = document.createElementNS(NS, 'svg');
            svg.setAttribute('viewBox', `0 0 ${matrix.size} ${matrix.size}`);
            svg.setAttribute('class', 'rl-qr-svg');
            svg.setAttribute('role', 'img');
            svg.setAttribute('aria-label', '扫码登录二维码');
            // 白底是硬要求：深色主题下直接把深色模块画在深色背景上就扫不出来
            const bg = document.createElementNS(NS, 'rect');
            bg.setAttribute('width', String(matrix.size));
            bg.setAttribute('height', String(matrix.size));
            bg.setAttribute('fill', '#ffffff');
            svg.appendChild(bg);
            const path = document.createElementNS(NS, 'path');
            path.setAttribute('d', qrSvgPath(matrix));
            path.setAttribute('fill', '#000000');
            // 形状渲染要 crispEdges：默认抗锯齿会让细模块糊成一团，手机更难识别
            path.setAttribute('shape-rendering', 'crispEdges');
            svg.appendChild(path);
            host.appendChild(svg);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            host.createDiv({ cls: 'rl-qr-issue', text: `二维码绘制失败：${msg}` });
        }
    }

    /** 轮询一次并按结果更新界面。 */
    private async tick(feedback: HTMLElement): Promise<void> {
        if (this.settled || !this.info) return;
        let r: QrPollResult;
        try {
            r = await pollQrLogin(this.info, this.startedAt);
        } catch (e) {
            // 单轮网络抖动不该结束会话：报一句、下一轮继续（⛔ 别在这里 stopPolling）
            const msg = e instanceof Error ? e.message : String(e);
            setFeedback(feedback, `查询扫码状态失败：${msg}（稍后重试）`, 'warn');
            return;
        }
        if (this.settled) return;

        if (r.stage === 'pending' || r.stage === 'scanned') {
            setFeedback(feedback, r.message, r.stage === 'scanned' ? 'ok' : 'neutral');
            return;
        }
        if (r.stage === 'expired') {
            this.stopPolling();
            setFeedback(feedback, `${r.message} —— 点「重新生成二维码」再来一次。`, 'warn');
            return;
        }
        if (r.stage === 'error') {
            this.stopPolling();
            setFeedback(feedback, r.message, 'warn');
            return;
        }

        // done
        // 🔴 #756：**先校验凭据再终结会话**。原先把 `settled = true` 写在前面，
        //    一旦出现「已确认登录但没读到 Cookie」（B 站票据兑换失败就会出现），
        //    轮询被永久停掉、`settled` 也锁死 ⇒ 用户连重试的机会都没有，只能关掉重开。
        //    ⇒ 没凭据时只报一句、**保持轮询**（下一轮可能就换到了），由用户决定何时重来。
        if (!r.cookie) {
            setFeedback(feedback, '已确认登录，但这次没拿到登录凭据，正在重试…', 'warn');
            return;
        }
        this.settled = true;
        this.stopPolling();
        setFeedback(feedback, '扫码成功，正在保存…', 'ok');
        try {
            this.opts.onPicked({ cookie: r.cookie, refreshToken: r.refreshToken });
            setFeedback(feedback, '扫码成功，已填入 Cookie。', 'ok');
            new Notice(`${PLATFORM_LABEL[this.opts.platform]} 登录成功`);
            this.child?.close();
            this.child = null;
            // 留 600ms 让用户看见「已填入」再关，⛔ 别瞬间消失（会以为没成功）
            window.setTimeout(() => this.close(), 600);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            setFeedback(feedback, `扫码成功但保存失败：${msg}`, 'warn');
        }
    }

    private stopPolling(): void {
        if (this.timer !== null) {
            window.clearInterval(this.timer);
            this.timer = null;
        }
    }
}
