// 六类型条目卡复现页的真渲染探针：无头 Chrome + CDP，拿**页面自己算出来的**结果，
// 不接受「我看源码觉得对」。
//
// 用法：node tools/shot-notecard.cjs _shot/notecard-all-types.html _shot/notecard-all-types.png
// 退出码：0 = 探针全绿；1 = 有失败项（页面里的 probe 会把每条不对打出来）。
const fs = require('fs');
const { resolve } = require('node:path');

const CHROME =
    process.env.CHROME_PATH ||
    (fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
        ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
        : 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe');

const page = resolve(process.argv[2] || '_shot/notecard-all-types.html');
const shot = resolve(process.argv[3] || '_shot/notecard-all-types.png');
const port = Number(process.env.CDP_PORT || 9341);

const child = require('node:child_process').spawn(
    CHROME,
    [
        '--headless=new',
        '--disable-gpu',
        `--remote-debugging-port=${port}`,
        '--user-data-dir=' + resolve('_shot/.cdp-nc'),
        '--window-size=1420,2400',
        '--hide-scrollbars',
        '--allow-file-access-from-files',
        'file:///' + page.replace(/\\/g, '/'),
    ],
    { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWs() {
    for (let i = 0; i < 40; i++) {
        try {
            const r = await fetch(`http://127.0.0.1:${port}/json/list`);
            const list = await r.json();
            const t = list.find((x) => x.type === 'page');
            if (t && t.webSocketDebuggerUrl) return t.webSocketDebuggerUrl;
        } catch (e) {}
        await sleep(250);
    }
    throw new Error('no CDP target');
}

async function main() {
    const ws = new WebSocket(await getWs());
    let id = 0;
    const pending = new Map();
    const events = [];
    ws.addEventListener('message', (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id && pending.has(msg.id)) {
            pending.get(msg.id)(msg);
            pending.delete(msg.id);
            return;
        }
        if (msg.method === 'Runtime.exceptionThrown') {
            const d = msg.params.exceptionDetails;
            events.push('EXC: ' + (d.exception && d.exception.description ? d.exception.description : d.text));
        }
        if (msg.method === 'Runtime.consoleAPICalled') {
            events.push('LOG[' + msg.params.type + ']: ' + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
        }
    });
    const send = (method, params = {}) =>
        new Promise((res) => {
            const myId = ++id;
            pending.set(myId, res);
            ws.send(JSON.stringify({ id: myId, method, params }));
        });

    await new Promise((res) => ws.addEventListener('open', res));
    await send('Runtime.enable');
    await send('Page.enable');
    await sleep(1800);

    // 探针文本 = 页面自己算的结论
    const probeText = await send('Runtime.evaluate', {
        expression: `(document.getElementById('probe')||{}).innerText || ''`,
        returnByValue: true,
    });
    const text = (probeText.result && probeText.result.result && probeText.result.result.value) || '';

    // 量测：整页高度，截图用
    const metrics = await send('Runtime.evaluate', {
        expression: `JSON.stringify({h: document.documentElement.scrollHeight, cards: document.querySelectorAll('.rl-notecard-split').length})`,
        returnByValue: true,
    });
    const m = JSON.parse((metrics.result.result && metrics.result.result.value) || '{}');
    await send('Emulation.setDeviceMetricsOverride', {
        width: 1420,
        height: Math.min(Math.max(m.h || 1600, 1200), 6000),
        deviceScaleFactor: 1,
        mobile: false,
    });
    await sleep(250);

    const png = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(shot, Buffer.from(png.result.data, 'base64'));

    console.log('--- events ---');
    console.log(events.length ? events.join('\n') : '(none)');
    console.log('--- probe ---');
    console.log(text);
    console.log(`--- 卡片数 ${m.cards} · 产物 ${shot} ---`);

    ws.close();
    child.kill();
    const ok = text.includes('✅') && !text.includes('❌');
    process.exit(ok ? 0 : 1);
}

main().catch((e) => {
    console.error('CDP FAIL:', e.message);
    child.kill();
    process.exit(1);
});
