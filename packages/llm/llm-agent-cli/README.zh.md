# @centurionarx/cxh-llm-agent-cli

[English](README.md) | 中文

一个 `LlmAdapter`：把以订阅身份认证的厂商 CLI 当作普通模型路由来驱动。harness 保留自己的 agent 循环、工具、沙箱与会话日志；改变的只是通往模型的传输层。全程不涉及任何 API 密钥：CLI 读取宿主机已有的登录态。

该路由在配置之前处于休眠状态。composition 负责挂载插件；是否提供服务由部署决定。

## 一次 CLI 运行如何变成一次模型调用

厂商 CLI 本身是带工具循环的 agent。四项设置把它压缩为单次模型调用，且其工具调用会原样返还给 harness 而不被执行：

| 设置 | 原因 |
|---|---|
| `systemPrompt` ← 请求的 `system` | 用 harness 的提示词替换 CLI 自己的，使模型所见即会话日志所存。 |
| `mcpServers` ← 一个进程内服务 | 让模型看到 harness 工具 schema 的唯一受支持方式。 |
| `disallowedTools` ← CLI 内置工具，`canUseTool` ← 拒绝 | 模型请求的工具无法在 CLI 内部执行——那里 harness 既看不到调用，也看不到结果。 |
| `maxTurns: 1` | 一个 assistant 回合即停——正是 `stream()` 的契约。 |
| `skills: []` | 省略它并不等于"关闭 skills"：SDK 明确说明此时 CLI 自身的默认值仍然生效，于是宿主机的 skill 目录会经由一个 harness 从未注册的工具抵达模型。skill 改为经 `ctx.skills` 抵达 harness 模型，在那里加载是一次被记录的工具调用。 |

`settingSources` 保持未设置，因此 SDK 读取宿主机常规的 Claude 设置与原生账户状态。这份继承*就是*认证本身。

## 工具名带命名空间，且这对模型可见

CLI 会把进程内 MCP 服务的工具呈现为 `mcp__cxh__<名称>`。因此模型发出的是 `mcp__cxh__bash`，本适配器在 harness 看到该调用之前将其映射回 `bash`。带前缀的形式正是模型在自身上下文中读到的内容，所以一份点名工具的系统提示词用的是 harness 名称，而模型看到的是带前缀的名称。

工具 schema 以 JSON Schema 原样传递。SDK 自带的 `tool()` 辅助函数接受 Zod shape，会迫使 harness 注册的每个工具都经历有损转换，因此本包改为在低层 MCP 服务上直接应答 `tools/list`。

## 会话亲和

`LlmAdapter` 是无状态的：每次 `stream()` 都收到完整历史。厂商 CLI 会话不是——它持有自己的对话。每一步都重放全部文本记录会打平角色结构、丢失厂商的提示词缓存，并把订阅额度花在重读该会话已知的内容上。

因此每个 harness 会话与服务它的厂商会话配对，以 `GenerateOptions.sessionId` 为键，并以逐消息摘要列表记住。若某次请求的历史仍是该厂商会话已消费内容的*延伸*，就恢复该会话并只投递增量——一条新的用户消息或一份工具结果，以真正的 `tool_result` 块承载。其余情况——压缩重写了历史、plan 模式的编辑、分支——都使该厂商会话不再是合法续接，于是文本记录会以带标签的文本重放进一个全新会话。这条重放路径是有损的，而规避它正是配对存在的全部意义。

配对保存在内存中。重启后每个会话重放一次，随后重新配对。

## 配置

每个模型必须填写 `contextWindow`。自动压缩从服务该请求的路由解析容量，并拒绝对不声明容量的路由运行，而厂商 CLI 本身不披露任何容量。

```yaml
- id: llm-agent-cli
  name: '@centurionarx/cxh-llm-agent-cli'
  config:
    cwd: /srv/workspace
    providers:
      claude-subscription:
        displayName: Claude (subscription)
        disposeGraceMs: 3000
        models:
          - id: claude-sonnet-4-5
            contextWindow: 200000
            maxTokens: 8192
```

`cwd` 是部署事实而非会话事实：一个适配器为进程内所有会话服务。未设置时，CLI 在 harness 进程所在目录运行。

## 归属

强制的 `attributionHeaders()` 不变式在这里是空的。本适配器不发出任何提供方 HTTP 请求——调用由 CLI 发起并携带它自己的身份——因此没有可供合并头部的请求。该要求在此明确声明，而非被无声跳过。

## Model Experience

### Vendor CLI request

#### What the model sees

原样的 harness 系统提示词以替代 CLI 自己的、以 `mcp__cxh__` 命名并保持 JSON Schema 形态的 harness 工具 schema，以及以下二者之一的对话：投递进已恢复厂商会话的增量——新的用户消息与以真正 `tool_result` 块承载的工具结果——或在没有厂商会话可续接时，对整份文本记录的带标签重放。

#### Token effect

重放路径把整份文本记录作为一条用户消息重新发送并为此付费；恢复路径只发送增量。请求走哪条，取决于其历史是否仍是厂商会话已消费内容的延伸。

#### KV Cache effect

已恢复的厂商会话在其自身回合之间保留厂商维护的前缀缓存。一旦发生分叉，该会话被丢弃，下一次请求从冷启动开始并再次为完整前缀付费。

### Vendor CLI response

#### What the model sees

不再额外增加内容：响应就是模型自己的输出。推理、文本与工具调用被翻译为 harness chunk，每个工具名在循环记录之前从 `mcp__cxh__<名称>` 映射回去。

#### Token effect

用量按厂商声明的口径上报，未命中缓存的输入、缓存读取与缓存写入分别保留在 harness 计价所用的独立桶中。

#### KV Cache effect

自身不产生影响；响应不改变请求前缀。

## Known Limitations and Deferred Work

- **图片无法到达厂商 CLI**——携带 image 块的请求以 `UNSUPPORTED_CONTENT` 失败，而不是在丢弃图片后照常发送。
- **亲和保存在内存中**——配对不会写入会话日志，因此无法跨重启存活。可持久化的变体可以把它放进 `finish` chunk 的 `ReplayEnvelope`。
- **SDK 版本按精确值锁定**——`0.3.220`，与 [`cxh-claude-agent-sdk-process`](../../subagent/claude-agent-sdk-process/README.zh.md) 中的投影一致。
