import { describe, it, expect } from 'vitest';
import {
    CLOUD_VOICE_DEFAULT,
    CLOUD_VOICE_KEY,
    SILICONFLOW_BASE_URL,
    SILICONFLOW_MODEL,
    SILICONFLOW_VOICES,
    SPEECH_MAX_RETRY,
    buildSpeechBody,
    classifySpeechError,
    cloudVoiceGroups,
    cloudVoiceId,
    loadCloudVoice,
    normalizeCloudVoice,
    prefetchIndex,
    saveCloudVoice,
    shouldRetry,
    speechCacheKey,
    speechEndpointUrl,
} from 'pure/ttsCloud';
import { TTS_RATE_MAX, TTS_RATE_MIN } from 'pure/tts';

describe('speechEndpointUrl（#344 云合成端点归一）', () => {
    it('baseUrl 补 /audio/speech', () => {
        expect(speechEndpointUrl('https://api.siliconflow.cn/v1')).toBe('https://api.siliconflow.cn/v1/audio/speech');
    });

    it('尾斜杠 / 多尾斜杠都不产生双斜杠', () => {
        expect(speechEndpointUrl('https://api.siliconflow.cn/v1/')).toBe('https://api.siliconflow.cn/v1/audio/speech');
        expect(speechEndpointUrl('https://api.siliconflow.cn/v1///')).toBe('https://api.siliconflow.cn/v1/audio/speech');
    });

    it('🔴 用户把完整端点整个粘进来（含 /audio/speech）不得再接一次', () => {
        expect(speechEndpointUrl('https://api.siliconflow.cn/v1/audio/speech')).toBe(
            'https://api.siliconflow.cn/v1/audio/speech',
        );
        expect(speechEndpointUrl('https://api.siliconflow.cn/v1/audio/speech/')).toBe(
            'https://api.siliconflow.cn/v1/audio/speech',
        );
    });

    it('空 / 空白 / 非字符串 → 回退硅基流动缺省 baseUrl（不生成半截 URL）', () => {
        expect(speechEndpointUrl('')).toBe(`${SILICONFLOW_BASE_URL}/audio/speech`);
        expect(speechEndpointUrl('   ')).toBe(`${SILICONFLOW_BASE_URL}/audio/speech`);
        expect(speechEndpointUrl(undefined as unknown as string)).toBe(`${SILICONFLOW_BASE_URL}/audio/speech`);
    });
});

describe('cloudVoiceId（🔴 硅基流动要求 voice 带**模型名前缀**，传裸 id 会被拒）', () => {
    it('裸音色 id 补上模型前缀', () => {
        expect(cloudVoiceId('alex')).toBe(`${SILICONFLOW_MODEL}:alex`);
        expect(cloudVoiceId('diana')).toBe(`${SILICONFLOW_MODEL}:diana`);
    });

    it('已带前缀的值原样返回（不得出现双前缀）', () => {
        expect(cloudVoiceId(`${SILICONFLOW_MODEL}:alex`)).toBe(`${SILICONFLOW_MODEL}:alex`);
        expect(cloudVoiceId('fishaudio/fish-speech-1.5:anna')).toBe('fishaudio/fish-speech-1.5:anna');
    });

    it('空 / 纯空白 → 缺省音色', () => {
        expect(cloudVoiceId('')).toBe(CLOUD_VOICE_DEFAULT);
        expect(cloudVoiceId('  ')).toBe(CLOUD_VOICE_DEFAULT);
    });

    it('可指定别的模型（为将来看腻了换模型留口子）', () => {
        expect(cloudVoiceId('alex', 'fishaudio/fish-speech-1.5')).toBe('fishaudio/fish-speech-1.5:alex');
    });
});

