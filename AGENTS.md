# AGENTS.md — dsh 插件开发工作区

本仓库专为 DeepSeek Harness (dsh) 插件开发而设：每个插件是一个独立包，位于 dsh 源码树（`E:\project\deepseek-harness`）之外，永远作为独立包被 profile 引用，不反向侵入 dsh。

## 硬约束

- **零写入 dsh 源码**：`E:\project\deepseek-harness` 只读——不得修改其包、不得提交到它的分支。
- **插件独立成包**：`<plugin>/` 自带 package.json（依赖 dsh 包用 `workspace:^`，经 pnpm workspace 链接到 dsh 源码树）、tsconfig、vitest、自己的检查命令（`pnpm --dir <plugin> test` / `typecheck`）。
- **挂载只走 profile 机制**：官方通道 `dsh plugin --profile <name> add <pkg>`；本地开发用 dsh 源码根目录下的 `pnpm dsh web --patch <绝对路径>/cordis.patch.yml`。插件路径必须是绝对路径——patch 文件只贡献配置，不改 loader 的 profile 目录。
- 需要 dsh 没有的能力时，优先用 dsh 现成的公开/只读 API 或插件自有路由；确实做不到，先向用户说明取舍，而不是改 dsh。

## 插件是什么

一个插件就是一个导出 `apply(ctx)` 的 TypeScript 模块。框架加载时调用 `apply`，通过 `ctx`（`Context`，来自 `@deepseek-ai/cordis`）注册能力：

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'my-plugin'          // 插件标识（cordis.yml 挂载行里也用这个名字）
export const inject = ['tools']          // 声明依赖的服务；框架保证就绪后才加载本插件
export function apply(ctx: Context) {
  // 在这里注册能力
}
```

三种形态，多数情况函数形式足够：

| 形态 | 写法 | 何时用 |
|---|---|---|
| 函数 | `export function apply(ctx)`（可加 `export const name` / `export const inject`） | 默认 |
| 对象 | `export default { name, inject, apply(ctx) }` | 打包配置时 |
| 类 | `export default class MyService extends Service { static inject = [...]; constructor(ctx) { super(ctx, 'myService') } }` | 要向其他插件提供服务时（见 `framework/service.md`） |

## 生命周期：自动清理

通过 `ctx` 注册的一切——事件监听、工具、定时器、disposer——在插件卸载时自动清理，不需要手动 removeListener / clearInterval。

手动管理的资源（网络连接、pty、WebSocket server 等）用 `ctx.effect()` 声明清理函数：

```ts
export function apply(ctx: Context) {
  ctx.effect(() => {
    const timer = setInterval(() => console.log('heartbeat'), 5000)
    return () => clearInterval(timer)   // 插件卸载时执行
  })
}
```

## 插件能力：host half 与 client half

web 插件通常拆成两半（`dsh-codex-project/` 是完整范例）：

- **host half**（Node 侧）：`src/index.ts`——注册 webServer 路由、WebSocket、工具等，`inject = ['webServer', 'sessions', ...]`。
- **client half**（浏览器侧）：`src/client/`——React UI。用 `ctx.provide('myService', service)` 发布服务，消费插件 `inject = ['myService']` 后 `ctx.myService` 直接可用；类型合并用 `declare module 'cordis' { interface Context { myService: MyService } }`，消费方 `import type {} from '<plugin>'` 即触发。
- **构建纯度门**：client bundle 禁止 value-import 其他插件的运行时符号；`import type {}` 会被擦除、不触发门禁——类型可以自由共享，运行时交互必须走服务方法调用。

## 最小骨架

`src/index.ts` 用 `defineTool` 注册模型工具：

```ts
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'my-tool'
export const inject = ['tools']

export function apply(ctx: Context) {
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'my_tool',
    description: '...',
    parameters: { /* JSON Schema */ },
    async execute(args, exec) { return { ok: true } },
  })))
}
```

## 挂载与验证

1. **官方通道（发布）**：`dsh plugin --profile <name> add <pkg>`——CLI 协调 `dsh.profile.bundles` 并应用包内 `dsh.bundle.patch`（即 `cordis.patch.yml`）。
2. **本地开发**：dsh 源码根目录运行 `pnpm dsh web --patch <plugin>/cordis.patch.yml`（绝对路径），打开 `http://127.0.0.1:3080` 验证。
3. client half 改动热加载（浏览器硬刷新即可）；host half 改动需重启 `dsh web`。

### `plugin add` 报 ERR_PNPM_IGNORED_BUILDS

pnpm ≥10 默认不执行依赖的构建脚本。profile 初始化会生成 `pnpm-workspace.yaml`，其中 `allowBuilds` 用占位符 `set this to true or false` 列出已知带构建脚本的包；占位符未填时 `dsh plugin --profile <name> add <pkg>` 以 `[ERR_PNPM_IGNORED_BUILDS]` 失败——依赖此时已装好，只是 bundles/patch 注册被中断。

修复：把 `<profile>/pnpm-workspace.yaml` 的 `allowBuilds` 占位符改成布尔值——`true` 信任并执行脚本、`false` 明确跳过——然后重跑同一条 `add` 命令；pnpm 补跑已批准的构建脚本，注册完成。验证标准：`package.json` 的 `dsh.profile.bundles` 出现插件名，重启 `dsh web` 生效。

已知包（Windows 实测）：

| 包 | 构建脚本 | 建议 |
|---|---|---|
| `node-pty` / `protobufjs` | — | dsh 模板已预置 `true` |
| `cpu-features` / `ssh2` | node-gyp 原生编译 | 有 VS Build Tools + Python 就设 `true`（ssh2 顺带编译可选加密绑定 `sshcrypto.node`） |
| `cloudflared` | postinstall 从 GitHub releases 下载 ~55MB 二进制，无超时无重试 | 弱网会永久挂起（0 字节文件）——设 `false` 手动补二进制；运行时缺二进制会按需下载 |

## 参考实现

- **`dsh-codex-project/`** —— 本仓库跟踪的典型插件标杆：host half（`src/index.ts`：/read、/write、/file 路由、工具）+ client half（`src/client/`：React UI + 项目文件夹 tab）+ `cordis.patch.yml` + 完整 vitest 套件。
- 官方教程：`E:\project\deepseek-harness\docs\user\develop\basic\index.zh.md`（本文件核心内容的来源）、`tool.md`（工具 DSL）、`config.md`（插件配置）、`framework/service.md`（服务与依赖）。
