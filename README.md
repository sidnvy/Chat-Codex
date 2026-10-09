# Chat-Codex

一个小型、自托管的 MCP coding starter：让 ChatGPT 直接读写项目、修改代码和运行测试。独立编写，MIT；**无需 Charon、Coder、Codex CLI 或私有源码**。名称不表示与 OpenAI 官方产品有从属关系。

```text
你自己的 ChatGPT 插件
  → 你自己的 OpenAI Secure MCP Tunnel
  → 本机 127.0.0.1:8791/mcp（强制 Bearer）
  → 默认：每次操作一个临时 Docker 容器，只持久挂载项目目录
  → 显式 backend=host：直接以当前系统用户执行（无 OS 沙箱）
```

这是单用户 Node 项目的最小版本，Docker 模式离线，不是远程管理平台。没有公网监听、OAuth 服务、后台任务、交互式终端或自动依赖安装。ChatGPT 直接调用 MCP 工具，没有另外启动一个 Codex agent。

## 前置条件

- Linux、非 root 用户，Node.js 22+、npm。两种模式仅在 Linux 验证；host 模式明确拒绝其他平台和 root，不宣称支持原生沙箱。
- 默认 Docker 模式另需 Docker Engine（当前用户已有使用权限）。仅验证本地 daemon；macOS、Windows、rootless UID 映射和远程 daemon 尚未验证。本脚本不会调整 Docker 权限或 daemon 配置。
- Docker 模式：daemon 与 MCP server 在同一台机器；有约 512 MiB 的 runner 内存预算。host 模式不需要 Docker。
- 初次安装依赖、下载官方 Node 镜像需要网络；执行项目时容器禁网。
- 要连接 ChatGPT：自己的账号/工作区允许自定义 MCP；Platform 组织具备 Tunnel 权限。创建需 Read+Manage，使用需 Read+Use。账号开通、关联和新插件安装由你自己完成，本仓库不会创建授权。

## 1. 取得源码并安装

```sh
git clone https://github.com/sidnvy/Chat-Codex.git
cd Chat-Codex
```

收到源码 ZIP 时也可解压后 `cd Chat-Codex`。

**后续所有 npm 命令都在这个 checkout 中运行。** 项目数据和凭据放在它外面：

```sh
node --version
npm ci --ignore-scripts --no-audit --no-fund
npm test
# 仅 Docker 模式需要：
docker version
docker pull node:22-bookworm-slim
```

Docker setup 会把已拉取官方镜像的 digest 固定到本地 config；执行时 `--pull never`，不会暗中联网更新镜像。镜像升级由你重新审核后手动改 config。完整 registry 依赖锁在 package-lock.json；不运行安装脚本。

## 2. 创建项目和认证配置

使用两个**尚不存在**的新目录；它们的父目录需存在。不要选择 HOME、已有源码仓库根目录或任何含凭据的目录。

```sh
mkdir -p "$HOME/chat-codex-data"
export CHAT_PROJECT="$HOME/chat-codex-data/project"
export CHAT_PRIVATE="$HOME/chat-codex-data/private"
npm run setup -- "$CHAT_PROJECT" "$CHAT_PRIVATE" --backend docker
export CHAT_CODEX_CONFIG="$CHAT_PRIVATE/config.json"
npm start
```

setup 新建空项目目录、权限 0700 的私有目录，以及 0600 的 `config.json`、`token`、`tunnel-authorization`。重复运行会报目录已存在，不覆盖凭据。若 setup 在中途失败，先检查这两个新目录，再选择新的空目录重试。

`token` 只给本地 MCP 鉴权；`tunnel-authorization` 是同一 token 的 `Bearer …` header 格式。它们**不在项目目录，Docker 模式不挂进 runner**。host 模式的任意命令仍能以同用户权限访问这些文件，不能承诺隐藏凭据。OpenAI runtime key 是另一份凭据，不由 setup 生成。

配置示例（由 setup 自动写入；无需手工生成 token）：

