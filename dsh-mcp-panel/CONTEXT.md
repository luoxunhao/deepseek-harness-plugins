# dsh-mcp-panel — 领域词汇表

本文件只记录领域术语（纯词汇，无实现细节）。实现决策见代码注释、README 与 docs/adr。

> 命名溯源：插件在 DSH 设置外壳（「设置 → MCP」）提供 MCP 服务器连接管理分区。它只生产配置；真正的连接、重连与工具注册全部归官方 `@deepseek-ai/dsh-mcp-client` 插件——本插件自己不连接任何 MCP 服务器。

## 核心概念

- **MCP 服务器（Server）**：一个可被 dsh 连接的外部 Model Context Provider，模型侧表现为一组 `mcp__<serverName>__<rawName>` 工具。**本插件的管理单位。**
- **服务器名（serverName）**：服务器的稳定本地命名空间标识，`[A-Za-z0-9_-]{1,32}`，跨受管行与外部行全局唯一。重命名 = 换了一台新服务器（旧行让位新行）。
- **传输（Transport）**：连接方式二选一：`stdio`（本地子进程：command / args / env / cwd）或 `streamable-http`（远程端点：url / headers）。
- **密钥（Secret）**：`env`（stdio）与 `headers`（http）中的键值对，值可能敏感。
- **密钥脱敏（Secret Masking）**：密钥值永不过 RPC——列表只回 key；编辑时 null = 删该 key、字符串 = 覆盖、缺省 = 保留旧值。
- **受管块（Managed Block）**：profile patch 文件中由成对注释标记划出的区域。面板只读写块内内容，块外逐字节保留。
- **受管行（Managed Row）**：受管块内、由本面板拥有的一条 mcp-client 加载行。面板对其增、删、改、启停。
- **外部行（External Row）**：受管块之外的一切 mcp-client 行（手写或其他工具写入的）。**只读展示**，本面板绝不修改，也不吞并。
- **启停（Enable / Disable）**：行的 disabled 标志。关闭 ≠ 删除：配置保留，只是不被加载。
- **探测（Probe）**：用一次真实连接（握手并列出工具后立即断开）验证服务器可达。与行是否保存、是否启用无关——未保存的表单输入也可探测。
- **调和（Reconcile）**：写入 patch 后等待 loader 把变更热加载到位（行出现 / 消失 / 启停生效）。超时不算失败——文件已写成功，只是确认不了。
- **相位（Phase）/ 工具数（Tool Count）**：loader 视角下某行的实时状态（加载中 / 运行 / 失败 / 已禁用）与其注册的工具数。loader 不可用时二者缺席，面板降级为纯配置视图。

## 关系

- 面板 ⊥ 连接：面板只产配置；连接生命周期全归官方 mcp-client。
- 受管行 ⊂ 受管块；外部行 ∩ 受管块 = ∅。块内出现无本面板 id 前缀的行（手写混入）时，按外部行对待——只读，绝不修改。
- serverName 唯一性在受管行与外部行之间统一校验。
- 探测不以行为前提；调和以写入成功为前提。
