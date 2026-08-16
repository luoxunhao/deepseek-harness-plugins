# dsh-codex-project

**dsh 工作区共享子目录插件** —— 源自 Codex 的项目处理思想：一个工作区可以挂载任意数量的**共享子目录**（可跨盘符），该工作区的 dsh 会话可以像对待自己的工作区一样读写这些目录——全程保持 `workspace-write` 权限，**永远不需要 `danger-full-access`**。

> 原名 `dsh-project-space`（0.6.0 起更名）。配置数据文件自动从旧路径迁移，见[配置文件](#配置文件)。

---

## 设计思想

Codex 处理项目时，一个"项目"往往横跨多个目录：主代码库、共享库、文档、数据目录。传统做法要么给模型 full access（危险），要么逐个授权（繁琐）。

本插件的模型是 **Codex 式的项目共享**：

```
一个共享配置（记录）= 一个主工作区 + 任意数量的共享子目录（跨盘符）
命中该配置的会话 → 可读写配置的全部 roots（主根 ∪ 共享子目录）
```

- **单配置模型**：会话的可写集合 = 其 cwd 命中的那一条配置的全部 roots（无并集、无叠加），行为可预期；
- **双向共享**：共享子目录若注册为工作区，其会话同样命中该配置（主位可交接：设为主工作区）；
- **不强制注册**：共享子目录可以是裸目录，不必是 dsh 注册的工作区；
- **不升级权限**：仍在 `workspace-write` 权限级内，只是把可写集合从单根扩展为多根（Windows ACL 受限令牌 + 空间级 SID）。

## 功能特性（已实现）

| 能力 | 说明 |
|---|---|
| 共享子目录配置 | 每个工作区可配置任意数量共享子目录（跨盘符、可裸目录） |
| 「管理工作区」弹窗 | 原生工作区「…」菜单注入入口：添加/移除共享子目录、设为主工作区交接 |
| 「打开本地目录」 | 原生「…」菜单注入入口：用系统文件管理器打开该工作区文件夹（插件自有路由 spawn explorer.exe——不走 workspaces.openPath，避免被 better-sidebar 等插件劫持到侧边栏编辑器） |
| 多根沙箱 runner | 命中配置的会话，shell/subprocess 自动走多根受限令牌（`lib/runner.js`） |
| 多根 fs fence | 进程内 fs 工具（read/write/edit）同样按配置 roots 放行（`lib/fs.js`） |
| 会话上下文提醒 | 第一条 user 消息后折叠 `<system-reminder>` 目录清单（英文、零权限声明，模型自己试错） |
| 配置 CRUD + 持久化 | `/codex-project/api` JSON 路由，`~/.dsh-codex-project/spaces.json` |
| 旧格式懒迁移 | 旧记录自动锚定主工作区并升格 `roots[0]`；配置文件自动从旧路径迁移 |

## 架构总览

```
┌─────────────────────────── dsh web ───────────────────────────┐
│  侧边栏工作区「…」菜单 ──注入「打开本地目录」+「管理工作区」──▶ 本地动作/弹窗   │  (client half)
│        │                                                      │
│        ▼                                                      │
│   /codex-project/api  (CRUD，loopback 守卫)                   │  (host half)
│        │                                                      │
│   ┌────┴────────────────────────────────────────────────┐     │
│   │ 命中判定：会话 cwd ∈ 某配置 roots 且 roots.length > 1 │     │
│   └────┬───────────────────────────────┬────────────────┘     │
│        ▼                               ▼                       │
│   sandbox.confine 路由             ctx.fs 提供者               │
│   (lib/runner.js 多根受限令牌)      (lib/fs.js 多根 fence)     │
│        ▼                                                       │
│   agent/pre-step 折叠上下文提醒（紧跟第一条 user 消息）          │
└───────────────────────────────────────────────────────────────┘
```

三处隔离面（runner / fs fence / 上下文提醒）共用同一命中判定（`matchingMultiRootSpace`，单一来源），配置外、单根、无 cwd 的会话零影响（纯透传）。

## 安全模型

- **权限不升级**：多根 runner 仍是 `workspace-write` 受限令牌（拒绝列表 + 空间级 SID 写授权），只是 Write ACE 覆盖配置的全部 roots；
- **空间级 SID**：每条配置一个专属 SID（`config 目录 + record id` 摘要）——核心单根会话的 SID 无法沿着共享目录的 ACE 进入其他根，空间会话的令牌也无法使用别的根的 ACE；
- **失败契约**：runner 任何失败输出 `codex-project-run: <detail>` 并以 127 退出，绝不以非受限方式 spawn 子进程；
- **模型不被告知权限**：上下文提醒只列目录清单，不声明可读写——模型通过工具试错发现边界，`[sandbox: …]` 拒绝标记不变。

### 已知边界（设计取舍）

- **重叠根歧义**：同一目录同时是两条配置的根时，cwd 落在该目录的会话匹配**配置文件中靠前的那条**（可写集合随配置顺序漂移）。建议共享子目录互不重叠；
- **standing ACE 常驻**：runner 在每个根上物化的空间 SID Write ACE 是常驻的（跨会话复用缓存，dispose 只回收私有 temp）。删除配置不会回收已打上的 ACE（孤立 ACE 无令牌携带，无害但会累积）；
- **无只读共享**：所有根都授予读写——想"只读共享"（如只允许读 dsh 源码树）需要后续特性；
- **提醒不重注入**：每会话一次性；恢复的会话若已有相同提醒不再折叠（带着旧文案恢复的会话会在下一条 user 消息后折叠进当前文案）。

## 配置文件

默认 `~/.dsh-codex-project/spaces.json`（环境变量 `DSH_CODEX_PROJECT_CONFIG` 可覆盖），形状：

```json
{
  "spaces": [
    {
      "id": "uuid",
      "workspaceId": "主工作区锚点（可选）",
      "title": "显示名（可选）",
      "roots": ["主工作区根", "共享子目录1", "共享子目录2"]
    }
  ]
}
```

- `roots[0]` 恒为主工作区根，其余为共享子目录；
- **重命名迁移（0.6.0）**：首次加载时若新路径不存在而旧路径 `~/.dsh-project-space/spaces.json` 存在，自动复制过去（原文件保留为备份）。注意：配置目录变化会改变记录 SID，旧 standing ACE 变为惰性、新 ACE 在下次受限运行时重新物化；
- 缺省文件 = 无配置 = 纯透传。

## HTTP API

`/codex-project/api` 前缀（loopback Host 守卫），全部 JSON：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/codex-project/api/ping` | 挂载冒烟 |
| GET | `/codex-project/api/spaces` | 共享配置列表 |
| POST | `/codex-project/api/spaces` | 创建 `{ workspaceId?, title?, roots: [...] }` → 201 + 配置（id = UUID） |
| PUT | `/codex-project/api/spaces/:id` | 更新 title/roots；workspaceId/title 缺省保留原值（设为主交接） |
| DELETE | `/codex-project/api/spaces/:id` | 删除 |

## 开发

```bash
pnpm --dir dsh-codex-project typecheck   # 类型检查
pnpm --dir dsh-codex-project test        # 单元测试（jsdom + node）
pnpm --dir dsh-codex-project build       # 构建 lib/（host ESM + client CJS + runner + fs）
pnpm --dir dsh-codex-project proto:verify  # 多根 runner 原型实证（Windows ACL）
```

**挂载**（profile 机制）：

```bash
dsh plugin --profile <name> add E:/project/deepseek-harness-plugins/dsh-codex-project
```

本地开发用 file:// 挂载 `dev.patch.yml`（`pnpm dsh web --patch <绝对路径>/dev.patch.yml`）；client 改动浏览器硬刷新即可，host 改动需重启 `dsh web`。

**约束**：client bundle 禁止 value-import 其他插件的运行时符号（纯度门）；与 dsh 源码的集成只走公开/只读 API——需要 dsh 没有的能力时，先取舍说明，不改 dsh。

## 测试

`tests/`：spaces-api CRUD + 锚点交接、space 迁移、上下文提醒（文本组成/零权限断言/折叠位置/一次性/去重）、seam 接线、fs fence、plugin 形态、client 组件（菜单注入 + 弹窗 + 指针宽限回归）。

## 版本记录

- **0.7.1**：修复「打开本地目录」——改用插件自有路由 /codex-project/api/open-directory（host 侧 spawn explorer.exe），不再走 workspaces.openPath（该方法是聊天文件打开通道，会被 better-sidebar 包装进侧边栏编辑器，目录无处安放而报 "is a directory"）。
- **0.7.0**：「…」菜单新增「打开本地目录」（初版走 workspaces.openPath，后被 better-sidebar 拦截问题推翻）。
- **0.6.0**：更名 `dsh-codex-project`（源自 Codex 项目处理思想）；配置路径迁移；文档重写；文档化安全边界。
- **0.5.0**：共享子目录模型定型（工作区 + 任意共享子目录 + 管理工作区弹窗 + 设为主工作区）。
