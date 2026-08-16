# ADR-0001: 失效根收窄（fail loud → narrow + 标注）

- 状态：已采纳（0.8.0）
- 日期：2026
- 涉及：dsh-codex-project（共享子目录插件）

## 背景

`dsh-codex-project` 的多根沙箱在**每次受限操作**（fs 写/编辑、shell confine、上下文提醒）前，都会通过 `matchingSpace` 定位会话所属的空间记录，并**全量校验所有空间记录的全部 roots**（`canonicalRoots`）。任何一条记录的任一 root 目录不存在，校验立即抛错：

```
space <id> root is not an existing directory: <path>
```

该抛错发生在"判断该空间是否包含当前会话"**之前**，因此：

- 死根所在空间的会话：所有受限操作瘫痪；
- **其他空间、甚至不在任何空间的会话同样被连坐**（本次事故：deepseek-harness 会话被 AionUi 空间死根 `E:\project\AionCore` 阻断全部写操作与 shell）；
- 三个隔离面（fs fence / seam runner / 上下文提醒）全部中招；提醒面抛错被 `index.ts` 的 try/catch 吞掉，只剩 warn 日志。

## 决策

被动失效（root 目录在配置保存后消失）不再 fail loud，改为**收窄（narrow）+ 标注**：

1. **匹配跳过无关空间**：归属判定只看**现存根**（会话 cwd 物理上不可能位于缺失根之下），死空间（全根缺失）跳过，first-match-wins 不变——死根不再连坐任何无关会话；
2. **收窄**：命中空间的可写集合 = 现存根；写死根路径自然失败（目录已不存在），无权限升级（ACE 只在现存目录上物化）；
3. **保留空间身份**：命中判定依据**配置**的 roots.length > 1（不因收窄改变）——现存根只剩 1 个时空间仍命中、提醒仍注入，避免"降级后配置损坏不可见"；
4. **可见性**：上下文提醒给缺失根加 `(⚠ directory missing)` 标注（纯事实、零权限声明）；host 日志每空间首见 warn 一次、之后 debug；
5. **无状态重校验**：每次操作按当下目录存在性判定，目录恢复后自动重新进入可写集合，零配置零重启；
6. **配置卫生**：配置文件**永不自动改写**；GET /spaces 暴露只读 `missingRoots` 派生，PUT 支持确认式清理（`allowMissingRoots`，现存根归一化前置；roots 全部失效则删除整条记录），管理弹窗标注失效根并提供移除按钮。

主动操作（创建/更新配置时传入不存在的 root）仍 fail loud——"此刻建立指向某目录的关系"与"目录事后消失"是两种语义。

## 备选方案与取舍

| 方案 | 结论 | 理由 |
|---|---|---|
| fail loud（现状） | 拒绝 | 一个死根连坐所有会话；与 dsh 核心哲学相悖（见下） |
| drop（整条空间失效，回退单根） | 拒绝 | 一个死根让所有共享子目录一起失效，比收窄更保守且无必要 |
| 自动清理配置文件 | 拒绝 | 用户数据不可静默改写（用户可能只是临时拔盘） |

## 依据

- **对齐 dsh 核心哲学**：`@deepseek-ai/dsh-workspace` 对"已注册工作区目录事后消失"的策略是"保留记录、降级显示（会话进未分组）、只 warn"（`entity.ts` `status()` 返回 `missing-dir` 且不改写记录；测试 `workspace.spec.ts:862` 锁定）；本决策把同一哲学移植到插件配置层；
- **物理边界即拒绝**：死根目录不存在，写它本来就必然失败（EPERM/ENOENT），fail loud 并未提供额外保护，只是放大了故障面；
- **pre-step 防御**：`index.ts` 对提醒折叠的 try/catch 从"掩盖问题"降级为纯防御性兜底。

## 影响

- `src/space-config.ts`：新增 `tryCanonicalDirectory` / `resolveSpaceRoots` / `SpaceMatch`；`matchingSpace` 与 `matchingMultiRootSpace` 返回 `SpaceMatch`，不再抛错；
- `src/fs.ts` / `src/seam.ts` / `src/runner.ts` / `src/context-injection.ts`：消费 `SpaceMatch`，可写集合/ACE 物化/提醒文本使用现存根；
- `src/spaces-api.ts` / `src/space-store.ts` / client 弹窗：`missingRoots` 派生与确认式清理；
- 契约翻转被测试锁定（fs-fence / seam-wiring / proto-verify 的 fail-loud 断言改为收窄断言）。
