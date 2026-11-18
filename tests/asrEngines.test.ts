import { describe, expect, it } from 'vitest';
import {
    ASR_ENGINES,
    ASR_ENGINE_IDS,
    buildQwenArgs,
    engineDefOf,
    parseQwenLine,
    qwenLangFor,
    qwenMissingMessage,
    qwenModelOf,
    QWEN_LANG_NAMES,
    senseVoiceMissingMessage,
} from 'pure/asrEngines';
import { SETTING_GROUP_ICONS, SETTING_NAV_TABS } from 'pure/settingNav';

describe('ASR_ENGINES 注册表', () => {
    it('六家引擎都在，且顺序 = 界面顺序（Whisper / Qwen3 / SenseVoice / Paraformer / X-ASR / Confucius4）', () => {
        expect(ASR_ENGINES.map((e) => e.id)).toEqual([...ASR_ENGINE_IDS]);
        expect(ASR_ENGINES.map((e) => e.title)).toEqual([
            'Whisper.cpp',
            'Qwen3-ASR',
            'SenseVoice',
            'Paraformer',
            'X-ASR',
            'Confucius4',
        ]);
    });

    it('执行器分工被钉住：只有 qwen3 还需要 Python，其余五家都是插件自带的原生程序', () => {
        expect(ASR_ENGINES.filter((e) => e.runner === 'python').map((e) => e.id)).toEqual(['qwen3']);
        // 🔴 这条守的是「六家都能开箱跑」这个卖点 —— 谁把某一家改回 'python'
        //    或改回 'whisper'（那条链只认 whisper-cli），用户就得自己装环境。
        expect(ASR_ENGINES.filter((e) => e.runner === 'whisper').map((e) => e.id)).toEqual(['whisper']);
        expect(ASR_ENGINES.filter((e) => e.autoInstall).map((e) => e.id)).toEqual([
            'whisper',
            'sensevoice',
            'paraformer',
            'xasr',
            'confucius',
        ]);
    });

    it('主标题必须是模型家名（m08893 用户要求），副标题才写人话定位', () => {
        // 🔴 这条**反过来了**：早先 m01938 要求「主标题不能出现技术黑话」，
        //    用户后来发现那样看不出装的是哪一家、排查时对不上号，于是改成主标题=家名。
        //    ⛔ 别把断言改回「不含 whisper/qwen」——那会直接卡死用户要的命名。
        for (const e of ASR_ENGINES) {
            expect(e.title.length).toBeGreaterThan(0);
            expect(e.subtitle.length).toBeGreaterThan(0);
            expect(e.scene.length).toBeGreaterThan(0);
        }
        expect(ASR_ENGINES[0].title).toMatch(/whisper/i);
        expect(ASR_ENGINES[1].title).toMatch(/qwen/i);
        expect(ASR_ENGINES[2].title).toMatch(/sensevoice/i);
        expect(ASR_ENGINES[3].title).toMatch(/paraformer/i);
        expect(ASR_ENGINES[4].title).toMatch(/x-asr/i);
        expect(ASR_ENGINES[5].title).toMatch(/confucius/i);
        // 副标题里要带上「擅长什么」，别变成空泛的版本号。
        // ⚠️ 逐字沿用用户需求文档的分组标题后半段（「Whisper 全场景多语种 · 生态最成熟」等），
        //    ⛔ 别自己另起说辞 —— 那是用户在表格里给定的文案。
        expect(ASR_ENGINES[0].subtitle).toContain('多语');
        expect(ASR_ENGINES[1].subtitle).toContain('中英');
        expect(ASR_ENGINES[2].subtitle).toContain('极速');
        expect(ASR_ENGINES[3].subtitle).toContain('时间戳');
        expect(ASR_ENGINES[4].subtitle).toContain('轻量');
        expect(ASR_ENGINES[5].subtitle).toContain('流式');
    });

    it('engineDefOf 认不出时回落第一家，且不认识空串/脏值', () => {
        expect(engineDefOf('qwen3').id).toBe('qwen3');
        expect(engineDefOf('sensevoice').id).toBe('sensevoice');
        expect(engineDefOf('paraformer').id).toBe('paraformer');
        expect(engineDefOf('xasr').id).toBe('xasr');
        expect(engineDefOf('confucius').id).toBe('confucius');
        expect(engineDefOf(undefined).id).toBe('whisper');
        expect(engineDefOf('nope').id).toBe('whisper');
    });
});

