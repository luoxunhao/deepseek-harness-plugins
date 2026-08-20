# dsh-skill-manager

DSH 的 web 插件：在「设置 → 技能」分区管理技能——浏览合并后的技能目录、查看每个技能的正文（body）、按技能切换模型/用户调用策略。

## 挂载

```bash
dsh plugin --profile <name> add dsh-skill-manager
```

本地开发用 dsh 源码根目录：

```bash
pnpm dsh web --patch E:\project\deepseek-harness-plugins\dsh-skill-manager\cordis.patch.yml
```

> host half（Node 侧）改动需重启 `dsh web`；client half（UI）改动浏览器硬刷新即可。

## dsh 技能加载机制

插件建立在一个核心事实之上：**dsh 的技能不是一次性注入的会话配置，而是一个运行时动态合并、按需重读的目录系统。** 理解这套机制才能理解本插件为什么这样设计。

### 1. 技能从哪来：四个发现根，合并成目录

dsh 在启动时从四个根目录发现技能（`packages/skill/src/index.ts`）：

| 发现根 | 作用域 | 路径 |
|---|---|---|
| `dsh.skills`（已配置目录） | project | 项目源码树里的 `skills/` |
| `user-dsh` | user | `~/.dsh/skills/` |
| `user-agents` | user | `~/.agents/skills/`（Docker/Codex 技能根） |
| 其他自定义源（`@deepseek-ai/dsh-skill-filesystem` 的 provider） | — | 各 provider 自行声明 |

所有来源合并为一个**共享目录（catalog）**，目录条目就是技能的「注册表定义」，每个定义带 `name`、`description`、`source`（来源桶）等元数据。每个技能对应磁盘上的一个目录：`<root>/<skill>/SKILL.md`（frontmatter + 正文）。

### 2. 三个对象

- **注册表定义（registry definition）**：`ctx.skills.get(name)` 返回的目录条目。`source` 字段表明它来自哪个发现根。
- **skill 工具执行**：`/skill` 斜杠指令或模型自动调用触发时，`@deepseek-ai/dsh-skill` 从注册表找到定义，再从**磁盘**读取该 `SKILL.md` 的正文。
- **文件系统 provider**：`@deepseek-ai/dsh-skill-filesystem` 用 chokidar 监视各技能根目录，文件变化时自动更新注册表定义并失效缓存。

### 3. 调用策略由两个 frontmatter 字段决定（不是加载机制的一部分）

每次从磁盘读取定义时，解析 frontmatter 中的两个键（`skill-filesystem/src/index.ts:996-1000`）：

```ts
modelInvocable: disableModelInvocation !== true,   // 缺席 → 默认 true（模型可调用）
userInvocable: userInvocable !== false,            // 缺席 → 默认 true（用户可调用）
```

- `disable-model-invocation`：**模型**是否可自动调用。名字带 `disable-`，是**反向键**：`false` = 模型可调用，`true` = 禁用。
- `user-invocable`：**用户**是否可通过 `/skill` 斜杠指令手动调用。**正向键**：`true` = 用户可调用，`false` = 禁用。

两个键语义独立：`disable-model-invocation: false` + `user-invocable: true` 字面相反，但表达同一个状态「全部启用」。**缺省即启用**——字段缺席时两者都默认 true；只有主动修改后字段才会写进文件。

「开关」只是元数据。真正决定「调不调得起」的是：模型侧由 `tool-skill` 在每次 `agent/pre-step` 重新计算目录摘要（digest）并过滤不可调用的技能（变了才追加一条替换消息，没变不重复），用户侧由 `/skill` 指令每次执行前从磁盘重读正文并检查 user 门禁。

### 4. 关键结论（决定本插件设计的事实）

- **技能目录不是会话开始时一次性注入的**。`tool-skill` 在每个请求的 `pre-step` 重算 digest；`skill` 工具执行时每次从磁盘重读正文（fresh-definition 门）。因此修改 `SKILL.md` 后，**下一条请求即被感知**，无需重启 dsh、无需重新加载会话。
- **技能文件内容不能被锁死在内存里**。dsh 每次真正使用时都回读磁盘；插件修改 frontmatter 后必须保证落盘且文件格式合法，dsh 的 watcher 会自动把新状态同步进注册表。
- **来源桶是元数据，不参与调用策略**。`user-agents` 等 source 徽标只表示「从哪发现」，以及只读性（`bundled`/`runtime` 来源的技能不可写、不可开关）。
- **技能根可能对进程不可见**。例如 `~/.agents/skills` 可能被某些项目的 `ctx.fs` 遮蔽（resolve 失败返回 0 技能），此时必须走独立于 `ctx.skills` 的磁盘兜底才能管理这些技能。

## 插件实现对照

| 加载机制事实 | 插件做法 |
|---|---|
| 注册表 + 磁盘双层 | 列表优先用注册表，磁盘兜底合并；正文读取注册表优先、磁盘兜底（`getSkillBody`），保证所有技能都能查看正文 |
| 双键语义相反 | 单个「启用」开关同时写两键：启用 → `disable-model-invocation: false` + `user-invocable: true`；关闭 → 相反。两键**始终成对写、永不删除** |
| 文件会被 dsh 实时重读 | 修改走原子写（临时文件 + rename，Windows 下 EPERM 重试并降级就地写），落盘即生效 |
| CRLF 兼容 | frontmatter 解析/写入对换行无关，不破坏文件原 EOL |

## 开发

```bash
pnpm typecheck   # 类型检查
pnpm test        # vitest 单元测试
pnpm build       # 构建 lib/
pnpm pack --pack-destination <dir>   # 出 tarball（pnpm build 与 pack 分开跑）
```

重装同版本 tarball 到真实 profile：先删 `<profile>/node_modules/dsh-skill-manager` 与 `<profile>/pnpm-lock.yaml`，再 `dsh plugin --profile <name> add file:...tgz`。

验证：`GET /skill-manager/api/skills`（目录）、`GET .../<name>/body`（正文）、`PUT .../<name>/invocation { enabled }`（开关，200 后文件双键同步）。