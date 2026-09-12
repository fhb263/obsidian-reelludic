# 阅读器「软件式沉浸」批 1.5 实施计划（去原生框 · 悬浮顶栏）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 TXT/EPUB 阅读器从「Obsidian Modal 内嵌自绘 UI」视觉升级为软件式仿真——隐藏原生 modal 边框/标题栏、顶栏改半透明悬浮直铺（跟随系统明暗主题）。

**Architecture:** 纯 CSS（styles.css `.rl-reader-*` 是 TXT/EPUB 双面板共用宿主样式）+ 少量 modal 沉浸类注入（ReaderModal.ts）。TXT/EPUB 共用 `.rl-reader` 容器与 `.rl-reader-head/.rl-reader-body/.rl-reader-footer` 宿主类，去框/悬浮顶栏的宿主层改动一次覆盖双面板。不改数据模型/功能逻辑。

**Tech Stack:** Obsidian plugin（TypeScript + 手写 DOM）+ styles.css。

**起点：** 批 1 交付态（含 G6 三轮修订），HEAD=`61800d5`。
**范围收敛（2026-09-04 计划阶段核实）：** 正文阅读栏宽/章标题**批 1 已实现**（TXT 680px 居中、EPUB 720px 居中），本批**不改**（用户确认接受现状）。侧栏折叠态 B-b（完全收起）批 1 已满足。本批只做**两项真增量：去原生框 + 悬浮顶栏**。

---

### Task 0: 去原生框 —— ReaderModal 沉浸类注入 + CSS 覆盖

**Files:**
- Modify: `src/modals/ReaderModal.ts`（`TxtReaderModal.onOpen` / `EpubReaderModal.onOpen`）
- Modify: `styles.css`（在 `.rl-reader` 块 505-513 附近追加覆盖规则）

- [ ] **Step 1: onOpen 给 modalEl 加沉浸类**

在 `TxtReaderModal.onOpen()` 与 `EpubReaderModal.onOpen()` 各加一行（放在 `contentEl.style.cssText = ...` 赋值后）：

```ts
// 软件式沉浸：去原生 modal 边框/标题栏，阅读器自绘顶栏直铺（批 1.5 P1）
this.modalEl.addClass('rl-reader-immersive');
```

- [ ] **Step 2: styles.css 追加沉浸覆盖规则**

在 `.rl-reader` 主块（505-513）后插入：

```css
/* 批1.5 软件式沉浸：rl-reader-immersive 加在 Modal 的 modalEl 上，覆盖 Obsidian 原生 modal 骨架
   （去标题栏/圆角/阴影，拉满近屏）。用 display:none 覆盖而非删除 DOM——结构为 Obsidian 未公开，
   若某版本失效则外观降级为普通弹窗，功能不受影响。仅限本类作用域，不影响插件其他弹窗。 */
.modal.rl-reader-immersive {
    width: 97vw;
    max-width: none;
    height: 95vh;
    max-height: none;
    border-radius: 0;
    box-shadow: none;
    border: none;
    padding: 0;
    margin: 0;
}
.modal.rl-reader-immersive .modal-title { display: none; }
.modal.rl-reader-immersive .modal-close { display: none; }
.modal.rl-reader-immersive .modal-content,
.modal.rl-reader-immersive .modal-body {
    padding: 0;
    height: 100%;
    overflow: hidden;
}
/* 外层容器去弹窗阴影/圆角/边框。用 .modal.rl-reader-immersive 已覆盖 modalEl；如宿主还有 modal-bg 遮罩层
   需一并隐藏，实现时目检决定是否补 .modal-container:has(.rl-reader-immersive) .modal-bg { display:none } */
```

> 注：Obsidian 桌面 Electron 现代内核支持 `:has()`；但默认选择器 `.modal.rl-reader-immersive`（modalEl 本身有该 class）已足够覆盖主体。`modal-bg`（弹窗遮罩）若目检觉得仍像弹窗（半透明黑遮罩挡 Obsidian 界面），可补：
> ```css
> body:has(.rl-reader-immersive) .modal-bg { display: none; }
> ```
> 让阅读器无遮罩更"独立"。以目检效果为准，保留与否在 Task 1 目检后定。

- [ ] **Step 3: 验证编译**

```bash
C:/Users/kest/.workbuddy/binaries/node/versions/22.22.2-2/node.exe node_modules/typescript/bin/tsc -noEmit -skipLibCheck
```
Expected: 0 errors。

