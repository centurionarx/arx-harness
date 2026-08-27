# Agent Note：不发布默认模型

Status: implemented

[English](2026-08-27-no-shipped-default-model.md) | 中文

## Problem

base bundle 曾把 `deepseek-official` / `deepseek-v4-flash` 指定为每个入口点创建 Agent 时的默认值，并把 `deepseek-official` 钉为 Web 搜索提供方。发布默认值会悄悄消耗它所指向的那个账户，而且替部署做了只有该部署才知道的决定。

## Decision

两者都不再指定。`agent-default-model` 保留其组合配置项与 settings 分节；`provider` 与 `model` 都变为可选，在部署组合出默认值或用户保存选择之前，`currentSelection()` 返回 `undefined`。这一对只有同时出现才有意义：半个选择指不向任何可达路由，因此等于没有选择。

`searchProvider` 本就是可选的，且选择语义有明确文档——恰好一个可用的已注册提供方会自动选中，两个则以 `WEB_PROVIDER_AMBIGUOUS` 高声失败。把 DeepSeek 钉死会用组合顺序的答案覆盖这套语义，因此该钉死已移除。

## Consequences

`AgentOptions.provider` 与 `.model` 本就是可选的，因此 Agent 创建时不带模型种子，而不是被塞进一个编造的值。Web BFF 会拒绝第一个需要模型的请求，并指明尚未选择任何模型——这与会话路由没有适配器时早已存在的拒绝路径是同一条。`SessionModels.current` 变为可选，且在没有选择时 `routable` 为 false，于是阻断输入的界面读同一个字段即可覆盖两种成因。

Headless 则直接抛错：它只跑一个任务就退出，没有可回退的选择器，因此必须说明本次运行用哪个模型。

`llm-deepseek` 与 `web-search-deepseek` 仍然挂载，且在没有密钥时处于休眠——都不内联端点或凭据——因此想要 DeepSeek 的部署仍可用 API 密钥启用它。改变的是：不再有任何东西出厂就指向它。

## Alternatives considered

**禁用 `agent-default-model` 配置项。** `bundle/headless` 与 `host/apiproxy` 都在 `inject` 中声明了它，服务缺失会阻止它们加载，Web 应用根本起不来。

**改指定另一个提供方作为出厂默认值。** 每个候选者都有与 DeepSeek 相同的缺陷：bundle 无法知道部署持有哪个账户，猜错就会在首次启动时消耗别人的额度。

**保留默认值并写文档说明如何更改。** 需求是让用户来选。必须被覆盖的默认值仍然是 bundle 做出的选择，而且第一个会话会在任何人读到文档之前就跑起来。
