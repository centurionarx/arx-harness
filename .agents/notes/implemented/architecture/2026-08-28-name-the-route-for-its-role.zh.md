# Agent Note: 按角色命名已组合的路由，而不是按厂商

Status: implemented

[English](2026-08-28-name-the-route-for-its-role.md) | 中文

## Problem

本 harness 不再随包提供任何 provider（提供方），但每份组合仍在使用某一家厂商的词汇：路由键 `deepseek-official`、模型 id `deepseek-v4-pro` 与 `deepseek-v4-flash`、凭据引用 `DEEPSEEK_API_KEY`、硬编码的端点，以及设计令牌中以该厂商命名的品牌色阶。

[把该厂商变成配置而非代码](2026-08-28-deepseek-is-configuration-not-code.zh.md)有意保留了这些名字：路由键指称的是第三方事实，改名就会描述一个并不存在的端点。这条理由适用于部署真正会拨打的路由，但不适用于这里——那次变更之后，随包组合根本不声明任何端点，于是该键指称的是一个没有任何配置去连接的提供方。

删除适配器还留下了五份配置和四份包 README，它们要么指名已删除的包，要么依赖 SDK 服务器已经不再具备的 `initialize` 回退。每一处都会在加载或握手时失败；本项工作开始前，基线分支的 CI 已有四个 job 变红。

## Decision

已组合的路由是 `primary`，其模型是 `primary-pro` 与 `primary-flash`，凭据引用是 `PRIMARY_API_KEY`。这些都是部署方会覆盖的占位名，而且它们本身就说明了这一点：没有任何地方声称存在一个真实端点会应答它们。端点仍然是随包写死的字面量，位于永不解析的保留顶级域 `.test` 下：[配置来源归属](2026-08-04-configuration-source-ownership.zh.md)把组合置于启动 shell 之上，正是为了不让一个游离的 `PRIMARY_BASE_URL` 决定已解析的凭据、以及承载用户代码的提示词被发往何处。部署方要么替换该字面量，要么在更高的层级覆盖它——也就是 patch overlay，keyless smoke 正是这样把随包的那棵树指向自己的 mock 服务器。

`arx-llm-pi-ai` 自身的 `deepseek` catalog（目录）键保持不动。该键属于上游库的词汇，而不属于本仓库；改名会破坏那个用于拦截目录漂移的类型。

设计令牌的主色阶改名为 `--arx-static-brand-*`，并重绘为 arx 自己的蓝色。每一档都保留了它所替换那一档的 WCAG 相对亮度，因此与表面色和文字色令牌之间的对比度没有变化。

## 手工声明的路由必须写全哪些字段

pi-ai 的内置 catalog 不描述 `primary` 路由，因此指名它的 profile 什么都继承不到，必须补全整个提供方：

- `models`——没有列表的路由解析不出任何模型，加载器会拒绝整棵树。
- 每个模型的 `reasoningEfforts`——缺了它，路由级的 `reasoning` 档位无法服务，请求以 `UNSUPPORTED_REASONING_EFFORT` 失败。
- `compat.maxTokensField`——`openai-completions` 默认发送 `max_completion_tokens`，普通 chat-completions 宿主会忽略该字段。
- `baseURL`——内置 catalog 不提供，因此缺少它的路由会在加载时被拒绝。

## Alternatives considered

**保留前一份笔记所决定的厂商路由键。** 它的论据是 `deepseek-v4-pro` 正是端点应答的 id。这里是取代而非否定：对于已配置的路由，那句话成立，而本仓库不再配置任何路由。指名真实厂商模型的占位名才是谎言，反过来不是。

**在 SDK 服务器里重新挂上适配器回退。** 这样打包的 Python 运行时和启动测试都无需改配置即可继续工作。已否决：前一份笔记删掉该回退，恰恰是因为它会用调用方从未配置过的提供方来应答；为了省下五份 profile 而恢复它，是用真实约定去换五行 YAML。

**在打包的 Python 运行时里以休眠方式挂载 `arx-llm-pi-ai`。** 它不指名厂商，也不含密钥，看起来很干净。已否决：没有 profile 就没有路由，于是每一次零配置启动都会拒绝 Python SDK 自己的默认 `provider`/`model`。现在该运行时声明了那条路由，端点与凭据都来自环境，同样不含密钥。

**让示例端点改读 `PRIMARY_BASE_URL`，而不是随包写死字面量。** 这样 keyless smoke 只需一个变量就能把随包的树指向 mock 服务器，而示例 README 本来也列着这个名字。已否决，`verify-config-source-ownership` 同样会拒绝它：端点决定已解析的凭据发往何处，让 shell 来命名它就颠倒了那套让部署层级得以成立的顺序。overlay 层级能做同样的事，且不带来这种颠倒。

## Consequences

每份重放 fixture 的头部都记录着录制时的提供方和模型，因此改名会重写它们——一次变更涉及 597 个文件。这些 fixture 是对着自己的录制回放的，所以既不需要重新录制，也不需要密钥。

`LICENSE`、`THIRD_PARTY_NOTICES.md`、`vendor/README.md` 以及已归档的 Agent Note 保留它们所载的上游署名。MIT 许可允许再许可，条件是该声明随作品一同传播；`vendor/README.md` 则钉住其同步流程所解析的上游 SHA。二者都不是品牌标识。

`Issue policy` 与 `Issue lifecycle` 有意检出仓库的**默认分支**，因此无论某个 pull request 包含什么，它们运行的都是默认分支的 `.github/issue-management/config.json`。在特性分支上修正组织名，因而无法让这两个检查变绿；它们会一直红着，直到修正进入默认分支。这是可信检出模式的性质，而不是任一分支的缺陷。

真实 API 的 `e2e` job 需要仓库 secret `PRIMARY_API_KEY_EXTERNAL` 和仓库变量 `PRIMARY_BASE_URL`。它的预检在缺少其一时直接拒绝，而不是让会自动跳过的测试套件报出虚假的绿色。

## Related

[把该厂商变成配置而非代码](2026-08-28-deepseek-is-configuration-not-code.zh.md)删除了本笔记所去名的那个适配器，并把 `ui-settings-models` 的死路径列为遗留工作；本笔记删除了它们。[不随包提供默认模型](2026-08-27-no-shipped-default-model.zh.md)移除了让厂商命名的路由得以被触达的那个组合默认值。
