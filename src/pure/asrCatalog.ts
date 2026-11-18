/**
 * 「选择模型」平铺单选列表的数据源（UI 只负责画，⛔ 不再把数字写进渲染代码）。
 *
 * 🔴 背景（2026-11-10 用户需求）：模型列表要从「一家一行 + 行内下拉」改成
 *    「按大类分组的平铺单选框」—— 让用户一眼看到**所有**档位的体积与准确度，
 *    而不是先选家、再展开下拉才知道有哪些档。
 *
 * 因此这里把 6 家 × 各档位拉平成一张表：每档一个 `pickId`（`<engine>:<档位>`），
 * 与 `Settings.switchAsrModel` 的前缀约定完全一致。⛔ 别另起一套 id 规则，
 * 那样「点列表」和「点下拉」会走两条不同的路，续加引擎必漏。
 *
 * ⚠️ 体积 / 准确度 / 标签 / 场景**逐字取自用户给的对照表**（`_shot/user-requirement-raw.md`
 *    行 105-122）。这是给用户看的对外口径，⛔ 不要拿 `bundleBytes()` 重算覆盖它 ——
 *    下载与就绪判定用的是真实字节数（`asrBundles` / `asrModels`），两套数字各有各的用途。
 *
 * ⚠️ 两处与上游事实不符、已经用户裁定过的条目：
 *    · X-ASR：用户表里写「Q4_K 93MB / F16 310MB」，但 HF 上只有 ONNX（整套约 586MB），
 *      没有 GGUF 量化包 ⇒ **只列一行**，分块档位（160/480/960/1920ms）进配置面板切换。
 *    · Paraformer：上游没有英文指标 ⇒ `accEn` 为 `null`，界面显示 `-`，⛔ 别填 0。
 */
import { ASR_ENGINES, type AsrEngineId } from 'pure/asrEngines';

/** 一个可选档位（平铺列表里的一行） */
export interface AsrCatalogTier {
    /** 平铺单选 id，形如 `whisper:base` / `xasr:1920` */
    pickId: string;
    /** 所属模型家 */
    engine: AsrEngineId;
    /** 档位名（上游档位原样，如 `base` / `0.6B` / `int8`） */
    tier: string;
    /**
     * 行上显示的档位名；省略则用 `tier`。
     * 只有 X-ASR 需要（它的档位值必须是裸 `1920` 才能落进设置，
     * 但给人看的是「1920ms」），⛔ 别为了统一把它改成 `1920ms` ——
     * `normalizeXasrChunk` 只认四个裸数字。
     */
    label?: string;
    /** 体积文案，如 `142 MB`（用户对照表口径） */
    size: string;
    /** 中文准确度（字错率 %，越小越好）；`null` = 上游未提供 */
    accZh: number | null;
    /** 英文准确度；`null` = 上游未提供 */
    accEn: number | null;
    /** 一句话定位，如「入门平衡」 */
    tag: string;
    /** 适合什么场景 */
    scene: string;
}

/** 一个大类（模型家）分组 */
export interface AsrCatalogGroup {
    engine: AsrEngineId;
    /** 家名，如 `Whisper.cpp` */
    title: string;
    /** 一行的定位说明，如 `全场景多语种 · 生态最成熟` */
    subtitle: string;
    tiers: readonly AsrCatalogTier[];
}

const WHISPER_TIERS: readonly AsrCatalogTier[] = [
    { pickId: 'whisper:tiny', engine: 'whisper', tier: 'tiny', size: '75 MB', accZh: 18.7, accEn: 7.55, tag: '极速极简', scene: '适合嵌入式、移动端或快速草稿转写' },
    { pickId: 'whisper:base', engine: 'whisper', tier: 'base', size: '142 MB', accZh: 8.9, accEn: 5.01, tag: '入门平衡', scene: '适合移动端、原型验证或极低延迟场景' },
    { pickId: 'whisper:small', engine: 'whisper', tier: 'small', size: '466 MB', accZh: 6.2, accEn: 3.43, tag: '桌面常用', scene: '多数语言可用，综合适用性广' },
    { pickId: 'whisper:medium', engine: 'whisper', tier: 'medium', size: '1.5 GB', accZh: 4.8, accEn: 2.9, tag: '高精度', scene: '复杂口音与专名鲁棒，适合高质量离线转写' },
    { pickId: 'whisper:turbo', engine: 'whisper', tier: 'turbo', size: '1.6 GB', accZh: 7.5, accEn: 4.8, tag: '性价比之王', scene: '速度极快，多语种通用性极强' },
    { pickId: 'whisper:large-v3', engine: 'whisper', tier: 'large-v3', size: '3.1 GB', accZh: 3.7, accEn: 3.0, tag: '旗舰精度', scene: '追求极低错误率，适合服务端部署' },
];

