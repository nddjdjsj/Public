# 开发说明

## 运行结构

这是原生浏览器 ES modules 项目，SillyTavern 直接加载 manifest 的 `index.js`，不需要编译、npm 包或服务器插件。`npm run build` 校验语法、JSON、相对导入和 manifest；`npm test` 运行 Node 原生测试。核心模块不读取 DOM、网络或宿主全局对象。

`index.js` 挂载设置面板，创建 Adapter；Adapter 管理宿主事件、持久化、稳定消息 ID 和生成事务。事件提取器产出可信度受限的候选，由 StateManager 统一验证后交给 appraisal/emotion/relationship/memory/decision 模块。Prompt 编译器将状态转成有限模板化语句。UI 只调用 controller，不直接读写宿主状态。

v1.1.0 的 `adapters/function-tools.js` 生成四个模型工具定义，通过 Adapter 中的 Context 工具注册接口接入宿主。读取工具返回当前角色与当前 Persona 的状态、记忆和行为倾向；事件工具仅将最新玩家原文中有证据的事实暂存到生成事务。工具输出为有大小限制的 JSON，包含调用前后 scope/epoch 校验，不能将旧聊天的结果返回新聊天。工具开关、候选写入开关和每轮调用预算在 `config.tools` 中校验。

自动提取与工具候选共享来源事件索引：同一来源修订、对象与类型复用事件身份，人工撤销/纠正会覆盖两条入口。重新生成可以恢复已经验证的源事实，而无需让模型再次调用同一写入工具。恢复/纠错后索引可由有效日志重建，不信任模型指定事件 ID 或来源 ID。

## 数据分层

- `character.data.extensions.psyche_engine`：version、baseline OCEAN、facets、raw_scores、instrument/version/scoring、source、quality_flags、角色基线偏移。经 `writeExtensionField` 保存。
- `chatMetadata.psyche_engine`：version、owner_avatar、chat_id、manager；manager 包含 scope、parent_scope、events 和有界 snapshots。附上一份先前有效日志 backup；损坏/导入覆盖时保留 recovery_backup。
- `extensionSettings.psyche_engine`：模块开关、情绪恢复、关系限幅、记忆数量、提取方式、Prompt 预算、工程权重及 debug。详见 `config/default.json` 和 `core/config.js`。
- `message.extra.psyche_engine.id`：UUID。数组 index 仅临时定位，永不作为持久记忆来源。修订指纹包含玩家/系统标志、姓名、正文的长度及双通道内容 hash。消息文本不被扩展重写。

所有导入都做大小/深度/字段/数值/原型检查。人格版本1；聊天版本0旧 log 迁移到版本1；未知未来版本隔离。导入快照从不作为事实依据。存量事件日志是权威来源，重建忽略已撤销或失去有效来源的事件。

## 一轮事务

1. host 开始生成，清理上次事务；玩家消息入列后设置稳定 UUID。
2. manifest interceptor 在实际 Prompt 构建前读取最后一条玩家来源。规则/可选模型提取，校验、缓存、加上来源修订。
3. `manager.preview` 得到候选，情绪/关系/记忆/策略会反映这轮事件，但未写入持久状态。
4. 编译器检索少量相关记忆，并按 host tokenizer 预算编译。唯一注入 key 保证重复调用替换而非追加。
5. 收到有效角色渲染与生成结束后，检查同一聊天、同一消息修订、有效 `gen_finished`、未停止，才提交事件与有效轮次事件。
6. 通过 metadata 保存事件日志/快照。异常由边界捕获并清除注入，不阻断 host 聊天。

失去收据、删除/编辑来源、切换聊天/角色、禁用扩展或取消都会清除候选。异步提取使用作用域 epoch，旧聊天的结果不能写进新聊天。编辑重算会替换旧来源事件位置，避免先前行为被错误追加到故事最后。

## 扩展算法

核心导出见各模块：`createPersonality` / `effectivePersonality`、`appraiseEvent`、`updateEmotion` / `recoverEmotion`、`updateRelationship`、`behavioralPolicy`、`retrieveMemories` 和 `StateManager`。工程权重在集中配置，`engine.event_overrides` 可替换已有事件各轴权重。新增事件类型须同步 appraisal 注册表、提取允许列表、JSON Schema、Prompt 类型描述、UI 标签和测试。

模型提取可通过 `createModelExtractor({provider})` 注入其他显式授权 provider；provider 只获得 system/prompt/signal，不拥有任意状态写权限。默认 host provider 使用当前连接，任何模型输出均经同一个验证器。不能执行返回代码、修改原始人格分或采信模型自由构造的内部命令。

长期适应通过 `personality_adaptation` 显式事件提供 offsets/reason/confirmed，只有开关开启时生效；普通对话不自动触发。目标和场景约束可传给 `behavioralPolicy` options；第一版图形面板不提供完整目标规划。

## 性能和界限

普通追加不重扫全部聊天正文，事件 ID 有索引，提取缓存最多256条，单次模型请求至多一个在途。结构性删除/加载才扫描来源；编辑/撤销需要对受影响日志重建。debug、情绪历史、关系历史、快照、工作记忆有界。重要记忆和事件有容量上限，满时拒绝追加并要求导出或另开聊天，不静默丢弃事实。

JS 单线程中状态快照克隆、首次长日志加载、导出和大量纠错仍可能耗时。没有声称20,000条重要事件始终能在固定毫秒内完成。可运行性能脚本查看当前机器实测；生产长聊天需独立验收。

## 安全渲染

UI 仅用静态模板创建结构，所有动态摘要、来源、JSON、错误及 Prompt 通过 `textContent` 或表单 value 设置。Prompt 不插入自由文本 evidence/summary，只使用已知事件类型自然语言模板；重要记忆正文在 UI 可见，但不会成为高信任模型指令。debug 默认关闭，不记录 API key；provider 错误使用固定文本，避免错误对象带出鉴权信息。

## 验证分类

算法/导入/Prompt 为单元测试；`tests/integration.test.js` 为模拟 host 生命周期测试；browser smoke 为本地浏览器 UI 测试。三者都不能替代真实 SillyTavern 的人工验收。见 `ACCEPTANCE.md` 与交付时的 `VALIDATION.md`。
