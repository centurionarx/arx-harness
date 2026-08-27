# @arx-ai/arx-llm-agent-cli

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
| 翻译在 assistant 回合处结束 | 继续读取会消费本次调用从未请求的下一个回合。CLI 自身的 `maxTurns` 无法表达这一点：触达它会让 SDK 抛出 error result，于是该上限会把每个普通的工具调用回合都变成失败。 |
| 每个工具带 `_meta['anthropic/alwaysLoad']` | 否则 CLI 会把 MCP 工具藏在它自己的 tool-search 工具后面，模型会把整个回合花在搜索一个 harness 已经放进请求里的工具上。 |
| `skills: []` | 省略它并不等于"关闭 skills"：SDK 明确说明此时 CLI 自身的默认值仍然生效，于是宿主机的 skill 目录会经由一个 harness 从未注册的工具抵达模型。skill 改为经 `ctx.skills` 抵达 harness 模型，在那里加载是一次被记录的工具调用。 |

`settingSources` 保持未设置，因此 SDK 读取宿主机常规的 Claude 设置与原生账户状态。这份继承*就是*认证本身。

## 工具名带命名空间，且这对模型可见

CLI 会把进程内 MCP 服务的工具呈现为 `mcp__arx__<名称>`。因此模型发出的是 `mcp__arx__bash`，本适配器在 harness 看到该调用之前将其映射回 `bash`。带前缀的形式正是模型在自身上下文中读到的内容，所以一份点名工具的系统提示词用的是 harness 名称，而模型看到的是带前缀的名称。

工具 schema 以 JSON Schema 原样传递。SDK 自带的 `tool()` 辅助函数接受 Zod shape，会迫使 harness 注册的每个工具都经历有损转换，因此本包改为在低层 MCP 服务上直接应答 `tools/list`。

## 每一步一条厂商运行

`LlmAdapter` 是无状态的：每次 `stream()` 都收到完整历史。厂商运行不是——它持有自己的对话。因此每次调用开启属于自己的运行，把文本记录作为提示词投递，并在回合结束时释放该运行。

运行无法跨步骤延续，因为 harness 与 CLI 对「由谁关闭一次工具调用」的判定并不一致。工具由 harness 自己执行，所以 CLI 启动时拒绝全部工具。在 CLI 那一侧拒绝是终局的：它写下自己的拒绝结果并继续往下走。随后 harness 的真实结果抵达时，该运行早已关闭那次调用，于是回合永远无法完成。把 CLI 的 `tools/call` 一直挂起到 harness 作答同样不可行——`MCP_TOOL_TIMEOUT` 是每次调用的硬性挂钟上限，进度通知不会延长它，因此任何等待人工批准的工具都会被时钟判失败。

代价是每一步都重发文本记录：角色结构被打平为带标签的文本，厂商的提示词缓存丢失，订阅额度被花在重读上一条运行已知的内容上。这份代价随对话增长。它换来的是能够终结的回合。

厂商自身的 `resume` 并不能消除这一点：恢复需要 `persistSession`，而那会把每一次对话的副本写入宿主机的 Claude 目录——处于本 harness 的控制与生命周期之外，且与它已经维护的会话日志重复。

一条运行拥有一棵 CLI 进程树，因此在其回合结束、失败或被取消时，它都会被释放。

## 配置

每个模型必须填写 `contextWindow`。自动压缩从服务该请求的路由解析容量，并拒绝对不声明容量的路由运行，而厂商 CLI 本身不披露任何容量。

```yaml
- id: llm-agent-cli
  name: '@arx-ai/arx-llm-agent-cli'
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
            acceptsImages: true
```

`acceptsImages`按模型设置，默认为 false。CLI 不暴露任何目录，因此由路由声明哪些模型接受图片输入；在拒绝图片的模型上声明它，会把每一张附加的图片都变成失败的请求，而不是被拒绝的附件。图片字节从 `ctx.attachments` 读取，遵循厂商自己写明的限制——这些限制是固定的而非可配置的：超出它们编码只会产生一个被提供方拒绝的请求，而不是更慢的请求。

`cwd` 是部署事实而非会话事实：一个适配器为进程内所有会话服务。未设置时，CLI 在 harness 进程所在目录运行。

## 归属

强制的 `attributionHeaders()` 不变式在这里是空的。本适配器不发出任何提供方 HTTP 请求——调用由 CLI 发起并携带它自己的身份——因此没有可供合并头部的请求。该要求在此明确声明，而非被无声跳过。

## Model Experience

### Vendor CLI request

#### What the model sees

原样的 harness 系统提示词以替代 CLI 自己的、以 `mcp__arx__` 命名并保持 JSON Schema 形态的 harness 工具 schema，以及以下二者之一的对话：投递进活跃厂商运行的增量——新的用户消息与以真正 `tool_result` 块承载的工具结果——或在没有运行可续接时，对整份文本记录的带标签重放。

#### Token effect

重放路径把整份文本记录作为一条用户消息重新发送并为此付费；续接的回合只发送增量。请求走哪条，取决于其历史是否仍是活跃运行已消费内容的延伸。

#### KV Cache effect

活跃运行在其自身回合之间保留厂商维护的前缀缓存。一旦发生分叉，它被释放，下一次请求开启一条冷运行并再次为完整前缀付费。

### Vendor CLI response

#### What the model sees

不再额外增加内容：响应就是模型自己的输出。推理、文本与工具调用被翻译为 harness chunk，每个工具名在循环记录之前从 `mcp__arx__<名称>` 映射回去。

#### Token effect

用量按厂商声明的口径上报，未命中缓存的输入、缓存读取与缓存写入分别保留在 harness 计价所用的独立桶中。

#### KV Cache effect

自身不产生影响；响应不改变请求前缀。

## Known Limitations and Deferred Work

- **目前只有一个厂商**——本包的命名描述的是形态而非名单：它只驱动 Claude Agent SDK，因此 Claude 订阅是它服务的唯一登录。第二个厂商意味着第二套 SDK，带有自己的协议与进程投影；它究竟以另一个包的形式出现，还是作为本包内部的一个 seam，尚未决定——包名不应被读作任何一方的承诺。
- **图片需要一个声明支持它的模型，以及已挂载的附件存储**——只有 `acceptsImages` 为真的模型才服务图片，也只有挂载了 `attachments` 的组合才能读到它们的字节。任一缺失都会让请求以 `UNSUPPORTED_CONTENT` 失败，而不是丢弃图片后照常发送。图片之外的文档在这里没有任何表示形式。
- **活跃运行不跨进程存活**——对话与其 CLI 一同驻留内存，因此重启后每个会话重放一次并开启新运行。没有任何持久化形式能承载它：该状态是一个运行中的进程，而非一条记录。
- **SDK 版本按精确值锁定**——`0.3.220`，与 [`arx-claude-agent-sdk-process`](../../subagent/claude-agent-sdk-process/README.zh.md) 中的投影一致。