const QWEN_TIERS: readonly AsrCatalogTier[] = [
    { pickId: 'qwen3:0.6B', engine: 'qwen3', tier: '0.6B', size: '1.88 GB', accZh: 3.15, accEn: 2.11, tag: '高吞吐引擎', scene: '主打轻量高并发（RTF 0.064），适合算力充裕的边缘端或高并发服务端' },
    { pickId: 'qwen3:1.7B', engine: 'qwen3', tier: '1.7B', size: '4.71 GB', accZh: 1.52, accEn: 1.63, tag: '开源 SOTA', scene: '中英及口音/强噪声极稳，适合质量优先的服务端/离线转写' },
];

const SENSEVOICE_TIERS: readonly AsrCatalogTier[] = [
    { pickId: 'sensevoice:int8', engine: 'sensevoice', tier: 'int8', size: '228 MB', accZh: 6.2, accEn: 3.1, tag: '端侧首选', scene: '体积仅 FP32 的 1/4，速度提升 2-4 倍，适合 CPU/移动端部署' },
    { pickId: 'sensevoice:fp32', engine: 'sensevoice', tier: 'fp32', size: '894 MB', accZh: 6.2, accEn: 3.1, tag: '精度基准', scene: '保留最完整权重，适合精度验证与算法研究' },
];

const PARAFORMER_TIERS: readonly AsrCatalogTier[] = [
    { pickId: 'paraformer:int8', engine: 'paraformer', tier: 'int8', size: '237 MB', accZh: 1.95, accEn: null, tag: '中文生产主力', scene: 'CER 与全精度持平，原生支持字级时间戳/热词，适合会议纪要、字幕' },
    { pickId: 'paraformer:fp32', engine: 'paraformer', tier: 'fp32', size: '880 MB', accZh: 1.95, accEn: null, tag: '基准对照', scene: '适合与官方 PyTorch 结果严格比对，或追求极限一致性' },
];

/**
 * X-ASR 只有一行。
 * 用户表里那两行（Q4_K / F16）在 HF 上不存在 —— 上游只发 ONNX 三件套，
 * 没有 GGUF 量化包。与其编两个下载不到的体积，不如如实列一档，
 * 把真正的差异（四档分块延迟）放到右侧配置面板里切。
 */
const XASR_TIERS: readonly AsrCatalogTier[] = [
    { pickId: 'xasr:1920', engine: 'xasr', tier: '1920', label: '1920ms', size: '586 MB', accZh: 6.85, accEn: 4.0, tag: '极致轻量流式', scene: '中英双语流式识别，端侧/嵌入式首选；四档分块可在右侧切换' },
];

const CONFUCIUS_TIERS: readonly AsrCatalogTier[] = [
    { pickId: 'confucius:Q4_K_M', engine: 'confucius', tier: 'Q4_K_M', size: '1.0 GB', accZh: 8.2, accEn: 6.1, tag: '高精度零回改', scene: '基于大模型后训练，输出绝不闪烁回改，支持 80ms 极细分块' },
    { pickId: 'confucius:F16', engine: 'confucius', tier: 'F16', size: '3.2 GB', accZh: 8.2, accEn: 6.1, tag: '流式旗舰', scene: '显存充裕且无法容忍量化损失的高端服务端部署' },
];

