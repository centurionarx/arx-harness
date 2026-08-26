# Agent Note: 以订阅认证的厂商 CLI 作为模型路由

Status: implemented

[English](2026-08-26-vendor-cli-as-model-route.md) | 中文

## Problem

已交付的每条模型路由都通过 HTTP 携带 API 密钥访问提供方。已经在为产品订阅付费的用户，若不另行购买 API access，就无法使用本 harness。

对"不用 API 密钥"最直观的两种理解，一接触代码就站不住。Web 聊天界面不暴露 function calling，因此驱动它的适配器需要提示词层面的工具调用模拟——本仓库任何地方都没有这种东西；而没有工具调用，harness 什么也执行不了，那恰恰是产品本身。本地 OpenAI 兼容服务不需要*付费*密钥，但仍需要一个凭据引用，这一点现已写入[提供方指南](../../../../docs/user/guide/providers.zh.md)。

真正做到按订阅认证、暴露原生工具调用、且走官方接口的，是厂商自己的 CLI。[`cxh-subagent-claude-code`](../../../../packages/subagent/subagent-claude-code/README.zh.md) 已经在驱动它——但作为返回单一最终答案的*委托*提供方，而不是 agent 循环可以逐步推进的模型路由。

## Decision

[`cxh-llm-agent-cli`](../../../../packages/llm/llm-agent-cli/README.zh.md) 在共享的 `llm` 服务上注册厂商 CLI 路由。harness 保留自己的循环、工具、沙箱与会话日志；改变的只是通往模型的传输层。

该 CLI 本身是带工具循环的 agent，因此四项设置把一次运行压缩为一次模型调用：harness 的系统提示词替换 CLI 自己的；harness 工具 schema 经进程内 MCP 服务抵达，同时按名称拒绝 CLI 自带工具；每个权限请求都被拒绝，使任何工具都无法在 harness 看不到的地方执行；翻译在 assistant 回合处结束，那正是 `stream()` 终止之处。

`settingSources` 保持未设置。于是 SDK 读取宿主机的常规设置与原生账户状态，而这份继承就是认证本身——没有任何凭据经过本 harness，并且 [`scrubbedParentEnv`](../../../../packages/subprocess/subprocess/README.zh.md) 会从子进程移除形似凭据的名称，因此环境中的 API 密钥不会被意外取用。

核心未做任何改动。`stream()` 是适配器唯一必须实现的方法；`sessionId`、`reasoningEffort` 与 `ReplayEnvelope` 早已存在；循环本就记录 `request/header` 并标记 `source: { provider, model }`；`SESSION_FORMAT_VERSION` 不变，因此两个 SDK 投影都未被触及。

## 验证改变了什么

该设计有三条前提是错的，且每一条都是靠测试而非阅读发现的：

SDK 的 `tool()` 辅助函数接受 **Zod shape**，因此经由它呈现 harness 工具 schema 会对每个已注册工具做有损转换。适配器改为在低层 MCP 服务上应答 `tools/list`，JSON Schema 由此原样穿过。

CLI 把进程内服务的工具呈现为 `mcp__<服务>__<工具>`。因此模型发出的是 `mcp__cxh__bash`，适配器在 harness 看到该调用之前将其映射回去。这对模型可见：一份点名工具的系统提示词用的是 harness 名称，而模型读到的是带前缀的名称。

厂商自身的回合上限无法界定一次模型调用：触达它会让 SDK 抛出 error result，因此 `maxTurns: 1` 把每个普通的工具调用回合都变成了失败。完成原因由已发出的内容推导——出现任何 `tool_use` 块即为 `tool-calls`——并且翻译在 assistant 回合处结束，而不等待厂商对一次本调用已经完成的运行所作的报告。

## 每个会话一条活跃对话

`LlmAdapter` 无状态，每次调用都收到完整历史；厂商运行不是，它持有自己的历史。每一步都重放文本记录会打平角色结构、丢失厂商的前缀缓存，并把订阅额度花在重读该运行已知的内容上。

