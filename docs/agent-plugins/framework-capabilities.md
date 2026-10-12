# 后端框架的特色与实际接入

## 实现原则

模型连接负责认证和传输，Agent 框架负责推理与工具循环，TokenBird 负责会话、数据源、权限和团队协作。选择框架不会改变模型本身的知识、智能水平或价格。特色用于判断任务适配，不用于虚构耗时或成功率。

支持版本以 `framework-installer.ts` 和 `binary-resolver.ts` 的固定版本为准。以下区分上游能力和当前适配器实际提供的能力。

## 后端设置

打开 **设置 → 后端设置**（`settings/backends`），集中管理运行环境安装、下载源、有效性测试、功能实现方式和框架原生配置。模型连接的选择和认证仍在 AI 设置中。框架配置保存到后端主机的 `agent-frameworks.json`，更换主机时应使用该主机的程序和插件目录；修改在新建或重启运行环境后生效。

- **Hermes**：安装对应 Python 环境与桥接器，配置原生记忆、技能、项目指令及工具集。
- **DeepSeek Harness**：安装固定版本 SDK 与桥接器，配置原生执行 profile。
- **Claude Code**：添加本地原生插件目录，目录须包含有效的 `.claude-plugin/plugin.json`；保存后通过 SDK 的 `plugins` 加载命令、技能和 hooks。移除目录条目只取消该配置，不删除磁盘文件。Super Agent 节点继续禁用原生插件。
- **Codex / Pi**：安装或选择运行环境，配置已有适配器支持的会话恢复、辅助推理、引导和工具实现方式。
- **其他 Agent 插件**：导入协议 v1 的 JSON 清单，预览名称、版本、执行程序及是否请求模型连接凭据，再安装到目录。后端进行完整清单校验，插件出现在同一框架列表，可配置、测试与启停。导入清单不下载第三方执行程序，它需要已部署在后端主机。

当前提供框架运行环境安装、TokenBird Agent 桥接插件导入和 Claude 本地原生插件配置，尚未提供第三方 marketplace 的通用安装器。

| 框架 | 保留的特色 | 适用工作 | TokenBird 接入边界 |
| --- | --- | --- | --- |
| Pi | 多供应商传输、流式引导、自动压缩、会话树 | 交互式开发、快速迭代、不同供应商模型协作 | MCP 和审批是 TokenBird 提供的集成；Super Agent 限制项目扩展，避免任务目录执行宿主扩展代码 |
| Claude Code | Claude Agent SDK 执行循环、会话分支、压缩；普通会话支持项目指令和原生技能 | 仓库理解、实现、调试、复用项目工作流 | 需要 Anthropic 连接；Super Agent 禁用未受控的原生技能、插件和子代理发现，分配给节点的技能由宿主提供 |
| Codex | app-server 原生循环、推理强度、计划、流式引导、自动压缩 | 实现、审查、调试、长编程任务 | 适用 OpenAI 连接和受支持 CLI 使用原生循环。Super Agent 文件、命令及数据源操作走 TokenBird 动态工具；第三方连接保留明确的 Pi 兼容路径 |
| Hermes | `AIAgent.run_conversation()`、原生记忆、技能、工具注册、压缩、SessionDB、引导 | 重复工作、用户偏好积累、可复用技能 | 记忆、技能、项目指令和工具集可单独配置；原生工具执行前经过宿主审批，共享工具注册到原生工具集，辅助推理由模型连接提供 |
| DeepSeek Harness | 原生 SDK 执行循环、Cordis 插件体系、profile/patch、上下文管理 | 自定义工具流程、可配置执行流程 | TokenBird 的工具和审批作为原生插件接入；当前适配器未声明原生恢复或引导，可见历史和辅助推理由宿主提供 |

### Codex 在 Super Agent 中的修复

以前工厂发现节点权限策略就创建 `CodexCompatibilityAgent`，原生类也拒绝执行该节点。现在权限策略不再决定推理框架，符合传输条件的连接可以继续使用 `NativeCodexAgent`。

受控执行使用 Codex 0.154.x 的 `environments: []`：不提供原生执行环境，因此模型不会收到原生 shell、补丁或图片文件工具。启动和线程配置同时禁用未受控的 MCP、hooks、插件、原生浏览器、子代理及后台记忆能力；节点指令和分配技能由 TokenBird 传入。`Read`、`Write`、`Edit`、`Bash` 作为动态工具接入。

受控进程使用独立临时 `CODEX_HOME`，从该目录启动，并将实际任务目录标为不加载原生项目配置的 `untrusted`。不能用 `mcp_servers = {}` 清空继承配置，因为 CLI 会合并表。托管连接通过 app-server 注入凭据；显式未托管连接仅复制已有 `codex login` 的 `auth.json`，不复制配置、MCP、hooks 或技能。此模式不继承系统原生 Codex 的 keyring 登录；可使用 TokenBird 的托管凭据或文件式 CLI 登录。会话销毁时清理临时目录，辅助推理也使用同样的隔离。

动态工具经过共享的异步权限路径：检查节点边界、审批具体调用、记录持久操作、消耗行动门、应用容器命令变换，再执行。停止轮次会取消审批和命令。原生权限升级、命令和补丁审批在此模式下一律拒绝，`allow-all` 不会绕过节点策略。

普通 Codex 会话可以在框架设置中选择原生文件工具、TokenBird 文件工具或禁用文件工具。执行中追加指令已声明为受支持能力；用户明确禁用的现有配置继续生效。