describe('buildSpeechBody（云合成请求体）', () => {
    it('字段齐全且 voice 走全称、格式固定 mp3', () => {
        const body = buildSpeechBody({ text: '你好。', voice: 'alex', rate: 1.5 });
        expect(body).toEqual({
            model: SILICONFLOW_MODEL,
            input: '你好。',
            voice: `${SILICONFLOW_MODEL}:alex`,
            speed: 1.5,
            response_format: 'mp3',
        });
    });

    it('🔴 语速按既有口径夹取（云侧虽支持 0.25–4，但 UI 值域是 0.5–2，不把越界值透传出去）', () => {
        expect(buildSpeechBody({ text: 'a', voice: 'alex', rate: 99 })).toMatchObject({ speed: TTS_RATE_MAX });
        expect(buildSpeechBody({ text: 'a', voice: 'alex', rate: 0 })).toMatchObject({ speed: TTS_RATE_MIN });
        expect(buildSpeechBody({ text: 'a', voice: 'alex', rate: NaN })).toMatchObject({ speed: 1 });
    });

    it('🔴 空文本 / 纯空白 → null（不发请求，省额度）', () => {
        expect(buildSpeechBody({ text: '', voice: 'alex', rate: 1 })).toBeNull();
        expect(buildSpeechBody({ text: '   \n  ', voice: 'alex', rate: 1 })).toBeNull();
    });

    it('不得出现 gain / sample_rate 这类我们没在用的参数（免得日后误以为可调）', () => {
        const body = buildSpeechBody({ text: 'a', voice: 'alex', rate: 1 }) as Record<string, unknown>;
        expect('gain' in body).toBe(false);
        expect('sample_rate' in body).toBe(false);
    });
});

describe('cloudVoiceGroups（云音色按性别分两组）', () => {
    it('男声在前、女声在后；item 的 value 是全称、label 是中文标签', () => {
        const groups = cloudVoiceGroups(null);
        expect(groups.map((g) => g.label)).toEqual(['男声', '女声']);
        expect(groups.map((g) => g.key)).toEqual(['male', 'female']);
        const all = groups.flatMap((g) => g.items);
        expect(all).toHaveLength(SILICONFLOW_VOICES.length);
        expect(all[0]).toMatchObject({ value: cloudVoiceId('alex'), label: '沉稳男声', on: false });
    });

    it('当前音色亮起（on 只跟规范全称走）', () => {
        const cur = cloudVoiceId('bella');
        const groups = cloudVoiceGroups(cur);
        const on = groups.flatMap((g) => g.items).filter((i) => i.on);
        expect(on).toHaveLength(1);
        expect(on[0].value).toBe(cur);
    });

    it('🔴 传裸 id 也能点亮（记忆里存的可能是裸 id，不能因此丢掉选中态）', () => {
        const on = cloudVoiceGroups('claire').flatMap((g) => g.items).filter((i) => i.on);
        expect(on).toHaveLength(1);
        expect(on[0].value).toBe(cloudVoiceId('claire'));
    });

    it('非法 / 空当前值 → 一个都不亮（交渲染层回退缺省，不虚亮一项）', () => {
        expect(cloudVoiceGroups('不存在的音色').flatMap((g) => g.items).filter((i) => i.on)).toHaveLength(0);
        expect(cloudVoiceGroups(null).flatMap((g) => g.items).filter((i) => i.on)).toHaveLength(0);
    });
});

describe('normalizeCloudVoice（记忆值归一）', () => {
    it('合法全称 / 裸 id / 未知值 三分支', () => {
        expect(normalizeCloudVoice(cloudVoiceId('david'))).toBe(cloudVoiceId('david'));
        expect(normalizeCloudVoice('david')).toBe(cloudVoiceId('david'));
        expect(normalizeCloudVoice('nobody')).toBe(CLOUD_VOICE_DEFAULT);
    });

    it('null / undefined / 空串 → 缺省', () => {
        expect(normalizeCloudVoice(null)).toBe(CLOUD_VOICE_DEFAULT);
        expect(normalizeCloudVoice(undefined)).toBe(CLOUD_VOICE_DEFAULT);
        expect(normalizeCloudVoice('')).toBe(CLOUD_VOICE_DEFAULT);
    });
});

