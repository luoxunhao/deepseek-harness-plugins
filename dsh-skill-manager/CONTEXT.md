# dsh-skill-manager — 领域词汇表

本文件只记录领域术语（纯词汇，无实现细节）。实现决策见代码注释、README 与 docs/adr。

> 命名溯源：插件在 DSH 设置外壳（「设置 → 技能」）提供一个 skill 目录管理分区。它消费 dsh 的 skill 注册表（`ctx.skills`，见 dsh `docs/subsystems/skills.md`），但**不改变**注册表语义——只提供一个面向用户的目录视图与调用策略开关。

## 核心概念

- **技能（Skill）**：一条 kebab-case 命名的指令，底层是一个磁盘文件（`<name>/SKILL.md` 目录包 或 `<name>.md` 扁平），或一次运行时注册。被 `ctx.skills` 注册表分层聚合。**本插件的管理单位。**
- **技能目录（Skill Catalog）**：`ctx.skills.snapshot()` 返回的、跨来源合并排序的调用无关摘要集。插件在「技能」分区展示它，不做过滤。
- **来源（Source）**：技能的出处桶：`project-dsh` / `project-agents` / `user-dsh` / `user-agents` / `custom` / `bundled` / `runtime`。目录行用它做徽标。
- **调用策略（Invocation Policy）**：一个技能的两个独立布尔 `modelInvocable` / `userInvocable`，由 frontmatter 键 `disable-model-invocation` / `user-invocable` 规范化而来（省略默认 true）。决定该技能是否出现在模型上下文目录 / 用户命令目录。**本插件用一个「启用」开关统一控制两层**：启用 = 模型与用户都可调用；关闭 = 两者都关闭；两键始终同步写入，永不删除。
- **可开关（Toggleable）**：一个技能可被插件改写调用策略 ⇔ 它有磁盘路径且来源非 `bundled`。`bundled`（包内文件）与 `runtime`（无文件）只读展示，无开关。
- **关闭 / 启用（Disable/Enable）**：改写技能文件 frontmatter 的调用键。启用 = 写 `disable-model-invocation: false` + `user-invocable: true`（两层都可调用）；关闭 = 写 `disable-model-invocation: true` + `user-invocable: false`（两层都关闭）。两键始终成对写入、状态同步。
- **frontmatter**：技能文件开头的 `---\n...yaml...\n---` 头，承载 `name` / `description` / `disable-model-invocation` / `user-invocable` 等元数据。写入必须**最小化保真**：只增删调用键，其余键与正文逐字节保留。
- **技能路径（Skill Path）**：`ctx.skills.get(name)` 返回的 `SkillDefinition.path`（绝对磁盘路径）。它是调用键写入的**唯一允许目标**——写 API 只接受 skill `name`，由 host 解析路径，绝不受理客户端任意路径。
- **作用域（Skill Scope）**：技能分两种作用域。**用户级（user）**＝用户/项目之外的全局面（`user-dsh` / `user-agents` / `bundled` / `runtime` / `custom`），`snapshot()` 不带 cwd 即可枚举；**项目级（project）**＝某工作区的项目技能（`project-dsh` / `project-agents`），必须把工作区目录作为 `cwd` 传给 `snapshot({ cwd })` / `get(name, { cwd })` 才会被发现。同一个技能可能既有用户级也有项目级实例。**面板用「用户级 / 项目级」两个标签页区分。**
- **工作区（Workspace）**：宿主 `ctx.workspaceRegistry` 记录的持久化项目目录（`{ id, path, title }`）。项目级标签页用**下拉列表**从中选择工作区，以该工作区 `path` 作为 `cwd` 加载项目技能。工作区服务缺失时列表为空，插件仍可用（仅用户级）。

## 界面概念

- **技能分区（SkillsSection）**：DSH 设置外壳中注册的 `settings.section`，nav label「技能」。内容：**用户级/项目级标签页**；项目级页有**工作区下拉列表**；目录列表（来源徽标 + 只读标记）→ 展开查看正文 → 每个可开关 skill 一个统一启用开关（模型 / 用户两层同步）。

## 关系

- 技能 N—1 来源桶；来源桶 ⊂ 提供方（provider）。
- 作用域决定来源桶集合：user ⊇ {user-dsh, user-agents, bundled, runtime, custom}，project ⊇ {project-dsh, project-agents}。
- 项目级发现以工作区 `cwd` 为前提：不传 cwd 就不扫描项目根（`skill-filesystem` 只在 `cwd !== undefined` 时加项目根）。
- 可开关 = 有路径 ∧ 非 bundled（⊥ 其他来源仍可写，因为写的是它自己的路径）。
- 启用 / 关闭作用于技能的调用策略；不改动正文、名称、描述或来源。