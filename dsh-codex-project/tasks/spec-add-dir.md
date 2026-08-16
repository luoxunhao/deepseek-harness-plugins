# SPEC: dsh-codex-project add-dir 化改造（减负）

> Technical specification derived from: `tasks/prd-add-dir.md`
> Generated: 2026-08-16 | Target: `dsh-codex-project` 0.9.0

## 1. Summary

### 1.1 What This SPEC Covers

把 `dsh-codex-project` 从"工作区共享配置（空间记录）"模型重构为 Claude Code `/add-dir` 语义：持久化模型简化为 `{ "workspaces": { "<workspaceId>": ["<dir>", ...] } }`，新增模型可调用的 `add-dir` 工具（经 `ctx.approval.request` 用户确认后把目录加入当前会话所属工作区），管理弹窗保留但砍掉主工作区/设为主/交接语义，删掉空间记录、迁移、失效根收窄/清理与 CRUD API 语义，安全底层（多根 runner / fs fence / 空间 SID）保留并改为按工作区派生。上下文提醒从"每会话一次性"改为"按文本幂等"，目录变更后自动重新注入。

### 1.2 PRD Reference

- Source: `tasks/prd-add-dir.md`
- User Stories covered: US-001 ～ US-008
- Functional Requirements covered: FR-1 ～ FR-12

### 1.3 Design Decisions Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| 持久化模型 | `{ "workspaces": { id: [dirs] } }`，键 = workspaceId | 与 dsh workspace 身份绑定；runner 通过 workspaceRegistry 反查 path→id（见 2.3） |
| add-dir 确认 | 工具执行内 `ctx.approval.request({ agent, toolName: 'add-dir', reason })` | 复用 dsh 现成审批链路；`'allowed-once'` 才写入，`'rejected'/'cancelled'/'unavailable'` 均不写入 |
| 匹配逻辑 | cwd canonical → registry path 相等 → 工作区 dirs | 与现有空间匹配同构，只是把"空间 roots"换成"工作区 path + dirs" |
| SID 派生 | `workspaceWriteSid(join(configDir, 'workspaces', workspaceId))` | 同工作区跨会话一致、跨工作区隔离；runner 与 host 共用 space-sid 模块 |
| 缺失目录容错 | `tryCanonicalDirectory` 跳过，不抛错不标注 | 目录事后消失 = 写入自然失败；不再有失效根管理面 |
| 提醒注入 | 每次 pre-step 按文本幂等（比较面上已有提醒），去掉 foldedSessions 一次性标记 | 变更使文本变化 → 自动重新注入；无变更不重复 |
| API | GET/PUT `/codex-project/api/dirs?workspaceId=` | 最小面：读 + 替换列表；删 create/delete 空间语义 |
| 旧配置 | 一次性迁移 `spaces[]` → `workspaces{}`（见 3.4） | 保留用户现有可写集合，零手动重配 |

---

## 2. Architecture

### 2.1 System Context

```
dsh web host (Node)                              client (browser)
┌─────────────────────────────────────┐          ┌──────────────────┐
│ ctx.fs = CodexProjectFileSystem     │          │ 「…」菜单注入      │
│   (fence: 工作区 path + dirs 可写)   │          │  - 打开本地目录   │
│ ctx.sandbox.confine → seam → runner │◀─confine─│  - 管理工作区    │
│   (受限令牌 + 工作区 SID ACE)        │          │ WorkspaceDialog   │
│ /codex-project/api/dirs (GET/PUT)   │◀─fetch───│  (目录列表/增删)  │
│ add-dir tool (tools.register)       │          └──────────────────┘
│ agent/pre-step → 提醒按文本幂等注入   │
│ workspaceRegistry (path↔id 反查)     │
│ ~/.dsh-codex-project/dirs.json      │
└─────────────────────────────────────┘
```

### 2.2 Component Design

