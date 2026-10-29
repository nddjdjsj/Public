# PsycheEngine v1.0.0

首个可直接安装的 SillyTavern 动态人格扩展版本，采用原生 JavaScript，无需转译或独立后端。

## 功能

- 五大人格与 30 个 IPIP-NEO 分面，支持手动调整、JSON/CSV 导入导出及五种模拟人格示例；原始分与内部归一化分开保存。
- PAD 情绪、分对象五维关系、可检索事件记忆和可解释行为倾向；基础人格固定，可选显式、缓慢且可撤销的适应偏移。
- 默认保守规则提取，无额外模型调用；可明确启用当前模型分析，包含输入校验、证据追踪、高影响确认、超时及失败回退。
- 事件日志与快照，处理重新生成、Swipe、编辑、删除、聊天切换和分支；角色私有状态按范围隔离。
- 中英文动态状态 Prompt、Token 预算、模块开关、可操作设置面板、备份恢复与有界调试日志。

## 安装

可通过 SillyTavern“安装扩展”输入 `https://github.com/nddjdjsj/Public`。也可下载仓库 `downloads/` 下的 [安装 ZIP](https://github.com/nddjdjsj/Public/raw/refs/heads/main/downloads/PsycheEngine-1.0.0.zip)，将完整的 `SillyTavern-PsycheEngine` 文件夹解压到：

```text
<SillyTavern>/data/<用户>/extensions/SillyTavern-PsycheEngine/
```

默认用户通常为 `default-user`。管理员也可使用 `public/scripts/extensions/third-party/SillyTavern-PsycheEngine/`。目标文件夹内应直接包含 `manifest.json` 与 `index.js`。刷新页面后在扩展设置中选择 PsycheEngine，打开单人角色聊天并配置人格。详细操作见 [README](../README.md)。

## 验证与限制

已核对 **SillyTavern 1.19.0** 官方源码，提交 `06bde939fb1e9c4c8d8641d810f0a916b5bce127`。开发环境自动化测试 **106/106 通过**，覆盖纯核心、输入边界、Prompt、模拟宿主生命周期、异步竞争和人格倾向实验；构建检查通过。记录见 [VALIDATION](VALIDATION.md)。

**真实 SillyTavern 端到端、实际模型连接和浏览器 UI 冒烟尚未执行。** 源码核对及模拟宿主测试不等于真实环境兼容性验收。安装后请按 [验收清单](ACCEPTANCE.md) 验证生成、持久化、分支和界面。

群聊采用保守降级。规则模式只覆盖有限的明确行为陈述；模型提取仍可能误解剧情。宿主模型请求取消后底层网络仍可能完成，迟到结果会被丢弃。旧消息缺少稳定 Persona 标记时使用显示名回退。无常模数据时不提供人群百分位；人格、情绪及关系算法是虚构角色工程模拟，不能用于临床诊断或真实人格复制。

沿用目标仓库原有的 Apache 2.0 License。默认数据由用户的 SillyTavern 保存；启用模型分析会将来源文本发送至其已配置模型服务。
