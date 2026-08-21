# MCP 服务器配置存于 profile patch 文件的受管块

dsh 官方 `@deepseek-ai/dsh-mcp-client` 只从 cordis loader 的 patch 行读取服务器配置，没有独立的 mcp.json 通道；要让面板的改动真正生效（且随 HMR 热加载），唯一可行路径是把配置行写进 profile 的 `cordis.patch.yml`。我们决定：面板在 patch 文件中用成对注释标记维护一个受管块（`# >>> dsh-mcp-panel:mcp:begin` / `end`），只读写块内行，块外字节逐字保留。

## Considered Options

- **自建独立存储 + 同步进 patch**：两份真相必然漂移，同步器还要处理用户手改 patch 的冲突——否决。
- **直接改写整个 cordis.patch.yml**：面板无权重排用户的其余 patch 内容——否决。
- **复用参考插件 `dsh-skill-mcp-panel` 的受管块**：那是它的私有实现细节，标记与行 id 前缀共用会互相吞块——否决，改用自己的标记（`dsh-mcp-panel:mcp`）与行 id 前缀（`mcp-panel-`）。

## Consequences

- 与参考插件并存时，彼此的受管行互为「外部行」，均只读展示。
- 面板卸载后块内配置仍在文件里（普通 patch 行），官方 mcp-client 继续照常加载——配置不锁死在本插件。
