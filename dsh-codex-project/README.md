# dsh-codex-project

**dsh 工作区共享子目录插件** —— 源自 Codex 的项目处理思想：一个工作区可以挂载任意数量的**共享子目录**（可跨盘符），该工作区的 dsh 会话可以像对待自己的工作区一样读写这些目录——全程保持 `workspace-write` 权限，**永远不需要 `danger-full-access`**。

配置数据文件自动从旧 `spaces.json` 格式迁移，见[配置文件](#配置文件)。

---

## 设计思想

Codex 处理项目时，一个"项目"往往横跨多个目录：主代码库、共享库、文档、数据目录。传统做法要么给模型 full access（危险），要么逐个授权（繁琐）。

本插件的模型是 **Codex 式的项目共享**：

```
一个共享配置（记录）= 一个主根（该工作区自身的 path）+ 任意数量的共享子目录（跨盘符）
命中该配置的会话 → 可读写该配置的全部可写根（主根 ∪ 现存共享子目录）
```

- **单配置模型**：会话的可写集合 = 其 cwd 命中的那一条配置的可写根（无并集、无叠加），行为可预期；
- **单边命中**：会话 cwd（规范路径）== 某条记录的 `path` 即命中该条记录（锚定）；共享子目录里的会话不会仅因该目录出现在别人配置里而命中；
- **不强制注册**：共享子目录可以是裸目录，不必是 dsh 注册的工作区；
- **不升级权限**：仍在 `workspace-write` 权限级内，只是把可写集合从单根扩展为多根（Windows ACL 受限令牌 + 空间级 SID）。

## 功能特性（已实现）

| 能力 | 说明 |
|---|---|
| 共享子目录配置 | 每个工作区可配置任意数量共享子目录（跨盘符、可裸目录） |
| 「管理工作区」弹窗 | 原生工作区「…」菜单注入入口：添加/移除共享子目录 |
| 「项目文件夹」tab | better-sidebar 侧边栏注册的项目多根目录树：主根 + 共享子目录（跨盘符），按层懒加载；仿 Files tab 布局（顶部路径输入框 + 右侧可拖拽文件树 + 左侧内联预览与编辑：图片 / PDF / Markdown / HTML / 代码编辑与 Ctrl+S 保存 / 二进制下载），右键目录用文件管理器打开 |
| 「打开本地目录」 | 原生「…」菜单注入入口：用系统文件管理器打开该工作区文件夹（插件自有路由 spawn explorer.exe——不走 workspaces.openPath，避免被 better-sidebar 等插件劫持到侧边栏编辑器） |
| 多根沙箱 runner | 命中配置的会话，shell/subprocess 自动走多根受限令牌（`lib/runner.js`） |
| 多根 fs fence | 进程内 fs 工具（read/write/edit）同样按配置可写根放行（`lib/fs.js`） |
| 会话上下文提醒 | 第一条 user 消息后折叠 `<system-reminder>` 目录清单（英文、零权限声明，模型自己试错） |
| 配置 CRUD + 持久化 | `/codex-project/api` JSON 路由，`~/.dsh-codex-project/dirs.json` |
| 旧格式懒迁移 | 首次加载时把旧 `spaces.json`（`roots[]`）转成 `{ path, dirs }`，原文件保留为备份 |

## 架构总览

```
┌─────────────────────────── dsh web ───────────────────────────┐
│  侧边栏工作区「…」菜单 ──注入「打开本地目录」+「管理工作区」──▶ 本地动作/弹窗   │  (client half)
│        │                                                      │
│        ▼                                                      │
│   /codex-project/api  (CRUD + 项目目录树，loopback 守卫)       │  (host half)
│        │                                                      │
│   ┌────┴────────────────────────────────────────────────┐     │
│   │ 命中判定：会话 cwd == 某条记录的 path（锚定）           │     │
│   └────┬───────────────────────────────┬────────────────┘     │
│        ▼                               ▼                       │
│   sandbox.confine 路由             ctx.fs 提供者               │
│   (lib/runner.js 多根受限令牌)      (lib/fs.js 多根 fence)     │
│        ▼                                                       │
│   agent/pre-step 折叠上下文提醒（紧跟第一条 user 消息）          │
└───────────────────────────────────────────────────────────────┘
```

三处隔离面（runner / fs fence / 上下文提醒）共用同一命中判定（`matchingWorkspace`，单一来源），配置外、单根、无 cwd 的会话零影响（纯透传）。

## 安全模型

- **权限不升级**：多根 runner 仍是 `workspace-write` 受限令牌（拒绝列表 + 空间级 SID 写授权），只是 Write ACE 覆盖配置的可写根；
- **空间级 SID**：每条配置一个专属 SID（`config 目录 + workspace id` 摘要）——核心单根会话的 SID 无法沿着共享目录的 ACE 进入其他根，空间会话的令牌也无法使用别的根的 ACE；
- **失败契约**：runner 任何失败输出 `codex-project-run: <detail>` 并以 127 退出，绝不以非受限方式 spawn 子进程；
- **失效根收窄（narrowing）**：配置里某个共享子目录事后被删除（被动失效）时，可写集合收窄到**现存根**——死根本身物理上已不可写，其存在性失败不阻塞其余根，也不影响任何无关会话；上下文提醒给死根加 `(⚠ directory missing)` 标注，host 日志对每个空间首次 warn 一次、之后 debug；root 目录恢复后无需重启或改配置即可重新进入可写集合（无状态重校验）；
- **模型不被告知权限**：上下文提醒只列目录清单，不声明可读写——模型通过工具试错发现边界，`[sandbox: …]` 拒绝标记不变（缺失标注是目录事实，不是权限声明）。

### 已知边界（设计取舍）

- **重叠根歧义**：同一目录同时是两条记录的 `path` 时，cwd 落在该目录的会话匹配**配置文件中靠前的那条**（可写集合随配置顺序漂移）。建议共享子目录互不重叠；
- **standing ACE 常驻**：runner 在每个根上物化的空间 SID Write ACE 是常驻的（跨会话复用缓存，dispose 只回收私有 temp）。删除配置不会回收已打上的 ACE（孤立 ACE 无令牌携带，无害但会累积）；
- **无只读共享**：所有根都授予读写——想"只读共享"（如只允许读 dsh 源码树）需要后续特性；
- **提醒不重注入**：每会话一次性；恢复的会话若已有相同提醒不再折叠（带着旧文案恢复的会话会在下一条 user 消息后折叠进当前文案）；
- **增删仍校验存在性**：通过 API 保存的共享子目录要求存在（主动操作 fail loud）；只有目录事后消失的被动失效会被收窄，不阻塞其余根。

## 配置文件

默认 `~/.dsh-codex-project/dirs.json`（环境变量 `DSH_CODEX_PROJECT_CONFIG` 可覆盖），形状：

```json
{
  "workspaces": {
    "<workspaceId>": {
      "path": "主根（该工作区自身的路径）",
      "dirs": ["共享子目录1", "共享子目录2"]
    }
  }
}
```

- `path` 恒为该工作区自己的主根（锚定，记录键即工作区 id）；`dirs` 为额外可写目录；
- **旧格式懒迁移**：首次加载时若新文件不存在而旧文件 `~/.dsh-codex-project/spaces.json` 存在，自动把 `roots[]` 转成 `{ path, dirs }`（`roots[0]` 升格为 `path`，其余进 `dirs`），原文件保留为备份；
- 缺省文件 = 无配置 = 纯透传；
- **失效根不自动清理**：目录消失不会改写配置文件（对齐 dsh 核心"被动失效保留记录、降级显示"策略）；通过「管理工作区」弹窗或 API 显式移除。

## HTTP API

`/codex-project/api` 前缀（loopback Host 守卫），全部 JSON：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/codex-project/api/ping` | 挂载冒烟 |
| GET | `/codex-project/api/dirs?workspaceId=<id>` | 某工作区的共享子目录列表（无记录返回空数组；只有未知 id 才 404） |
| PUT | `/codex-project/api/dirs` | 替换某工作区的共享子目录（`{ workspaceId, dirs }`）；首次添加自动锚定该工作区 |
| GET | `/codex-project/api/project?cwd=<path>` | cwd 命中的项目：`{ path, dirs, missingDirs }` 或 `null`（无项目配置） |
| GET | `/codex-project/api/list?cwd=<path>&path=<abs>` | 列一个项目根目录层级（fence 到项目可写根，越界 403） |
| POST | `/codex-project/api/open-directory` | 用系统文件管理器打开一个文件夹 |

错误：400 非法输入、403 项目根之外（fence）、404 未知工作区、405 未知方法/路由。

## 开发

```bash
pnpm --dir dsh-codex-project typecheck   # 类型检查
pnpm --dir dsh-codex-project test        # 单元测试（jsdom + node）
pnpm --dir dsh-codex-project build       # 构建 lib/（host ESM + client CJS + runner + fs）
pnpm --dir dsh-codex-project proto:verify  # 多根 runner 原型实证（Windows ACL）
```

**挂载**（profile 机制）：

```bash
dsh plugin --profile <name> add <本仓库绝对路径或 npm spec>
```

本地开发用 file:// 挂载 `dev.patch.yml`（`pnpm dsh web --patch <绝对路径>/dev.patch.yml`）；client 改动浏览器硬刷新即可，host 改动需重启 `dsh web`。

**约束**：client bundle 禁止 value-import 其他插件的运行时符号（纯度门）；与 dsh 源码的集成只走公开/只读 API——需要 dsh 没有的能力时，先取舍说明，不改 dsh。`项目文件夹` tab 通过 `betterSidebar.registerTab` 的公开服务接口接入（仅在 better-sidebar 安装时注册），client 侧用结构化再声明消费，不走 value-import。

## 测试

`tests/`：dirs-api CRUD + 锚定 + 失效根派生、项目解析（projectFor 命中/null/stale）、项目目录树列表（排序/fence 403/跨盘根）、space 迁移、上下文提醒（文本组成/零权限断言/折叠位置/一次性/去重/缺失标注）、seam 接线（含死根收窄与无关死空间隔离）、fs fence（含收窄/隔离/自愈）、plugin 形态、client 组件（菜单注入 + 弹窗 + 项目文件夹 tab 的展开/打开文件/右键打开目录）。

## 版本记录

- **0.11.0**：移除「在编辑器中打开」（`betterSidebar.openFile` 触发 dsh-better-sidebar editor chunk "client module system unavailable"）；修复内联编辑器空白页 bug——CodeMirror host 改为始终挂载（预览态用 `hidden` 隐藏），markdown/html 切到编辑不再空白。
- **0.10.0**：`项目文件夹` tab 升级为 Files 同级预览——顶部路径输入框 + 右侧可拖拽/可隐藏文件树 + 左侧内联预览（图片 / PDF / Markdown / HTML / 代码编辑与 Ctrl+S 保存 / 二进制下载）；新增 `GET /read`、`POST /write`、`GET /file`（原始字节 + 下载 disposition）路由，全部 fence 到项目可写根；CodeMirror 6 + 语言包内联进 client bundle。
- **0.9.0**：新增 `项目文件夹` tab——better-sidebar 侧边栏注册项目多根目录树（主根 + 共享子目录，跨盘符），按层懒加载；新增 `GET /project`（cwd 命中项目解析）与 `GET /list`（项目根目录层级，fence 到可写根）路由；点击文件经 `betterSidebar.openFile` 在编辑器打开、右键目录用系统文件管理器打开。
- **0.8.0**：失效根收窄（narrowing）——配置共享子目录被删后不再 fail loud 连坐，可写集合收窄到现存根；上下文提醒标注缺失根；host 日志首见 warn；GET /dirs 暴露 missingDirs；管理弹窗标注失效根并提供移除按钮；修复无关会话被死根连坐的全局故障。
- **0.7.1**：修复「打开本地目录」——改用插件自有路由 /codex-project/api/open-directory（host 侧 spawn explorer.exe），不再走 workspaces.openPath（该方法是聊天文件打开通道，会被 better-sidebar 包装进侧边栏编辑器，目录无处安放而报 "is a directory"）。
- **0.7.0**：「…」菜单新增「打开本地目录」（初版走 workspaces.openPath，后被 better-sidebar 拦截问题推翻）。
- **0.6.0**：更名 `dsh-codex-project`（源自 Codex 项目处理思想）；配置路径迁移；文档重写；文档化安全边界。
- **0.5.0**：共享子目录模型定型（工作区 + 任意共享子目录 + 管理工作区弹窗）。
