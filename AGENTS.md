# AGENTS.md — dsh 插件开发工作区

本仓库专为 DeepSeek Harness (dsh) 插件开发而设：每个插件是一个独立包，位于 dsh 源码树（<https://github.com/deepseek-ai/deepseek-harness>）之外，永远作为独立包被 profile 引用，不反向侵入 dsh。

## 本仓库的插件

| 插件 | 形态 | 一句话 |
|---|---|---|
| [`dsh-codex-project/`](dsh-codex-project/README.md) | web 插件（host + client） | 工作区共享子目录 + 项目文件夹 tab（预览/引用）+ /read、/write、/file 路由 + `add-dir` 工具 |
| [`dsh-presets-liangshen/`](dsh-presets-liangshen/README.md) | Agent 模式（preset）插件 | 发行「梁神模式」agent preset：两阶段锚定 + PTC Mode 切换 |
| [`dsh-skill-manager/`](dsh-skill-manager/README.md) | web 插件（host + client） | 「设置 → 技能」面板：浏览技能目录、查看正文、切换调用策略 |

## 硬约束

- **零写入 dsh 源码**：dsh 官方仓库（<https://github.com/deepseek-ai/deepseek-harness>）的检出只读——不得修改其包、不得提交到它的分支。
- **插件独立成包**：`<plugin>/` 自带 package.json（依赖 dsh 包用 `workspace:^`，经 pnpm workspace 链接到 dsh 源码树）、tsconfig、vitest、自己的检查命令（`pnpm --dir <plugin> test` / `typecheck`）。
- **挂载只走 profile 机制**：官方通道 `dsh plugin --profile <name> add <pkg>`；本地开发用 dsh 源码检出根目录下的 `pnpm dsh web --patch <绝对路径>/cordis.patch.yml`。插件路径必须是绝对路径——patch 文件只贡献配置，不改 loader 的 profile 目录。
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
| 类 | `export default class MyService extends Service { static inject = [...]; constructor(ctx) { super(ctx, 'myService') } }` | 要向其他插件提供服务时（见 `docs/user/develop/framework/service.md`） |

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

## Agent 模式（preset）插件

梁神模式（`dsh-presets-liangshen/`）是新形态的完整范例：不注册工具/路由/UI，而是**发行一个 agent preset**——一个目录（`presets/<id>/`，含 `agent.cordis.yml` + 配套 `.mjs` 模块），host 启动时同步进 `~/.dsh/.agent-presets`，新会话即可在预设选择器中选用。`inject = ['systemPrompt']`，只挂一个 announcement section；工具与提示词组装全在 preset 内部。

**`agent.cordis.yml` 是 AGENT-PLANE 组合**，区分两条线：

- **服务行必须进 `cordis:group` + `isolate` realm**（entry-local 私有实例）：不隔离就发布进 root realm、变成进程全局——同名 preset 会撞车，`dsh-agent-presets` 挂载即拒。典型：`persistent-shell`（`isolate.terminals`）、`planning`（`isolate.planMode`）、`compaction`（`isolate.compaction` + `toolResultPruner`）、`delegation`（`isolate.workflowEngine`）。
- **宿主平面的注册表/服务留在 realm 之外**：`tools`、`fs`、skill registry、`subagents` registry、`workflow`、`web`、`tokenMeter`（全局会话折叠单位）、`tool-result-pruner` 的宿主 policy——preset 只选「能不能调」，不重造单例。

**两阶段引导（`tool-bootstrap.mjs`，`inject = ['systemPrompt', 'tools']`）**——全部 `prepend: true` 挂在瀑布最外层，`await next()` 看到完整下游结果后再过滤：

