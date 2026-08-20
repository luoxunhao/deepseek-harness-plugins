# dsh-codex-project — 插件开发文档

> 本文件是**本插件（`dsh-codex-project`）自身的**开发/上手文档：数据模型、host/client 两半、路由、fence 语义、构建与门禁、挂载与验证。开发前先读根目录 `AGENTS.md`（工作区硬约束）；本文件只讲这个插件怎么改、怎么验。

源自 **Claude Code /add-dir 的项目处理思想**：一个项目 = 主代码库 + 若干关联目录（可跨盘符）。本插件把这一模型搬进 dsh——工作区 + 共享子目录，会话在**不升级权限**（始终 `workspace-write`）的前提下读写整个共享集合。

---

## 0. 硬约束（本插件的边界）

- **零写入 dsh 源码**（官方仓库 <https://github.com/deepseek-ai/deepseek-harness> 的检出只读）。需要 dsh 没有的能力时，优先用公开/只读 API 或插件自有路由；确实做不到，先向用户说明取舍，不改 dsh。
- **client 纯度门**：client bundle 只能 value-import 平台模块白名单（见 §6）；与其他插件的运行时交互一律走 cordis 服务方法调用，`import type {}` 可共享类型但不产生运行时依赖。
- **browser bundle 无 `node:path`**：路径字符串运算必须放 `src/client/paths.ts`（`basename` / `relativePath` / `resolvePath` / `samePath`），不许 import node 内置。
- 本插件通过 `betterSidebar.registerTab` 接入侧边栏（仅当 better-sidebar 安装时注册）；不直接操作其内部运行时符号。

---

## 1. 插件定位与形态

- **标识**：`export const name = 'dsh-codex-project'`。
- **host inject**：`['webServer', 'sessions', 'workspaceRegistry', 'tools', 'approval']`。
- **client inject**：`['workspaces', 'betterSidebar', 'inputTriggers']`（后两者**可选**：`betterSidebar` 缺失则不注册 tab，`inputTriggers` 缺失则不注册 @ 引用源）。
- 函数形态 `apply(ctx)`，职责：
  - 挂 `/codex-project/api/*` 路由（loopback 守卫）；
  - `agent/pre-step` 折叠上下文提醒（text-idempotent）；
  - 注册 `add-dir` 模型工具（经核心 approval 确认）；
  - 路由 `sandbox.confine` 到多根 runner、注册多根 fs 提供者。

## 2. 数据模型（唯一持久化状态）

配置文件：`$DSH_CODEX_PROJECT_CONFIG`，未设则 `~/.dsh-codex-project/dirs.json`。形状：

```json
{ "workspaces": { "<workspaceId>": { "path": "<规范主根>", "dirs": ["<共享子目录>", "..."] } } }
```

- **主根（MainRoot）**：记录的 `path` = 该工作区自身（锚点）。
- **共享子目录（SharedSubdirectory）**：`dirs` 数组，可跨盘符、可裸目录（不必是注册工作区）。
- **失效根（StaleRoot）**：`dirs` 中已不存在的目录 → 可写集合**收窄**到现存根（不 fail loud、不改写配置），上下文提醒标注 `(⚠ directory missing)`；目录恢复后自动重新进入集合。
- 写路径（`dirs-store.ts`）：临时文件 + rename 原子写，promise 队列串行化防丢更新；**主动增删时校验目录存在**（fail loud），保存后消失则被动收窄。

## 3. 命中判定与 fence（三处隔离面共用）

- **锚定（单边）**：会话 cwd（`realpath` 规范路径）== 某条记录 `path` 即命中该条记录。`src/project-view.ts` 的 `projectFor` 是唯一事实来源；共享子目录里的会话不会因该目录出现在别人配置里而命中。
- **三处隔离面共用同一命中判定**：`lib/runner.js`（shell/subprocess 多根受限令牌）、`lib/fs.js`（进程内 fs 工具 fence）、上下文提醒。
- **可写根（roots）** = `[record.path, ...record.dirs]`（现存根）。
- **项目类路由的 fence（`src/dirs-api.ts` 的 `fenceFor`）**：命中 → 项目根；**未命中 → 退化为 `[cwd]`**（tab 无配置时的单根回退，树/预览恒有内容）。所有 `/read` `/write` `/file` `/list` 共用这一个 fence 定义，改动只改一处。

## 4. Host 路由（`/codex-project/api`，loopback 守卫）