describe('qwenLangFor 语言码映射', () => {
    it('常用码都映射到英文名（桥接脚本认 English 不认 en）', () => {
        expect(qwenLangFor('zh')).toBe('Chinese');
        expect(qwenLangFor('en')).toBe('English');
        expect(qwenLangFor('ja')).toBe('Japanese');
        expect(qwenLangFor('ko')).toBe('Korean');
        expect(qwenLangFor('yue')).toBe('Cantonese');
    });

    it('大小写与空白都容忍', () => {
        expect(qwenLangFor('  ZH ')).toBe('Chinese');
        expect(qwenLangFor('En')).toBe('English');
    });

    it('auto / 空 / undefined / 脏值一律回落 Chinese', () => {
        expect(qwenLangFor('auto')).toBe('Chinese');
        expect(qwenLangFor('')).toBe('Chinese');
        expect(qwenLangFor(undefined)).toBe('Chinese');
        expect(qwenLangFor('klingon')).toBe('Chinese');
    });

    it('映射出来的名字必须真在脚本的语言表里', () => {
        for (const code of ['zh', 'en', 'ja', 'ko', 'yue', 'fr', 'de', 'it', 'pt', 'ru', 'es']) {
            expect(QWEN_LANG_NAMES).toContain(qwenLangFor(code));
        }
    });
});

describe('qwenModelOf 模型档', () => {
    it('只认 1.7B，其余一律 0.6B', () => {
        expect(qwenModelOf('1.7B')).toBe('1.7B');
        expect(qwenModelOf('0.6B')).toBe('0.6B');
        expect(qwenModelOf('')).toBe('0.6B');
        expect(qwenModelOf(undefined)).toBe('0.6B');
        expect(qwenModelOf('7B')).toBe('0.6B');
    });
});

describe('buildQwenArgs', () => {
    it('必填两项 + 默认带 --json', () => {
        expect(buildQwenArgs({ input: 'a.mp4', out: 'a.srt' })).toEqual([
            '--input', 'a.mp4', '--out', 'a.srt', '--json',
        ]);
    });

    it('可选参数按固定顺序追加，且模型档被归一', () => {
        expect(
            buildQwenArgs({ input: 'a.mp4', out: 'a.srt', lang: 'Chinese', model: '7B', mode: 'transcribe', segment: 90 }),
        ).toEqual([
            '--input', 'a.mp4', '--out', 'a.srt',
            '--lang', 'Chinese', '--model', '0.6B', '--mode', 'transcribe',
            '--segment', '90', '--json',
        ]);
    });

    it('segment 非法值不出现', () => {
        expect(buildQwenArgs({ input: 'i', out: 'o', segment: 0 })).not.toContain('--segment');
        expect(buildQwenArgs({ input: 'i', out: 'o', segment: -5 })).not.toContain('--segment');
    });

    it('text 只在有值时出现', () => {
        expect(buildQwenArgs({ input: 'i', out: 'o' })).not.toContain('--text');
        expect(buildQwenArgs({ input: 'i', out: 'o', mode: 'align', text: 'hi' })).toContain('--text');
    });
});

