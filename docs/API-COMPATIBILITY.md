# SillyTavern 接口核对

核对日期：2026-10-29。当前工作区未提供本地 SillyTavern 安装或正在运行的聊天服务。实际下载并检查官方 `release` 源码，其 `package.json` 版本为 **1.19.0**，提交为 [`06bde939fb1e9c4c8d8641d810f0a916b5bce127`](https://github.com/SillyTavern/SillyTavern/commit/06bde939fb1e9c4c8d8641d810f0a916b5bce127)。下载的源码供核对使用，位于交付项目旁的 `reference/`，不并入扩展许可证或安装包。

## 一手依据

- [官方 UI Extensions 文档](https://docs.sillytavern.app/for-contributors/writing-extensions/)
- [getContext 实现](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/st-context.js)
- [主生成/消息/Prompt 实现](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/script.js)
- [事件定义](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/events.js)
- [扩展拦截器及角色字段持久化](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/extensions.js)
- [官方 Extension-WebpackTemplate 示例](https://github.com/SillyTavern/Extension-WebpackTemplate) 的 manifest 与入口已下载检查；PsycheEngine 使用无需打包的 ESM。

## 核对结果

| 接口/机制 | 官方实参/行为 | 本扩展用法与降级 |
|---|---|---|
| `SillyTavern.getContext()` | 每次返回当前上下文；含 `chat`, `characters`, `characterId`, `chatId`, `groupId` | 每次读写重新获取，不长期缓存 metadata 对象 |
| `eventSource`、`eventTypes` | `eventSource.on` / `removeListener`；`event_types` 为兼容别名 | 首选 `eventTypes`，监听前检查事件存在；缺失可移除监听能力则不注册 |
| `extensionSettings` | 可变全局选项；`saveSettingsDebounced()` 保存 | 独立 `psyche_engine` 命名空间，完整 schema 验证 |
| `chatMetadata` | `saveMetadata()` 实际调用保存完整聊天 | 独立版本化日志、owner_avatar、chat_id；同一操作只在仍是当前作用域时提交 |
| `writeExtensionField(characterId,key,value)` | 角色索引为数组位置；写入 `character.data.extensions` 并请求服务器 | 仅保存当前角色人格时调用；不存在则拒绝保存，避免伪称已持久化 |
| `setExtensionPrompt(key,value,position,depth,scan,role,filter?)` | 字典按 key 替换；`IN_CHAT=1`，`SYSTEM=0` | `psyche_engine` 唯一 key，深度1，关闭世界书扫描；清空即移除有效注入 |
| manifest `generate_interceptor` | 全局函数 `(chat,contextSize,abort,type)`，按加载顺序 await | 精确在 host 构建最终 Prompt 前预览候选、注入，不修改 coreChat 或阻止生成 |
| `GENERATION_STARTED(type,options,dryRun)` | 可早于 slash 命令、玩家消息入列 | 只取消前事务；不在此阶段提取或注入；跳过 dryRun/quiet/impersonate |
| `GENERATION_AFTER_COMMANDS` | 仍早于玩家消息入列和重新生成删除旧回复 | 已核对但不用于提取，避免读取上一轮消息 |
| `MESSAGE_SENT(index)` | 玩家消息已进入 chat | 分配稳定消息身份；数组 index 仅用于定位当前对象 |
| `CHARACTER_MESSAGE_RENDERED(index,type)` | 普通完成和流式结束；流式错误路径也可能发出 | 仅记录回复收据，单凭此事件不提交 |
| `GENERATION_ENDED(chat.length)` | UI 停止按钮隐藏时发出；流式可能早于渲染 | 等待 ended 和 rendered 两个条件，另检查 `gen_finished`、非空正文、未停止/中止 |
| `GENERATION_STOPPED` | 用户停止，模型 raw 调用也挂钩此事件 | 丢弃候选、取消提取等待、清除注入 |
| `MESSAGE_EDITED(index)` / `MESSAGE_UPDATED(index)` | 编辑早期及编辑完成事件；其他功能也会 updated | 重算来源修订；同事件 ID 幂等，不把重复通知当新行为 |
| `MESSAGE_DELETED(chat.length)` | 参数不是可靠的被删消息 ID | 结构性变更才重扫稳定 ID；撤销所有失去来源的效果 |
| `MESSAGE_SWIPED(index)` | 可选旧 Swipe，也可触发新生成；修改了 `extra` | 检查是否有效已保存 Swipe；新生成等待正常事务，避免占位文本提交 |
| `CHAT_CHANGED` / `CHAT_CREATED` / `CHAT_LOADED` | metadata 引用会更换；分支可能复制 metadata | 中止异步任务，owner 检查；同角色复制日志而后续状态独立；不同角色不继承 |
| `getTokenCountAsync(text,padding)` | 当前模型 tokenizer | 用 padding=0 计算心理片段；失败按 UTF-8 字节数保守限额 |
| `generateRaw({prompt,systemPrompt,responseLength,trimNames,...})` | 当前连接生成；没有 caller `signal` 参数 | 仅显式 LLM 模式调用；独立校验、超时、缓存、在途并发上限1；不伪造网络取消 |

初次误探 `public/scripts/events/event-types.js` 返回404，已改为实际 `public/scripts/events.js`；代码不导入误探路径。专属读取和 API 封装于 `adapters/sillytavern.js`，入口仅负责启动、宿主启停钩子和 UI 挂载。

## 保守策略与实际限制

自动事实仅来自玩家来源消息；不会从 AI 回复里自动学习“已经发生的记忆”。回复仅作为该轮成功提交的收据来源；普通 Swipe 不改变玩家事实内容，删除回复会撤销依赖它的提交，重新生成再幂等提交。编辑玩家消息会用新的修订替代原事件。

群聊第一版停用自动注入和自动状态，以避免发言角色识别不足造成私有关系泄漏。玩家消息有 `force_avatar` 时使用该 Persona 标识；该字段已在官方 `sendMessageAsUser` 源码核对。旧消息缺少标识时回退到消息姓名；同名且缺少标识的旧 Persona 无法可靠区分。行为建议每轮依据当前来源对象重新计算，避免沿用另一个人的私人关系策略。未来 host 若不提供完整最终生命周期，只提供候选预览而不自动提交；UI 可以手动确认事件。

本项目检查了官方源码并执行模拟宿主测试，没有启动完整官方前后端或连接真实生成服务。因此流式、真实分支导入、不同 API 类型的 Prompt 排序、其他扩展交互仍需人工验收。宿主 `saveMetadata` 内部吞掉某些网络保存错误；本扩展不能将该调用返回等同于服务器已落盘，应使用宿主保存提示及导出备份。