| 路由 | 方法 | 说明 |
|---|---|---|
| `/ping` | GET | 挂载冒烟 |
| `/dirs` | GET/PUT | 某工作区共享子目录的读/替换（首次 PUT 自动锚定） |
| `/project` | GET | `?cwd=` 命中项目解析 → `{ path, dirs, missingDirs }` 或 `null` |
| `/list` | GET | 项目根目录层级（`?cwd=&path=`），fence 到 roots |
| `/read` | GET | 文本读取（`?cwd=&path=`），fence；**上限 `READ_CAP`=4MB**，超出返回 `truncated: true` |
| `/write` | POST | 保存文本（`{ cwd, path, content }`），fence，自动建父目录 |
| `/file` | GET | 原始字节（图片/PDF/二进制）；`&download=1` → `Content-Disposition: attachment`（RFC 5987 `filename*=UTF-8''…`） |
| `/open-directory` | POST | 系统文件管理器打开（插件自有，**不走** `workspaces.openPath`，避免被 better-sidebar 劫持） |

错误码：400 入参非法、403 路径出 roots、404 未知工作区/路由、405 方法错。JSON 路由逻辑在 `dirs-api.ts` 是纯函数（不依赖 server，可单测）；`index.ts` 只解析请求并调用，`/file` 的 raw 响应经 `ApiResponse.raw/contentType/headers` 返回。

## 5. Client 结构（`src/client/`）

| 文件 | 职责 |
|---|---|
| `index.tsx` | 入口：注入样式、注册 @ 引用源、注入工作区「…」菜单项、注册「项目文件夹」tab |
| `workspace-menu.ts` / `workspace-dialog.tsx` | 「…」菜单注入 + 「管理工作区」弹窗 |
| `project-tab.tsx` | **项目文件夹 tab**：Files 同级布局 + 自绘多根树（DirNode/FileRow/上下文菜单/@ 按钮） |
| `preview-pane.tsx` | 内联预览分发（按 viewer 类型 fetch + 渲染） |
| `text-editor.tsx` | CodeMirror 6 内联编辑器（预览/编辑切换、脏点、Ctrl/Cmd+S 保存） |
| `file-reference.ts` | @ 引用 chip 的注册源 + 注入（见 §7） |
| `viewer.ts` | 扩展名 → viewer 类型、`looksBinary` NUL 探测 |
| `paths.ts` | 浏览器端路径运算（无 node:path） |
| `api.ts` | `/codex-project/api` 的 fetch 面（`createSpacesApi`，含 `readFile/writeFile/fileUrl/downloadUrl`） |
| `context.ts` | 客户端服务/类型的**结构化再声明**（不 value-import 上游），漂移收敛于此 |
| `styles.ts` | 一次性注入的 DOM 样式（`data-dsh-codex-project-*` 属性限定，走 `--dsw-*` token） |

### 项目文件夹 tab：Files 同级预览

布局仿 better-sidebar Files tab：**顶部路径输入框 + 右侧可拖拽/可隐藏文件树 + 左侧选中文件的内联预览**。点击文件直接在左侧预览；内联预览支持编辑（代码/Markdown/HTML），不再跳 better-sidebar 编辑器（其 editor chunk 加载报 "client module system unavailable"）。

- **路径输入框**：回车 → `resolvePath(cwd, input)` 解析（相对/绝对、`..` 折叠）→ 内联预览。
- **预览分发（`preview-pane.tsx`）**：图片 → `<img>`（`/file`）；PDF → 原生 viewer（Blob URL）；二进制 → 下载按钮（`/download`）；Markdown/HTML/代码 → `readFile` 后交给 `text-editor.tsx`。首 8KB 含 NUL → 判定二进制。
- **内联编辑器（`text-editor.tsx`）**：Markdown/HTML 默认预览（Markdown 用共享的 `MarkdownText`；HTML 用沙箱 iframe，`sandbox="allow-scripts allow-popups allow-downloads allow-modals"`，无 same-origin），代码默认编辑。预览/编辑切换 + 脏点 + `保存` / Ctrl/Cmd+S → `/write`。超过 4MB 显示只读截断提示。
- **CodeMirror 视图生命周期**：按文件 `path` 创建一次并**常驻**（预览态用 `hidden` 隐藏，节点不卸载），避免切换模式丢失未保存草稿；脏判定用 `baseRef` 镜像盘上文本。**host 必须始终挂载**（而非仅编辑态渲染），否则 markdown/html 以预览态挂载时视图创建 effect（依赖 `[path, language]`）在 `host === null` 提前返回，切到编辑后不重跑 → 编辑器空白页。

### @ 引用 chip（`file-reference.ts`）

- 源：`FILE_REF_SOURCE = 'codex-project:file'`，隐藏 `@` 源（空候选，MenuView 隐藏 ready+空组）。
- 注入：会话 actx `emit('slash/input-insert-reference', { reference: { source, ref: 绝对路径, label: 文件名, clipboardText: 绝对路径 }, span: { start, end, draftRev } })`。
- 序列化：`codec.serialize = ref => Promise.resolve(\`\`${ref}\`\`)` → 模型侧得到 inline-code 绝对路径。

