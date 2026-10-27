// 安全挂内置图标 —— **全仓唯一一份**（P1 收口：此前 9 个文件各自抄了一份同名函数）。
//
// ⚠️ 官方文档的事实：`setIcon` 的注释明写
//    "Insert an SVG into the element from an iconId. **Does nothing if no icon associated with the iconId.**"
//    ⇒ 「图标名不认识」**不会抛错**，是静默 no-op。
//    所以旧注释里写的「图标名不认识 ⇒ 抛错 ⇒ 兜住」是**错的**，别照抄。
//
// 那还留 try/catch 干嘛：`setIcon` 是宿主实现（非我们可控），传入已卸载/非元素节点、
//    或宿主内部图标表损坏时仍可能抛；图标只是装饰，**炸了不该连带整个面板**。
//    这是「廉价兜底」，不是「在防一个已知的抛错点」——两者别混。
import { setIcon } from 'obsidian';

/** 挂内置图标；任何异常吞掉（图标是装饰，不该阻断宿主流程） */
export function safeSetIcon(el: HTMLElement, icon: string): void {
    try {
        setIcon(el, icon);
    } catch {
        // 见文件头：官方语义下「未知图标」不会走到这里，此处只兜宿主实现异常。
    }
}
