# Agent Note: 从 arx Harness 更名为 arx Harness

Status: implemented

[English](2026-08-25-rebrand-to-arx-ai.md) | 中文

## Problem

harness 此前以 DeepSeek 的产品身份交付：npm scope `@arx-ai`、包与二进制前缀 `arx`、环境变量前缀 `ARX_`、Python 模块 `arx_harness`，以及 `arx-ai/arx-harness` 仓库。产品现在以 arx 交付，上述每一处接口都需要自己的身份。

盲目改名会摧毁它所改名的产品。仓库中 29,604 处不区分大小写的 `deepseek` 里，约 5,900 处根本不指 harness：它们指的是 `arx-llm-deepseek` 至今仍在对接的 DeepSeek *模型*、*提供方*、*凭据* 或 *端点*。`DEEPSEEK_API_KEY`、`deepseek-official`、`deepseek-v4` 系列模型 id 与 `api.deepseek.com` 是第三方事实，不是品牌。

另有两类 span 看起来像产品，实则不是。`arx-harness` 这个 GitHub 组织在此处属于第三方——[`vendor/README.md`](../../../../vendor/README.md) 钉住的 fork 提交托管于此，Agent Note 引用的 pull request 亦然。而归档 Agent Note 树按[归档策略](../../README.zh.md)冻结，其文件名保留旧前缀，但每一条*指向*它的链接都位于改写会触及的文件里。

## Decision

新身份为 `@arx-ai`（npm scope）、`arx`（包与二进制前缀）、`ARX_`（环境变量前缀）、`arx_harness`（Python 模块）与 `github.com/centurionarx/arx-harness`。npm scope 与 GitHub owner 是彼此独立的字段，且取值不同：npm 上为 `arx-ai`，GitHub 上为 `centurionarx`。分类器把 owner 规则锚定在 GitHub 主机名上，因为未加锚定的规则也会吞掉裸露的 scope 字面量——只要两个字段取值相同，这一点就不可见。

[`scripts/rebrand.ts`](../../../../scripts/rebrand.ts) 是可复现的唯一事实来源，且它是**分类器，而非替换**。受保护的 span 在任何改写规则运行之前被遮蔽、之后再还原，因此无论规则顺序如何，都无法触及它们。[`scripts/rebrand.spec.ts`](../../../../scripts/rebrand.spec.ts) 双向锁定：什么必须迁移，什么必须原样存活。

除模型与提供方 span 外，分类器还保留：除本产品自身位于 [`native/`](../../../../native/README.zh.md) 的 clone URL（该 URL 随产品迁移）之外的全部 `github.com/arx-harness/<repo>`；issue 管理策略测试中的 `arxharness/` fixture；以及每一条命名 `archived/` 下文件的相对链接。

MIT 声明保留 `Copyright (c) 2026 DeepSeek`，并在其下增加 `Copyright (c) 2026 arx`——衍生作品必须如此。

对前缀规则而言词边界是错误的工具，因此被刻意省略。`_` 与数字都是词字符，`\b` 会因此隐藏 `__ARX_BOOT__`、`_arxWebServer`、`_arx_base_agent`、`\0arx-css:` 虚拟模块前缀、扩展了模块名的 Python 发行包，以及 JSON 中被转义 `\n` 把字母顶到紧邻位置的 `arx Harness`。只排除字母才能覆盖全部这些情形。

## 验收不变式

改写完成后，搜索旧身份**恰好**返回受保护集合，别无其他。残留量为第三方 GitHub URL 中的 83 处，加策略 fixture 中的 2 处；保留下来的 DeepSeek 提供方接口约 5,900 处。多于此说明产品身份泄漏，少于此说明提供方被破坏。

生成的目录会把 `@scope/prefix-name` 去掉 `@` 与 `/` 后 slug 化为锚点，于是 scope 与前缀融合成一个 token，而手写文档正链接到它。分类器用与生成器一致的规则改写这个融合 token，因此重新生成后 `website:build` 找不到任何死锚点。

## Alternatives considered

**对整棵树跑 `sed`。** 否决：约五分之一的匹配必须存活，而任何顺序的盲目替换都无法区分它们。遮蔽过程存在的理由，正是规则顺序不可信赖。

**保留 `arx` 前缀。** 它读起来像缩写而非品牌，因此看似可以省事留下。否决：`arx` 的含义*就是* arx Harness，一个悄悄保留旧产品首字母的前缀比两个极端都更糟——它既不是旧身份，也不是新身份。

**把归档 Agent Note 与其余部分一起改名。** 否决：归档笔记是旧名之下所做决策的冻结记录，改写它们等于伪造该记录。代价是一处不对称——指向 `archived/` 的链接命名的文件，其前缀与周围的树不再一致——分类器现已显式保护该情形。

**在已改写的树上再跑一次修正。** 首次运行用了错误的 npm scope 与 owner。否决，改为从原始提交重跑修正后的分类器，使这棵树可被证明是对已知输入的一次变换，而非两次叠加。

## Consequences

`$ARX_HOME` 变为 `$ARX_HOME`，因此既有会话、凭据与设置成为孤儿。[预发布立场](../../../../CLAUDE.md)允许这样做——后端拒绝旧的磁盘格式——且 `SESSION_FORMAT_VERSION` 不变，因为更名不改变任何日志结构。

命名 GitHub 组织的配置超出了分类器能判断的范围。上游组织以产品命名，因此 JSON 中裸露的组织字面量与产品 slug 无从区分，会被 slug 规则吞掉——`.github/issue-management/config.json` 由此指向了一个并不存在的组织，issue-policy 作业也因此调用了 `repos/arx-harness/arx-harness`。给 owner 规则加锚定触及不到这里：值的旁边没有主机名可供锚定。重命名之后，组织形态的配置需要人工核对。

发布现在取决于持有 `@arx-ai` npm scope 与 `arx-harness-sdk` PyPI 名称；二者都不是代码变更。

这种规模的改名无法 rebase。它单独落地；发生冲突时，在新基线上重跑分类器比手工解决更划算。

陈旧的 `lib/` 产物会在改名后残存，并以一个在新名下已不存在的符号触发 `MISSING_EXPORT` 从而中断构建。`pnpm run clean` 是改名的组成部分，而非可选的后续步骤——并且当被改名的包目录仍持有未跟踪的构建残留时，它会拒绝运行。

## Related

[仓库命名契约](2026-08-11-repository-naming-contract-and-rename-ledger.zh.md)拥有一个名称必须满足的规则；本笔记拥有这些规则的一次应用。[强制应用归属头部](2026-06-21-mandatory-app-attribution-headers.zh.md)拥有 `APP_IDENTITY`，本次变更迁移了它的 `product` 与 `url`——每个提供方请求发送的 `User-Agent` 对外可观测，因此本次更名并非纯粹的表面工作。