## 6. 构建与门禁

```bash
pnpm --dir dsh-codex-project typecheck   # tsc --noEmit
pnpm --dir dsh-codex-project test        # vitest run（12 个文件 / 112 测试）
pnpm --dir dsh-codex-project build       # tsc(types) + tsdown（host ESM + client CJS）
```

- **产物**：`lib/index.js`（host）、`lib/runner.js`、`lib/fs.js`、`lib/client.js`（浏览器 bundle，CJS closure 工厂注册 id `dsh-codex-project`）。
- **client 白名单（`tsdown.config.ts` 的 `CLIENT_EXTERNALS`）**：`react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`cordis`、`@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-primitives`。纯度门插件在 resolve 阶段拒绝任何其他 `@deepseek-ai/*` value import 与 node 内置。
- **CodeMirror 内联**：`@codemirror/*` 与 `@lezer/*` 是普通依赖（非 `@deepseek-ai`），经 `noExternal` 内联进 client bundle——这是本插件刻意为之。若希望首屏更小，后续可仿 better-sidebar 拆一个 lazy editor chunk。
- 白名单改动（加新 `@deepseek-ai` 依赖前）务必确认它在 web shell 的 `PLATFORM_MODULES`（`packages/client/web/src/platform.ts`）共享表里，否则运行时解析失败。

## 7. 挂载与验证

1. **官方通道**：`dsh plugin --profile <name> add <pkg>`（协调 `dsh.profile.bundles` 并应用 `cordis.patch.yml`）。
2. **本地开发**：dsh 源码检出根目录 `pnpm dsh web --patch <本仓库绝对路径>/cordis.patch.yml`。bundle patch 会把 `lib/fs.js` 插为 fs 提供者、禁用核心 fs-sandbox 行。
3. **热加载**：client 改动浏览器硬刷新即可；**host 改动（路由、seam、fs、runner）需重启 `dsh web`**。
4. `pnpm plugin add` 报 `ERR_PNPM_IGNORED_BUILDS` 时，把 `<profile>/pnpm-workspace.yaml` 的 `allowBuilds` 占位符改成布尔值后重跑（见根 AGENTS.md）。

## 8. 测试

`tests/`（vitest，browser 组件用 jsdom）：

- `dirs-api.spec.ts` — CRUD + 锚定 + 失效根 + 项目解析 + 目录列表（排序/fence 403/跨盘根）+ 读/写/文件字节与下载 disposition。
- `project-tab.spec.tsx` — 无配置回退单根、根行（主/共享/缺失）、懒加载、**点击即内联预览**、右键菜单。
- `file-reference.spec.ts` — @ 引用源注册 / 注入 / 序列化。
- `client-apply.spec.tsx` / `client-components.spec.tsx` — 插件形态、菜单注入、管理弹窗。
- `fs.spec.ts` / `seam.spec.ts` / `runner.spec.ts` / `context-injection.spec.ts` / `dirs-migration.spec.ts` — 多根 fence 收窄/隔离/自愈、runner 令牌、上下文提醒。

新增 API 面（如 `SpacesApi` 加方法）时，记得同步更新各测试里的 fake（`readFile/writeFile/fileUrl/downloadUrl` 等），否则 typecheck 会因缺方法失败。

## 9. 常见坑（改代码前先看）

- **fence 只改一处**：新增项目文件操作路由时，复用 `dirs-api.ts` 的 `fenceFor`；不要另写一份 roots 推导（否则三处漂移）。
- **`updateListener` 是 `CodeMirrorView.updateListener.of(...)`**，不是 `EditorState.updateListener`（那不存在）。

- **CodeMirror host 必须始终挂载**：`<div className="dsh-cxp-preview-cm" ref={hostRef} hidden={!inEdit}>` 的节点不能条件卸载——视图创建 effect 依赖 `[path, language]`（不含 `mode`），若预览态不渲染 host，effect 在 `host === null` 提前返回，切到编辑后不重跑 → 空白页。用 `hidden` 隐藏而非卸载。
- **CodeMirror 视图别按 base/content 重建**：按 `path` 常驻；切文件用 `key={path}` 让 `PreviewPane` 整体重挂载（`project-tab.tsx` 已这么做）。
- **`import.meta` / node 内置**：只存在于 host 侧 `src/*.ts`；client 一律用 `paths.ts`。
- **路径比较大小写**：Windows 上 `samePath`/`relativePath`/`isPathUnder`（`containment.ts`）都按平台大小写约定处理；跨盘符返回绝对路径回退。
