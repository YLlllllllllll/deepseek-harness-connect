# deepseek-harness-connect

用一条命令安装 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)，连接你自己的 OpenAI-compatible endpoint。

```bash
curl -fL --progress-bar https://raw.githubusercontent.com/YLlllllllllll/deepseek-harness-connect/v1.2.0/connect.sh | bash -s -- 'http://localhost:8000/v1'
```

把最后一个参数替换为你的 endpoint。默认启动 Web UI；首次安装，后续复用。
支持 Linux / macOS 的 x64 / arm64。需要 Bash、curl、tar；不需要 sudo、Git 或 Python。
有合适的 Node.js 时直接复用，否则在用户目录安装 Node.js 24.15.0 并核对 SHA-256。
Harness 默认固定为 `0.2.1-rc.2`。

`v1.1.0` 在 Linux x64 / glibc / Node 24 ABI 137 上默认下载约 161 MiB 的预打包运行时，
校验 SHA-256 后直接解压，跳过现场 npm 解析、下载数百个包和安装的过程。
已包含完整依赖与原有许可证文件；安装包不含连接配置、会话、密钥或安装日志。
其他平台和 Node 版本继续使用 npm；包下载失败时自动回退 npm，校验失败则停止。
已有安装直接复用，不会重新下载运行包。

安装时显示 `[1/4] Node.js → [2/4] Harness → [3/4] endpoint → [4/4] Web UI`。
脚本和 Node 文件下载显示真实百分比；npm 不提供总下载大小，因此安装阶段每 5 秒
显示已耗时和完成的 HTTP/缓存操作数量。完整 npm 日志保存在安装目录的 `npm-install.log`。

## 使用

下载一次，之后可以直接运行：

```bash
curl -fL --progress-bar https://raw.githubusercontent.com/YLlllllllllll/deepseek-harness-connect/v1.2.0/connect.sh -o connect.sh
bash connect.sh 'http://localhost:8000/v1'
```

IPv6 地址保留方括号：

```bash
bash connect.sh 'http://[::1]:8000/v1'
```

`/v1` 可省略，脚本会补齐。通过 `/models` 发现模型；返回多个模型时要求显式选择：

```bash
bash connect.sh 'http://localhost:8000/v1' --model my-model
```

Web 默认监听 `127.0.0.1:3080`。远程运行时转发该端口，打开终端打印的完整链接，
保留 `?token=...`；首次访问后浏览器通过 cookie 认证。可追加 `--no-open --port 3081`。

其他模式：

```bash
# 仅安装和配置；不推理，不开端口。
bash connect.sh 'http://localhost:8000/v1' --install-only

# 检查普通对话、SSE 工具调用和工具结果回传；不执行模型生成的宿主代码。
bash connect.sh 'http://localhost:8000/v1' --check

# 在当前项目目录运行一次真实 agent 任务。
bash connect.sh 'http://localhost:8000/v1' --run 'Explain README.md without changing files'
```

API key 通过 `VLLM_API_KEY` 环境变量提供，不放在 URL 或命令行参数中，也不写入配置：

```bash
read -rsp 'API key: ' VLLM_API_KEY; echo; export VLLM_API_KEY
bash connect.sh 'http://localhost:8000/v1'
```

无鉴权服务使用占位 key。此安装器连接 Chat Completions API，配置
`llm-pi-ai` 的 `openai-completions` 路由；不是 Codex 的 Responses API 配置。
服务应已具备正确的 chat template、自动工具选择和模型对应的 tool-call parser。
脚本不启动、不修改推理服务。

## macOS App 与远程 SSH

