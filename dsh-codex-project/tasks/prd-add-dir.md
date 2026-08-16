# PRD: dsh-codex-project add-dir 化改造（减负）

## Introduction

`dsh-codex-project` 当前实现的是"工作区共享配置"模型：一条空间记录（id/workspaceId/title/roots[0] 主根 + 共享子目录）、主工作区设为主/交接、管理弹窗、CRUD API、旧格式迁移、失效根收窄与清理。用户实际想要的本质是 **Claude Code `/add-dir` 的效果**：会话里把某个目录加进来，这个会话（及该工作区后续会话）就能读写它——简单、按需、立即生效。

本次改造给插件**减负**：砍掉共享配置模型的所有衍生物，保留安全底层（多根 runner / fs fence / 空间 SID）与 UI 入口（管理弹窗），把数据模型简化为"工作区 → 附加可写目录数组"，并新增模型可调用的 add-dir 工具（用户确认后生效）。

## Goals

- 插件效果对齐 Claude Code `/add-dir`：把目录加入工作区可写集合，立即生效、无需重启
- 数据模型从"空间记录"简化为"工作区 → 附加目录数组"
- 删除共享配置模型的衍生物：主工作区/设为主/交接、迁移机制、失效根收窄/清理、CRUD API 语义
- 保留安全底层与 UI：多根 runner、fs fence、空间 SID、管理弹窗（简化）
- 新增 add-dir 工具：模型请求 + 用户确认（approval）→ 写入可写集合
- 全部现有测试重写/新增后通过（typecheck / test / build / proto:verify）

## User Stories

### US-001: 数据模型简化为"工作区 → 附加目录数组"
**Description:** As a developer, I want the plugin's persisted model to be a plain workspace→directories mapping so that no space/anchor/main-root concepts exist.

**Acceptance Criteria:**
- [ ] 配置文件结构为 `{ "workspaces": { "<workspaceId>": ["<dir>", ...] } }`，不再有 `spaces` 数组与 `id/title/roots` 记录
- [ ] 原 `space-config.ts` / `space-store.ts` 中所有 `SpaceRecord`/`SpaceMatch`/主根/锚点概念从代码中消失
- [ ] 写入时校验每个目录存在且是目录（主动操作 fail loud 保留）
- [ ] 缺省文件 = 无配置 = 纯透传
- [ ] Typecheck passes

### US-002: add-dir 工具（模型请求 + 用户确认）
**Description:** As a user, I want the model to be able to add a directory to the current workspace's writable set, with my confirmation, so that I can grant access mid-conversation like Claude Code `/add-dir`.

**Acceptance Criteria:**
- [ ] 注册一个模型可见工具（如 `add-dir`），参数为绝对路径
- [ ] 工具执行先走 `ctx.approval.request()`：用户拒绝则返回拒绝结果、不写入
- [ ] 用户批准后：路径必须存在且是目录，否则返回错误、不写入
- [ ] 批准成功后目录加入**当前会话所属工作区**的附加目录列表并持久化
- [ ] 添加后该会话立即能读写该目录（fs fence 与 runner 下次调用即生效，无需重启）
- [ ] Typecheck passes

### US-003: 管理弹窗保留并简化
**Description:** As a user, I want the existing 管理工作区 dialog to manage the workspace's additional directories (add/remove) without any main-workspace or handover concepts.

**Acceptance Criteria:**
- [ ] 弹窗显示：工作区自身路径 + 附加目录列表（可移除）+ 添加按钮
- [ ] 移除"设为主工作区"按钮、主根/共享子目录的视觉区分、"此工作区作为共享子目录属于"分支
- [ ] 添加目录使用原生目录选择器，重复添加被忽略
- [ ] 空列表时显示空状态文案
- [ ] Typecheck passes
- [ ] Verify in a browser (via the `run` skill)

### US-004: 上下文提醒简化 + 变更时重新注入
**Description:** As a user, I want the session context reminder to list the workspace's writable directories (workspace root + added dirs) so the model knows the boundary — and to be refreshed whenever the directory set changes mid-session, so the model always sees the current boundary.

