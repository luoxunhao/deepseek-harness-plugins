# Skill Manager 插件设计方案

> 目标：在 DSH 内提供一个可视化的 skill 管理界面（列出 / 查看 / 新增 / 编辑 / 删除 / 切换启用），并在宿主侧提供可复用的 skill CRUD 能力，供 UI 与其他插件消费。
>
> 仓库硬约束见 `AGENTS.md`：**零写入 `E:\project\deepseek-harness`**，插件独立成包、仅经 profile / `cordis.patch.yml` 挂载，需要 dsh 没有的能力时优先用其公开只读 API 或插件自有路由。

---

## 1. 背景与现状（基于 dsh 源码调研）

DSH 的 skill 系统（`packages/skill`）已经提供了：

- **`ctx.skills` 宿主注册表**（`SkillRegistry`）：分层（宿主 + 按 scope）合并各提供方的 skill 目录；提供方贡献本地/内嵌/远程 skill，消费方（`dsh-tool-skill`）拥有面向模型的 `skill` 工具。
- **本地文件系统提供方**（`dsh-skill-filesystem`）：按固定 rank 扫描多个根目录，解析 `SKILL.md`（目录包）或 `<name>.md`（扁平文件）的 YAML frontmatter。
- **客户端只读 RPC**（`skill.list`）：按 session 的 project cwd 返回 `SkillEntry[]`（`name` / `description` / `whenToUse?` / `modelInvocable`），**不返回正文或路径**，且只列 `userInvocable` 的 skill。
- **UI 扩展点**：`ctx.slots`（客户端槽位注册）、`ctx.betterSidebar.registerTab`（侧边栏 tab）、`ctx.connection.api`（客户端 RPC 客户端）。

### 关键事实（决定方案取舍）

| 事实 | 出处 | 对管理插件的含义 |
|---|---|---|
| skill 是 **kebab-case** 目录包 `<name>/SKILL.md` 或扁平 `<name>.md` | `skills.zh.md` §skill 身份 | 写入磁盘时要遵守命名与 frontmatter 规则 |
| 本地发现根有固定 rank：`project-dsh(100)` / `project-agents(200)` / `custom(300)` / `user-dsh(400)` / `user-agents(500)` / `bundled(600)` | `skills.zh.md` §本地发现优先级 | 新增 skill 落到哪个根，决定了它的优先级与可见范围 |
| 本地提供方读取 frontmatter 键 `disable-model-invocation` 与 `user-invocable`，缺省均为 `true` | `skills.zh.md` §摘要 | “启用/禁用” = 改写这两个 frontmatter 字段，而非动注册表 |
| `ctx.skills` 提供 `register(skill)`（运行时注册，供消费方在内存注入 skill）和 `registerProvider` | `skills.zh.md` §Cordis API | 管理插件可直接用 `register()` 做“运行时新增/临时启用”，不必落盘 |
| 注册表只缓存**摘要**，**不缓存完整定义**：每次 `get()` 重新读取磁盘正文 | `skills.zh.md` §查找与配置 | 改写 `SKILL.md` 正文后，下一次 `get()` 自动读到新内容；无需手动 invalidate |
| `skills/change` 是**不带 diff 的失效事件**，消费方重新 `snapshot()` | `skills.zh.md` §events | 管理插件写入磁盘后应主动广播/依赖 watcher 触发失效 |
| 客户端 `skill.list` 是**只读**、**按 session**、**只返回 user-invocable** | `apiproxy/src/api-proxy.ts` `skillRegistry.list(...).filter(isUserInvocable)` | 客户端要写 skill，必须走**插件自有 host 路由**（宿主半拥有 `ctx.fs` 与 `ctx.skills`） |
| `ctx.fs` 文件系统服务在宿主侧可用，提供 `fs.read` / 目录浏览 | better-sidebar 通过 `/sidebar/api/fs.read` 使用 | 管理插件的 host 半可直接用 `ctx.fs` 读写 skill 文件 |

**结论**：只读浏览可直接复用 `skill.list` + 宿主 `ctx.skills`；但**任何写操作（新增/编辑/删除/改 frontmatter）都必须在宿主半实现**，通过插件自有 HTTP 路由暴露给客户端——这与 better-sidebar 的 host/client 拆分一致，也是仓库硬约束允许的“插件自有路由”路径。

---

## 2. 方案总览

插件名：**`dsh-skill-manager`**，采用与 `DSH-better-sidebar` 一致的 **host half + client half** 形态。

