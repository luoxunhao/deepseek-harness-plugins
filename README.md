# deepseek-harness-plugins

Personal DeepSeek Harness plugins that live **outside** the dsh source tree, so they never pollute or conflict with dsh source code.

| Package | Role |
|---|---|
| [`dsh-codex-project/`](dsh-codex-project/README.md) | 工作区共享子目录：一个工作区挂载任意数量的共享子目录（可跨盘符），会话在 `workspace-write` 权限下直接读写它们（源自 Codex 的项目处理思想；无需 `danger-full-access`）。含「打开本地目录」与「管理工作区」原生「…」菜单入口。 |

## 不在本仓库

以下项目各自保持独立仓库（本仓库 `.gitignore` 已排除，克隆后按需单独获取）：

| 目录 | 仓库 |
|---|---|
| `DSH-better-sidebar/` | https://github.com/omdsh-dev/DSH-better-sidebar |
| `dsh-web-ui/` | https://github.com/luoxunhao/dsh-web-ui |

## Development

每个插件是独立包，自带 lockfile；依赖解析自 npm 发布的 `@deepseek-ai/dsh-*@0.1.0-rc.6`（不依赖 dsh 源码树链接）。插件各自拥有检查命令：

```sh
pnpm --dir dsh-codex-project typecheck  # 类型检查
pnpm --dir dsh-codex-project test       # vitest（jsdom + node）
pnpm --dir dsh-codex-project build      # tsc 声明 + tsdown 双半构建
```

开发期挂载：`pnpm dsh --profile web --patch <绝对路径>/dsh-codex-project/cordis.patch.yml`；正式安装：`dsh plugin --profile web add <绝对路径或 npm spec>`（`dsh.bundle.patch` 声明自动激活 bundle）。