| 模块 | 职责 | 变化 |
|------|------|------|
| `dirs-config.ts`（新，替代 space-config.ts） | 配置文件读写、`loadWorkspaceDirs`、`matchingWorkspace(cwd)`、`tryCanonicalDirectory` 保留 | 重写 |
| `dirs-store.ts`（新，替代 space-store.ts） | 原子写 `dirs.json`、validate（目录存在）、队列串行化 | 重写 |
| `dirs-api.ts`（新，替代 spaces-api.ts） | GET/PUT `/dirs` 纯函数路由 | 重写 |
| `add-dir.ts`（新） | `defineTool({ name: 'add-dir' })` + approval 流程 | 新增 |
| `seam.ts` | confine 路由改为"工作区多目录"判定 | 修改 |
| `runner.ts` | `runWorkspaceBranch`：可写根 = path + dirs，SID 按工作区 | 修改 |
| `fs.ts` | `writableRootsFor` 用工作区 dirs | 修改 |
| `context-injection.ts` | 提醒按文本幂等（去 foldedSessions） | 修改 |
| `space-sid.ts` | 改为 `workspaceWriteSid(join(configDir, 'workspaces', id))` | 修改 |
| `index.ts` | 路由、pre-step、tools.register、seam 接线、旧配置迁移 | 修改 |
| `space-migration.ts` | — | **删除** |
| `space-config.ts` / `space-store.ts` / `spaces-api.ts` | — | **删除** |
| client：`api.ts` / `workspace-dialog.tsx` / `workspace-menu.ts` / `styles.ts` / `index.tsx` | 弹窗简化：工作区 + 附加目录增删 | 修改 |

### 2.3 Module Interactions

**关键难点：runner 是独立进程，没有 workspaceRegistry 服务。** 解决方案：runner 的 argv 已经携带 `--bind <workspace>`（canonical 路径），runner 先 `matchingWorkspaceByPath(loadWorkspaceDirs(), canonicalWorkspace)`——但配置文件键是 workspaceId，路径反查需要 registry。

因此配置文件**同时携带 path**，形状为：

```json
{
  "workspaces": {
    "<workspaceId>": {
      "path": "E:\\project\\deepseek-harness",
      "dirs": ["E:\\project\\shared-lib", "D:\\docs"]
    }
  }
}
```

- **host 侧匹配**：会话 cwd → `workspaceRegistry`（path 相等）→ workspaceId → 配置中的 dirs
- **runner 匹配**：`--bind` 路径 → 遍历配置，找到 `path` 相等（canonical）的记录 → 可写根 = [path, ...dirs]
- 两处共用 `canonicalPath`/`tryCanonicalDirectory`，避免大小写/符号链接漂移

**add-dir 数据流**：模型调用 → `defineTool.execute` → 参数校验（绝对路径）→ `ctx.approval.request({ agent: exec.caller, toolName: 'add-dir', reason: \`add ${path} to writable dirs\` })` → `'allowed-once'` → 校验目录存在 → `dirsStore.add(workspaceId, path)` → 返回结果。随后该会话下一条 user 消息 pre-step 时，提醒文本已变化 → 重新注入。

**确认交互窗口归属（重要）**：审批弹窗**由 dsh 核心提供，插件不实现任何确认 UI**。`ctx.approval.request()` 触发 host 的 `approval/requested` 事件 → client runtime（`dsh-client-runtime`）mint `PendingWait('approval')` → dsh GUI 渲染允许/拒绝弹窗 → `approval/resolved` 回传 `ApprovalOutcome`。插件仅发起请求并消费结果；审批的 UI、审计（`approval/asked` + `approval/decided` 会话日志事件）均为核心能力。

### 2.4 File Structure