- [ ] **Step 4: 生产构建 + 类断言**

```bash
rm -f main.js && C:/Users/kest/.workbuddy/binaries/node/versions/22.22.2-2/node.exe esbuild.config.mjs production 2>&1 | grep -iE "error"; ls -la main.js
node -e "const s=require('fs').readFileSync('main.js','utf8'); console.log('rl-reader-immersive in bundle:', s.includes('rl-reader-immersive'))"
```
Expected: build 无 error、main.js ~3.5MB、`rl-reader-immersive` = true。

- [ ] **Step 5: 提交**

```bash
git add src/modals/ReaderModal.ts styles.css
git commit -m "feat: reader immersive de-frame modal shell (batch1.5 T0)"
```

- [ ] **Step 6: 手工目检（TXT/EPUB 各一本）**
无 Obsidian 原生标题栏/无外层圆角阴影；阅读器自绘顶栏在 modal 最顶部；宽接近全屏。若仍见原生栏/弹窗遮罩露馅，转 Step 2 补 `modal-bg` 规则重试。

---

### Task 1: 顶栏半透明悬浮 + body 顶部 padding（宿主 chrome，TXT/EPUB 共用）

**Files:**
- Modify: `styles.css`（`.rl-reader` L505 / `.rl-reader-head` L519-527 / `.rl-reader-body` L586-590）

- [ ] **Step 1: .rl-reader 加 position:relative**

`.rl-reader` 块（505-513）补一行：

```css
.rl-reader {
    position: relative;      /* 悬浮顶栏的定位上下文（批1.5） */
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    font-family: var(--font-text);
    user-select: text;
}
```

- [ ] **Step 2: .rl-reader-head 改 absolute 半透明悬浮**

将 `.rl-reader-head`（519-527）整块替换为：

```css
/* 顶栏：半透明渐变悬浮浮层（跟随系统明暗）；absolute 于 .rl-reader 顶部，不占文档流，正文可下穿 */
.rl-reader-head {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 16px;
    /* 半透明渐变浮层：顶部实色保可读，向下渐隐到透明；色值用 Obsidian 变量 */
    background: linear-gradient(to bottom,
        var(--background-primary) 0%,
        color-mix(in srgb, var(--background-primary) 60%, transparent) 55%,
        transparent 100%);
    flex-shrink: 0;
}
```

> `color-mix` 现代 Chromium 支持。若主题未定义某变量导致编译/渲染异常，降级为 `background: linear-gradient(to bottom, var(--background-primary), transparent);`（两段式渐变）。实现时目检文本可读性微调渐变终点（55%/100%）。**去掉原 `border-bottom: 1px solid ...`（实体分隔线），悬浮无需硬线。**

- [ ] **Step 3: .rl-reader-body 顶部 padding 容纳悬浮顶栏**

`.rl-reader-body`（586-590）加顶部留白。head 内 padding 10px + 按钮行约 34px，悬浮高度 ~54px；给 body 内容区顶部留等量空间让首行不压在顶栏下（C-1a）：

```css
.rl-reader-body {
    display: flex;
    flex: 1;
    min-height: 0;
    /* 为悬浮顶栏留白（C-1a 不压首行/首 tab）；值以目检 head 实际高度为准微调 */
    padding-top: 54px;
    box-sizing: border-box;
}
```

> **padding 放 body 正确**：`.rl-reader-body` 是 flex row（侧栏 + 正文并排），整体下移让出顶部一条，悬浮顶栏盖在这条透明空白区上，侧栏 tab 与正文首行都避开顶栏。**不要**改放到正文容器（会只让正文让位、侧栏 tab 仍被盖）。

- [ ] **Step 4: 验证编译**

```bash
C:/Users/kest/.workbuddy/binaries/node/versions/22.22.2-2/node.exe node_modules/typescript/bin/tsc -noEmit -skipLibCheck
```
Expected: 0 errors（纯 CSS）。

- [ ] **Step 5: 提交**

```bash
git add styles.css
git commit -m "feat: reader floating translucent head + body top padding (batch1.5 T1)"
```

- [ ] **Step 6: 手工目检（TXT/EPUB 各一本，浅色+深色主题各看一遍）**
顶栏半透明悬浮于正文/侧栏之上、无实体下边框、无原生弹窗遮罩；正文首行与侧栏 tab 不被顶栏压住；顶栏按钮文字在浅/深主题下均可读。若顶栏文字与正文撞色难读 → 调 Step 2 渐变终点/加底部不透明段。

