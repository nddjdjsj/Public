# 事件提取、人格导入与提示词边界

这些模块使用浏览器原生 ESM，无第三方运行依赖。单独执行相关测试：

```sh
node --test tests/extraction.test.js tests/prompt.test.js
```

## 提取接口

```js
extractRuleEvents(text, {
  sourceId: 'stable-message-uuid',
  actor: 'user', target: 'character-identity',
  knownActors: ['user', 'character-identity'], minimumConfidence: 0.75,
});
validateExtractedEvents(jsonOrObject, {
  sourceText: text, sourceId, actor, target, knownActors,
  minimumConfidence: 0.75, processedIds: new Set(),
}); // {events, rejected}
```

事件 ID 根据稳定消息 ID、事件类别、参与方和证据确定；不使用消息数组下标。Adapter 必须在提交前关联消息修订指纹，并在删除、编辑、Swipe、重新生成后核对有效来源。提取器不负责持久化。

规则模式只接受少数完整、明确的第一人称行动语句。例如：

- `我刚才帮你搬好了箱子。`
- `我承认我没有遵守我们的约定。`
- `我为没有遵守约定向你道歉。`
- `I admit I broke my promise to you.`
- `I have kept my promise to you.`

词语“帮助”“背叛”本身不会触发更新。引述、假设、历史回忆、不确定叙述、指令和未来计划被保守拒绝；无法确认时返回空事件。此设计会漏掉真实但表达复杂的事件，用户可使用界面修正或选择模型提取。登记表包含 16 种人际事件，规则模式不承诺自动识别每一种叙述。

模型模式使用显式传入的 `provider({system, prompt, signal})`，由 SillyTavern Adapter 对接当前模型。首次启用前应告知：所选来源消息、允许的事件类型和参与方 ID 将发送到用户当前配置的模型服务。没有独立模型服务、数据库或付费依赖。

```js
const extractor = createModelExtractor({ provider, timeoutMs: 15000, maxCalls: 3 });
const result = await extractor.extract(text, { sourceId, actor, target, knownActors, signal });
extractor.cancel();
// 新事务开始时才能显式重置，运行中不能重置。
extractor.resetBudget();
```

包装器限制并行请求、调用次数、输入规模及超时；取消或服务失败后回退规则模式。模型必须返回纯 JSON，不接受 Markdown 围栏或可执行文本。服务忽略 AbortSignal 时，包装器仍会放弃该结果；底层生成请求是否真正停止取决于宿主能力。失败结果返回固定错误说明，不转发可能包含凭据的服务异常。

`schemas/event.schema.json` 定义结构；运行时校验另外要求：

- 来源 ID 有效，参与方存在并与当前事件方向一致。
- `modality` 只能为 `fact`，强度、置信度、剧情时间范围有效。
- 证据必须逐字来自当前来源消息，拒绝明确的否定与事件矛盾。
- 拒绝重复事件、同证据相反事件、额外字段、危险属性、循环/过深数据。
- 每次最多 8 个事件；来源最多 16,000 字符；模型输出最多 32,000 字符。

违约、欺骗、侵犯边界、忽视及强度 ≥0.85 的事件标记为需要确认；状态管理器在用户确认前不应用这些效果。语义验证无法证明叙述真实，也无法完全识别所有提示词注入，因此提取结果始终属于候选数据，并保留来源和人工撤销能力。

## 人格导入格式

`importPersonality(input, {format:'json'|'csv'})` 返回核心人格结构；`exportPersonality(profile, {format})` 可导出。禁止导入未知字段、无效数值和声称未经提供常模支持的百分位。

JSON 支持 `baseline`、30 个 `facets`、`raw_scores`、量表元数据及质量标记。`raw_scores.domains` 的 IPIP-NEO-120 原始加总范围为 24–120，`raw_scores.facets` 为 4–20，必须是整数。原始加总导入使用 `(raw-min)/(max-min)` 得到内部 0–1 值，明确标记**不是人群百分位**。不支持从未声明计分方法的原始题目答案自动猜测反向计分。若外部测试输出其他量表、均分、z 分或百分位，请先按照合法来源的计分说明转换。

```csv
trait,raw,normalized
E,96,0.75
A,,0.80
N1,16,
```

CSV 必须包含这三个列，trait 为 O/C/E/A/N 或 O1…O6、C1…C6、E1…E6、A1…A6、N1…N6。原始值与归一化值至少填写一项。不允许重复 trait、数学表达式或 Excel 公式。解析器支持引号、逗号、跨行字段及双引号转义，数值列仍严格校验。缺失分面由所属大五维度补全并添加 `imputed:*` 标记；缺失维度仅在六分面齐全时从分面均值得到，否则补为 0.5 并添加质量标记。原始数据永久保留；数值不一致时添加标记，不静默改写原始得分。

## Prompt 编译接口

```js
await buildPrompt(state, {
  config, personality, language: 'zh', target: 'user',
  maxTokens: 300, countTokens: async text => actualHostTokenCount,
  memories: retrievedMemories, cardText,
}); // {text, tokens, truncated, modules, tokenizer}
```

编译器支持中英文本与各模块开关，按情绪、关系、行为、相关记忆、稳定倾向的顺序保留预算内内容。全部关闭时返回空文本。人格说明会考虑已批准的适应偏移；基础得分不受影响。`cardText` 只去除逐字重复的完整片段，不承诺识别角色卡中所有语义重复。

模型证据、聊天原文、角色名字、自由文本记忆摘要和任意行为字符串不会插入高信任 Prompt 通道；只采用预先编写的事件/状态/行为枚举描述。关系维度分别描述，主观记忆标记未经证实，待确认、撤销、删除和低置信度记忆被排除。用户对记忆的自由文本修正可用于检索和界面查看；改变事实影响应更改事件类别、撤销或确认事件。

宿主提供 tokenizer 时使用实际 token 数并最终复核。宿主不可用或调用失败时按 UTF-8 字节数保守限额，可能产生明显较短的中文 Prompt；返回 `tokenizer:'utf8-conservative'`。预算很小时返回空文本，避免切断守卫语句。模块自身不注册 SillyTavern Prompt；Adapter 使用同一个固定注入 key 替换内容，并在禁用、切换和异常时清空。

## 已验证范围

本目录自动化测试验证了确定性规则、JSON 安全边界、超时/取消/限额、导入导出、语言、状态描述、模块开关和预算回退。测试使用假的模型 provider 和 tokenizer，不能代替真实 SillyTavern 模型连接、tokenizer 和生成生命周期的人工验收。工程参数和语言映射是可配置、可替换的模拟规则，不是经临床验证的人格复制或诊断。