describe('parseQwenLine 协议解析', () => {
    it('PROGRESS 带百分比与文案（文案里有空格也完整保留）', () => {
        expect(parseQwenLine('PROGRESS 35 正在识别 1/3 段')).toEqual({
            kind: 'progress', percent: 35, label: '正在识别 1/3 段',
        });
    });

    it('PROGRESS 没有文案也能解析', () => {
        expect(parseQwenLine('PROGRESS 78')).toEqual({ kind: 'progress', percent: 78, label: '' });
    });

    it('PROGRESS 百分比不是数字时给 null 而不是 NaN', () => {
        const r = parseQwenLine('PROGRESS abc 正在对齐');
        expect(r).not.toBeNull();
        expect(r && r.kind === 'progress' && r.percent).toBeNull();
    });

    it('DONE / ERROR 取余下整段（路径里的空格不会被截断）', () => {
        expect(parseQwenLine('DONE D:\\my videos\\a.srt')).toEqual({
            kind: 'done', srtPath: 'D:\\my videos\\a.srt',
        });
        expect(parseQwenLine('ERROR RuntimeError: 模型加载失败')).toEqual({
            kind: 'error', message: 'RuntimeError: 模型加载失败',
        });
    });

    it('RESULT 解析 JSON', () => {
        const r = parseQwenLine('RESULT {"ok":true,"srtPath":"a.srt","entries":3,"durationSec":13.82}');
        expect(r).toEqual({ kind: 'result', ok: true, srtPath: 'a.srt', entries: 3, durationSec: 13.82 });
    });

    it('坏 JSON 当噪声丢掉，不抛异常', () => {
        expect(parseQwenLine('RESULT {oops')).toBeNull();
    });

    it('上游库的普通日志与空行一律 null（⛔ 别当错误）', () => {
        expect(parseQwenLine('音频时长: 13.82 秒')).toBeNull();
        expect(parseQwenLine('转写中 1/1 [####] 100.0%')).toBeNull();
        expect(parseQwenLine('')).toBeNull();
        expect(parseQwenLine('   ')).toBeNull();
        expect(parseQwenLine('PROGRESS')).toBeNull();
    });

    it('\\r 进度条被清掉后仍能认出协议行', () => {
        expect(parseQwenLine('PROGRESS 50 正在识别\r')).toEqual({
            kind: 'progress', percent: 50, label: '正在识别',
        });
    });

    it('前缀必须带空格，避免把 PROGRESSIVE 之类误判', () => {
        expect(parseQwenLine('PROGRESSIVE 50')).toBeNull();
        expect(parseQwenLine('DONEx')).toBeNull();
    });

    it('SEG 行：三个有限数解析成起止与总长（桥接系的句级时间轴，m09995）', () => {
        expect(parseQwenLine('SEG 12.500 19.000 220.400')).toEqual({
            kind: 'seg', start: 12.5, end: 19, total: 220.4,
        });
    });

    it('SEG 行：缺数 / 非数字 ⇒ 丢整行（半个时间戳会画成 0:12 → NaN，比不画更糟）', () => {
        expect(parseQwenLine('SEG 12.5 19.0')).toBeNull();
        expect(parseQwenLine('SEG 12.5 abc 220.4')).toBeNull();
        expect(parseQwenLine('SEG')).toBeNull();
    });

    /**
     * 🔴 用户 m11612：「转录过程中字幕面板的空态要变成转录过程（每一句转写）」
     *
     * `LINE <起> <止> <正文>` —— 桥接系（Qwen3）原本只发 `SEG`（无正文），
     * 视图层因此拿不到句子，转写期间只能看进度条。
     * ⚠️ 正文含空格且可能很长 ⇒ **只切前两刀**，余下整段原样当正文。
     */
    it('LINE 行：正文含空格 / 标点 / 中文都原样保留（只切前两刀）', () => {
        expect(parseQwenLine('LINE 12.5 19 我们开始吧')).toEqual({
            kind: 'line', start: 12.5, end: 19, text: '我们开始吧',
        });
        expect(parseQwenLine('LINE 0 3.25 Good morning, everyone.')).toEqual({
            kind: 'line', start: 0, end: 3.25, text: 'Good morning, everyone.',
        });
        // 正文里再多空格也不该被切碎
        expect(parseQwenLine('LINE 1 2 a  b   c')).toEqual({
            kind: 'line', start: 1, end: 2, text: 'a  b   c',
        });
    });

    it('LINE 行：时间轴坏 / 正文空 ⇒ 丢整行（⛔ 别画一条只有时间没有字的空行）', () => {
        expect(parseQwenLine('LINE 12.5 19')).toBeNull();
        expect(parseQwenLine('LINE abc 19 正文')).toBeNull();
        expect(parseQwenLine('LINE 12.5 abc 正文')).toBeNull();
        expect(parseQwenLine('LINE 12.5 19   ')).toBeNull();
        expect(parseQwenLine('LINE')).toBeNull();
    });

    it('LINE 与 SEG / PROGRESS 互不误判（前缀必须带空格且整词匹配）', () => {
        expect(parseQwenLine('LINEAR 1 2 x')).toBeNull();
        expect(parseQwenLine('SEG 1 2 3')?.kind).toBe('seg');
        expect(parseQwenLine('LINE 1 2 3')?.kind).toBe('line');
    });
});