原生线程恢复有实际限制：当前接入依赖动态工具，而本版本的 `thread/resume` 不接受动态工具。重启或工具集变化时创建新线程，并恢复 TokenBird 可见历史。这不能等同于恢复所有原生隐藏状态。

### 框架特色如何进入协作

所有后端通过共享会话工具注册表获取 Super Agent 协作工具及参数 Schema。内置 `super-agent-collaboration` Skill 随节点指令加载，负责目标交接、派工、消息、共享板、资源启用与证据验收；模型不再依赖生成文本动作块。工具执行仍经过宿主的角色、版本、预算及真实操作授权检查，框架切换不会扩大权限。

工具按节点角色提供：意图节点获得目标交接、通信和交付工具；编排节点获得计划、派工、资源分配、共享板和验收工具；工作节点获得通信、进度、资源启用及实际执行工具。Pi、Claude、Codex 和原生桥接插件使用同一可见性规则，意图与编排节点不会再被缩减为单一消息工具。用户要求开始工作时，意图节点提交目标，由编排安排实际检索和执行。

日常、开发、科研、交付和运维五个预设均包含专门的 Computer Use 工作节点，绑定 `windows-desktop-control` 和验证技能。该节点先确认 `computer_use status`，观察窗口、截图或 UI Automation，逐步操作并检查结果；宿主自动给其任务加入 `host-desktop` 独占资源，避免团队任务争用桌面。现有团队重新应用预设并保存即可补齐节点，保留自定义技能、数据源和节点身份。桌面工具控制实际执行主机，需要 Windows 交互桌面、完全控制且无容器执行器；设置受限模式或在其他宿主上运行时仍按真实边界返回原因。截图随工具结果交给支持图像的模型，Codex 动态工具使用 `inputImage`。

五类默认团队均绑定专业和跨场景 Skills，详见 [默认节点 Skills](../super-agent/default-skills.md)。绑定指令通过 TokenBird 节点系统提示传入所选后端，无需依赖该后端的原生技能发现机制。编排同时获得各节点实际绑定定义的 `skillCatalog`（名称和用途），按场景选择具体 `nodeId`；Skill 不增加 MCP、额外模型调用或子代理权限。

编排和工作节点还会获得 `resourceCatalog`，可以提交 `activateResources` 自主启用已安装 Skill 与团队授权 MCP/API 源。编排给空闲工作节点分发资源并派工；工作节点可给自己启用资源，宿主在同一会话的下一轮加载真实技能和数据源工具，自动继续原任务。绑定持久保存，来源连接错误及现有操作审批继续保留；不启动未授权来源或后端原生扩展。

协调节点的每轮上下文包含每个 Worker 的 `backendFramework`，提供框架身份、原生或兼容执行方式、特色、适用任务、限制和配置开关。节点自身也接收这些说明。

协调节点据此显式指定专门任务的 `nodeId`，同时考虑职责、真实工具权限和当前负载。关闭的技能或记忆不能作为选人依据，兼容模式不能当作原生框架。自动兜底选择仍使用能力标签、恢复状态、队列和启动时间下限，框架名称不增加凭空定义的优先级。

### 微软 Agent Framework 的定位

它是团队工作流引擎，不是模型连接中可选的推理后端。当前桥接以 `Executor`、`WorkflowBuilder` 和 `WorkflowContext` 校验节点拓扑、路由并等待会话执行结果，同时提供执行器与工作流状态事件。持久任务契约、依赖、重试和验收仍由 `SuperAgentService` 管理。不能把当前图路由与事件接入描述成已经接入上游所有编排、checkpoint 或交接能力。

## 源码与研究依据

- [Codex 0.154.0 配置结构](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/config.schema.json)及[工具注册条件](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/tools/spec_plan.rs)。协议另用实际安装 CLI 的 `app-server generate-ts --experimental` 核对。官方文档站本次访问受限，未用无法读取的页面作为结论依据。
- [Pi SDK 与功能说明](https://github.com/badlogic/pi-mono/blob/v0.85.1/packages/coding-agent/README.md)。对照 `pi-agent.ts`、Pi 子进程的资源加载、会话与压缩路径。
- [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript)及当前安装 SDK 类型。对照 `claude-agent.ts` 的分支、思考、技能、MCP 和执行策略设置。
- [Hermes 固定版本原生 Agent](https://github.com/NousResearch/hermes-agent/blob/dce1e9b37581dd62e480a9064dc04a709c2940d3/run_agent.py)。对照 `hermes_bridge.py` 的构造参数、原生工具注册和 SessionDB 恢复。
- [DeepSeek Harness 上游](https://github.com/deepseek-ai/deepseek-harness)与[架构文档](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/architecture.md)。对照固定 SDK 版本的 `dsh_bridge.py`，上游的新功能不自动意味着适配器已支持。

## 验证

`native-codex-policy.isolated.ts` 启动真实 Codex CLI，连接本地确定性 Responses 端点，不使用生产凭据。检查模型实际收到的工具列表、获批写入、越界拒绝和持久操作记录，同时放入会写入标记文件的用户与项目 MCP 配置，确认服务没有启动；检查仅文件登录凭据复制成功。此检查证明原生循环与受控工具接通，不代表生产模型质量或每个上游扩展均已验证。

插件回归检查独立进程、能力协商、权限、停止、历史恢复和连接凭据隔离；界面检查实际 React 渲染与翻译。Hermes、DSH 的原生集成检查另见本目录 README。
