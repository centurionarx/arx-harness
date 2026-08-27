# Agent Note：从 harness 自己的界面停止它

Status: implemented

[English](2026-08-27-stopping-the-harness-from-its-own-ui.md) | 中文

## 问题

启动了 Web 服务器的用户，无法从正在使用的界面停止它。launcher 早已拥有有界的进程退出，并以 `ctx.appExit` 提供，但没有任何客户端能触及它，因此结束 harness 意味着回到终端里找进程。

"退出"也没有约定的所指。harness 使用匿名身份，自身没有登录态，因此这一行既可能指停止进程，也可能指清除其宿主 CLI 持有的 provider 凭据，还可能只是回到起始视图。这是三种不同的产品。

## 决策

退出只停止 harness，别无其他。它不清除任何凭据：harness 从宿主读取的 provider 令牌——订阅路线下即 Claude Code 的 OAuth 文件——属于那个 CLI 的安装，本界面上的按钮若撤销它，就伸到了 harness 自身生命周期之外。

`host.exit` 承载该请求。它在进程消失之前作答，因为承载答复的连接会随服务器一同死去：客户端听到的是 `stopping`，永远不是 `stopped`。若某部署的 launcher 未提供退出请求，则以 `exit-unavailable` 拒绝，而不是在一个不会发生的关停上解析完成。

该方法与原生对话框和配置面一同被固定在 loopback。`trustedHosts` 是防 DNS 重绑定的围栏，明确不是身份认证，因此在 LAN 部署中，未被固定的退出方法等于把关机开关交给任何可达的调用方。

[`arx-client-ui-exit`](../../../../packages/client/ui-exit/README.zh.md) 占据 `sidebar.exit`——ui-sidebar 在 Settings 下方声明的座位。既有的 `sidebar.footer.action` 列表渲染在 Settings *上方*，因此 footer action 无法满足该需求；shell 声明新座位，而不是移动旧列表，否则已注册在那里的每个 action 都会随之移位。

该行先确认。这不是仪式：这个控件会终止为当前页面提供服务的服务器，因此使用者无法从眼前的界面撤销它。确认框的主操作命名后果（"Stop the server"），而不是重复"Exit"——后者会让可访问性树里同时出现两个同名按钮。

## 备选方案

**复用 `sidebar.footer.action`。** 它本就是侧边栏底部的列表且已有占位者，注册一行退出控件几乎零成本。否决：它渲染在 Settings *上方*。把列表移到下方，会让已在其中的每个 action 随之移位——为了放一行新控件，去改动无关功能的可见位置。

**不做确认。** 会话是持久的、重启后可继续，因此这个操作在要紧的意义上是可恢复的。仍然否决：恢复需要一个使用者未必开着的终端，而提供该按钮的界面正是点击后第一个消失的东西。

**把退出当作登出。** 清除宿主 CLI 的 provider 凭据，会让这个词具有多数产品里的含义。否决：那份凭据属于另一个程序的安装，并与该机器上对它的其他一切使用共享，因此这个按钮会伸到 harness 之外，去撤销它从未签发的东西。

**返回 `stopped`。** 等进程真正消失再作答，读起来更诚实。否决：这个答复无法送达——承载它的连接会随服务器一同死去——因此等待总是以一个意味着成功的传输错误告终。

## 后果

已开始的关停不会回到 idle。该行显示 `Stopping…` 并禁用自身，因为它所在的页面正在消失；没有可渲染的成功态，也没有从浏览器重启的路径。

`sidebar.exit` 是 `kind: 'single'`：只有一个退出控件才是本意，列表则会让两个部署各贡献一个。会话得以留存——日志是持久的，重启后可继续——正是这一点让一个无法撤销的操作变得可以接受。

## 相关

[配置面边界](../architecture/2026-07-30-config-plane-boundaries.zh.md) 掌管哪些方法仅限 loopback、以及为何 `trustedHosts` 不是身份认证；本笔记出于同样理由把关停请求加入该集合。[CLI 信号关停升级](../bug-fix/2026-08-03-cli-signal-shutdown-escalation.zh.md) 掌管 launcher 收到请求后的行为。