```json
{
  "backend": "docker",
  "project": "/absolute/dedicated/project",
  "user": "1000:1000",
  "image": "node:22-bookworm-slim@sha256:<setup-resolved-digest>",
  "port": 8791
}
```

UID:GID 使用调用 setup 的非 root Linux 用户；容器以该 UID 写入挂载目录。只读系统、无网络、capabilities 全部移除、no-new-privileges、PID/内存/CPU 限制均写死在 runner，MCP 调用者不能改变。只挂载项目目录，不挂载 HOME、凭据、宿主 PID namespace 或 Docker socket。MCP 入口在宿主使用 Docker CLI，因此这个入口本身属于可信控制程序；Docker 容器并不是抵御内核漏洞的强虚拟机边界。

### 显式选择宿主机执行

**host 模式没有 OS 沙箱。** 命令拥有运行 MCP server 的系统用户权限，可以读写项目外文件、读取同用户凭据、访问网络和已有服务。文件工具的相对路径/符号链接检查只约束那些工具；它不限制 shell，也不是面对恶意代码的文件系统安全边界。只用于你愿意以当前用户运行的可信代码。

用新的目录创建独立配置（不需要 Docker 或镜像）：

```sh
mkdir -p "$HOME/chat-codex-host-data"
export CHAT_PROJECT="$HOME/chat-codex-host-data/project"
export CHAT_PRIVATE="$HOME/chat-codex-host-data/private"
npm run setup -- "$CHAT_PROJECT" "$CHAT_PRIVATE" --backend host
export CHAT_CODEX_CONFIG="$CHAT_PRIVATE/config.json"
npm start
```

生成的配置只有 `backend: "host"`、`project`、`port`；无须 `image` 或 `user`。命令使用启动 gateway 的 Node、`/bin/sh` 和当前 OS 用户。setup 与启动都会输出风险提示。

已有配置缺少 `backend` 时始终使用 Docker；允许值只有 `docker` 和 `host`，其他值（包括 null、空字符串）直接报错。Docker 不可用、镜像缺失、操作失败时绝不自动改用 host。切换已有配置需先停止入口，明确修改 `backend` 后重启；切回 Docker 前必须补齐上述 `image` 和非 root `user`。MCP 调用者不能用工具参数选择后端。

host 子进程只获得精简环境：Node 所在目录加 `/usr/bin:/bin` 的 PATH、临时 HOME/TMPDIR、LANG 和文件 worker 所需的项目路径；不继承 token、SSH agent 等环境变量。shell 只得到 PATH/HOME/LANG。每次操作清理临时 HOME，但这**不是安全隔离**：程序仍能自行定位真实 HOME、同用户凭据和文件。host 没有容器的禁网、只读根文件系统、CPU/内存/PID 限制；修改项目之外的宿主状态也会持久存在。

`npm run setup -- --help` 显示两种选择。两种模式的 loopback、Bearer、Host/Origin、五个工具和输出格式一致。

另外一个终端可检查：

```sh
curl --fail http://127.0.0.1:8791/healthz
# 仅说明入口进程存活
curl -s -o /dev/null -w '%{http_code}\n' \
  -X POST http://127.0.0.1:8791/mcp -d '{}'
# 必须是 401
```

不要把有秘密的现有项目直接作为工作区。最初只复制需要编辑的源码；不复制 `.env`、SSH key、云凭据、宿主敏感文件的硬链接。模型能运行任意容器内 shell，并能删除项目文件，所以使用可恢复的副本并在自己的电脑上审查 diff。

## 3. 实际本地验收

先停止不需要的测试服务；集成测试使用独立端口 18793（可用 TEST_PORT 修改）、临时目录和临时 token，不需要 OpenAI 账号：

```sh
npm run test:integration
```

这不是 mock。测试启动真实 SDK HTTP MCP server、通过认证的官方 MCP Client，调用真实 Docker runner：写入 add 函数 → 读回 → 测试失败（exit 1）→ edit_file 修复 → 测试通过（exit 0）。还检查缺失/错误 token、Origin、目录/符号链接越界、凭据及 socket 不可见、只读系统、禁网、命令超时、输出限额、容器清理。正常结束删除临时 fixtures。Docker 的 26 项本地集成检查通过，证据见 `VALIDATION.md`。

