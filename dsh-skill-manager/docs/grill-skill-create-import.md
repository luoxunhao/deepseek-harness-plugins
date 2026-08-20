# Grill 会话 — 技能导入 + 技能创建工具

> 状态：**进行中**。本文件记录设计树当前的全部分支与待定决策；每次用户回答后更新。

## 目标

给 `dsh-skill-manager` 增加两项能力：

1. **导入技能**：允许用户将规范的 zip 格式技能压缩包导入 dsh。
2. **创建技能工具**：为 dsh 写一个创建 skill 的工具；工具不主动注入系统 prompts，只有当用户使用技能管理插件创建 skill 时显式调用。

## 已确立的决策（用户已拍板）

- **导入不需要工具**：导入只是一种规范（zip 包格式约定），核心工作是**对导入的 skill 做校验，避免非法数据**。
- 两条入口解耦：导入 = 「校验 zip → 解压搬入」；创建 = 「工具创建持久化」。共享的只有**校验规则**与**落点解析**这两个函数，不共享工具。
- 创建侧最新倾向方案：**创建专属 preset agent**（详见「提案：create-skill agent」）。

## 已确认的事实（源码侦察）

- dsh 树**无任何 zip 解析依赖**（无 yauzl/adm-zip/jszip/tar）。
- `isSkillName` = `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`（`packages/skill/skill/src/index.ts:20,34`）。
- `ctx.skills` 是纯只读聚合服务（snapshot/get/list）；`ctx.skills.register()` 只做**内存 runtime 技能**（`source: 'runtime'`，不落盘、不可开关、重启即失）。
- 内核 skill 相关工具仅一个：`tool-skill` 的 `skill`（**只读加载器**，加载技能正文 + 注入 `<available_skills>` 目录 + `/name` 手势）。无创建/导入工具。
- `tool-cordis` 把 `ctx.skills` 的 API 暴露为模型可调用 cordis 工具（`skills.register` 仍是内存技能）。
- **dsh 无工具级延迟加载**：`ctx.tools.register` 即时注册，注册即挂 system prompt schema 提供器（`packages/core/tools/src/index.ts:832`）；无 hidden/disabled/lazy 标志。
- 「注册但不进 prompt」可用的真机制：scope 化注册（schedule 模式：`agent.ctx.tools.register`）、`tools.restrict`（按 agent scope）、`system-prompt/assemble` 瀑布剥 schema、`tools.guard`（执行期拒绝）。
- `ctx.tools.execute({ name, arguments, signal })` 是受支持的程序化调用入口（走完整策略管线）；`definition.execute()` 直接调用非受支持模式（生产无人用），但插件调用**自有**定义属内部行为。
- 工具可见性按 agent scope 每次组装实时解析：global 层 → preset 常驻层 → agent 自身层，减去 restrict 掩码。
- 发现根：user = `~/.dsh/skills` + `~/.agents/skills`；project = `<项目根>/.dsh/skills` + `<项目根>/.agents/skills`，项目根必须传 `cwd` 才扫描。
- 工作区：`ctx.workspaceRegistry.list()` → `{ id, path, title }`，可选依赖。

## 提案：create-skill agent（用户最新倾向）

- 创建一个 **preset agent**，专门处理 create_skill。
- 技能管理界面点「＋」→ 弹窗提供 **导入 / 创建** 两种模式。
- 点「创建」→ **默认切换到 create-skill agent**。
- 该 agent 的**工具与提示词全部自定义**（专属 scope 里注册 `create_skill` 工具 + 自定义 system prompt）。
- 优势：工具只在该 agent 作用域可见 → 其他 agent 天然不注入 prompt；dsh 通过该 preset 的组合"知道"这个工具。

## 设计树 — 待定决策（按编号回答）

### A. 创建侧

**Q1 — 工具本质与注册方式**（用户倾向已转向 preset agent，但注册粒度待定）
- A. 插件自持 defineTool，永不注册进 `ctx.tools`；UI 流程由 host 代码直接调其 `execute()`。（dsh 不知道它）
- B. 全局注册 + `system-prompt/assemble` 瀑布剥 schema；插件经 `ctx.tools.execute` 调用。（dsh 知道、可走策略）
- C. **专属 preset agent scope 内注册**（schedule 模式）；仅该 agent 可见/可调。（当前用户倾向）
➡️ 倾向 **C**（与最新提案一致）。