---

### Task 2: Gate —— 回归 + 构建部署 + 符号断言 + 文档

**Files:**
- 验证/部署/文档：`Project-Rule/CHANGELOG.md`、`Project-Rule/current-progress.md`

- [ ] **Step 1: 全量测试回归**

```bash
cd "C:/Users/kest/Desktop/obsidian-reelludic"
C:/Users/kest/.workbuddy/binaries/node/versions/22.22.2-2/node.exe node_modules/vitest/vitest.mjs run 2>&1 | grep -E "Test Files|Tests "
```
Expected: 735/735（纯视觉，纯逻辑不受影响）。

- [ ] **Step 2: 生产构建**

```bash
rm -f main.js && C:/Users/kest/.workbuddy/binaries/node/versions/22.22.2-2/node.exe node_modules/typescript/bin/tsc -noEmit -skipLibCheck && C:/Users/kest/.workbuddy/binaries/node/versions/22.22.2-2/node.exe esbuild.config.mjs production 2>&1 | grep -iE "error"; ls -la main.js
```
Expected: 无 error、main.js 生成。

- [ ] **Step 3: 部署三件套 cmp 校验**

```bash
cp -f main.js build/main.js && cp -f main.js "C:/Users/kest/Desktop/临时测试库/.obsidian/plugins/obsidian-reelludic/main.js"
cp -f styles.css build/styles.css && cp -f styles.css "C:/Users/kest/Desktop/临时测试库/.obsidian/plugins/obsidian-reelludic/styles.css"
cp -f manifest.json build/manifest.json && cp -f manifest.json "C:/Users/kest/Desktop/临时测试库/.obsidian/plugins/obsidian-reelludic/manifest.json"
cmp build/main.js "C:/Users/kest/Desktop/临时测试库/.obsidian/plugins/obsidian-reelludic/main.js" && cmp build/styles.css "C:/Users/kest/Desktop/临时测试库/.obsidian/plugins/obsidian-reelludic/styles.css" && cmp build/manifest.json "C:/Users/kest/Desktop/临时测试库/.obsidian/plugins/obsidian-reelludic/manifest.json" && echo "THREE-PIECE OK"
```
Expected: THREE-PIECE OK。

- [ ] **Step 4: 产物符号断言**

```bash
node -e "const s=require('fs').readFileSync('main.js','utf8'); ['rl-reader-immersive'].forEach(k=>console.log('main.js', k, s.includes(k))); const c=require('fs').readFileSync('styles.css','utf8'); ['.modal.rl-reader-immersive','position: absolute'].forEach(k=>console.log('styles.css', k, c.includes(k)))"
```
Expected: main.js 含 `rl-reader-immersive`；styles.css 含 `.modal.rl-reader-immersive` 与 `position: absolute`（head 悬浮）。

- [ ] **Step 5: 文档同步**

在 `Project-Rule/CHANGELOG.md`「未发布」节顶部追加横幅；`Project-Rule/current-progress.md` 追加 #206：
内容：批 1.5 软件式沉浸（去原生 modal 框/标题栏 + 顶栏半透明悬浮 + 正文/侧栏留白让位；正文阅读栏宽核实为批 1 已实现不改）；文件、验证数字（735/735、main.js 大小、cmp OK）。

- [ ] **Step 6: 提交文档**

```bash
git add Project-Rule/CHANGELOG.md Project-Rule/current-progress.md
git commit -m "docs: reader immersive (batch1.5) CHANGELOG + current-progress"
```

- [ ] **Step 7: 最终手工目检（交付 G6）**
对照 spec 目标结构：①无原生 modal 标题栏/边框/圆角阴影/弹窗遮罩 ②顶栏半透明悬浮、正文首行与侧栏 tab 不被压 ③浅/深主题各看无不可读/色断层 ④侧栏折叠 `≣` 展开/收起正常 ⑤TXT 阅读栏仍居中限宽 680px（回归确认未破坏）。

---

## 范围边界（对照 spec 裁剪）

- 不做：真无边框独立窗口 / 独立 View / 主题切换 / icon 胶囊列 / 自动隐藏顶栏（常驻保留）/ 差异化底色 / 数据存储变更 / **正文宽度与章标题改动（P4，批 1 已实现，本批裁剪）**
- 不改 readerFontSize/readerLineHeight 默认值
- 纯 CSS + ReaderModal 沉浸类；无纯逻辑 TDD
