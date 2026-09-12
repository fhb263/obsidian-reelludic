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
        },
    },
    test: {
        environment: 'node',
        include: ['tests/**/*.test.ts'],
    },
})
