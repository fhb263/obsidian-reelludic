const fs = require('fs');

const CHROME =
    process.env.CHROME_PATH ||
    (fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
        ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
        : 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe');

const url = process.argv[2];
const port = Number(process.argv[3] || 9334);

const child = require('node:child_process').spawn(
    CHROME,
    [
        '--headless=new',
        '--disable-gpu',
        `--remote-debugging-port=${port}`,
        '--user-data-dir=' + process.cwd() + '\\_shot\\.cdp2',
        '--window-size=1160,1200',
        '--hide-scrollbars',
        url,
    ],
    { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWs() {
    for (let i = 0; i < 40; i++) {
        try {
            const r = await fetch(`http://127.0.0.1:${port}/json/list`);
            const list = await r.json();
            const page = list.find((t) => t.type === 'page');
            if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
        } catch (e) {}
        await sleep(250);
    }
    throw new Error('no CDP target');
}

async function main() {
    const wsUrl = await getWs();
    const WebSocket = globalThis.WebSocket;
    const ws = new WebSocket(wsUrl);
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
    await sleep(2500);
    const r = await send('Runtime.evaluate', {
        expression: `JSON.stringify({
            title: document.title,
            report: (document.getElementById('report')||{}).innerText || '',
            probe: window.__PROBE_RESULT__ || null,
            SCOPE: typeof SCOPE,
            handleCount: document.querySelectorAll('.rl-tbl-resize').length,
            parents: [...new Set([...document.querySelectorAll('.rl-tbl-resize')].map(e=>e.parentElement.tagName))]
        })`,
        returnByValue: true,
    });
    console.log('--- events ---');
    console.log(events.length ? events.join('\n') : '(none)');
    console.log('--- result ---');
    console.log(r.result && r.result.result ? r.result.result.value : JSON.stringify(r));
    ws.close();
    child.kill();
    process.exit(0);
}

main().catch((e) => {
    console.error('CDP FAIL:', e.message);
    child.kill();
    process.exit(1);
});