因此每个 harness 会话跨回合保持一条厂商运行活跃。该运行的输入是适配器持续推送的通道：开启回合投递运行必须知道的历史，之后每个回合只投递自己新增的内容，以真正的 `tool_result` 块承载。只有当历史仍是该运行已消费内容的延伸时续接才成立，这由逐消息摘要列表判定；其余情况会释放该运行，并以带标签的重放开启一条新的。

厂商自身的 `resume` 无法承担这件事。恢复需要 `persistSession`，而它会把每一次对话的副本写入宿主机的 Claude 目录——处于本 harness 的控制与生命周期之外，且与它已经维护的日志重复。第一版实现同时要了两者，结果两者都不成立：`persistSession: false` 搭配 `resume` id，在首次真实运行的第二个回合产生了 `No conversation found with session ID`。

让迭代器保持打开是这一切成立的前提，而它约束了翻译层：离开 `for await` 会对厂商运行调用 `return()`，从而终结下一个回合要续接的那条对话。翻译层改为用 `next()` 拉取。

一条运行拥有一棵 CLI 进程树，因此在分叉时、回合被取消或失败时，以及插件卸载时，它都会被释放。

## Alternatives considered

**通过浏览器扩展桥接已登录的 Web 会话。** 它按订阅认证并使用真实会话，也是最初的偏好。被否决的理由是机制而非口味：没有任何 Web 聊天产品暴露 function calling，因此该桥接只能靠提示词层面的工具调用模拟来驱动循环——那会是系统中最脆弱的部件，而本仓库从未拥有过它。

**无头浏览器自动化。** 同样的缺陷，且它驱动的是厂商并未为自动化提供的接口。

**复用 `cxh-subagent-claude-code` 而不新建适配器。** 它的契约是一份完成的答案，而非 harness 去执行的工具调用流。共用它意味着一个提供方里塞进两种契约。

**把 SDK 进程投影复制进本包。** 否决：进程树所有权决定由谁证明该树已退出，这条契约不能分叉。它被移入 [`cxh-claude-agent-sdk-process`](../../../../packages/subagent/claude-agent-sdk-process/README.zh.md)，并留在 `packages/subagent/` 之下，因为新建顶层分组会是比它所服务的这次提取更大的结构性改动。

## Consequences

归属不变式在这里是空的：本适配器不发出任何提供方 HTTP 请求，因此没有可合并头部的对象。没有任何 gate 以机械方式强制 `attributionHeaders()`，这正是要在包 README 中明说其为空、而不是任由它看起来像疏漏的原因。

把订阅 CLI 用作另一个 harness 的模型后端，可能超出该订阅的许可范围。本仓库已在委托层做过一次这样的决定；把它提升为主要模型路由更进一步，而这个决定属于运维者。

图片无法穿过：携带图片的请求以 `UNSUPPORTED_CONTENT` 失败，而不是在丢弃图片后照常发送。

没有任何 keyless 快照覆盖这条路由，这是有意为之。录制 fixture 意味着把真实 agent 跑一次并采集其会话日志，而对这条路由而言，那花掉的是真实的产品订阅而非 API 密钥。这一缺口的代价小于表面所见：[`cxh-llm-replay`](../../../../packages/test-support/llm-replay/README.zh.md) 在 `llm` seam 处拦截，因此快照会完全替代本适配器——它证明的是 composition，而不是工具桥接、会话亲和或流翻译，而这三者都由本包自己的测试覆盖。取而代之交付的是一份可运行的 composition，位于 [`examples/headless-agent/agent-cli.cordis.yml`](../../../../examples/headless-agent/agent-cli.cordis.yml)。愿意花费额度的运维者随时可以补录该 fixture。

该路由在 base bundle 中以休眠方式挂载。没有配置任何提供方就没有路由，因此从未让 CLI 登录的宿主不会提供可选项，也没有任何请求能到达它。
