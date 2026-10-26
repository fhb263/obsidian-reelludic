/**
 * 真机会话状态持久化（.testvault-userdata/rd-session.json）
 *
 * 🔴 为什么需要：`Emulation.setDeviceMetricsOverride` 是**会话级**的 —— 每个 CLI 子命令
 *    （setup / shot / check）都是一次独立的 CDP 连接，上一条命令设的视口在下一条里会丢。
 *    真机窗口本身又不会把尺寸变化传给渲染进程（见 cdp.setViewport 的注释）。
 *    ⇒ 把「期望视口 / 主题 / 页签」落到磁盘，每次 connect 时自动重放。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const STATE_NAME = 'rd-session.json';

function statePath(root, userDataName) {
    return path.join(path.resolve(root, userDataName), STATE_NAME);
}

function read(root, userDataName) {
    try {
        return JSON.parse(fs.readFileSync(statePath(root, userDataName), 'utf8'));
    } catch {
        return {};
    }
}

function write(root, userDataName, patch) {
    const p = statePath(root, userDataName);
    const next = { ...read(root, userDataName), ...patch };
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(next, null, 2), 'utf8');
    return next;
}

module.exports = { read, write, statePath };