```
src/
├── dirs-config.ts        [NEW]  (替代 space-config.ts)
├── dirs-store.ts         [NEW]  (替代 space-store.ts)
├── dirs-api.ts           [NEW]  (替代 spaces-api.ts)
├── add-dir.ts            [NEW]
├── index.ts              [MODIFY]
├── seam.ts               [MODIFY]
├── runner.ts             [MODIFY]
├── fs.ts                 [MODIFY]
├── context-injection.ts  [MODIFY]
├── space-sid.ts          [MODIFY]
├── open-directory.ts     [keep]
├── containment.ts        [keep]
├── space-config.ts       [DELETE]
├── space-store.ts        [DELETE]
├── spaces-api.ts         [DELETE]
├── space-migration.ts    [DELETE]
└── client/
    ├── api.ts                    [MODIFY]
    ├── workspace-dialog.tsx      [MODIFY]
    ├── workspace-menu.ts         [MODIFY (keep 打开本地目录 + 管理工作区)]
    ├── styles.ts                 [MODIFY]
    ├── context.ts                [keep]
    ├── paths.ts                  [keep]
    └── index.tsx                 [MODIFY]
tests/
├── dirs-api.spec.ts      [NEW]
├── add-dir.spec.ts       [NEW]
├── fs-fence.spec.ts      [MODIFY]
├── seam-wiring.spec.ts   [MODIFY]
├── context-injection.spec.ts [MODIFY]
├── space-migration.spec.ts [DELETE]
├── spaces-api.spec.ts    [DELETE]
└── client-*.spec.tsx     [MODIFY]
scripts/proto-verify.mjs  [MODIFY: E 段改工作区收窄断言]
cordis.patch.yml          [MODIFY: 注释更新]
```

---

## 3. Data Model

### 3.1 Schema Changes

配置文件 `~/.dsh-codex-project/dirs.json`（环境变量 `DSH_CODEX_PROJECT_CONFIG` 可覆盖）：

```json
{
  "workspaces": {
    "<workspaceId>": {
      "path": "<canonical main workspace path>",
      "dirs": ["<absolute dir 1>", "<absolute dir 2>"]
    }
  }
}
```

- 缺省文件 = 无配置 = 纯透传
- `path` 为记录创建/迁移时的 canonical 路径（registry 同步时更新）
- `dirs` 为附加可写目录（含跨盘），顺序无关、去重（写入时按 canonical 去重）

### 3.2 Entity Definitions

```ts
/** One workspace's additional writable directories. */
export interface WorkspaceDirs {
  /** Canonical main workspace path (matching anchor for the runner). */
  path: string
  /** Additional writable directories (absolute, may cross drives). */
  dirs: string[]
}

/** The persisted file shape. */
export interface DirsConfigFile {
  workspaces: Record<string, WorkspaceDirs>
}

/** A resolved match: the owning workspace + its writable root set. */
export interface WorkspaceMatch {
  workspaceId: string
  /** Canonical surviving writable roots: path + existing dirs. */
  roots: string[]
  /** dirs that no longer exist (skipped, never failing). */
  missingDirs: string[]
}
```

### 3.3 Relationships

- 工作区（workspaceId）1—1 配置记录；记录包含 path（主工作区目录）与 N 个附加目录
- 会话的可写集合 = 其 cwd 命中记录的 `[path, ...dirs]`（现存者）
- 不再有"主根/共享子目录"之分：path 与 dirs 平等

### 3.4 Migration Plan

启动时（`index.ts` apply 内）执行一次性迁移 `migrateSpacesToDirs(ctx.workspaceRegistry)`：

1. 若 `dirs.json` 已存在 → 跳过（迁移幂等：写后置标记或直接检查目标文件存在）
2. 读取旧 `spaces.json`（`{ spaces: [{ workspaceId?, roots, title }] }`）
3. 对每条记录：workspaceId 缺失 → 用 roots 中与 registry 匹配的 path 反查；仍无 → 丢弃并 warn
4. 新记录 = `{ path: roots[0], dirs: roots.slice(1) }`（roots[0] 是原主根；共享子目录变 dirs）
5. 原子写入 `dirs.json`；旧文件保留为备份（不删除）

回滚：删除 `dirs.json` 即回旧格式（迁移不再触发）。

---

## 4. API Design

### 4.1 Endpoints

| Method | Path | Description | Request | Response |
|--------|------|-------------|---------|----------|
| GET | `/codex-project/api/ping` | 挂载冒烟 | — | `{ ok: true, plugin }` |
| GET | `/codex-project/api/dirs?workspaceId=<id>` | 读某工作区附加目录 | — | `{ ok: true, dirs: string[] }` |
| PUT | `/codex-project/api/dirs` | 替换某工作区附加目录（弹窗增删走全量替换） | `{ workspaceId, dirs: string[] }` | `{ ok: true, dirs }` |
| POST | `/codex-project/api/open-directory` | 打开本地目录（保留，不改） | `{ path }` | `{ ok: true }` |

