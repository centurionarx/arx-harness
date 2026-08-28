# Agent Note：CI 运行在本组织真正拥有的 runner 上

Status: implemented

[English](2026-08-28-ci-runs-on-runners-this-org-has.md) | 中文

## 问题

`centurionarx/arx-harness` 中的每一个 pull request 都无法合并，而原因看起来并不像是 runner 的问题。

四个最重的必需作业——`node 24 / static`、`node 24 / coverage`、`node 24 / snapshots and artifacts` 和 `windows node 24 / native complete`——指名了托管的大型 runner 池 `arx-ubuntu-24-04-16core` 与 `arx-windows-2025-16core`。这些池定义在上游组织中，并随 fork 一同带了过来。本组织没有任何一个同名的池。

GitHub 并不会拒绝 `runs-on` 标签匹配不到任何东西的作业，而是把它排队。该作业会一直等到 24 小时上限到期，然后以 `24h0m0s` 的时长被报告为失败。在 pull request 上，评审者看到的是四个必需门禁挂起一整天后变红，没有日志，也没有任何提到 runner 的信息——这读起来像构建坏了，而不是缺一个池。十三个开放的 pull request 就此堆积，其中包括每一个 Dependabot 升级。

## 决定

这四个作业运行在 GitHub 的标准托管 runner 上：`ubuntu-24.04` 与 `windows-2025`。

failover 表达式未作改动。`ARX_CI_FAILOVER_LINUX` 与 `ARX_CI_FAILOVER_WINDOWS` 仍会重定向到自建的 self-hosted 池，改变的只是每个表达式的兜底分支。日后定义了大型 runner 池的组织，只需为每个作业改一个标签即可启用。

`ci-master.yml` 保留其私有池名称。它的 `larger-runner-benchmark` 作业的存在意义就是跨核数比较这些池，且仅由 `workflow_dispatch` 触发，因此不阻塞任何东西；把它改指向标准 runner，等于删掉它存在的那次测量。

`scripts/ci-workflow.spec.ts` 固定了 Windows 标签。门禁要守的并不是必须使用某个特定的池，而是重新引入私有池名称必须是一次有意的编辑，而不是一次无声的停滞——因为这种失败模式每次尝试要付出一整天，且什么都不指明。

## 备选方案

**在本组织中定义这些池。** 这样能保留上游的调优，而 benchmark 作业的存在恰恰是因为那份调优是测量出来的。已否决其作为默认方案：它需要在仓库之外做组织级配置，因此在有人完成之前仓库会一直是红的；而任何一个从不做这件事的 fork，都会继承同样长达一天的停滞。

**移除 failover 表达式。** 在每个平台只剩一个托管池的情况下，这些表达式看起来像是背后空无一物的间接层。已否决：self-hosted 分支是托管容量不可用时有文档记载的恢复路径，而启用它只差一个仓库变量。

## 影响

标准 runner 比这些作业原本调优所针对的池更小，因此 coverage 与 consumer 两条通道的挂钟时间会更长。它们仍在 GitHub 的单作业上限之内，而一个较慢但会给出结果的门禁，胜过一个更快却永远不启动的门禁。

`ci-master.yml` 中由 master push 触发的作业仍指向本组织尚未注册的 `self-hosted` 池，因此那些运行会以同样方式停滞。它们不对任何 pull request 设门禁，故维持原样；需要该信号的组织可以注册这些池或退役这些作业。

## 相关

[CI failover 运行手册](2026-07-26-ci-failover-runbook.zh.md)规定了 failover 变量以及池不可用时该怎么做。[原生 Windows pull-request CI](2026-08-08-native-windows-pull-request-ci.zh.md)规定了 Windows 原生作业为何不阻塞。
