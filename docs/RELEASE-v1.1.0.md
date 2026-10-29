# PsycheEngine v1.1.0

新增 SillyTavern 原生 Function Calling 集成。支持的聊天补全模型可以根据剧情主动读取心理状态、检索事件记忆、获取行为倾向，或提出有证据的事件候选。

## 本次变化

- `psyche_get_state`：读取当前角色状态与对象关系。
- `psyche_recall`：检索有来源的事件记忆。
- `psyche_get_behavior`：读取可解释的行为倾向。
- `psyche_record_event`：提出经过类型、参与方、强度和逐字来源证据校验的事件候选；高影响事件仍需人工确认。
- 设置面板增加工具启用、事件候选开关和每次生成调用上限；显示宿主工具注册能力、当前连接支持情况与已注册工具名。

## 启用方式

1. 更新扩展并刷新 SillyTavern，打开单人角色聊天。
2. 使用支持工具调用的 **Chat Completion（聊天补全）** 模型，并启用 SillyTavern 的 **Function Calling**。
3. 在 PsycheEngine 设置中启用“模型可调用工具”，点击“应用设置”，查看“模型自动调用工具”区域。
4. 让角色继续对话，观察宿主是否发出工具调用；在记忆面板检查候选事件和高影响确认。

默认配置为：

```json
{
  "tools": {
    "enabled": true,
    "allow_event_proposals": true,
    "max_calls_per_turn": 8
  }
}
```

调用上限允许 1–20。可关闭事件候选，仅保留读取能力；关闭工具或扩展后停止注册。模型按场景决定是否调用，当前连接支持并不等于实际发生过调用。

原生工具使用当前模型连接，与可选的 LLM 事件分析分别控制。工具参数和返回的状态、相关记忆参与当前模型服务的生成，后续生成可能产生额外请求与费用。**Text Completion（文本补全）不支持此原生调用路径**，可继续使用规则提取和动态状态 Prompt。

## 安装与验证范围

仓库安装地址为 `https://github.com/nddjdjsj/Public`。手动安装包为 `downloads/PsycheEngine-1.1.0.zip`；具体步骤见 [README](../README.md)。

兼容目标为 **SillyTavern 1.19.0**：已核对官方 release 源码及开发机 `D:\SillyTavern-1.19.0` 实际安装的接口。最新已执行的自动化结果由 [VALIDATION](VALIDATION.md) 记录。

**真实 LLM 工具调用、宿主页面端到端以及浏览器 UI 冒烟尚未完成验收。** 模拟宿主测试与源码核对不能替代这些检查。本次未改动用户的本地 SillyTavern 安装或模型配置。群聊继续采用保守降级。隐私边界、心理学模型限制及更新前备份要求沿用 README。
