import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
    resolve: {
        alias: {
            // obsidian 模块 → 测试替身
            obsidian: resolve(__dirname, 'tests/mocks/obsidian.ts'),
            // src 下 baseUrl 裸导入（tsconfig baseUrl=./src）：按顶层目录注册
            pure: resolve(__dirname, 'src/pure'),
            data: resolve(__dirname, 'src/data'),
            services: resolve(__dirname, 'src/services'),
            // 🔴 补 `modals`：`tests/syncHint.test.ts` 要测 `modals/syncHintView` 的渲染
            //    （加粗是不是真 `<strong>`、冒号是不是全角 —— 只有真 DOM 能验）。
            //    ⛔ 别改成在测试里写 `../src/modals/...` 绕开 —— 那会让测试与源码的导入风格分叉，
            //      以后 `modals` 下的模块越来越难被单测摸到。
            modals: resolve(__dirname, 'src/modals'),
            // 🔴 补 `ui`：2026-11-12（①-9 / ③-5）新建了全局 UI 组件基座 `src/ui/components.ts`，
            //    源码里的裸导入是 `ui/components`（tsconfig baseUrl=./src 认得，vitest 不认）。
            //    ⛔ 别用相对路径绕开 —— tsc 与 vitest 的解析规则分叉过一次（见 Project-Rule 教训），
            //      分叉的代价是「tsc 绿、vitest 红」这种半天找不到原因的假故障。
            ui: resolve(__dirname, 'src/ui'),
        },
    },
    test: {
        environment: 'node',
        include: ['tests/**/*.test.ts'],
    },
})
