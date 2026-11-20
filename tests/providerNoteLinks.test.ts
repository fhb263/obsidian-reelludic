// m16150（用户逐字）：「给AI集成配置的三个平台 deespeek/GLM/硅基流动凭据行加个描述，
// 开头要附上对应的API开放平台官网，超链接点击直达」的守卫。
//
// 为什么这组要单独钉住：
//   · 说明文案的真源是 `src/Settings.ts` 的 `AI_PROVIDER_NOTE`（纯数据），**渲染走 `renderHintNote`** ——
//     域名能被切成 `<a>` 全靠 `pure/sourceLink.splitHintLinks`。
//   · 一旦有人把渲染退回 `createDiv({ text })`，或把文案改成「官网首页」以外的东西，
//     页面上**不会报任何错**，只是链接变死字 —— 正是这条需求要防的形态。
//   · 「以官网开头」是用户的原话要求，必须逐字守住（不是「文案里含域名就行」）。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { splitHintLinks } from 'pure/sourceLink';

const ROOT = resolve(__dirname, '..');
const SETTINGS_SRC = readFileSync(resolve(ROOT, 'src/Settings.ts'), 'utf8');

/** 从源码里抠出 `AI_PROVIDER_NOTE` 那个字面量块 */
function noteBlock(): string {
    const m = SETTINGS_SRC.match(/const AI_PROVIDER_NOTE[\s\S]*?\n\};/);
    expect(m, 'AI_PROVIDER_NOTE 常量不见了').toBeTruthy();
    return (m as RegExpMatchArray)[0];
}

/** 取某一家那条文案的原文（去掉行尾逗号与引号） */
function noteText(key: 'zhipu' | 'deepseek' | 'siliconflow'): string {
    const line = noteBlock()
        .split(/\r?\n/)
        .find((l) => new RegExp(`^\\s{4}${key}:`).test(l));
    expect(line, `${key} 那条说明不见了`).toBeTruthy();
    const m = (line as string).match(/:\s*'([\s\S]*)',?\s*$/);
    expect(m, `${key} 的说明不是单引号字符串字面量`).toBeTruthy();
    return (m as RegExpMatchArray)[1];
}

/** 期望的 API 开放平台（Key 管理页，不是站点首页） */
const EXPECTED_ORIGIN: Record<'zhipu' | 'deepseek' | 'siliconflow', string> = {
    zhipu: 'open.bigmodel.cn/usercenter/apikeys',
    deepseek: 'platform.deepseek.com/api_keys',
    siliconflow: 'cloud.siliconflow.cn/account/ak',
};

describe('m16150 三家凭据行的说明 · 开头就是 API 开放平台官网', () => {
    for (const key of ['zhipu', 'deepseek', 'siliconflow'] as const) {
        it(`${key}：说明以官网地址开头`, () => {
            const text = noteText(key);
            expect(text.startsWith(EXPECTED_ORIGIN[key])).toBe(true);
        });

        it(`${key}：官网地址被切成可点链接，且是第一段`, () => {
            const parts = splitHintLinks(noteText(key));
            expect(parts.length).toBeGreaterThan(1);
            // 🔴 第一段必须是链接 —— 这就是「开头要附上官网」的机械判据
            expect(parts[0].url).toBe(`https://${EXPECTED_ORIGIN[key]}`);
            expect(parts[0].text).toBe(EXPECTED_ORIGIN[key]);
        });

        it(`${key}：链接化不吃字（拼回去逐字等于原文）`, () => {
            const text = noteText(key);
            expect(parts2text(splitHintLinks(text))).toBe(text);
        });
    }

    it('三家都在（⛔ 别只给其中一家加）', () => {
        const block = noteBlock();
        for (const key of ['zhipu', 'deepseek', 'siliconflow'] as const) {
            expect(block).toContain(`${key}: '`);
        }
    });

    it('说明走链接化渲染（⛔ 别退回纯文本 createDiv）', () => {
        // 反向守卫：`if (note) bodyEl.createDiv({ cls: 'rl-hint-note', text: note });` 是旧形态
        expect(SETTINGS_SRC).not.toMatch(/if \(note\) bodyEl\.createDiv\(\{ cls: 'rl-hint-note', text: note \}\);/);
        expect(SETTINGS_SRC).toContain('if (note) this.renderHintNote(bodyEl, note);');
    });

    it('三处调用都真的把说明传了进去', () => {
        for (const key of ['zhipu', 'deepseek', 'siliconflow'] as const) {
            const re = new RegExp(
                `renderTranslateKeyBlock\\(list, '${key}', [^)]*AI_PROVIDER_NOTE\\.${key}\\)`,
            );
            expect(SETTINGS_SRC, `${key} 那行没传 note`).toMatch(re);
        }
    });

    it('🔴 #487 那句仍在黑名单里（说明换了，但旧句不许回潮）', () => {
        // ⚠️ 锚**带引号的完整字面量实参形态**（与产物断言同款）：
        //    本文件上方的注释里引用了这句做反面例子，裸匹配「共用这一个 Key」会撞到注释 ⇒ 误红。
        expect(SETTINGS_SRC).not.toContain("'AI 翻译 / 总结 / 搜索与朗读云合成共用这一个 Key'");
        expect(SETTINGS_SRC).not.toContain("'仅用于朗读");
    });
});

/** 片段拼回原文（与 sourceLink.test.ts 同款不变量） */
function parts2text(parts: Array<{ text: string }>): string {
    return parts.map((p) => p.text).join('');
}