**Acceptance Criteria:**
- [ ] `<system-reminder>` 列出工作区路径与全部附加目录，当前工作区标记不变
- [ ] 无附加目录时不注入提醒（与现状一致：纯透传）
- [ ] 移除失效根标注（`⚠ directory missing`）与相关文案
- [ ] 提醒注入从"每会话一次性"改为"幂等去重"：每次 pre-step 比较当前提醒文本与面上已有的本插件提醒，不同才注入
- [ ] 首次 user 消息注入当前清单（行为与现状一致）
- [ ] 会话中途附加目录变更（add-dir 工具批准 或 弹窗添加/移除）后，该会话下一条 user 消息重新注入更新后的清单
- [ ] 无变更时后续 user 消息不重复注入（面上已有相同提醒）
- [ ] 恢复的会话：面上提醒与当前清单不同时（目录已变）重新注入，相同时不重复
- [ ] 折叠时机（紧跟 claimed 批次后）/顺序语义不变
- [ ] Typecheck passes

### US-005: 删除共享配置衍生物
**Description:** As a developer, I want all space-record machinery removed so the plugin is small and maintainable.

**Acceptance Criteria:**
- [ ] 删除 `space-migration.ts`（迁移机制）及其调用
- [ ] 删除失效根收窄/清理整套逻辑：`missingRoots` 派生、`allowMissingRoots`、清理按钮与 API 语义
- [ ] API 简化为最小面：读某工作区目录列表 + 替换该工作区列表（无 create/delete 空间、无锚点）
- [ ] 删除"设为主/交接"全部代码与文案
- [ ] 仓库中不再出现 `space`/`Space`（空间记录语义）命名
- [ ] Typecheck passes

### US-006: 安全底层在新模型下工作
**Description:** As a developer, I want the multi-root runner, fs fence, and space SID to keep working under the simplified model.

**Acceptance Criteria:**
- [ ] runner/fs fence 的可写根 = 工作区路径 + 附加目录（现存者）
- [ ] 空间 SID 改为按工作区派生（同工作区跨会话一致，跨工作区隔离）
- [ ] 会话 cwd 不在任何工作区 → 纯透传（core 行为不变）
- [ ] 单目录工作区（无附加）→ 纯透传
- [ ] proto:verify 全绿（真实 Windows ACL：全部可写根可写、外部目录 denied）

### US-007: 测试重写与新增
**Description:** As a developer, I want the test suite to cover the new model and contract.

**Acceptance Criteria:**
- [ ] spaces-api.spec / fs-fence.spec / seam-wiring.spec / context-injection.spec 按新模型重写
- [ ] 删除 space-migration.spec；删除失效根/allowMissingRoots 相关用例
- [ ] 新增 add-dir 工具用例：批准路径生效、拒绝不写入、非法路径报错
- [ ] 新增：工作区匹配（cwd → workspaceId）用例
- [ ] `pnpm --dir dsh-codex-project test` 全绿

### US-008: 文档更新
**Description:** As a developer, I want README/CONTEXT/ADR to reflect the add-dir model.

**Acceptance Criteria:**
- [ ] README 重写：add-dir 语义、新配置文件结构、最小 API、安全模型不变部分保留
- [ ] CONTEXT.md 术语更新：删除空间相关术语，新增"附加可写目录"等
- [ ] 新增 ADR 记录本次模型简化（或更新既有 ADR 为最终形态）
- [ ] 版本记录追加 0.9.0 条目

## Functional Requirements

