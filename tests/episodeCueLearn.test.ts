/**
 * Learn-mode subtitle panel: hover-lookup guard tests (user m02554).
 *
 * User's words: restructure how the subtitle panel presents itself in learn mode,
 * e.g. every word shows a line when the mouse passes over it, and hovering shows the
 * definition immediately. Three requirements are pinned here:
 *   1. EVERY word - not only the currently playing row (previously onCueTick split
 *      only cueActiveIdx, all other rows were plain text, so hovering did nothing).
 *   2. A line on every word - the underline must come from CSS :hover directly, NOT
 *      only from a JS-added .is-hover class (a word with no dictionary hit would then
 *      show no line at all, which looks broken).
 *   3. Immediate definition - do NOT unconditionally print "querying..." and wait for a
 *      promise; the underlying dict lookup is synchronous already.
 *
 * strip discipline: strip HTML comments, block comments and line comments separately.
 * Never run a block-comment regex over a whole Svelte file - `accept="image/*"` inside
 * the template would swallow tens of thousands of characters (this repo has been bitten).
 * Never put a bare block-comment terminator inside a comment in this file either.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const read = (rel: string): string => readFileSync(resolve(ROOT, rel), 'utf8');
const stripTs = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const stripCss = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '');

const VIEW = stripTs(read('src/views/EpisodePageView.ts'));
const CSS = stripCss(read('styles.css'));

describe('learn-mode hover lookup: every row splits (m02554 item 1)', () => {
    it('has a dedicated split-one-row function that indexes cue by row number', () => {
        expect(VIEW).toContain('private splitCueRow(idx: number): boolean');
        expect(VIEW).toContain('const cue = this.cueCues[idx];');
    });

    it('splits the row on mouseenter so the first mouseover already hits a word', () => {
        expect(VIEW).toMatch(/addEventListener\('mouseenter'[\s\S]{0,200}this\.splitCueRow\(i\)/);
    });

    it('records split rows so each line change does not rescan every row', () => {
        expect(VIEW).toContain('private cueSplitRows = new Set<number>();');
        expect(VIEW).toMatch(/this\.cueSplitRows\.add\(idx\)/);
    });

    it('clears the split-row record when row DOM is rebuilt', () => {
        const hits = VIEW.match(/this\.cueSplitRows\.clear\(\);/g) ?? [];
        // one after each cueRows reset (buildCuePanel and renderCueRows)
        expect(hits.length).toBeGreaterThanOrEqual(2);
    });

    it('still lazy-splits: the render loop only splits from a mouseenter listener', () => {
        const start = VIEW.indexOf('private renderCueRows(');
        const end = VIEW.indexOf('private ', start + 10);
        const body = VIEW.slice(start, end > start ? end : start + 8000);
        // It MUST appear (hovering any row has to work) but only as the listener body,
        // never as a direct call while building rows up front.
        const at = body.indexOf('splitCueRow(');
        if (at >= 0) {
            const before = body.slice(0, at);
            const listenerAt = before.lastIndexOf("addEventListener('mouseenter'");
            expect(listenerAt).toBeGreaterThanOrEqual(0);
            expect(at - listenerAt).toBeLessThan(200);
        }
        // No split call before the first row is even created.
        const firstRow = body.indexOf("cls: 'rl-epp-cuerow'");
        expect(firstRow).toBeGreaterThanOrEqual(0);
        expect(body.slice(0, firstRow)).not.toContain('splitCueRow(');
    });
});

describe('learn-mode hover lookup: the line comes from CSS (m02554 item 2)', () => {
    it('word span gets a hover underline without any JS class', () => {
        expect(CSS).toMatch(/\.rl-epp-cueword:hover\s*\{[^}]*text-decoration:\s*underline/);
    });

    it('keeps the is-hover tier for when the tooltip is attached', () => {
        expect(CSS).toMatch(/\.rl-epp-cueword\.is-hover\s*\{[^}]*text-decoration:\s*underline/);
    });

    it('both tiers share accent colour and offset so there is only one visual', () => {
        const hover = CSS.match(/\.rl-epp-cueword:hover\s*\{([^}]*)\}/)?.[1] ?? '';
        const isHover = CSS.match(/\.rl-epp-cueword\.is-hover\s*\{([^}]*)\}/)?.[1] ?? '';
        expect(hover).toContain('var(--interactive-accent)');
        expect(isHover).toContain('var(--interactive-accent)');
        expect(hover).toContain('text-underline-offset: 3px');
        expect(isHover).toContain('text-underline-offset: 3px');
    });
});

describe('learn-mode hover lookup: immediate definition (m02554 item 3)', () => {
    it('caches lookup results in the view', () => {
        expect(VIEW).toContain('private cueWordDefs = new Map<string,');
        expect(VIEW).toMatch(/this\.cueWordDefs\.set\(key,/);
        expect(VIEW).toMatch(/const cached = this\.cueWordDefs\.get\(key\)/);
    });

    it('renders straight from cache on a hit', () => {
        expect(VIEW).toMatch(/if \(cached !== undefined\) \{\s*this\.fillWordTipDef\(/);
    });

    it('shows the pending placeholder only on the branch that really waits', () => {
        const start = VIEW.indexOf('const lookup = this.pageCtx?.lookupWord;');
        const seg = VIEW.slice(start, start + 1200);
        expect(seg).toMatch(/\} else \{[\s\S]*?\u67e5\u8be2\u4e2d/);
        const cachedBranch = seg.slice(0, seg.indexOf('} else {'));
        expect(cachedBranch).not.toContain('\u67e5\u8be2\u4e2d');
    });

    it('caches misses too, so a repeated miss is not re-queried', () => {
        expect(VIEW).toMatch(/this\.cueWordDefs\.set\(key, r \?\? null\)/);
    });

    it('puts definition and phonetic in a fixed host so async fill cannot jump after the say button', () => {
        expect(VIEW).toContain("tip.createDiv({ cls: 'rl-epp-wordtip-body' })");
        expect(CSS).toMatch(/\.rl-epp-wordtip-body\s*\{[^}]*flex-direction:\s*column/);
    });

    it('repositions the tooltip after filling content', () => {
        expect(VIEW).toMatch(/private fillWordTipDef\([\s\S]{0,900}this\.positionWordTip\(tip, wordEl\)/);
    });
});

describe('learn-mode hover lookup: teardown', () => {
    it('collapses every split row when leaving learn mode', () => {
        expect(VIEW).toContain('private collapseAllCueWords(): void');
        expect(VIEW).toMatch(/if \(!this\.cueLearnOn\) \{[\s\S]{0,200}this\.collapseAllCueWords\(\)/);
    });

    it('hideWordTip searches the subtitle list for .is-hover, not the toolbar', () => {
        expect(VIEW).toMatch(/this\.cueListEl\s*\?\.querySelectorAll\('\.rl-epp-cueword\.is-hover'\)/);
    });
});