- 删除：`/spaces` CRUD、`:id` 变体、`allowMissingRoots` 语义
- 404/405 语义沿用现有 spaces-api 处理

### 4.2 Request/Response Schemas

GET 响应示例：

```json
{ "ok": true, "dirs": ["E:\\project\\shared-lib", "D:\\docs"] }
```

PUT 请求：

```json
{ "workspaceId": "2995ec2d-b5c1-4fec-b461-d43224c5fe59", "dirs": ["E:\\project\\shared-lib"] }
```

PUT 校验：workspaceId 非空字符串；dirs 为字符串数组（可为空=清空附加）；**每个 dir 必须存在且是目录**（主动操作 fail loud，与 PRD US-001 一致）；重复路径去重；写入后按 canonical 排序存储。

### 4.3 Error Responses

| 条件 | Status | Body |
|------|--------|------|
| 非法 body / workspaceId 空 | 400 | `{ ok: false, error }` |
| dir 不存在或非目录 | 400 | `{ ok: false, error: "space root is not an existing directory: <p>" }`（文案改为 dir 语义） |
| 未知方法/路由 | 405/404 | `{ ok: false, error }` |

### 4.4 Breaking Changes

- `/codex-project/api/spaces*` 全部移除 → client 与外部消费者需改用 `/dirs`；插件 client 同步更新
- 配置文件结构变更，由一次性迁移承接；旧文件保留备份

---

## 5. Business Logic

### 5.1 Core Algorithms

**工作区匹配（host 侧，fs fence / seam / context 共用单一来源）：**

```
matchingWorkspace(cwd):
  canonicalWorkspace = requireCanonicalDirectory('session workspace', cwd)
  for each (workspaceId, record) in loadWorkspaceDirs():
    if canonicalPath(record.path) == canonicalWorkspace:
      roots = [canonicalWorkspace, ...record.dirs.filter(exists)]
      return { workspaceId, roots, missingDirs }
  return undefined
```

判定条件（与现状一致的纯透传分界）：命中记录且 `dirs.length >= 1` → 多目录语义生效；否则（无命中 / dirs 为空）→ core 单根行为。

**add-dir 工具流程：**

```
add-dir.execute({ path }, exec):
  if !isAbsolute(path): return error
  approval = ctx.approval.request({ agent: exec.caller, toolName: 'add-dir', reason })
  if approval != 'allowed-once': return { ok: false, reason: approval }
  workspaceId = resolveWorkspaceId(exec)      # 会话 cwd → registry
  if workspaceId == undefined: return { ok: false, reason: 'session not in a workspace' }
  if !isDirectory(path): return { ok: false, reason: 'not an existing directory' }
  dirsStore.add(workspaceId, path)            # 去重 + 原子写
  return { ok: true, dirs: <new list> }
```

**提醒按文本幂等注入（context-injection）：**

```
foldSpaceContext(decision, claimed, session):
  if decision.kind != 'enter' or claimed.empty: return decision
  reminder = computeWorkspaceReminder(session.cwd)
  if reminder == undefined: return decision
  if hasIdenticalInjection(session, reminder): return decision   # 面上已有同文本
  insert after claimed batch
```

去掉 `foldedSessions` WeakSet 一次性标记——幂等由 `hasIdenticalInjection` 单独承担（首次：面上无 → 注入；变更后：文本不同 → 注入；无变更：相同 → 跳过；恢复会话：旧文本 vs 新文本 → 差异才注入）。

### 5.2 Validation Rules

- add-dir 参数：字符串、绝对路径（`isAbsolute`）
- 写入前：`statSync(path).isDirectory()`（存在且目录）
- PUT dirs：同上逐项校验；空数组合法（清空）
- workspaceId：必须存在于 registry（host 侧）或配置（runner 侧）

### 5.3 State Machine

不适用（无状态机；写入即持久化）。

### 5.4 Edge Cases