```
dsh-skill-manager/
├── package.json              # 依赖 dsh 包用 workspace:^
├── cordis.patch.yml          # 挂载行（id: skill-manager, name: dsh-skill-manager）
├── dsh.plugin.json           # 插件元信息
├── tsconfig.json / tsconfig.build.json
├── src/
│   ├── index.ts              # HOST HALF：注册 HTTP 路由 + skill 服务
│   ├── skill-service.ts      # HOST：封装 skill CRUD（读写磁盘 + ctx.skills.register）
│   ├── routes.ts             # HOST：路由 handler（list/get/write/delete/toggle）
│   └── client/
│       ├── index.tsx         # CLIENT HALF：注册 slots / better-sidebar tab
│       ├── SkillManagerView.tsx  # 主管理界面
│       ├── SkillEditor.tsx        # 单个 skill 编辑/新建表单
│       └── api.ts            # 客户端调用自有路由的封装（fetch）
└── tests/
    └── e2e/mount.e2e.ts      # 挂载冒烟（参考 better-sidebar）
```

### 2.1 Host half（`src/index.ts`）

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'skill-manager'
export const inject = ['webServer', 'skills', 'fs']   // 路由 + 注册表 + 文件系统

export function apply(ctx: Context) {
  // 1) 注册 skill 管理服务（发布到 ctx，供其他宿主插件消费）
  ctx.effect(() => ctx.provide('skillManager', createSkillManager(ctx)))

  // 2) 注册 HTTP 路由（客户端 UI 调用）
  ctx.effect(() => registerSkillRoutes(ctx))
}
```

> ⚠️ `ctx.skills` / `ctx.fs` / `ctx.webServer` 是宿主侧服务，声明在 `inject` 里由框架保证就绪。客户端半**不**能直接拿到 `ctx.skills`，必须通过自有路由中转。

### 2.2 Client half（`src/client/index.tsx`）

```ts
import type {} from 'dsh-better-sidebar'   // 可选：若用侧边栏 tab
import type { Context } from 'cordis'

export const inject = ['slots', 'connection', 'sessions', 'locale']