宿主机验收（同样只用临时目录，不需要 Docker）：

```sh
npm run test:host
```

它经过相同的真实 HTTP MCP 回路验证红→绿、五个工具、鉴权、路径检查、超时、输出上限和串行执行；不运行 Docker 的隔离断言。`npm test` 另验证默认/错误后端、不回退、无 Docker 的 host setup、普通后台子进程清理。

**本地通过不等于已经连接你的 ChatGPT 账号。** 后续隧道和插件步骤需要你自己的权限与在线验收。

## 4. 使用自己的 Secure MCP Tunnel

参照[官方 Secure MCP Tunnel 指南](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)：在自己的 Platform tunnel settings 创建 tunnel，关联目标 ChatGPT workspace，取得运行凭据。下载官方 tunnel-client。入口只监听 loopback；不需要修改路由器、防火墙或开放端口。

在第二个终端设置同样的私有目录，并用本地安全编辑器将**你自己的 tunnel runtime API key**保存到 `$CHAT_PRIVATE/runtime-key`，权限 0600。不要把 key 输入聊天、命令参数或 Git。这一步是你本人进行的账号配置，本项目没有替你执行。

```sh
export CHAT_PRIVATE="$HOME/chat-codex-data/private"
# 用本地安全编辑器创建 runtime-key，然后：
chmod 600 "$CHAT_PRIVATE/runtime-key"
export CHAT_TUNNEL_ID='<你自己的 tunnel_id>'
tunnel-client help quickstart
tunnel-client run --help
```

下面是 **v0.0.14 的 run --help 已核对支持的参数模板**；只验证了 CLI help，未建立真实账号连接。若安装版本不同，先确认相同 flags，或按官方 `init / doctor --profile / run --profile` 流程建立等效 HTTP profile。不要把 doctor 的专用参数机械带入 run。

```sh
tunnel-client run \
  --control-plane.tunnel-id "$CHAT_TUNNEL_ID" \
  --control-plane.api-key "file:$CHAT_PRIVATE/runtime-key" \
  --mcp.server-url 'url=http://127.0.0.1:8791/mcp,channel=main' \
  --mcp.extra-headers "Authorization: file:$CHAT_PRIVATE/tunnel-authorization" \
  --mcp.discovery-extra-headers "Authorization: file:$CHAT_PRIVATE/tunnel-authorization"
```

普通 MCP 请求和 discovery 都必须携带 header。使用本机二进制即可；此命令不是在项目 runner 内运行。保持 MCP server 和 tunnel-client 两个终端运行。隧道需要向 OpenAI 出站 HTTPS；Docker runner 自身仍然完全禁网；host 模式不限制网络。

