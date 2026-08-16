# ADR-0002: 模型简化为 add-dir 语义（工作区 → 附加可写目录）

- 状态：已采纳（0.9.0）
- 日期：2026
- 涉及：dsh-codex-project（附加可写目录插件）

## 背景

0.8.x 的 `dsh-codex-project` 实现的是"工作区共享配置（空间记录）"模型：一条空间记录含 id/workspaceId/title/roots[0] 主根 + 共享子目录、设为主交接、管理弹窗、CRUD API、旧格式迁移、失效根收窄与清理。该模型比用户实际需要的复杂得多。用户明确：**插件本质效果应等价 Claude Code `/add-dir`**——会话（及其工作区）把某个目录加进来就能读写，简单、按需、立即生效；UI 需要保留但同样只做 add-dir 的事。

## 决策

把插件**减负**为 add-dir 语义：

1. **数据模型**：`{ "workspaces": { "<id>": { path, dirs } } }`——工作区 → 附加可写目录数组；删除空间记录、主根/共享子目录之分、锚点。
2. **删除**：设为主/交接、迁移机制（保留旧格式一次性迁移到新模型）、失效根收窄/清理管理面、`/spaces` CRUD API、主根视觉区分。
3. **新增**：`add-dir` 模型工具——`defineTool` + `ctx.approval.request` 用户确认后把目录加入当前会话所属工作区的可写集合并持久化；确认弹窗与审计由 dsh 核心提供，插件零确认 UI。
4. **保留（安全地基）**：多根 runner、fs fence、工作区级 SID——Windows 下 workspace-write 多目录可写的唯一安全实现，不对模型外暴露。
5. **匹配简化**：会话 cwd → workspaceRegistry path 相等 → 工作区记录 → 可写根 `[path, ...dirs]`；缺失目录静默跳过（无失效管理面）。
6. **提醒按文本幂等**：去掉每会话一次性标记，改为内容幂等——首注入、目录变更后重注入、无变更不重复（变更无需显式事件，文本变化即触发）。
7. **API 最小化**：GET/PUT `/codex-project/api/dirs`（读 + 全量替换）。

## 备选方案与取舍

| 方案 | 结论 | 理由 |
|---|---|---|
| 保留空间记录模型（现状） | 拒绝 | 臃肿；主根/设为主/迁移/失效根全是共享配置语义，不是用户要的 |
| 新建独立插件 | 拒绝 | 安全地基（runner/fence/SID）高度复用，改造现有插件成本最低 |
| 纯会话级（不持久） | 拒绝 | 管理弹窗需要管理持久列表；与 dsh 工作区级共享一致（同工作区会话共享） |
| 自动清理失效目录 | 拒绝 | 用户数据不可静默改写（可能暂时掉盘） |

## 依据

- 用户需求：add-dir 效果（Claude Code `/add-dir`），保留 UI；
- 对齐 dsh 核心哲学：被动失效保留 + 降级 + warn，不 fail loud、不自动删；
- 复用安全底层：runner/fence/SID 是 Windows workspace-write 多目录的唯一可靠实现，与模型无关。

## 影响

- `src/space-config.ts` / `space-store.ts` / `spaces-api.ts` / `space-migration.ts` 删除，`dirs-config.ts` / `dirs-store.ts` / `dirs-api.ts` / `add-dir.ts` / `dirs-migration.ts` 新增；
- fs/seam/runner 改按 `matchingWorkspace`（path → workspaceId）路由，SID 按 workspaceId 派生；
- client 弹窗只管理附加目录，删除主工作区/设为主语义；
- 旧 `spaces.json` 启动时一次性迁移，保留备份。