[下载 macOS 安装包](https://github.com/YLlllllllllll/deepseek-harness-connect/releases/tag/v1.2.0)：
Apple Silicon 选择 `arm64.dmg`，Intel 选择 `x64.dmg`，拖入 Applications 后打开。
这是独立 Electron 窗口。社区构建未做 Apple Developer ID 签名或公证；
macOS 若拦截，可从系统设置的“隐私与安全性”确认打开，不需要关闭系统安全功能。

1. 首屏填写任意 OpenAI-compatible endpoint；多个模型时填写模型 ID。
2. 有下载代理时展开高级设置填写代理地址。首次安装显示进度，之后复用本地缓存。
3. 进入后打开 **Settings → Remote SSH**，填写主机、端口、用户名、密码或私钥；可添加多个连接，也可导入 `~/.ssh/config`。
4. 点击连接测试，再从 **Add Workspace → Select Remote Directory** 选择远程项目。文件侧栏直接操作远端，终端进入所选目录。密码终端会再次提示输入密码；命令和文件工具使用设置中保存的密码。

安装包不内置 endpoint、SSH 主机或密码。模型 API key 仅保留在本次服务进程的环境中，
App 不保存它；endpoint、模型 ID 和下载代理保存于 App 的用户数据目录。
SSH 连接及密码由社区插件保存在本机 DSH profile 中；插件把密码标记为 secret，
但这不代表 Keychain 加密，请按凭据文件保护该目录。插件的镜像目录和 shell helper
仍位于 `~/.dsh/remote-workspaces` 与 `~/.dsh/remote-ssh`，不受 `DSH_DATA_DIR` 控制。

**这一版实现本地 agent + 远程开发**。关闭 App 或本地离线会中断 agent，
尚未实现“远程完整 agent 常驻、本地断开后继续推理、重连恢复”的模式。
独立提交到远端作业系统的任务有自己的生命周期，和本地 agent 会话不同。

命令行也可启用相同界面：

```bash
bash connect.sh 'http://localhost:8000/v1' --remote-ssh
```

该选项固定 DSH `0.2.1-rc.2`、`dsh-better-sidebar@0.28.0` 和
`@zhangfengshun/dsh-remote-ssh@2.4.36`，通过官方 plugin 命令安装，
按侧栏→SSH 顺序加载。远程模式使用独立连接 profile；原有非 SSH profile 的会话不迁移。
macOS 无需额外安装 sshpass：连接工具使用 OpenSSH 原生 askpass。
安装器对固定 SSH 插件应用局部兼容修复：内部认证读取真实密码，向界面和模型返回的
连接列表仍然脱敏；编辑连接时留空密码会保留原密码。补丁不匹配则停止启动。
默认仅监听本机回环地址，App 通过启动时的 token 完成认证。

SSH 文件/命令由 [dsh-remote-ssh](https://github.com/ZhangFengshun/dsh-remote-ssh)
和 [dsh-better-sidebar](https://www.npmjs.com/package/dsh-better-sidebar) 提供。
可提供远程完整 DSH 的 [dsh-ssh-workspace](https://github.com/sincerity711/dsh-ssh-workspace)
目前声明绑定 `0.2.0-rc.2`，本项目尚未集成或验证它。

App 构建：`cd macapp && npm ci && npm run dist`（macOS）。
仓库的 `macOS app` Actions 工作流分别构建 Apple Silicon 和 Intel，
检查连接表单、preload 与 IPC 后生成 DMG/ZIP。源码中不含 Apple 签名凭据。

## 网络与安装位置

运行机器需要能访问 endpoint。首次安装还需要访问 GitHub、Node.js 和 npm 下载源，
可通过标准 `HTTPS_PROXY/https_proxy` 环境变量使用所在网络的代理。
只通内网而无下载出口时，需提供内网 Node 镜像和 npm registry，并从内网镜像取得本脚本。
模型 API 与 Harness 子进程直连，不继承下载代理。

默认数据目录：`~/.local/share/deepseek-harness-connect`（或 `$XDG_DATA_HOME` 下同名目录）。
不同 endpoint/model 使用不同连接目录；安装不会修改 shell 启动文件或全局 Codex 配置。
完整会话历史由 Harness 写入对应连接目录；该目录不应提交到公开仓库。

| 环境变量 | 用途 |
| --- | --- |
| `DSH_DATA_DIR` | 覆盖用户安装和会话目录 |
| `DSH_VERSION` | Harness npm 版本，默认 `0.2.1-rc.2` |
| `DSH_NODE_VERSION` | 缺少 Node 时安装的版本，默认 `24.15.0` |
| `DSH_NODE_MIRROR` | Node 下载源，默认 `https://nodejs.org/dist` |
| `DSH_NPM_REGISTRY` | npm registry，默认 `https://registry.npmjs.org` |
| `DSH_INSTALL_METHOD` | `auto`（默认）、`npm` 或 `prebuilt` |
| `DSH_RUNTIME_BASE_URL` | 可覆盖运行包下载目录；仍校验安装器内固定的 SHA-256 |
| `DSH_CONTEXT_WINDOW` | 覆盖 `/models` 声明的 `max_model_len`；缺失时使用 32768 |
| `DSH_MAX_TOKENS` | 输出预算，默认不超过 4096 或上下文的四分之一 |
| `DSH_API_TIMEOUT` | 每次 API 请求超时秒数，默认 180 |

Linux 使用官方 Node 二进制，需兼容的 glibc 系统；Alpine/musl 用户应先安装满足要求的
Node.js。此仓库的本机 live 验证覆盖 Linux x64；其他平台有安装路径支持，但尚无 live 验证。
预打包路径固定完整依赖，并通过 `BUNDLE.json` 绑定平台、Node ABI 与 lockfile SHA。
npm 路径只固定 Harness 顶层版本，不同时间首次安装仍可能解析到不同的传递依赖。

本机 Linux x64 对照：旧版空 npm 缓存首次安装约 135 秒；预打包运行时经本地 HTTP
下载、校验、解压和配置约 5.6 秒，重定位后的 Web UI 返回 HTTP 200。
后一个数据不包含公网下载耗时，实际总时间取决于 161 MiB 文件的下载速度。

## 本地检查和打包

```bash
bash -n connect.sh
node --test test/*
bash release.sh v1.2.0
```

源码发布包包含安装器、文档、测试、打包脚本和许可证。可选运行包额外包含已安装的
公开 npm 依赖；两者都不含 endpoint、API key、会话或机器配置。
`dist/` 下生成 `.tar.gz` 与 SHA-256，可上传 GitHub Release 或内网下载站。

维护者可通过 `bash bundle-runtime.sh /path/to/installed/runtime` 生成运行包；
将输出的 SHA-256 更新到安装器，并完成重定位和 Web UI 检查后再发布。

DeepSeek Harness 是 developer preview。Web 中提交任务以及 `--run` 会运行真实 agent，
它可以使用 Harness 提供的文件和命令工具；请从准备操作的项目目录运行。

MIT License。本项目是独立连接工具，不是 DeepSeek 官方项目。