- FR-1: 系统必须以 `{ "workspaces": { "<workspaceId>": ["<dir>", ...] } }` 结构持久化附加目录
- FR-2: 系统必须提供模型可见的 `add-dir` 工具（参数：绝对路径）
- FR-3: 系统必须在 `add-dir` 写入前向用户发起 approval 请求，拒绝时不写入
- FR-4: 系统必须在写入前校验路径存在且是目录，非法路径返回错误
- FR-5: 系统必须把批准后的目录加入当前会话所属工作区的附加目录列表
- FR-6: 系统必须让 fs fence 与 runner 在添加后立即放行新目录（无状态重读配置）
- FR-7: 系统必须提供最小 API：GET 某工作区附加目录列表、PUT 替换该工作区列表
- FR-8: 系统必须让管理弹窗列出工作区路径与附加目录并提供添加/移除
- FR-9: 系统必须对命中工作区的会话注入 `<system-reminder>` 目录清单（工作区 + 附加目录）
- FR-10: 系统必须对会话 cwd 不在任何工作区或无附加目录的会话保持纯透传
- FR-11: 系统必须在附加目录集合变更（add-dir 工具批准写入或 API 替换）后，让该工作区会话的下一条 user 消息重新注入更新后的目录清单
- FR-12: 系统必须保证提醒注入幂等：面上已存在与当前清单相同的提醒时不重复注入

## Non-Goals

- 不做跨会话独立列表（列表属于工作区，同工作区会话共享——与 Claude Code additionalDirectories 一致）
- 不做主工作区/设为主/交接
- 不做失效根的自动标注与清理 UI（目录没了写入自然失败，匹配时跳过即可）
- 不做只读共享目录（所有附加目录可读写）
- 不做管理弹窗之外的设置页
- 不修改 dsh 核心（sandbox/fs/session）任何代码

## Design Considerations

- 管理弹窗沿用现有 `WorkspaceDialog` 的注入方式（工作区「…」菜单）与样式体系（`styles.ts`）
- 交互入口双通道：模型 add-dir 工具 + 弹窗手动添加（用户已确认"两者都要"）
- 文案保持中文 UI / 英文模型提醒的现状约定

## Technical Considerations

- **工具注册**：`ctx.tools.register(defineTool(...))`（`@deepseek-ai/dsh-tools`）；执行内 `ctx.approval.request({ agent, reason, ... })` 获得 `ApprovalOutcome`
- **匹配逻辑**：会话 cwd（canonical）→ workspaceRegistry 中 path 相等的工作区 → 该工作区的附加目录；`tryCanonicalDirectory` 跳过缺失目录（容错，不抛错、不标注）
- **SID 派生**：`workspaceWriteSid(join(configDir, 'workspaces', workspaceId))`——按工作区身份派生，同工作区跨会话一致
- **依赖变化**：peerDependencies 增加 `@deepseek-ai/dsh-tools` 与 `@deepseek-ai/dsh-user-approval`；删除迁移/空间相关内部模块
- **runner 独立进程**：`lib/runner.js` 读取同一配置文件与 workspaceRegistry 映射（runner 需能按路径找到工作区——配置中直接存 workspaceId→dirs，runner 通过 cwd 反查）
- **变更注入机制**：`foldSpaceContext` 的 `foldedSessions`（WeakSet 一次性标记）改为按提醒文本幂等——pre-step 每次计算当前提醒，与面上已有本插件提醒（`hasIdenticalInjection`）比较，不同才注入；变更（add-dir 写入 / API 替换）天然使文本变化，下一次 user 消息自动重新注入，无需显式事件或变更通知

## Success Metrics

- 从"配置一个共享目录"到"会话可写"的操作步数：1 步（模型请求→确认 或 弹窗添加）
- 插件源码行数与文件数显著下降（删除空间/迁移/失效根/交接逻辑）
- typecheck / test / build / proto:verify 全绿
- 既有工作区（deepseek-harness-plugins、pigo、ams）在新模型下可写集合行为与改造前一致

## Open Questions

- [Assumption] **旧配置迁移**：现有 `spaces.json` 的 3 条空间记录（AionUi/ams、deepseek-harness-plugins、pigo）默认**一次性迁移**为新的 `workspaces` 结构（每条记录的 roots 拍平为对应 workspaceId 的 dirs，主根并入工作区自身、不再单独列出）；也可以选择直接废弃旧配置让用户重新添加——待用户确认
- [Assumption] **命名**：工具名暂定 `add-dir`，配置文件名沿用 `~/.dsh-codex-project/`（键从 `spaces` 改为 `workspaces`）；待用户确认
- 附加目录数量上限是否需要？（默认不设限，按 Claude Code 惯例）
