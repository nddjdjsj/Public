# 心理学来源与模拟算法

核对日期：2026-10-29。本扩展模拟虚构角色，不是临床评估工具；不会推断真实用户的人格或疾病。下列人格测量来源与运行时工程算法分开维护。

## 已核对的一手来源

- [IPIP 官方 Johnson 120 题、30 分面及正反向计分键](https://ipip.ori.org/30FacetNEO-PI-RItems.htm)：每个分面四题。该页按分面和正反向分组，不是统一的问卷题号表。本项目导入已计分结果，不实现题目作答；不能将其他网站的第 n 题直接视作该页第 n 项。
- [IPIP 官方计分说明](https://ipip.ori.org/newScoringInstructions.htm)：正向题采用 1–5 分，反向题采用 6−作答分，量表分数为题目分数之和。
- [IPIP 官方许可](https://ipip.ori.org/newPermission.htm)：IPIP 材料为公共领域；本项目未抓取或再分发任何私人作答数据。
- [Johnson (2014) 原论文](https://doi.org/10.1016/j.jrp.2014.05.003)：IPIP-NEO-120 的测量来源。运行时情绪和关系权重不是该论文的心理学公式。

## 分面键

| 域 | 顺序 1–6（英文为来源原名；中文为本项目 UI 释义） |
|---|---|
| O | Imagination、Artistic Interests、Emotionality、Adventurousness、Intellect、Liberalism |
| C | Self-Efficacy、Orderliness、Dutifulness、Achievement-Striving、Self-Discipline、Cautiousness |
| E | Friendliness、Gregariousness、Assertiveness、Activity Level、Excitement-Seeking、Cheerfulness |
| A | Trust、Morality、Altruism、Cooperation、Modesty、Sympathy |
| N | Anxiety、Anger、Depression、Self-Consciousness、Immoderation、Vulnerability |

键为域字母加顺序号，例如 N2、A4。名称中的 Depression、Anxiety 是人格分面名称，不表示诊断。中文界面不是经验证的中文测量问卷。

`raw_scores.facets` 保留 4–20 原始分；`raw_scores.domains` 保留 24–120 原始分。内部归一化为分面 `(raw−4)/16`、域 `(raw−24)/96`。这些是**量表范围归一化**，不是人群百分位、标准分或常模。导入器不虚构常模。手动修改归一化值时，原始分不会被重写为新的测量结果。

分面缺失时回填对应域的值，并加入 `imputed:N1` 等质量标记；该回填是显式工程默认值。五份示例和预设均带 `source: simulated`，固定随机种子可复现，不代表任何真实人的测评。

## 可解释工程模型

核心均为无 DOM 的纯 JavaScript。`config.js` 集中默认参数及范围校验，`engine.event_overrides` 可替换每个事件的 PAD/关系权重。`appraisal.js` 的注册表允许开发者添加事件；独立模块可以直接替换。

PAD 三轴范围 −1…1。事件响应依据强度、置信度、人格敏感度、已有冲突和相关记忆次数调节，再乘 `event_gain`、`emotion.sensitivity`。负面事件受 N 及 N1/N2/N6 分面影响；承诺受 C3 调节；信任增长受 A1 调节，冲突增长受 A4 调节。上述相关方向是角色模拟的设计选择，不是对个人反应的可靠预测。

情绪基线由角色人格计算。恢复形式为 `baseline + (current−baseline) × (1−recovery)^(amount×speed)`；默认 recovery=.12，速度 slow=.5、standard=1、fast=2，再乘用户 decay_speed。有效时间由显式 `time_passed` 事件提供，默认剧情时间；墙上时间不参与推断。无事件不制造剧情时间；多事件按日志顺序更新，各轴每次截断到边界。每条事件 ID 只应用一次。

关系五维独立。重复事件乘 `1/sqrt(1+次数×frequency_decay)`；正负变化受剩余空间调节，每事件每维不超过 `max_event_delta`，正向信任额外不超过 `trust_recovery_limit`。同一次信任伤害后，反复道歉累计信任恢复还受 `apology_trust_budget` 限制（默认 2），补救和履约分别累计；依恋不替代信任，冲突不清空亲密度。低置信事件不更新状态，高影响候选须确认后才影响情绪、关系及行为策略。主观理解可以影响情绪，但不自动改变客观关系。

行为模块对六种策略评分，经带温度的 softmax 转成倾向概率，并用事件 ID 种子抽样。人格、情绪、关系、冲突记忆、显式目标和场景约束分别贡献可检查的分项。策略是供 LLM 参考的建议。当前目标/场景约束可通过核心 `behavioralPolicy` 的 options 传入，第一版 UI 未实现任务规划器。

记忆保留事件来源、修正历史、重要度、置信度和实际关系变化。检索以关键词/汉字集合重叠、重要度、剧情时间距离、人物、情绪和冲突背景评分，无向量服务依赖。`MemoryIndex` 维护有界词项/人物倒排表：候选数默认 256，每条最多索引 64 个词项，词汇表最多 50,000 项；常见词保留最近候选，稀有场景词可召回较早事件。索引不删除原始记忆。行为策略采用同样大小的最近记忆窗口，以保证分批提交和完整重放产生一致状态；Prompt 可通过 `manager.retrieve()` 获取跨历史的索引检索。提示词编译器采用事件类型模板，避免将不可信记忆文本拼成指令。

基础人格固定；仅用户启用适应时，确认过的 `personality_adaptation` 事件可改变聊天级偏移。默认每次不超过 .002，累计绝对值不超过 .1；须有原因，可撤销。该功能不会从普通文本自动推断人格变化，也不会改写角色原始测评分。

## 事件存储与适用边界

事件日志是重建依据，快照是有界缓存，不信任导入快照。本次运行生成的快照须通过事件前缀、模型配置和快照内容指纹核对，编辑或撤销仅复用变动位置之前的有效快照；存储导入始终从校验后的日志重放。普通追加使用事件 ID 索引，仅计算新事件。`source_message_ids` 对应适配器赋予的稳定身份，`source_revisions` 对应内容/Swipe 修订指纹，不能把数组索引当身份。`source_order` 仅是可刷新顺序提示：适配器在结构变更时通过 `reconcile(validSources, {sourceOrder: Map})` 更新当前消息位置。编辑旧消息得到的新事件插入原来源的位置；此前无事件的旧消息也可按此提示恢复正确顺序。

记忆和事件日志保留至配置容量上限；达到容量时拒绝继续累计并提示导出/另开聊天，不静默丢弃重要事件。检索只复制排序后的命中项；长历史导入、状态副本、纠错和导出仍需要遍历数据，未声称常量复杂度。不会每轮重扫历史聊天正文。一次 1,000 事件实测及运行环境记录在 [performance.json](performance.json)，并非生产环境时延保证。

本模型不复制真实人格，不保证所有故事解释正确。规则提取故意保守；结构化模型提取仍需校验，情境歧义、中文叙述变体和人物指代可能需要人工修正。所有数值权重和策略都应随具体角色体验进行校准。
