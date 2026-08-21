# dsh-mcp-panel — AGENTS.md

开发/维护本插件的指引。领域词汇见 `CONTEXT.md`；配置存储决策见 `docs/adr/0001-patch-managed-block.md`。

## 这个插件是什么

DSH web 插件：在「设置 → MCP」分区管理 profile `cordis.patch.yml` 受管块里的 MCP 服务器行——新增/编辑（stdio 与 streamable-http）、启停、删除、测试连接。host half（`src/index.ts` 路由）+ client half（`src/client/` React UI）。**面板只产配置；连接、重连、工具注册全归官方 `@deepseek-ai/dsh-mcp-client`，由 HMR 热加载。**

## 不变量（每个改动都成立，改代码前先过一遍）

- **所有权看 id 前缀**：受管块内 id 以 `mcp-panel-` 开头的行才是本面板的受管行；块内无前缀的 mcp-client 行按**外部行**对待——只读展示，绝不修改、绝不删除。
- **块外字节逐字保留**：patch 编辑只动 begin/end 标记之间的内容；用户手写的其余 patch 行、注释、空格、CRLF 一律原样保留。删空最后一批受管行后必须补回合法顶层数组。
- **密钥值永不过 RPC**：列表只回 key；编辑走三态补丁——`null` = 删 key、字符串 = 覆盖、缺省 = 保留旧值（`mergeSecretPatch`）。探测在 host 进程内用完整输入，不受此限。
- **写目标只由 host 解析**：patch 路径从 `ctx.baseUrl`（file: URL）推导，包位置兜底；客户端永远不能指定写路径。
- **无锁文件，原子写**：v1 无 CLI，写方只有 host 进程——临时文件 + rename 原子替换（Windows EPERM 退化为 rm+rename），写前整文件校验。不要重新引入锁文件，除非出现第二个写方。
- **调和超时不算失败**：写入成功即操作成功；`waitForLoaderState` 超时只影响确认字段（`reconciled: false`），绝不回滚、绝不变 5xx。
- **loader 相位是尽力而为**：`inject` 声明 `['webServer', 'tools', 'loader']`（cordis 未注入的服务属性访问会直接抛错，必须声明）；但 entry 形状变化时相位/工具数字段降级缺席，面板退化为纯配置视图，不 5xx。
- **serverName 唯一性跨受管与外部统一校验**：与外部行撞车 → 409 且文件不动；「编辑自己」不算撞车（判定键 = `previousServerName ?? serverName`）。
- **产出形状对齐官方 schema**：`toOfficialConfig` 的字段与默认值（timeout 60s、reconnect 500ms/30s/10 次）必须与 `@deepseek-ai/dsh-mcp-client` 的 Config 保持一致。

## 布局

- `src/index.ts` — host 路由（GET servers / PUT servers/:name / PUT …/enabled / DELETE / POST test）、信任 fence、`resolvePatchPath`。
- `src/patch-editor.ts` — 受管块纯函数半区（extract/replace/validate，EOL 感知）。
- `src/patch-file.ts` — 文件层（readPatchFile / writeFileAtomic / writeManagedRows）。
- `src/mcp/model.ts` — 配置模型（zod schema、脱敏合并、view 投影、官方形状换算）。
- `src/status.ts` — loader entry 相位/工具数 + 调和轮询。
- `src/probe.ts` — MCP SDK 直连探针（握手 + listTools 后断开，15s 超时）。
- `src/trust-fence.ts` — 浏览器信任 fence（同 dsh-skill-manager，防 DNS rebinding）。
- `src/client/` — `api.ts`（typed fetch）、`McpSection.tsx`（列表 + 编辑对话框 + 外部行）、`locales.ts`、`index.tsx`。
- `tests/` — vitest；`mcp-server-fixture.mjs` 是 stdio 探测夹具。

## 开发循环

1. 改 host（`src/` 非 client）→ 类型 + 测试 + 构建
2. 改 client（`src/client/`）→ 仅类型检查

**每次改动后验证（全部通过才算完成）**：

```bash
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest run，现有 26 个测试须全绿
pnpm build       # 清 lib/ 重建（tsc -p tsconfig.build.json + tsdown）
```

**改动 host 后要出包重装**（否则旧 dsh web 进程跑的是旧宿主代码）：

```bash
pnpm pack --pack-destination <dir>
# 重装同版本：先删 <profile>/node_modules/@luoxunhao/dsh-mcp-panel 与 <profile>/pnpm-lock.yaml
dsh plugin --profile <name> add "file:<abs>/luoxunhao-dsh-mcp-panel-0.1.0.tgz"
```

**宿主重启规则**：host half 改动需**重启 dsh web**；client half 改动只需**浏览器硬刷新**。

## 验收标准（fresh `dsh web`）

1. 设置页出现「MCP」分区；`GET /mcp-panel/api/servers` 返回 `{ servers, externalServers, patch }`，patch.ok 为 true。
2. 新增一个 stdio 服务器（如 `node tests/mcp-server-fixture.mjs`）：保存后 `cordis.patch.yml` 出现 `mcp-panel-<名>` 受管行，HMR 加载后列表显示 active 相位与工具数。
3. 启停开关切换行的 `disabled` 标志且配置字段保留；删除移除该行且块外内容逐字未动。
4. 「测试连接」对 fixture 返回 ok=true 且列出 `hello` 工具；对不存在命令返回 ok=false 带错误信息。
5. 响应 JSON 全文不含任何 env/headers 的值。

## 陷阱

- **不要把受管块标记改成别的插件的名字**（如参考插件的 `dsh-skill-mcp-panel:mcp`）——那是别人的私有实现细节，共用会互相吞块。
- **不要在 client bundle 里 value-import 其他插件的运行时符号**；纯度门会拒绝，类型用 `import type`。
- **不要绕过 `writeManagedRows` 直接写 patch 文件**——会丢掉校验与原子性。
- **Windows 上 rename 覆盖可能 EPERM**：`writeFileAtomic` 已处理，别删退化分支。
