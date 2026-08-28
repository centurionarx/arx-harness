# 平台支持

[English](platforms.md) | 中文

arx Harness 可在 Linux、macOS 与 Windows 上运行。agent loop（智能体循环）、会话持久化、插件解析、settings、凭据，以及除 shell 之外的每一个工具，在三个平台上表现一致。本页说明有哪些差异，并链接到拥有各项契约的包。

## 每台宿主机只挂载一套 shell

base bundle 按平台只挂载一个 shell 家族：POSIX 上是 `bash-sandbox` 与 `tool-bash`，Windows 上是 `pwsh-sandbox` 与 `tool-pwsh`，因为 bash 没有 Windows 运行器。两种情况下权限面完全相同——同一套 sandbox 策略、权限切换器、审批服务，以及对 `ctx.fs` 的围栏都照常生效（[行集合与恢复 bash 的完整配方](../../../packages/bundle/base/README.zh.md)）。

因此在 Windows 上工作的模型写的是 PowerShell，而不是 bash。以 shell 脚本编写的命令、skill 与 hook 无法直接沿用。

PowerShell 本身是被解析出来的，而非硬性要求：先看显式的 `pwshPath`，再看 PowerShell 7 的安装位置，然后是 `PATH`，最后把 Windows PowerShell 5.1 作为遗留兜底（[解析规则及其注意事项](../../../packages/shell/pwsh-local/README.zh.md)）。

## 限制的差异在种类，而不只在机制

| 宿主 | 后端 | 限制范围 |
|---|---|---|
| Linux | `landlock-run` 或 bubblewrap | 读与写 |
| macOS | `sandbox-exec` | 读与写 |
| Windows | 通过 Win32 API 的 ACL 受限令牌 | 仅写 |

Windows 后端不需要任何外部二进制：它直接调用 `CreateRestrictedToken`。它放弃的是读侧限制与网络策略——这些不在写受限令牌的范围内——以及受限进程捕获其"孙进程"管道输出的能力：必须捕获输出的工具无法在受限模式下运行（[完整边界及其边缘情形](../../../packages/sandbox/sandbox-windows-acl/README.zh.md)）。

首次向某个 workspace 写入受限内容时，ACL 会在整棵目录树上传播一次，每台机器每个 workspace 只发生一次。在大型 workspace 上，这第一条命令会很慢。

## Windows 上的进程控制更粗粒度

POSIX 子进程运行在自己的进程组中，可被整体信号化。Windows 通过 `taskkill /T /F` 以尽力而为的方式终止进程树，中断以整个控制台范围的 CTRL_C 事件投递，`SIGTSTP` 与 `SIGHUP` 被拒为不可用，强制终止被报告为退出码 1 且不带信号（[终止与信号契约](../../../packages/subprocess/subprocess-local/README.zh.md)）。

取消一条长时间运行的命令，正是受此影响的日常动作。

## 持久性与插件解析等价，但用的是不同原语

会话日志在 POSIX 上通过 `link()` 加父目录 fsync 发布，在 Windows 上通过不带替换的 write-through 重命名发布，因为 Node 在那里并不暴露父目录 fsync（[物化契约](../../../packages/session/session-persistence-jsonl/README.zh.md)）。

profile 的模块兜底目录在 Windows 上用 junction 链接每个包，因此安装与运行都不需要提权，也不需要开发者模式（[profile 布局](../../../packages/boot/app-boot/README.zh.md)）。

## Windows 不强制的一项

凭据文档的权限检查不会运行。在 POSIX 上，`$ARX_HOME/.credentials.yaml` 只要带有任何 group 或 other 权限位，就会在被解析之前失败，错误信息会指明用 `chmod 600` 修复；Windows 没有可供检查的 mode，因此这项检查被跳过，而不是伪造一个（[凭据存储契约](../../../packages/credentials/credentials-local/README.zh.md)）。

请改用账户自身的 ACL 保护 harness home。
