/**
 * 「发 GET 并取正文」的**唯一实现**。
 *
 * ## 为什么单独一个文件
 * 产物断言里有一条老守卫（#396 的 A 组）钉的就是**这件事**：
 * 「每条请求都走同一个 `getText` —— 请求头与状态码判定只有一处」。
 * 只要哪一层自己抄一份 `if (!res || res.status < 200 || res.status >= 300) throw …`，
 * 两份状态码判定将来必然在某次修补时分叉（一处改成 3xx 也算成功，另一处没改
 * ⇒ 同一批请求在两条链上表现不同）。
 *
 * 所以抽到这里：`services/lyricSearch` 只调本函数，⛔ 谁都不许再写第二份状态码判定。
 *
 * ## 为什么收 `headers` 而不是收「源 id」
 * 各源各有一份固定请求头（`LYRIC_SOURCE_HEADERS[source]`）⇒ 请求头是**调用方算好的**，
 * 这一层只管发、只管判状态码。
 */

/** 注入式 GET 的返回形态（`headers` 可选：调用方要读响应头时才用得着） */
export interface TextHttpResponse {
    status: number;
    text: string;
    headers?: Record<string, string | string[] | undefined>;
}

/** 注入式 GET 的签名（真源 = `services/nodeHttp.nodeHttpGet`） */
export type TextHttpGet = (url: string, headers?: Record<string, string>) => Promise<TextHttpResponse>;

/**
 * 发一次 GET 并返回正文。
 * 🔴 非 2xx 一律 throw：站点返回 403/404/500 时正文常常是 HTML 错误页，
 *    交给解析器只会静默得到 0 条 —— 「请求失败」与「没有结果」必须分开。
 */
export async function getTextWithHeaders(
    http: TextHttpGet,
    url: string,
    headers?: Record<string, string>,
): Promise<string> {
    const res = await http(url, headers);
    if (!res || res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res?.status ?? '?'}`);
    return res.text;
}