| 场景 | 处理 |
|------|------|
| 添加已存在的目录 | 去重，返回当前列表（幂等） |
| 添加工作区自身 path | 允许但视为去重（path 已在可写根） |
| 添加后目录被删 | 匹配时 `tryCanonicalDirectory` 跳过 → 写入失败；不抛错不标注 |
| 会话 cwd 不在任何工作区 | add-dir 拒绝（无法确定归属）；fs/seam/context 纯透传 |
| 工作区 path 目录被删（注册记录还在） | host 匹配失败 → 纯透传；runner 匹配失败 → 回退 delegation（core 行为） |
| 两工作区 path 相同 | 不可能（registry 唯一）；配置内靠 workspaceId 键去重 |
| 同一目录被两个工作区添加 | 各自记录独立（与现状"配置层互斥"不同的简化——允许重叠，无歧义） |
| PUT 清空 dirs | 记录保留 path、dirs=[] → 纯透传（不删除记录，避免 UI 状态丢失） |
| approval 无 answerer | `'unavailable'` → fail closed，不写入 |

---

## 6. Error Handling

### 6.1 Error Taxonomy

| Error | Status/Code | Condition | Message |
|-------|-------------|-----------|---------|
| `invalid` | 400 | 参数/body 形状错误 | 具体字段说明 |
| `not-found` | 404 | workspaceId 未知 | `no workspace <id>` |
| `invalid-dir` | 400 | 目录不存在/非目录 | `not an existing directory: <p>` |
| `not-in-workspace` | 工具返回 | 会话 cwd 无归属 | `session is not inside a registered workspace` |
| `denied` | 工具返回 | approval 非 allowed-once | `approval <outcome>` |

### 6.2 Retry Strategy

add-dir 可重试（幂等，重复添加去重）；PUT 可重试（全量替换）。

### 6.3 Failure Modes

- runner 匹配不到记录 → 回退 core delegation（受限单根，绝不非受限 spawn——失败契约保留）
- 配置 JSON 损坏 → `loadWorkspaceDirs` fail loud（与现状一致：损坏文件 = 配置错误，警告用户修复）
- 迁移失败 → warn 并继续（插件以无配置状态运行）

---

## 7. Security

### 7.1 Authentication & Authorization

- API：loopback Host 守卫不变（`isLoopbackRequest`）
- add-dir：`ctx.approval.request` 用户确认；`'unavailable'` fail closed
- 工作区 SID 隔离：跨工作区令牌互不可用（保留现有机制）

### 7.2 Input Validation

- 所有路径：绝对路径校验 + 存在性校验（API/工具/迁移三处一致）
- 路径仅作目录授权，不拼接执行

### 7.3 Data Protection

- 配置文件仅记录目录路径（非敏感）；不记录内容
- 审计：approval 的 `approval/asked` + `approval/decided` 事件自动落会话日志（dsh 原生）

---

## 8. Performance

### 8.1 Expected Load

个人使用规模：配置 < 100 条工作区、每工作区 < 20 dirs；每次受限操作读一次文件（无状态，与现状一致）。

### 8.2 Optimization Strategy

不引入缓存——配置小、无状态重校验是正确性前提（目录恢复即重新可写）。若未来配置变大，可加 mtime 缓存（不在本次范围）。

### 8.3 Database Considerations

不适用（JSON 文件）。

---

## 9. Testing Strategy

### 9.1 Unit Tests

- `dirs-config.spec`：文件读写、canonical 匹配、缺失目录跳过、损坏文件 fail loud
- `add-dir.spec`：approval 各 outcome 分支（allowed-once 写入 / rejected 不写 / unavailable fail closed）、非法路径、非工作区会话、幂等去重
- `context-injection.spec`：按文本幂等——首次注入、变更后重注入、无变更不重复、恢复会话差异注入

### 9.2 Integration Tests

- `dirs-api.spec`：GET/PUT 语义、校验、404/405、持久化
- `fs-fence.spec`：工作区 path + dirs 可写、外部 denied、无附加目录纯透传、目录删除后收窄（无抛错）
- `seam-wiring.spec`：命中多目录工作区走 runner、无关工作区隔离、单目录纯透传

### 9.3 Edge Case Tests

- 添加已存在目录（幂等）
- 添加工作区自身 path
- PUT 清空 dirs → 纯透传
- 工作区 path 目录消失 → runner 回退 delegation
- proto-verify：E 段改为"工作区 A + 附加目录 B 可写、外部 denied"（真实 Windows ACL）