describe('引导文案', () => {
    /**
     * 🔴 2026-11-07：这条断言原来只查 `toContain('音频转文字')` —— 设置页把「高级设置 › 音频转文字」
     *    整组搬进「播放阅读 › 语音服务 › 语音转文字」后，旧文案一字未改照样能过（词还在，入口没了）。
     *    现在改成**拿两份导航真源逐级校验处方路径**：
     *      · 第一级 = 页签 ⇒ 必须在 `SETTING_NAV_TABS` 里；
     *      · 第二级 = 分组 ⇒ 必须在 `SETTING_GROUP_ICONS` 里（改组名要同步这张表，所以它等价于「组真实存在」）。
     *    ⛔ 别退回宽松子串匹配 —— 那只能证明「话说得像」，不能证明「点得到」。
     *    ⚠️ 只查页签是不够的：`高级设置` 至今仍是合法页签，光看第一级会让「高级设置 › 音频转文字」照旧通过。
     *
     * 🔴 2026-11-10（用户 m03321）：**路径层级从三级变两级** —— 「语音服务」这个中间层被拆掉，
     *    「语音转文字」自己成了组名，处方路径成了「设置 › 播放阅读 › 语音转文字」。
     *    ⇒ 正则的结尾**不能再硬要求第三个 `›`**（原写法 `… › … ›` 在两级路径上直接匹配不上，
     *      这条断言就会以「文案里没有处方路径」的名义误报）。
     *    改成「第二段后面要么还有 `›`（三级），要么就到收尾的 `」`（两级）」——
     *    两种形状都能切出正确的「页签 + 分组」，且**依旧是逐级对账**，不是子串匹配。
     */
    it('缺失提示里处方路径的页签与分组，必须在导航真源里逐级存在', () => {
        const pages = SETTING_NAV_TABS.map((t) => t.label);
        const groups = Object.keys(SETTING_GROUP_ICONS);
        for (const msg of [qwenMissingMessage(), senseVoiceMissingMessage()]) {
            expect(msg).toContain('设置');
            // 处方形如「设置 › 播放阅读 › 语音转文字」或「设置 › 播放阅读 › 语音服务 › 语音转文字」
            const m = /设置 › ([^›」]+?) › ([^›」]+?)(?= ›|」)/.exec(msg);
            expect(m, `文案里没有「设置 › 页签 › 分组 › …」这种处方路径：${msg}`).not.toBeNull();
            const [, page, group] = m as RegExpExecArray;
            expect(pages, `处方里的页签「${page}」不在导航真源里（现有：${pages.join(' / ')}）`).toContain(page.trim());
            expect(groups, `处方里的分组「${group}」不在组图标注册表里（入口已不存在）`).toContain(group.trim());
        }
    });
});
