// pdf.js worker 模块类型声明（esbuild worker 内联 plugin 注入 Blob URL；tsc 无此子路径类型）
declare module 'pdfjs-dist/build/pdf.worker.min.mjs' {
    const url: string;
    export default url;
}
