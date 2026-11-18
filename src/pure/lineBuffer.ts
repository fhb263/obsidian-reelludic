/**
 * 按行切分「流式字节块」的纯逻辑。
 *
 * 🔴 存在理由（用户 m12618「极速版 SenseVoice每隔2分钟出句还是错的」）：
 *    外部程序（`sherpa-onnx-offline` / `whisper-cli` / python 桥接）把结果**按行**打到
 *    stdout / stderr，而 Node 的 stream `'data'` 事件给出的分块边界**与换行毫无关系**。
 *    若对每个 chunk 各自 `split('\n')`：
 *      · 一条 5～10KB 的 JSON 被切成两半 ⇒ 两半都 `JSON.parse` 失败 ⇒ **整个结果静默丢失**；
 *      · 中文被切在多字节序列中间 ⇒ 片段末尾出现 U+FFFD ⇒ 即便拼上也解析不出原文。
 *    真机表现就是「每隔 N 秒才出一句」—— 丢掉的恰好是被切开的那几段。
 *
 * ⚠️ 为什么用 `Buffer` 而不是 `string`：`String(chunk)` 会用默认 utf8 解码，多字节字符
 *    被腰斩时**信息已经永久丢失**（解码成一串 U+FFFD，再拼也拼不回来）。必须先把原始
 *    字节攒够一整行，再一次性解码。
 */

/**
 * 逐块喂入，吐出**完整行**（不含换行符）。
 *
 * 半行会留在内部，等下一次 `push` 或最后的 `flush`。
 */
export interface LineSplitter {
    /** 喂一个字节块，返回这次凑齐的所有完整行（已去 `\r`、已 trim，空行丢弃） */
    push(chunk: Buffer | Uint8Array | string): string[];
    /** 流结束时调用：把残留的半行也吐出来（最后一条 JSON 常常没有换行结尾） */
    flush(): string[];
}

/**
 * 造一个行切分器。
 *
 * @param onText 可选：每收到完整一批文本时回调（用于同时累积「原始输出」给报错用）
 */
export function createLineSplitter(onText?: (text: string) => void): LineSplitter {
    let pending: Buffer = Buffer.alloc(0);

    const emit = (buf: Buffer): string[] => {
        const text = buf.toString('utf8');
        if (onText) onText(text);
        const out: string[] = [];
        for (const raw of text.split('\n')) {
            const line = raw.replace(/\r/g, '').trim();
            if (line) out.push(line);
        }
        return out;
    };

    return {
        push(chunk) {
            const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk);
            if (!buf.length) return [];
            pending = pending.length ? Buffer.concat([pending, buf]) : buf;
            // 只处理到**最后一个**换行为止，后面的半行留给下一次
            const cut = pending.lastIndexOf(0x0a);
            if (cut < 0) return [];
            const complete = pending.subarray(0, cut + 1);
            pending = pending.subarray(cut + 1);
            return emit(complete);
        },
        flush() {
            if (!pending.length) return [];
            const rest = pending;
            pending = Buffer.alloc(0);
            return emit(rest);
        },
    };
}