**Q10 — 内容作者**：创建 = 模型起草（用户自然语言描述 → create-skill agent 起草 name/description/whenToUse/正文 → 调 `create_skill` 落盘）？还是用户填表单、模型只做整理？
➡️ 推荐**模型起草**。

**Q11 — 落点来源**：create-skill agent 怎么知道写进哪个根？
- A. 从启动对话框携带 scope/cwd 作为会话初始上下文（用户级标签→user-dsh；项目级标签+已选工作区→该工作区 project-dsh），agent 默认用它
- B. agent 主动问用户
➡️ 推荐 **A**。

**Q12 — 写前确认**：`create_skill` 是模型工具，落盘前是否要用户确认（dsh 有 `tools/pre-execute` ask 机制）？
➡️ 推荐**要**。

**Q13 — preset 打包**：create-skill 这个 preset agent 怎么交付？
- A. 随本插件同步进 `~/.dsh/.agent-presets`（liangshen 模式）
- B. 独立 preset 包
➡️ 推荐 **A**。

**Q14 — 启动机制**（**依赖侦察**）：「点击创建 → 默认切换到 create-skill agent」需要客户端 API（创建会话/切 agent）。侦察内容：dsh web/client 是否有程序化创建会话、选择 agent 的 API（session/agent 服务、ui 槽位）。待侦察结果回来再定形态。

### B. 导入侧（规范 + 校验）

**Q2 — 落点解析**（导入与创建共用同一套）：目标作用域/根？
- A. 固定用户级 `~/.dsh/skills`（user-dsh）
- B. 固定用户级 `~/.agents/skills`（user-agents）
- C. 随当前标签页走：用户级标签→用户级根（可再选 user-dsh 或 user-agents）；项目级标签→所选工作区 `.dsh/skills`（project-dsh）
➡️ 推荐 **C**。

**Q3 — zip 包规范 + 校验清单**（需求 1 核心，即"避免非法数据"）：
- 结构：zip 根即技能包目录（若根下恰有一个目录则剥掉这层壳），包内必须含 `SKILL.md`，其余文件/子目录原样保留。
- 校验（全部通过才接受，任一失败整包拒绝并清理临时目录）：
  1. 解压安全：拒绝 `..`、绝对路径、盘符、反斜杠伪装、symlink/hardlink
  2. 体积上限：总解压 ≤ 10MB、条目 ≤ 200、单文件 ≤ 5MB（档位可调）
  3. 结构：解压后必须存在 `SKILL.md`
  4. frontmatter：能解析；`name` 匹配 `isSkillName`；`description` 为非空字符串
  5. name 与落点一致性：用 frontmatter 的 name 决定落点 `<root>/<name>/SKILL.md`，zip 文件名/内目录名一律忽略
- 待拍板：体积档位、是否允许任意扩展名（倾向允许）、是否限制 frontmatter 键白名单（倾向不限制——多余键原样保留）

**Q4 — 同名冲突**（判定基于磁盘根里的目录，不只注册表）：
- A. 直接拒绝
- B. 静默覆盖
- C. UI 确认（默认拒绝，可勾覆盖；API 带 `overwrite`，默认 false）
➡️ 推荐 **C**。

**Q5 — zip 解析库**（dsh 树无 zip 依赖，插件新增，仅 host half）：
- A. `yauzl`（流式、防 slip 标准）
- B. `adm-zip`（同步简单）
- C. 手写
➡️ 推荐 **A yauzl**。

**Q6 — 上传传输**：`<input type="file">` → 裸二进制 POST（`application/zip`，路由按字节上限截断）／multipart／base64 JSON。
➡️ 推荐裸二进制。

### C. 共享层

**Q8 — 共享校验/落点层**：两条入口共用「校验 name/frontmatter + scope→root 解析 + 冲突检查」同一套函数（导入再叠加 zip 安全校验），写入动作各自独立（导入=整体搬目录、新建=单文件写）。
➡️ 推荐共享校验、不共享写入。

**Q7 — 新建工具的产出**（若模型起草成立，工具参数）：只写单个 `SKILL.md`（参数 `{ name, description, whenToUse?, body, scope?, cwd? }`，省略调用键=默认启用）？还是也携带资源文件？
➡️ 推荐**单 SKILL.md**（资源走导入通道）。

## 备注

- 领域词汇将随决策确认同步进 `CONTEXT.md`（如：技能包、导入技能、创建技能、合法技能）。
- 实现决策落 `docs/adr/`（如"为何创建走 preset agent 而非全局工具"）。