在 ChatGPT 网页：**Plugins → 加号 → Add custom MCP server → Connection: Tunnel → 选择自己的 tunnel → 配置认证 → Create as a plugin → 安装 → 新对话 @ 选择插件**。[官方步骤](https://developers.openai.com/api/docs/guides/custom-mcp-server)

这个单用户方案由组织/工作区 tunnel 权限限制入口，client 注入本地 Bearer；插件层没有额外 OAuth 流程，选择 No authentication 仅指插件层。**本地服务仍强制 Bearer，不能删除检查。** 若组织要求 OAuth，则本版本不适用，需要另行实现和验证。不要用公开 URL／Cloudflare quick tunnel 加 No authentication 替代这条私有路线。公开 URL/OAuth 和公共插件市场发布不在此版本范围。

隧道看不到时查 workspace association 和 Read+Use 权限；401 查两类 headers；403 查 client 请求的 Host 是否为 `127.0.0.1:8791` 或 `localhost:8791`。不要为排障改为公网监听或关闭鉴权。

## 5. 在聊天里完成真实 coding 回路

在安装并 @ 选择 Chat-Codex 后，发送：

> 只在本插件项目中工作。先列文件。创建 add.mjs，内容为 `export const add=(a,b)=>a-b;`；创建 add.test.mjs，用 node:test 和 node:assert/strict 断言 add(2,3) 等于 5。读回源码，运行 `node --test add.test.mjs` 并报告非零退出码。用 edit_file 把唯一的 `a-b` 改为 `a+b`，再次读回并运行测试，报告退出码 0、stdout 和所改文件。不要安装依赖或修改其他文件。

在你的电脑核对 `$CHAT_PROJECT` 中相同文件。每个工具返回真实结果，不能仅凭模型说“通过”验收。

| 工具 | 参数与限制 |
|---|---|
| list_files | path 默认 `.`；最多 500 条，返回 truncated |
| read_file | 相对 path；UTF-8、最大 32 KiB |
| write_file | path、content；父目录须存在，会覆盖 |
| edit_file | path、old_text、new_text；旧文本必须恰好匹配一次 |
| run_command | command、cwd 默认 `.`、timeout_ms 默认 15000，范围 1000–60000 |

运行结果含 `exit_code`、`stdout`、`stderr`、`termination`、耗时。超时/超过 64 KiB 合计输出时，Docker 模式终止整个容器，host 模式终止本次进程组，exit_code 为 null，termination 说明原因；非零退出、取消或工具错误会标成 MCP error。Docker 每次操作容器重建，只有项目文件保留。host 每次操作新进程，但宿主文件修改持续存在。目录建立可用 `run_command` 的 `mkdir`。Docker 内 shell/测试不挂载宿主 token；host 命令具有当前用户的访问权限，包括同用户凭据。

项目目录没有磁盘配额；对不可信的大量写入使用独立或有配额的文件系统。

同一时间只允许一个操作，繁忙会拒绝而不排队。请求断开不自动重试；正常超时后仍会执行后端清理。`audit.jsonl` 在私有目录仅记录调用 ID、操作类型、时间、退出码和清理状态，不记录凭据或命令内容；完整 stdout/stderr 在工具响应中。自行管理 audit 保留期。

Docker 依赖由你提前审核并放进项目；离线 runner 不能联网安装。host 可以访问本机已有工具和网络，但本指南不自动安装项目依赖。两种模式都不提供持久后台任务或交互式终端。

## 6. 停止和恢复

Ctrl+C 停止 MCP server 和 tunnel-client，等待当前操作完成清理（最长约 70 秒）。以下 Docker 恢复说明仅适用于 Docker 后端。常规操作完成、超时、超输出时都会删除容器；不要在任务中途强制杀 gateway。若系统崩溃或 SIGKILL，可能留下临时容器；先查看：

```sh
docker ps -a --filter label=chat-codex=ephemeral
```

人工核对确切属于本项目的容器名，再 `docker rm -f <确切容器名>`。不提供清空 Docker 的命令。清理失败会锁住 runner，避免假称命令已经终止；检查完再重启服务。

host 模式在正常完成、超时和输出超限时 SIGKILL 本次进程组，并删除临时 HOME。普通后台子进程也会清理；主动使用 setsid/另建会话、外部服务启动器等方式脱离进程组的程序不保证能清理。gateway 被 SIGKILL 或主机崩溃也可能留下进程或临时目录。本实现不是恶意进程监管器；不要用 host 模式运行不可信代码，不能把时限视为不可绕过的安全约束。清理报告失败时锁住 runner，由操作者核查后重启。

## 7. 来源、许可、验证边界

原始代码独立编写，MIT，未复制 Charon 或两个被调研项目。直接依赖：官方 `@modelcontextprotocol/sdk@1.30.1`、`zod@4.4.3`，均 MIT；所有锁定 registry 包的许可声明见 `THIRD_PARTY.md`。官方 Node 镜像及所含系统软件遵循各自许可，本 ZIP 不包含镜像或 node_modules。

仅包含本地服务与 runner，没有 API 模型计费调用；隧道/ChatGPT 的账号资格、费用和服务规则以你自己的账号及官方说明为准。新账号 ChatGPT 端到端尚未实测；无需私有 Charon 源码，但仍需要 Node、自己的账号权限和隧道配置；Docker 仅为默认后端的依赖。
