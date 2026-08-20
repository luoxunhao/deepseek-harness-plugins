# deepseek-harness-plugins

Personal DeepSeek Harness plugins that live **outside** the dsh source tree, so they never pollute or conflict with dsh source code.

| Package | Role |
|---|---|
| [`dsh-codex-project/`](dsh-codex-project/README.md) | 工作区共享子目录：一个工作区挂载任意数量的共享子目录（可跨盘符），会话在 `workspace-write` 权限下直接读写它们（源自 Codex 的项目处理思想；无需 `danger-full-access`）。含「打开本地目录」与「管理工作区」原生「…」菜单入口、项目文件夹 tab（内联预览 + 引用）、/read、/write、/file 路由与 `add-dir` 工具。 |
| [`dsh-presets-liangshen/`](dsh-presets-liangshen/README.md) | 梁神模式 agent preset：两阶段锚定（首轮只暴露 Minimal 精确双工具 + 一行 persona，锚定后 wire 切换为 PTC Mode 单 `run_code`），启动时把 preset 同步进 `~/.dsh/.agent-presets`，新会话预设选择器可选「梁神模式」。host-only，经 `cordis.patch.yml` 挂载。 |
| [`dsh-skill-manager/`](dsh-skill-manager/README.md) | 技能管理器：在「设置 → 技能」分区浏览合并后的技能目录、查看每个技能的正文（body）、按技能切换模型/用户调用策略（frontmatter 双键同步写入）。host half（路由）+ client half（设置面板 UI）。 |

## Development

每个插件是独立包，自带 lockfile；依赖解析自 npm 发布的 `@deepseek-ai/dsh-*@0.1.0-rc.6`（不依赖 dsh 源码树链接）。插件各自拥有检查命令：

```sh
pnpm --dir dsh-codex-project typecheck        # 类型检查
pnpm --dir dsh-codex-project test             # vitest（jsdom + node）
pnpm --dir dsh-codex-project build            # tsc 声明 + tsdown 双半构建

pnpm --dir dsh-presets-liangshen typecheck    # 类型检查
pnpm --dir dsh-presets-liangshen test         # vitest（node）
pnpm --dir dsh-presets-liangshen build        # tsc 声明 + tsdown host 构建

pnpm --dir dsh-skill-manager typecheck        # 类型检查
pnpm --dir dsh-skill-manager test             # vitest 单元测试
pnpm --dir dsh-skill-manager build            # 构建 lib/
```

开发期挂载：在 dsh 源码检出（<https://github.com/deepseek-ai/deepseek-harness>）根目录运行 `pnpm dsh web --patch <本仓库绝对路径>/<plugin>/cordis.patch.yml`；正式安装：`dsh plugin --profile web add <绝对路径或 npm spec>`（`dsh.bundle.patch` 声明自动激活 bundle）。