export function apply(ctx: Context) {
  // 方案 A：注册到 better-sidebar 的 tab（推荐，复用现成面板）
  ctx.effect(() =>
    ctx.betterSidebar.registerTab({
      id: 'skill-manager:root',
      title: () => 'Skills',
      icon: <SkillIcon />,
      order: 45,
      single: true,
      component: ({ scope }) => <SkillManagerView sessionId={scope.sessionId} />,
    })
  )
  // 或 方案 B：用 ctx.slots 注册到主界面某槽位（不依赖 better-sidebar）
}
```

> 客户端通过 `ctx.get('connection').api` 拿到 RPC 客户端；对**自有写路由**用 `fetch('/skill-manager/api/...')` 调用（与 `/sidebar/api/*` 同款模式）。

---

## 3. 宿主侧 Skill 服务（`skill-service.ts`）

封装对 `ctx.skills` 与 `ctx.fs` 的读写，作为插件自有能力的单一事实源。

### 3.1 能力与数据模型

```ts
interface ManagedSkill {
  name: string
  description: string
  whenToUse?: string
  modelInvocable: boolean   // ← frontmatter disable-model-invocation
  userInvocable: boolean    // ← frontmatter user-invocable
  source: SkillSource       // project-dsh | user-dsh | custom | ...
  rootKind: 'project' | 'user' | 'custom'   // 决定写入落点
  path?: string             // 磁盘绝对路径（运行时注册的无）
  content: string           // SKILL.md 正文（不含 frontmatter）
}

interface SkillManagerService {
  /** 列出当前 cwd 下所有 skill（合并各根，含完整摘要 + 策略）。 */
  list(cwd: string): Promise<ManagedSkill[]>
  /** 读取单个 skill 完整定义（含正文）。 */
  get(name: string, cwd: string): Promise<ManagedSkill | undefined>
  /** 新建或覆盖一个落盘 skill（写 SKILL.md + frontmatter）。 */
  write(input: WriteInput, cwd: string): Promise<ManagedSkill>
  /** 删除一个落盘 skill（目录包或扁平文件）。 */
  remove(name: string, cwd: string): Promise<void>
  /** 仅切换 modelInvocable/userInvocable（改写 frontmatter，不动正文）。 */
  setInvocation(name: string, policy: Partial<SkillInvocationPolicy>, cwd: string): Promise<ManagedSkill>
}
```

### 3.2 写入落点策略（rank 与可见性）

写操作必须选一个**根目录**作为落点。默认策略：

| 操作意图 | 落点根 | rank | 说明 |
|---|---|---|---|
| 用户想“全局可用” | `user-dsh` = `<dshHome>/skills` | 400 | 跨项目生效，优先级低于项目根 |
| 用户想“仅当前项目” | `project-dsh` = `<projectRoot>/.dsh/skills` | 100 | 当前 git 仓库内生效，最高优先级 |
| 管理员自定义目录 | `custom`（`Config.customSkillDirs`） | 300 | 需配置，否则不可用 |

> 实现：用 `ctx.fs` 解析 git root（向上探测 `.git`）得到 `projectRoot`；`dshHome` 来自 `@deepseek-ai/dsh-home-paths` 的 `resolveDshHome()`（与 `dsh-skill-filesystem` 同源，不重复造轮子）。UI 上让用户在下拉里选“项目 / 用户”两种落点即可，custom 作为进阶选项。

### 3.3 frontmatter 读写

复用 `yaml`（`@deepseek-ai/schemastery` 已依赖）解析/序列化：

- **读取**：`ctx.skills.get()` 返回的 `SkillDefinition` 已含解析后的 `content`（正文）+ `metadata`（frontmatter 对象）+ `invocation` 策略。无需自己解析。
- **写入**：构造 `{ name, description, whenToUse?, 'disable-model-invocation': !modelInvocable, 'user-invocable': userInvocable }` 作为 frontmatter，拼接 `\n---\n<yaml>\n---\n\n<content>` 写回 `SKILL.md`。
- **改写策略（toggle）**：只重读 frontmatter、替换两个布尔键、回写，**保留正文不变**。

> ⚠️ 不要自己重新解析 `SkillDefinition.content` 的 frontmatter——`ctx.skills.get()` 已经做好了；直接消费其 `metadata` / `invocation` / `content` 字段。

### 3.4 与注册表的关系

- **写盘即生效**：本地提供方有 Chokidar watcher，落盘后自动触发 `skills/change`，下一次 `get()` 读到新内容（注册表不缓存完整定义，见 §1）。
- **运行时注册（可选增强）**：`ctx.skills.register(skill)` 可在内存注入 skill（不落盘、进程级），适合“临时启用 / 从 UI 草稿预览”。返回的 disposer 即卸载入口——用 `ctx.effect` 管理，卸载时自动移除。
- **删除落盘文件**后同样由 watcher 失效；若提供方实例读到名称不匹配会自我失效重新发现。

---

## 4. 宿主路由（`routes.ts`）

参考 `/sidebar/api/*` 模式，在宿主 `webServer` 上注册 `/skill-manager/api/*`：

| Method | Path | 作用 | 入参 | 出参 |
|---|---|---|---|---|
| `GET` | `/skill-manager/api/list?sessionId=` | 列出 skill | sessionId → 解析 cwd | `ManagedSkill[]` |
| `GET` | `/skill-manager/api/get?name=&sessionId=` | 读取单个 | name | `ManagedSkill` |
| `POST` | `/skill-manager/api/write` | 新增/覆盖 | `{ sessionId, rootKind, skill }` | `ManagedSkill` |
| `POST` | `/skill-manager/api/remove` | 删除 | `{ sessionId, name }` | `{ ok }` |
| `POST` | `/skill-manager/api/toggle` | 切换启用 | `{ sessionId, name, policy }` | `ManagedSkill` |

> 安全边界：**不接收客户端原始路径**。所有路径解析在宿主侧完成——`sessionId` → 当前 session 的 header cwd → 解析到受信根目录（`project-dsh` / `user-dsh` / 配置的 `customSkillDirs`）。这与 `skill.list` 的“客户端永不提交原始路径”原则一致（`skills.ts` 注释明确要求）。
>
> 写操作前校验 `name` 匹配 `^[a-z0-9]+(?:-[a-z0-9]+)*$`，拒绝非法标识，防止路径穿越。

---

## 5. 客户端 UI（`SkillManagerView.tsx`）

### 5.1 布局

- **左栏：skill 列表**（按 source 分组：项目 / 用户 / 运行时），每项显示 `name` + `description` + 启用的两个开关（model/user）的小标。
- **右栏：详情/编辑器**（`SkillEditor.tsx`）：
  - 只读模式：渲染 `content`（Markdown，复用 DSH 的 `MarkdownText`，注意传 `codeLabels`）。
  - 编辑模式：`name`（新建时）、`description`、`whenToUse`、两个启用开关、`content`（textarea 或轻量 Markdown 编辑器）。
- **落点选择**：新建时下拉选“项目根 / 用户根”。

### 5.2 数据获取

```ts
// 列出：复用官方只读 RPC（无需自有路由）
const { result } = await ctx.get('connection').api.skills.list({ sessionId })
// 但 list 只返回 user-invocable 且无正文 —— 完整管理需走自有路由：
const skills = await fetch('/skill-manager/api/list?sessionId=' + sessionId).then(r => r.json())
```

> 设计取舍：**列表用自有路由**而非 `skill.list`，因为管理界面需要看到 model-only 与 user-only 的全部 skill、且需要 `path`/`source` 以便编辑与删除。`skill.list` 的语义是“给用户调用的目录”，不适合管理场景。

### 5.3 皮肤兼容

与 better-sidebar 同策略：**只消费 DSH 的 `--dsw-alias-*` / `--ds-*` 令牌**，不硬编码颜色，换肤自动跟随。组件用 CSS Modules 哈希类名（非契约）。

---

## 6. 挂载与验证

1. **`cordis.patch.yml`**（模板同 `DSH-better-sidebar/cordis.patch.yml`）：
   ```yaml
   - insert:
       - id: skill-manager
         name: 'dsh-skill-manager'
   ```
2. **本地开发**：dsh 源码根目录运行 `pnpm dsh web --patch <绝对路径>/dsh-skill-manager/cordis.patch.yml`，打开 `http://127.0.0.1:3080`。
3. **官方通道（发布）**：`dsh plugin --profile <name> add dsh-skill-manager@<version>`，CLI 协调 `dsh.profile.bundles` + 应用包内 `dsh.bundle.patch`。
4. **冒烟测试**：`tests/e2e/mount.e2e.ts`（Playwright）断言外壳挂载、无 `dsh-skill-manager:` 错误条、Skill 面板可打开、列出 seed skill、新建/删除一个临时 skill 后目录更新。

---

## 7. 范围与取舍（先对齐再实现）

| 能力 | 本期做 | 理由 |
|---|---|---|
| 列出 / 查看（含 model-only & user-only） | ✅ | 自有路由读 `ctx.skills` |
| 新增 / 编辑 / 删除（落盘） | ✅ | 宿主半 `ctx.fs` 写 SKILL.md |
| 切换 model/user 启用 | ✅ | 改 frontmatter 两个键 |
| 运行时注册（不落盘的临时 skill） | ⬜ 可选增强 | `ctx.skills.register` 已支持，后续迭代 |
| 导入/导出 skill 包 | ⬜ 后续 | 跨机器分发需求 |
| 远程提供方管理 | ⬜ 不涉及 | 注册表架构由 dsh 拥有，插件不碰 |
| 改写注册表层 / provider | ❌ 不做 | 违反“不改 dsh 注册表架构”约束；只消费 `ctx.skills` 公共 API |

---

## 8. 依赖与 peerDependencies（草案）

宿主侧：`@deepseek-ai/cordis`、`@deepseek-ai/dsh-skill`（类型）、`@deepseek-ai/dsh-home-paths`、`@deepseek-ai/dsh-fs`（类型）、`@deepseek-ai/dsh-host-webserver`（类型）、`@deepseek-ai/schemastery`（yaml）。

客户端侧：`@deepseek-ai/dsh-client-runtime`、`@deepseek-ai/dsh-client-slots`、`@deepseek-ai/dsh-client-web-react`、`@deepseek-ai/dsh-api-remotes/client`（RPC 类型）、`react`、`react-dom`；若用侧边栏 tab，加 `dsh-better-sidebar`（peer，optional）。

> 与 better-sidebar 一致：`dsh-better-sidebar` 作为 **optional peerDependency**，未安装时 UI 回退到 `ctx.slots` 注册（或直接以独立浮层呈现），注册代码因 `ctx.betterSidebar` 为 undefined 而跳过。

---

## 9. 下一步

1. 与用户确认 §7 的范围与 §5.2 的“列表走自有路由”取舍。
2. 用 `hindsight_capture_initiative` 记录本插件为 tracked initiative。
3. 脚手架 `dsh-skill-manager/`：package.json + cordis.patch.yml + 最小 host/client 跑通挂载冒烟。
4. 实现 host 半 `skill-service.ts` + `routes.ts`，单测覆盖落点解析与 frontmatter 读写。
5. 实现 client 半 UI，接入 better-sidebar tab 或 slots。
6. 补 e2e 挂载冒烟。

---

## 附：关键源码索引（只读参考，不修改）

- 注册表契约：`E:\project\deepseek-harness\docs\subsystems\skills.zh.md`
- 宿主 `SkillRegistry` 类型：`packages/skill/skill/src/index.ts`
- 本地提供方（rank / 根 / frontmatter）：`packages/skill/skill-filesystem/src/index.ts`
- 客户端只读 RPC：`packages/host/apiproxy/src/api/skills.ts` + `src/api-proxy.ts`（skill.list 实现，仅 user-invocable、无正文）
- 标杆插件（host+client 范式 / 挂载 / 冒烟）：`DSH-better-sidebar/`（本仓库）
- 最小工具插件：`tool-sqlite/`（本仓库）
- 客户端 RPC 客户端用法：`packages/client/ui-agent-preset/src/client/*`（经 `ctx.get('connection').api`）
- 槽位注册：`packages/client/ui-slots/src/index.ts`（`ctx.slots.register` / `inject`）
