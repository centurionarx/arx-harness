# @arx-ai/arx-client-ui-exit

[English](README.md) | 中文

本包填充 `sidebar.exit`——ui-sidebar 在 Settings 下方声明的座位——提供一行停止 harness 的底部控件。关停本身属于 launcher：该行通过 `host.exit` 发出请求，launcher 以自己的有界进程退出作答。

该行在发出请求前先确认。这个控件会终止为当前页面提供服务的服务器，因此使用者无法从眼前的界面撤销它；会话日志是持久的，重启后可继续。已开始的关停不会回到 idle——它所在的页面正在消失——在连接随服务器一同断开之前，该行显示 `Stopping…`。若某部署的 launcher 未提供退出请求，则回答 `exit-unavailable`，该行如实告知，而不是在一个不会发生的关停上解析完成。

`host.exit` 仅限 loopback。`trustedHosts` 是防 DNS 重绑定的围栏而非身份认证，因此在 LAN 部署中，未被固定的退出方法等于把关机开关交给任何可达的调用方；[`arx-client-connection`](../connection/README.zh.md) 将它与原生对话框和配置面一同固定。

occupant 通过 `slots.inject()` 安装，因此无论该行先于还是后于 ui-sidebar 激活都能工作；声明折叠时它会撤回，teardown 后不留残余。它不保留运行时状态——确认阶段存放在组件内。node 半边是空的 Loader seat。

## 模型体验

无，因为本包只贡献浏览器呈现；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；本包既不组装也不发送 provider 请求。

## 已知限制与暂缓事项

- **退出不等于登出** —— harness 使用匿名身份，自身没有登录态，因此该行只停止进程，不清除任何凭据。harness 从宿主读取的 provider 凭据（例如 Claude Code 的令牌）保持原样。
- **无法从浏览器重启 harness** —— 页面随服务器一同消失，下一次启动来自终端或服务管理器。
