# @centurionarx/cxh-claude-agent-sdk-process

[English](README.md) | 中文

官方 Claude Agent SDK 会自行拉起一个 Claude Code CLI。本包让 harness 接管那棵进程树。它**不是 cordis 插件**——不注册任何东西，也不注入任何东西。它是一个库，供 SDK 的 `spawnClaudeCodeProcess` 钩子把拉起请求转交给 [`cxh-subprocess`](../../subprocess/subprocess/README.zh.md)，从而让终止升级与整棵树的退出证明留在真正拥有它们的服务里。

它之所以独立成包，是因为驱动同一个 SDK 的 seam 不止一个：[`cxh-subagent-claude-code`](../subagent-claude-code/README.zh.md) 把整个任务委派给它，而 LLM 适配器可以把同一个 CLI 当作普通模型路由来驱动。把这层投影复制进第二个消费者，会让进程所有权契约产生分叉。

## 原语

- **`sdkEnvironmentOverlay(env)`**——把 SDK 组装好的子进程环境编码为 subprocess overlay。被 SDK 移除的名字会变成显式的墓碑项，而非无声的缺失，因此 overlay 陈述的是完整环境，而不是相对环境态的差异。
- **`claudeSpawnSpec(options, graceMs)`**——把一次 SDK 拉起请求翻译为完全显式的 `SubprocessSpawnSpec`：argv、工作目录、`stdin`/`stdout` 管道与继承的 `stderr`、终止宽限期，以及 SDK 转发的 signal。缺少工作目录的请求会抛错，而不是退回到服务进程自身的目录。
- **`ManagedClaudeCodeProcess`**——一个受管子进程面向 SDK 的 `SpawnedProcess` 视图。协议传输仍留在 SDK 内；这里只投影流与退出事件。

## 所有权

进程静默的权威始终是 subprocess handle。消费者请求 SDK 关闭其 query，表达的是协议意图而非进程死亡，仍需等待 handle 给出整棵树的退出证明。

## Model Experience

无，因为本包不注册任何 prompt、消息、schema、工具或模型调用；驱动该 SDK 的 seam 拥有全部模型可见效果。

#### KV Cache effect

不产生失效；请求前缀的任何变化由消费者负责。

## Known Limitations and Deferred Work

- **SDK 版本按精确值锁定，而非范围**——`0.3.220`。本包所投影的自定义拉起接口不在稳定性承诺范围内，因此消费者必须锁定与该投影编写时相同的版本。
