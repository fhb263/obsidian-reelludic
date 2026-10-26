/**
 * 设置**真机窗口尺寸**（Win32 SetWindowPos）。
 *
 * 为什么不走 CDP `Browser.setWindowBounds`：
 *   Electron 的 CDP 里**没有 `Browser.*` 窗口域**（实测报 `'Browser.getWindowForTarget' wasn't found`），
 *   而渲染进程里 `require('electron').BrowserWindow` 因上下文隔离拿不到主进程 API。
 *   ⇒ 唯一可靠路径 = 发给 Win32 窗口的那条 `SetWindowPos`。
 *
 * ⚠️ 两个坑：
 *  ⑴ 入参是**内容区**尺寸（CSS px），要自己加上标题栏/边框（按 GetClientRect / GetWindowRect 差值算）；
 *  ⑵ 最大化状态下 `SetWindowPos` 无效 ⇒ 先 `ShowWindow(SW_RESTORE)`；
 *  ⑶ 系统缩放（DPI 150% 等）下，逻辑像素 ≠ 物理像素 ⇒ 用 `GetDpiForWindow` 换算。
 */
'use strict';

const { execFileSync } = require('child_process');

const PS = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class RlWin {
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int X, int Y, int cx, int cy, uint f);
    [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
    [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
    public delegate bool EnumProc(IntPtr h, IntPtr p);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }

    // 按进程找 Chromium 顶层窗（Chrome_WidgetWin_1）
    // ⚠️ **不筛 IsWindowVisible**：后台/无焦点启动的窗口在这里报 vis=False，但它就是真窗口，照样能改尺寸。
    public static IntPtr FindByPid(uint[] pids) {
        IntPtr found = IntPtr.Zero;
        int bestArea = 0;
        EnumWindows(delegate(IntPtr h, IntPtr p) {
            uint pid; GetWindowThreadProcessId(h, out pid);
            if (Array.IndexOf(pids, pid) < 0) return true;
            var sb = new StringBuilder(64); GetClassName(h, sb, 64);
            if (sb.ToString() != "Chrome_WidgetWin_1") return true;
            RECT r; GetClientRect(h, out r);
            int area = (r.Right - r.Left) * (r.Bottom - r.Top);
            if (area < 10000) return true;   // 过滤零尺寸辅助窗
            if (area > bestArea) { bestArea = area; found = h; }   // 取最大的那个
            return true;
        }, IntPtr.Zero);
        return found;
    }
}
"@
$pids = @(Get-CimInstance Win32_Process -Filter "Name='Obsidian.exe'" |
    Where-Object { $_.CommandLine -like '*VAULTMATCH*' } |
    ForEach-Object { [uint32]$_.ProcessId })
if ($pids.Count -eq 0) { Write-Output 'NO_PROC'; exit 0 }
$h = [RlWin]::FindByPid([uint32[]]$pids)
if ($h -eq [IntPtr]::Zero) { Write-Output ('NO_WINDOW pids=' + ($pids -join ',')); exit 0 }
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class RlDpi { [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h); }
"@
$proc = $null
$h = $null
try { $h = [RlWin]::FindByPid([uint32[]]$pids) } catch { Write-Output ('HANDLE_ERR ' + $_); exit 0 }
if (-not $h -or $h -eq [IntPtr]::Zero) { Write-Output 'NO_WINDOW'; exit 0 }
# 先让窗口真正显示：从未显示过的窗口 Chromium 不会按新尺寸重排（渲染进程停在旧的 800x600）
[RlWin]::ShowWindow($h, 1) | Out-Null
try { (New-Object -ComObject WScript.Shell).AppActivate([int]$pids[0]) | Out-Null } catch {}
[RlWin]::ShowWindow($h, 9) | Out-Null
Start-Sleep -Milliseconds 600
if ([RlWin]::IsZoomed($h)) { [RlWin]::ShowWindow($h, 9) | Out-Null; Start-Sleep -Milliseconds 250 }
$c = New-Object RlWin+RECT; $w = New-Object RlWin+RECT
[RlWin]::GetClientRect($h, [ref]$c) | Out-Null
[RlWin]::GetWindowRect($h, [ref]$w) | Out-Null
$chromeW = ($w.Right - $w.Left) - ($c.Right - $c.Left)
$chromeH = ($w.Bottom - $w.Top) - ($c.Bottom - $c.Top)
$scale = 1.0
try { $d = [RlDpi]::GetDpiForWindow($h); if ($d -gt 0) { $scale = $d / 96.0 } } catch {}
$outerW = [int]([double]WIDTH_TARGET * $scale) + $chromeW
$outerH = [int]([double]HEIGHT_TARGET * $scale) + $chromeH
[RlWin]::SetWindowPos($h, [IntPtr]::Zero, 0, 0, $outerW, $outerH, 0x0014) | Out-Null
Start-Sleep -Milliseconds 400
$c2 = New-Object RlWin+RECT
[RlWin]::GetClientRect($h, [ref]$c2) | Out-Null
Write-Output ("CLIENT=" + [int](($c2.Right - $c2.Left) / $scale) + "x" + [int](($c2.Bottom - $c2.Top) / $scale) + " SCALE=" + $scale)
`;

/**
 * @param {number} width  内容区逻辑宽（CSS px）
 * @param {number} height 内容区逻辑高
 * @param {string} [vaultName] 用来在多个 Obsidian 窗口里认出 harness 那个（默认 .testvault）
 * @returns {{ ok: boolean, width?: number, height?: number, scale?: number, raw: string }}
 */
function setWindowSize(width, height, vaultName = '.testvault') {
    const script = PS.replace(/VAULTMATCH/g, vaultName).replace(/WIDTH_TARGET/g, String(width)).replace(/HEIGHT_TARGET/g, String(height));
    try {
        const raw = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8', timeout: 20000 }).trim();
        if (raw === 'NO_WINDOW') return { ok: false, raw };
        const m = raw.match(/CLIENT=(\d+)x(\d+)\s+SCALE=([\d.]+)/);
        if (!m) return { ok: false, raw };
        return { ok: true, width: Number(m[1]), height: Number(m[2]), scale: Number(m[3]), raw };
    } catch (e) {
        return { ok: false, raw: 'ERR ' + (e.message || String(e)) };
    }
}

module.exports = { setWindowSize };

if (require.main === module) {
    const [w, h] = (process.argv[2] || '1440x900').split('x').map(Number);
    const r = setWindowSize(w, h);
    console.log(r.raw);
    process.exit(r.ok ? 0 : 1);
}
