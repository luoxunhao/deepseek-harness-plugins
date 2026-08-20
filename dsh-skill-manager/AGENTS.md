# dsh-skill-manager — AGENTS.md

开发/维护本插件的指引。领域词汇见 `CONTEXT.md`；dsh 技能加载机制见 `README.md`（本文件不复述，只载入每个改动都成立的**不变量**）。

## 这个插件是什么

DSH web 插件：在「设置 → 技能」分区展示合并后的技能目录、查看正文、按技能切换模型/用户调用策略。host half（`src/index.ts` 路由）+ client half（`src/client/` React UI）。

## 不变量（每个改动都成立，改代码前先过一遍）

- **双键同步**：一个「启用」开关同时控制模型与用户两层。写入永远成对、永不删除：
  - 启用 → `disable-model-invocation: false` + `user-invocable: true`
  - 关闭 → `disable-model-invocation: true` + `user-invocable: false`
  - 模型键是**反向**的（`disable-` 前缀）：写 `true` = 关闭模型。字面相反的两键表达同一个语义「启用」。
- **最小保真写**：编辑 frontmatter 只增删两个调用键，其余键与正文逐字节保留，保留文件原有换行（LF/CRLF 都支持）。用 `src/frontmatter.ts`，不引入 YAML 依赖。
- **写目标只由 host 解析**：写 API 只接受 skill `name`，路径从 `ctx.skills.get(name).path` 或磁盘定位器解析。客户端永远不能把写指向任意路径。
- **注册表权威，磁盘兜底**：`ctx.skills` 是唯一权威目录；用户作用域技能被 project `ctx.fs` 遮蔽（如 `~/.agents/skills`）时，`src/user-skills.ts` 用 node fs 兜底补齐。合并时注册表行优先，磁盘只补注册表没暴露的名字。
- **作用域决定枚举方式**：用户级走 `snapshot()`/`get(name)`（不带 cwd）；项目级必须把工作区目录当 `cwd` 传 `snapshot({ cwd })`/`get(name, { cwd })`，且结果只保留 `project-dsh`/`project-agents` 源（带 cwd 的 snapshot 会混入用户根）。**不传 cwd 就扫不到项目根**——这是「面板看不到项目技能、但对话里能用」的根源。
- **工作区来自 `ctx.workspaceRegistry`**：项目级下拉列表的选项 = `ctx.workspaceRegistry.list()`（`{id,path,title}`）。该服务是**可选依赖**：用 `ctx.get('workspaceRegistry')` 探测，缺失时返回空列表、插件仅用户级可用，不要把它的 inject 设成必需。
- **可开关判定**：有磁盘路径 且 来源非 `bundled`。`bundled`/`runtime` 只读展示，无开关。
- **缺省即启用**：两个调用键缺席时 dsh 默认 `modelInvocable: true` + `userInvocable: true`。文件里 `false`/`true` 显式化了「启用」，不代表不一致。

## 布局

- `src/index.ts` — host 路由（GET skills?scope=&cwd= / GET workspaces / GET body / PUT invocation），循环回环 fence，catch-all 500 带 `detail`。
- `src/skills.ts` — 目录组装（按作用域） + 调用策略写入；`SkillScope`（user|project）；`listWorkspaces`（可选依赖）；`atomicWrite` 对 EPERM/EACCES/EBUSY 重试并降级就地写（Windows 文件锁）。
- `src/frontmatter.ts` — EOL 无关的 frontmatter 读/写/剥正文。
- `src/user-skills.ts` — 用户作用域 + 项目作用域磁盘技能发现（node fs 兜底；`findProjectRoot` 向上找 `.git` 镜像 dsh）。
- `src/trust-fence.ts` — 浏览器信任 fence（`isTrustedApiRequest`），防 DNS rebinding，非鉴权。
- `src/client/` — `api.ts`（typed fetch + scope/cwd 参数 + `listWorkspaces`）、`SkillsSection.tsx`（标签页 + 工作区下拉 + 列表/正文/开关）、`locales.ts`、`index.tsx`。
- `tests/` — vitest；`routes.spec.ts` 顶部 `vi.mock('../src/user-skills.ts')` 隔离真实 `~/.agents`。

## 开发循环

1. 改 host（`src/` 非 client）→ 类型 + 测试 + 构建
2. 改 client（`src/client/`）→ 仅类型检查（见下）

**每次改动后验证（全部通过才算完成）**：

```bash
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest run，现有 57 个测试须全绿
pnpm build       # 清 lib/ 重建（tsc -p tsconfig.build.json + tsdown）
```

**改动 host 后要出包重装**（否则旧 dsh web 进程跑的是旧宿主代码）：

```bash
pnpm pack --pack-destination <dir>                        # 出 tarball（与 build 分开跑）
# 重装同版本：先删 <profile>/node_modules/dsh-skill-manager 与 <profile>/pnpm-lock.yaml
dsh plugin --profile <name> add "file:<abs>/dsh-skill-manager-0.1.0.tgz"
```

**宿主重启规则**：host half 改动需**重启 dsh web**；client half 改动只需**浏览器硬刷新**，无需重启。

**验收标准**（fresh `dsh web --port 0`，从 stdout 解析 URL）：`GET /skill-manager/api/workspaces` 返回工作区列表；`GET /skill-manager/api/skills?scope=user` 返回 25 个技能；`GET /skill-manager/api/skills?scope=project&cwd=<workspace>` 返回该项目技能（如 `dsh-plugin-development`，source=project-dsh）且不含用户技能；`GET .../<name>/body?scope=project&cwd=...` 200；`PUT .../<name>/invocation {enabled}` 200 且文件双键同步写入；改完恢复原 frontmatter（如 `grill-me` 原状 = `disable-model-invocation: true` + `user-invocable: true`）。

## 陷阱

- **不要重启也不用 server 就以为 client 改好了**：client 是静态资源 no-cache，硬刷新即生效；但 host 改必须重启。
- **不要绕过 `setFrontmatterKey`/`atomicWrite` 直接写文件**：会破坏最小保真或撞 Windows 文件锁。
- **不要在宿主代码里 value-import 其他插件的运行时符号**；client bundle 有纯度门，类型用 `import type`。