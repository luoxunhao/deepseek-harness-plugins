# dsh-mcp-panel

[English](README.en.md) | 简体中文

DSH 插件，在 Web 设置页提供「MCP」管理面板：管理 profile `cordis.patch.yml` 受管块中的 MCP 服务器连接配置。

**面板只产配置**——真正的连接、重连与工具注册由 DSH 官方插件 `@deepseek-ai/dsh-mcp-client` 完成，保存后经 HMR 热加载，无需重启网关。

## 功能

- **服务器列表**：受管行展示传输方式、启停状态、运行相位（active/failed/…）与已注册工具数；受管块之外的手写 mcp-client 行以「外部行」只读展示，绝不修改
- **新增 / 编辑**：Stdio（本地命令）与 HTTP（streamable-http）两种传输；高级折叠区暴露 `toolCallTimeoutMs`、`failOnStartupError`、自动重连策略
- **启停 / 删除**：关闭 = 配置保留但不加载；删除有二次确认
- **测试连接**：用 MCP SDK 发起一次真实连接（握手 + 列出工具后立即断开），对未保存的表单输入也可用
- **密钥脱敏**：`env` / `headers` 的值永不过网络——列表只显示 key；编辑时留空保留旧值、显式 ✕ 删除、填新值覆盖
- **字节保真**：只读写自己的受管块（`# >>> dsh-mcp-panel:mcp:begin/end`），块外内容逐字保留；原子写 + 写前校验

## 安装

```bash
dsh plugin --profile web add <本包 tarball 或 npm 包名>
```

重启 `dsh web` 后打开设置页，「技能」下方即「MCP」。

## 工作原理

面板把每台服务器写成一个 patch 行：

```yaml
# >>> dsh-mcp-panel:mcp:begin
- insert:
    - id: mcp-panel-my-server
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        serverName: my-server
        transport: stdio
        command: node
        args:
          - server.js
        env:
          API_KEY: …
        cwd: ""
# <<< dsh-mcp-panel:mcp:end
```

官方 `@deepseek-ai/dsh-mcp-client` 按 cordis loader 加载这些行并注册 `mcp__<serverName>__<rawName>` 工具；文件变更被 HMR 感知后热替换实例。卸载本插件后块内配置仍是普通 patch 行，照常生效。

## 开发

```bash
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest run
pnpm build       # lib/index.js（host ESM）+ lib/client.js（浏览器束）
```

本地挂载：在 dsh 源码检出根目录运行 `pnpm dsh web --patch <绝对路径>/dsh-mcp-panel/cordis.patch.yml`。

领域词汇见 [CONTEXT.md](CONTEXT.md)；开发不变量见 [AGENTS.md](AGENTS.md)；配置存储决策见 [docs/adr/0001-patch-managed-block.md](docs/adr/0001-patch-managed-block.md)。

## License

MIT