### 9.4 Acceptance Criteria Mapping

| US | Test | Type |
|----|------|------|
| US-001 | dirs-config.spec：结构/校验/fail loud | unit |
| US-002 | add-dir.spec：approval 全分支 | unit |
| US-003 | client-components.spec.tsx：弹窗增删、无设为主 | unit (jsdom) + browser |
| US-004 | context-injection.spec：幂等注入/变更重注入 | unit |
| US-005 | 删除 spaces-*/migration 相关文件与用例（编译即验证） | build |
| US-006 | fs-fence / seam-wiring / proto-verify | unit + integration |
| US-007 | 全测试套件 | — |
| US-008 | 文档审阅 | manual |

---

## 10. Implementation Plan

### 10.1 Phases

1. **模型层**：`dirs-config.ts` + `dirs-store.ts`（含迁移函数）+ 删除旧 space-* 模块
2. **匹配层**：`space-sid.ts` 改工作区派生；`fs.ts` / `seam.ts` / `runner.ts` 改用新匹配
3. **提醒层**：`context-injection.ts` 按文本幂等（去 foldedSessions）
4. **工具层**：`add-dir.ts`（tools.register + approval）+ `index.ts` 接线（路由 + 迁移 + 工具）
5. **API 层**：`dirs-api.ts` GET/PUT + client `api.ts` 同步
6. **UI 层**：`workspace-dialog.tsx` 简化 + `workspace-menu.ts`/`styles.ts` 清理
7. **测试**：重写 + 新增 + 删除旧用例
8. **文档**：README / CONTEXT / ADR / 版本记录

### 10.2 Issue Mapping

| Issue | SPEC Sections | Priority | Depends On |
|-------|--------------|----------|------------|
| #1 模型层 | 2.4, 3.1–3.4 | high | — |
| #2 匹配层 | 2.3, 5.1 | high | #1 |
| #3 提醒幂等 | 5.1, 9.1 | medium | #1 |
| #4 add-dir 工具 | 5.1, 7.1 | high | #1, #2 |
| #5 API + client api | 4.1–4.4 | medium | #1 |
| #6 UI 弹窗简化 | 2.4 | medium | #5 |
| #7 测试 | 9.1–9.4 | high | #1–#6 |
| #8 文档 | 2.4 | low | #1–#6 |

### 10.3 Incremental Delivery

单插件改造，无功能开关：一次提交落地（版本 0.9.0）；迁移在启动时自动执行，旧文件留备份，可回滚。

---

## 11. Open Questions & Risks

### 11.1 Unresolved Questions

- 工具名 `add-dir` 是否与 dsh 其他命令/工具冲突（仓库内无同名，待最终确认）
- 弹窗中"添加目录"沿用现有原生 picker（`workspaces.pickDirectory`）——确认无路径输入需求

### 11.2 Technical Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| 配置键 workspaceId + path 双字段漂移（registry 改名后 path 过期） | 匹配失败 → 纯透传（安全降级，非越权） | 迁移与 PUT 写入时同步 registry 的 path；runner 匹配失败回退 delegation |
| 去掉 foldedSessions 后每次 pre-step 都读配置 | 每步一次小文件读，开销可忽略 | 无状态正确性优先；如需要再缓存 |
| approval `'unavailable'`（无 answerer） | add-dir 拒绝 | fail closed 正确；UI 弹窗仍可手动添加（双通道互补） |
| 旧配置迁移丢记录（无 workspaceId 且 roots 无 registry 匹配） | 该空间配置丢失 | warn 日志明确列出；旧文件留备份可手动恢复 |

### 11.3 Assumptions

- workspaceRegistry 提供 `list(): { id, path }[]`（现状已用）且 path 为 canonical
- `ctx.approval` 在插件 inject 后可用（`@deepseek-ai/dsh-user-approval` 为 peerDependency）
- `ctx.tools` 服务存在（`@deepseek-ai/dsh-tools` 为 peerDependency）；`ToolRunContext.caller` 提供 agent
- 迁移在 `apply()` 时执行一次，`dirs.json` 存在即跳过