describe('classifySpeechError（云失败归一 —— 决定是「重试」还是「提示」）', () => {
    it('200 → ok（不弹任何提示）', () => {
        expect(classifySpeechError(200).kind).toBe('ok');
    });

    it('401 / 403 → auth（Key 无效，重试无意义）', () => {
        expect(classifySpeechError(401).kind).toBe('auth');
        expect(classifySpeechError(403).kind).toBe('auth');
        expect(classifySpeechError(401).message).toContain('Key');
    });

    it('429 → quota（限流 / 额度）', () => {
        expect(classifySpeechError(429).kind).toBe('quota');
    });

    it('🔴 400 里带「余额 / balance / 充值」也归 quota（各家把余额不足塞在 400 里）', () => {
        expect(classifySpeechError(400, '{"message":"余额不足，请充值"}').kind).toBe('quota');
        expect(classifySpeechError(400, 'insufficient balance').kind).toBe('quota');
        expect(classifySpeechError(400, 'invalid voice').kind).toBe('http');
    });

    it('status=0 → network（连接层就失败了，区别于服务端返回异常）', () => {
        expect(classifySpeechError(0).kind).toBe('network');
    });

    it('其余非 200 → http 且文案带上状态码', () => {
        const r = classifySpeechError(500);
        expect(r.kind).toBe('http');
        expect(r.message).toContain('500');
    });
});

describe('shouldRetry（🔴 按字符计费 ⇒ 不能无脑重试）', () => {
    it('auth / quota 一律不重试（重试白费工夫还烧额度）', () => {
        expect(shouldRetry(0, 'auth')).toBe(false);
        expect(shouldRetry(0, 'quota')).toBe(false);
    });

    it('network / http 在重试上限内可重试，超限即止', () => {
        expect(shouldRetry(0, 'network')).toBe(true);
        expect(shouldRetry(SPEECH_MAX_RETRY - 1, 'http')).toBe(true);
        expect(shouldRetry(SPEECH_MAX_RETRY, 'network')).toBe(false);
        expect(shouldRetry(9, 'http')).toBe(false);
    });

    it('ok 不需要重试', () => {
        expect(shouldRetry(0, 'ok')).toBe(false);
    });
});

describe('prefetchIndex（#344 预取下一句，消掉云合成的句间空档）', () => {
    it('中间句 → 预取下一句', () => {
        expect(prefetchIndex(0, 5, [])).toBe(1);
        expect(prefetchIndex(3, 5, [])).toBe(4);
    });

    it('🔴 末句 → -1（没有下一句，不得越界）', () => {
        expect(prefetchIndex(4, 5, [])).toBe(-1);
        expect(prefetchIndex(0, 1, [])).toBe(-1);
    });

    it('🔴 下一句已在合成中 → -1（重复请求 = 重复计费）', () => {
        expect(prefetchIndex(0, 5, [1])).toBe(-1);
        expect(prefetchIndex(2, 5, [3, 9])).toBe(-1);
    });

    it('非法入参（空队列 / NaN / 越界下标）→ -1（宁可不预取）', () => {
        expect(prefetchIndex(0, 0, [])).toBe(-1);
        expect(prefetchIndex(NaN, 5, [])).toBe(-1);
        expect(prefetchIndex(99, 5, [])).toBe(-1);
    });
});

describe('speechCacheKey（句级缓存：同句不重复计费）', () => {
    it('同文本+同音色+同语速 → 同 key', () => {
        expect(speechCacheKey('你好。', 'a:alex', 1)).toBe(speechCacheKey('你好。', 'a:alex', 1));
    });

    it('🔴 语速 / 音色变了就是另一条（换了就该重新合成，不能拿旧音频糊弄）', () => {
        expect(speechCacheKey('你好。', 'a:alex', 1)).not.toBe(speechCacheKey('你好。', 'a:alex', 1.5));
        expect(speechCacheKey('你好。', 'a:alex', 1)).not.toBe(speechCacheKey('你好。', 'a:anna', 1));
        expect(speechCacheKey('你好。', 'a:alex', 1)).not.toBe(speechCacheKey('你好！', 'a:alex', 1));
    });
});

describe('云音色记忆（localStorage；node 下不可用时静默兜底）', () => {
    it('读取不可用 → null（由调用方回退缺省）；写入不得抛', () => {
        expect(loadCloudVoice()).toBeNull();
        expect(() => saveCloudVoice(cloudVoiceId('alex'))).not.toThrow();
    });

    it('记忆键与系统语音的键**不同**（两者混用会让切音源时选中态错乱）', () => {
        expect(CLOUD_VOICE_KEY).not.toBe('rl-tts-voice');
    });
});
