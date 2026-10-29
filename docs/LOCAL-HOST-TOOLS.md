# 本机 SillyTavern 函数工具契约核验

实际读取目录：`D:\SillyTavern-1.19.0`。`package.json` 声明版本 **1.19.0**、Node.js **>=20**。目录中没有可用的 Git 元数据，因此不根据安装包名称推测官方提交。以下结论对应实际文件，而非仅依据扩展文档猜测。

## 执行过的核验

运行：

```powershell
node --test tests/host-tool-contract.test.js
```

测试直接读取本机 `tool-calling.js`、`events.js` 和 `eventemitter.js`，在 `node:vm` 中运行其实际类实现，包括私有 `ToolDefinition`、`ToolManager` 注册表及实际异步事件发射器。仅移除模块导入/导出语法，注入受控浏览器依赖；**没有改写 SillyTavern 源文件**。

生命周期核验从实际 `script.js` 提取并执行原始非流式工具处理分支、流式 `finalizeIntermediaryMessage` 方法，以及 `hideStopButton`、`activateSendButtons`、`unblockGeneration` 的原始函数体。递归 `Generate` 的后续网络/模型请求由受控函数替代；测试没有启动完整浏览器、服务器或真实模型连接，不能称作完整 SillyTavern 端到端测试。

安装目录不存在时，上述测试明确显示 **SKIP**，不会把未执行项目记作通过。其他安装位置可使用：

```powershell
$env:SILLYTAVERN_ROOT = 'C:\your\SillyTavern'
node --test tests/host-tool-contract.test.js
```

## 实际 API 与调用行为

`public/scripts/tool-calling.js`：

- 第 115 行：`ToolDefinition`。`toFunctionOpenAI()` 输出 `type: function` 及 `function.name/description/parameters`。`invoke()` 调用注册的 action。
- 第 242 行起：`ToolManager`。`registerFunctionTool({name, displayName, description, parameters, action, formatMessage, shouldRegister, stealth})`；同名注册覆盖旧定义；`unregisterFunctionTool(name)` 移除工具。
- `registerFunctionToolsOpenAI(data)` 每次检查 `shouldRegister()`；有可用工具时填充 `data.tools` 并设置 `data.tool_choice = 'auto'`。本扩展没有把工具改成模型必须调用。
- `invokeFunctionTool(name, parameters)` 解析 JSON 参数、调用 action，并把非字符串结果序列化为 JSON。**宿主没有按声明的 JSON Schema 校验参数**，扩展必须自行检查类型、范围、证据、对象和不可信字段。
- `invokeFunctionTools()` 处理模型返回的 tool calls。工具异常会转成带 `error: true` 的 invocation，供后续模型看到失败；这不是成功提交状态的凭据。
- 第 896 行附近的 `saveFunctionToolInvocations()` 创建 `is_system: true`、`is_user: false`、`extra.tool_invocations` 的系统消息；它不是最终角色回复。
- `canPerformToolCalls()` 排除 `quiet`、`continue`、`impersonate`；还受 `main_api`、`function_calling`、连接/模型能力和提示词后处理方式限制。安装版本默认递归上限为 5，用户配置可改变。

本扩展的四项工具定义也通过实际宿主注册表和调用器执行测试：`psyche_get_state`、`psyche_recall`、`psyche_record_event`、`psyche_get_behavior`。验证包括工具可见性、自动选择、正常参数、拒绝非法参数及返回结构。

本机12项契约测试全部执行通过。其中一项同时运行实际 PsycheEngine Adapter、函数工具定义、实际宿主 ToolManager 和原始非流式续写分支，验证工具请求发现、原文事件暂存、`...` 占位清理、递归续写及最终状态提交；网络和模型生成仍使用受控替代函数。

## 生命周期顺序与事务要求

非 stealth 工具的实际保存顺序：

1. 工具 action 执行，扩展只能形成候选状态。
2. 宿主将工具结果系统消息放入 chat。
3. 等待 `TOOL_CALLS_PERFORMED`。
4. 渲染系统消息，等待 `TOOL_CALLS_RENDERED`，保存聊天。
5. 两条生成路径均将 `depth` 增加后调用 `Generate('normal', ...)`，让模型继续生成角色回复。
6. 递归再次触发 `GENERATION_STARTED` 和 `GENERATION_AFTER_COMMANDS`；**这两个事件的 options 中不包含 depth**，不能仅凭又一次 normal start 就取消原事务。

实际 `script.js` 重点位置：4495 行检查递归上限；5410–5435 行为流式工具分支；5541–5558 行为非流式分支。两条路径在正常工具续写前均不解锁生成 UI，因此工具轮次本身不产生正常的终止事件。

工具输出可能有非空的中间角色文本。流式中间消息会执行 `finalizeIntermediaryMessage(..., {unlockUI:false})`，发出 `MESSAGE_RECEIVED` 和 `CHARACTER_MESSAGE_RENDERED`，但没有 `GENERATION_ENDED`。空白/省略号占位消息则可能在调用工具之前被 `deleteLastMessage()` 删除；不能把这种临时占位清理误认成用户删除剧情来源而撤销候选事务。

流式最终消息的顺序不同：`finalizeIntermediaryMessage(...,{unlockUI:true})` 先调用 `markUIGenStopped()`，经 UI 解锁链产生 `GENERATION_ENDED`，随后才发出 `MESSAGE_RECEIVED` 和 `CHARACTER_MESSAGE_RENDERED`。因此提交必须同时等待有效终止和有效最终角色消息，且接受两者顺序变化。

适配器在 `TOOL_CALLS_PERFORMED` 清除中间消息收据、标记待续写，并保留同一聊天、同一来源修订的候选状态。最终提交绑定**来源消息和最终角色回复**的稳定 ID，并核对玩家来源文本修订；模型事件只依赖该玩家事实，普通回复改写不会凭空改变玩家行为。工具系统消息不能充当提交收据。切换聊天/人物、真正删除来源、停止、失败、无最终回复或来源修订变化时，会丢弃候选。重算历史配对时也跳过工具中间文本，选取同一玩家来源后最后的有效角色回复。

`stealth:true` 工具不会保存可见 invocation，宿主会停止这一轮自动续写。PsycheEngine 的状态工具使用 `stealth:false`，才能等待模型继续给出最终角色回复。

## 实际文件 SHA-256

| 本机文件 | SHA-256 |
|---|---|
| `package.json` | `5b6e0634a63872c33603bf803217613a388f2e5dbd5990f7b30d254bfbf027c2` |
| `public/scripts/tool-calling.js` | `934be74f6bd672a821e5f3e5dc34ad4548c1cac60ee41c48feaa630e6e2f7712` |
| `public/script.js` | `955c603d0bad84bac5a716f0818d85c2543e44d4c43878e0d63ef1e55ca91855` |
| `public/scripts/events.js` | `2aa1c20f140fab8967e6f850bd6e253bd0aa6e7c6a2e0540778cb11dd0f3a6ea` |
| `public/lib/eventemitter.js` | `a43e0c8b85efe8defd0c70d5f5ef4464b152d427233022393cfbfce562fcfc1e` |

测试在执行时会重新计算并输出当前文件哈希。宿主版本变化导致关键生命周期位置不再匹配时，测试会失败并指出契约变化；不会静默套用旧结论。
