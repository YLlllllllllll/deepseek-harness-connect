# deepseek-harness-connect

用一条命令安装 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)，连接你自己的 OpenAI-compatible endpoint。

```bash
curl -fL --progress-bar https://raw.githubusercontent.com/YLlllllllllll/deepseek-harness-connect/v1.1.0/connect.sh | bash -s -- 'http://localhost:8000/v1'
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
curl -fL --progress-bar https://raw.githubusercontent.com/YLlllllllllll/deepseek-harness-connect/v1.1.0/connect.sh -o connect.sh
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
node --test test/connect.test.mjs
bash release.sh v1.1.0
```

源码发布包包含安装器、文档、测试、打包脚本和许可证。可选运行包额外包含已安装的
公开 npm 依赖；两者都不含 endpoint、API key、会话或机器配置。
`dist/` 下生成 `.tar.gz` 与 SHA-256，可上传 GitHub Release 或内网下载站。

维护者可通过 `bash bundle-runtime.sh /path/to/installed/runtime` 生成运行包；
将输出的 SHA-256 更新到安装器，并完成重定位和 Web UI 检查后再发布。

DeepSeek Harness 是 developer preview。Web 中提交任务以及 `--run` 会运行真实 agent，
它可以使用 Harness 提供的文件和命令工具；请从准备操作的项目目录运行。

MIT License。本项目是独立连接工具，不是 DeepSeek 官方项目。
