/**
 * 音频转文字：模型在磁盘上的目录布局（纯逻辑，不碰 fs）。
 *
 * 🔴 2026-11-06 m09819 用户报障：「三家模型下载在目录怎么不区分，只有 Models 文件夹
 *    都不知道哪个是哪个」。
 *
 * 起因：旧实现 `asrEngineDir()` 对 whisper 直接返回 `models/` 根目录，对另两家返
 * `models/<engine>/`。结果是根目录里散着 `ggml-base.bin` / `model.int8.onnx` /
 * `model.onnx` / `tokens.txt`，与三家各自子目录里的东西混在一层 —— 文件名虽不撞车，
 * 但**没有任何线索说明哪个属于哪一家**，用户想手动清掉某一家的模型都无从下手。
 *
 * 现在统一成：每家一律 `models/<engine>/`，根目录不再放任何模型。
 * 这条规则被 `tests/asrLayout.test.ts` 钉住 —— 它的价值在于：
 * 一旦有人把 whisper 改回根目录（那是个很容易的「顺手」改动），测试会立刻红。
 *
 * 🔴 2026-11-10：引擎从三家扩到六家（新增 paraformer / xasr / confucius）。
 *    子目录名 = 引擎 id 这条规则必须**自动覆盖新引擎**，⛔ 别再写成逐个 if 列举 ——
 *    之前就是那样，新增三家后有三个会悄悄回落到 `whisper`，六家的模型全挤进一个目录，
 *    m09819 那个毛病原样复发，而且这次是六个引擎混在一起，更难清。
 *
 * ⛔ 别把 `path.join` 搬进来：这个模块必须能在浏览器/测试环境无 Node 依赖地跑。
 *    路径分隔符统一用 `/`，由调用方在真正拼磁盘路径时交给 `path.join` 处理。
 */

import { ASR_ENGINE_IDS, type AsrEngineId } from 'pure/asrEngines';

/**
 * 引擎在模型根目录下的子目录名（= `AsrEngineId`）。
 *
 * ⚠️ 这个别名保留下来只为兼容既有 import；真值域就是 `AsrEngineId`，
 *    新增引擎时不需要在这里跟着加一项。
 */
export type AsrEngineIdForLayout = AsrEngineId;

/**
 * 某一家的模型应落在 `models/` 下的哪个子目录。
 *
 * ⚠️ 返回的是**相对子目录名**，不含 `models/` 前缀与任何分隔符 ——
 * 调用方（`main.ts` 的 `asrEngineDir`）负责拼绝对路径。
 * 统一用小写引擎 id，与 `ASR_ENGINES` 的 `id` 逐字一致（⛔ 别用展示名
 * 「Whisper.cpp」当目录名，Windows 大小写不敏感、Linux 敏感，会跨平台不一致）。
 *
 * 认不出的值一律回落到 `whisper`：它是缺省引擎，也是旧布局唯一的受害者，
 * 把来路不明的字符串指向它，至少不会污染别家的目录。
 */
export function asrEngineSubdir(engine: string): AsrEngineIdForLayout {
    const hit = ASR_ENGINE_IDS.find(id => id === engine);
    if (hit) return hit;
    return 'whisper';
}

/**
 * 某一家的模型根下是否**必须**再分一层子目录。
 *
 * 存在的意义是把「每家都必须分子目录」写成可断言的常量。如果哪天有人想给某一家
 * 开例外（「它只有一个文件，放根目录挺好」），得先看这里的注释：
 * 多家混在根目录正是 m09819 抱怨的原始场景，⛔ 没有例外。
 */
export const ASR_ALL_ENGINES_SPLIT = true;

/**
 * 某一家在模型根目录下的**固定文件名**（用于迁移旧布局时判断这些散落文件归谁）。
 *
 * ⚠️ 只列「文件名本身就带引擎身份」的条目：
 *    · whisper 的 `ggml-*.bin` 由 `ASR_MODEL_PRESETS` 提供，不在这里重复列举
 *      （否则改档位要同时改两处）；
 *    · qwen3 的产物是两个上游仓库名**目录**，不是平面文件，这里返回空；
 *    · paraformer / xasr / confucius 的产物常年待在各自子目录里，
 *      旧布局时代它们根本还不存在，没有可迁移的散落文件。
 *
 * ⛔ `tokens.txt` 只归 SenseVoice：另外几家也各有一份 `tokens.txt`，
 *    但那是**新版布局**下 ``models/<engine>/`` 里的东西，不走这条迁移逻辑。
 *    把 tokens.txt 登记给多家会让旧布局迁移搬错方向。
 */
export function asrFixedModelFiles(engine: AsrEngineIdForLayout): readonly string[] {
    if (engine === 'sensevoice') return ['model.int8.onnx', 'model.onnx', 'tokens.txt'];
    return [];
}

/**
 * 判断一个文件名（位于 `models/` 根目录）是否属于某一家，用于旧布局迁移时决定搬给谁。
 *
 * ⚠️ `ggml-*.bin` 只有 whisper 用；`model*.onnx` / `tokens.txt` 只有 SenseVoice 在老布局里出现。
 *    ⛔ 别用模糊前缀匹配 —— 六家引擎里 `model` 这词到处都是（`model.int8.onnx`、
 *    `model.onnx`、`encoder-1920ms.onnx`…），前缀匹配会张冠李戴。
 */
export function asrFileOwner(fileName: string): AsrEngineIdForLayout | null {
    if (/^ggml-.*\.bin$/i.test(fileName)) return 'whisper';
    if (asrFixedModelFiles('sensevoice').includes(fileName)) return 'sensevoice';
    return null;
}