const TIERS_BY_ENGINE: Record<AsrEngineId, readonly AsrCatalogTier[]> = {
    whisper: WHISPER_TIERS,
    qwen3: QWEN_TIERS,
    sensevoice: SENSEVOICE_TIERS,
    paraformer: PARAFORMER_TIERS,
    xasr: XASR_TIERS,
    confucius: CONFUCIUS_TIERS,
};

/**
 * 按大类分组的完整目录（顺序 = `ASR_ENGINES` 顺序 = 用户表格顺序）。
 *
 * 家名与副标题直接取 `ASR_ENGINES`，⛔ 别在这里再抄一份 —— 两处文案一旦分叉，
 * 分组标题和引擎状态文案就会对不上。
 */
export function asrCatalog(): AsrCatalogGroup[] {
    return ASR_ENGINES.map((def) => ({
        engine: def.id,
        title: def.title,
        subtitle: def.subtitle,
        tiers: TIERS_BY_ENGINE[def.id],
    }));
}

/** 全部档位拉平（计数 / 查找用） */
export function asrCatalogTiers(): AsrCatalogTier[] {
    return asrCatalog().reduce<AsrCatalogTier[]>((all, g) => all.concat(g.tiers), []);
}

/** 按 `pickId` 找档位；找不到返回 null（调用方据此回落默认档） */
export function catalogTierOf(pickId: string): AsrCatalogTier | null {
    return asrCatalogTiers().find((t) => t.pickId === pickId) ?? null;
}

/**
 * 准确度列的显示文案。
 * `null` ⇒ `-`（上游确实没有这项指标），⛔ 不要显示 `0` / `暂无` / `N/A` ——
 * 用户表里就是这么写的，保持同一套口径。
 */
export function accuracyLabel(tier: AsrCatalogTier): string {
    const zh = tier.accZh === null ? '-' : String(tier.accZh);
    const en = tier.accEn === null ? '-' : String(tier.accEn);
    return `${zh}/${en}%`;
}

/**
 * 哪些引擎**整体不折叠**（用户 m03321 点名 whisper）。
 * ⚠️ 单独列成常量而不是在 `tierRowVisible` 里写死 `engine === 'whisper'`：
 *    以后若再有「这家全摊」的裁定，只需在这里加一个 id，判据函数不用动。
 */
export const WHISPER_NO_FOLD: readonly string[] = ['whisper'];

/**
 * 「这一档该不该显示」的判据（组内折叠）。
 *
 * 🔴 2026-11-10 用户逐字（m03321）：「把 Whisper.cpp 后三档不再折叠起来默认展开」。
 *    ⇒ Whisper 这一组**整体免折**（6 档全摊），其余各家用原来的「前 N 档」规则。
 *
 * ⚠️ 为什么免折是**按引擎**而不是把 `tierLimit` 调到 6：
 *    调到 6 会让 SenseVoice / Paraformer / Confucius4 这些**只有 2 档**的组也「永不用折」——
 *    表面看没差，但 `tierLimit` 同时决定「展开其余 N 档」这句话的 N 怎么算
 *    （`group.tiers.length - tierLimit`），调大会把那句话算成 0 甚至负数。
 *    按引擎免折则**只影响 whisper**，其余组的折叠按钮文案一个字都不变。
 *
 * ⚠️ 当前选中项**永远显示**（原有契约，⛔ 别删）：否则选中 Confucius4 之后那一档被折起来，
 *    右侧写着「配置：Confucius4」、左侧却找不到它在哪，看起来像界面丢了东西。
 *
 * @param tierIndex   该档在组内的序号（0 基）
 * @param tierLimit   前多少档常驻
 * @param isCurrent   是不是当前选中项
 * @param expanded    用户是否点了「展开其余 N 档」
 * @param engine      所属引擎（whisper ⇒ 免折）
 */
export function tierRowVisible(
    tierIndex: number,
    tierLimit: number,
    isCurrent: boolean,
    expanded: boolean,
    engine: string,
): boolean {
    if (WHISPER_NO_FOLD.includes(engine)) return true;
    return tierIndex < tierLimit || isCurrent || expanded;
}