- `system-prompt/assemble`：阶段一裁剪为「一个平台 shell + `commonTools`」、清空 `contexts`、只留 persona section（`deployment:persona` / 旧名 `persona`）；晋升后还原全部 section 并给 persona 追加 `Your working directory is <cwd>.`（从 session header 读，不靠 `{{cwd}}` 插值，换工作区不失效）。
- `agent/pre-step`：阶段一只放行 `source.kind === 'user'` 的显式用户消息；晋升后按 `deferredSources` + `deferredGraceSteps` 延迟注入；`instructionHint` 把晋升边界上的 AGENTS.md 全文注入换成一次性非祈使 hint（命名参考文件、按需阅读）——全文注入会翻掉锚定轨迹（上游 #49）。
- `agent/request`：阶段一用 `bootstrapMaxTokens`（社区实测 1024 处于 "We need" 高命中窗）封顶输出预算；晋升后**必须剥离**该 cap——否则 `requestProposal` 会把上一个 header 的 maxTokens 焊进之后每个请求。
- `session/event`：晋升后调 `agent.ctx.tools.presentAs('code')` 把 wire 切成 **PTC Mode（单一 `run_code` 工具 + 生成 SDK）**，在 `step/end` 边界切（绝不在 step 中途切，否则打断当步已计划的 native 调用）；`compaction/end` 释放 presentation 并回退到受控阶段。

**晋升判定与状态恢复**：状态以 session 为键（WeakMap），只扫描新增事件（`next` 游标），所以 resume/reload 从持久事件日志重建同相。判定：`tool/call` 后等首块 minimal-like reasoning（含 `we` 且无 `let me`）或 `maxBootstrapSteps` 兜底；`promoteAfterFirstResponse` 让无工具首轮响应后自动晋升。composition drift（缺 bootstrap 工具）降级为全目录 + 一次性告警，绝不锁死会话。

**Windows 平台门**：PTY 后端仅 linux/darwin，win32 用 `disabled: !!js process.platform === 'win32'` 关掉 persistent-shell 组、开 `custom-bash.mjs`（同名 `bash`、Minimal 兼容 schema、走跨平台子进程通道）；两平台恰好一个 `bash`。platform-guard 测试静态断言该极性。

**同步（`src/sync.ts`）**：按字节判同的幂等复制，prune 目标多余文件、`retire` 名单清理退役 preset、只动自己拥有的目录；**禁用 `fs.cpSync`**——Node 22 上含 CJK 字符的路径会以 0xC0000409 致命崩溃（nodejs/node#54476），手写逐项复制并保留 mtime。`agent.cordis.yml` 同步后过 `src/schema.ts` 结构性校验，失败进 `failed` 结果而非静默。

**可移植性**：测试里对路径的断言先做分隔符归一化（`posix()`），`node:path` 跟随运行平台，POSIX 直写断言在 Windows 上必挂。

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
2. **本地开发**：dsh 源码检出根目录运行 `pnpm dsh web --patch <plugin>/cordis.patch.yml`（绝对路径），打开 `http://127.0.0.1:3080` 验证。
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

- **`dsh-codex-project/`** —— web 插件标杆：host half（`src/index.ts`：/read、/write、/file 路由、工具）+ client half（`src/client/`：React UI + 项目文件夹 tab）+ `cordis.patch.yml` + 完整 vitest 套件。
- **`dsh-presets-liangshen/`** —— Agent 模式（preset）插件标杆：两阶段引导 `tool-bootstrap.mjs` + `agent.cordis.yml` AGENT-PLANE 组合 + `src/sync.ts` 幂等同步 + `src/schema.ts` 校验 + 平台门测试。开发要点见上文「Agent 模式（preset）插件」。
- **`dsh-skill-manager/`** —— 设置面板类 web 插件标杆：host 路由 + client「设置 → 技能」分区（`dsh-client-ui-settings` slot）+ frontmatter 最小保真写（EOL 无关）+ 注册表权威/磁盘兜底 + Windows 原子写（EPERM 重试）。不变量见 `dsh-skill-manager/AGENTS.md`，领域词汇见 `dsh-skill-manager/CONTEXT.md`。
- 官方教程（dsh 仓库 `docs/user/develop/`）：[第一个插件](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/index.zh.md)（本文件核心内容的来源）、[工具 DSL](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/tool.md)、[插件配置](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/config.md)、[框架 service](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/framework/service.md)。