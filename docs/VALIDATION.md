# 交付验证记录

日期：2026-10-29。版本：PsycheEngine 1.1.0。开发环境：Windows 11 x64、PowerShell 7.6.5、Node.js v26.8.1、npm 11.19.0。

## 已执行

| 验证 | 结果 | 证据 |
|---|---|---|
| 官方 release 源码与扩展示例核对 | SillyTavern 1.19.0，提交 `06bde939fb1e9c4c8d8641d810f0a916b5bce127`；所用 API 和注入时序已查看实际实现 | [API-COMPATIBILITY.md](API-COMPATIBILITY.md)、[upstream-audit.json](upstream-audit.json) |
| 自动化测试 `node --test --test-reporter=spec` | **146 / 146 通过**；失败0、跳过0、TODO0 | [完整终端结果](test-results.txt) |
| 本地实际宿主函数工具契约 | 12项通过；实际 ToolManager、ToolDefinition、EventEmitter、工具续写分支及流式最终事件顺序；包含真实 Adapter 经实际宿主注册表调用的联合测试 | [LOCAL-HOST-TOOLS.md](LOCAL-HOST-TOOLS.md)、`tests/host-tool-contract.test.js` |
| `npm run build` | 29 个 JavaScript 模块语法、相对导入、JSON 和安装 manifest 校验通过；无需转译 | `scripts/check.mjs` |
| 人格倾向实验 | 1,000 个固定种子下，外向/内向模拟人格的参与/回避选择分布具有预期方向差异；可复现 | `tests/statistics.test.js`，不代表心理学实证效度 |
| 独立1,000事件性能样本 | 首批约773ms，索引检索约1ms，单次追加约10ms，快照重建约40ms | [performance.json](performance.json)，单机单次测量，无生产延迟保证 |
| ZIP 文件完整性 | 打包脚本逐条读取 ZIP，核对所有文件数量、相对路径和 SHA-256；ZIP 旁提供独立 `.sha256` | `scripts/package.ps1`、`SHA256SUMS.txt` |

测试覆盖纯核心、提取与导入、Prompt、模型函数工具、模拟 host 生命周期、本地实际宿主源码契约、异步竞态、隐私与人格统计倾向。工具候选经过原文证据校验，并在递归生成、空/省略号占位清理、停止、切换、重新生成及跨入口去重时保持一致。人工撤销/修正不能被另一条自动提取入口复活。测试详情以完整终端结果为准。

## 未执行

- **浏览器 UI 冒烟**：本地夹具已创建并通过脚本语法检查；首轮授权未完成，后续启动又在执行前被工具拒绝，因此没有运行结果或截图。详见 [BROWSER-UI.md](BROWSER-UI.md)。
- **真实 SillyTavern 端到端**：已读取并测试用户本地 `D:\SillyTavern-1.19.0` 的实际源码；该目录尚无已初始化用户数据、依赖安装或运行中的8000端口服务。没有启动完整服务器、浏览器或真实模型请求。实际流式/非流式模型生成、服务器保存、主题及其他扩展交互仍须验收。
- **生产长聊天与模型分析质量**：性能样本不等于20,000条重要记忆的生产测试，也未对真实模型的事件识别精度作评价。

## 已知限制

1. 群聊采用保守降级，不自动注入或提交角色私有状态。
2. 原生模型工具需要 Chat Completion 的 Function Calling 开关与受支持模型；注册成功不保证模型每轮都会选择调用。规则模式只识别有限明确语句；模型事件工具和可选额外模型分析是两个独立入口。
3. 当前模型分析超时/取消会丢弃迟到结果；宿主 `generateRaw` 没有 caller AbortSignal，底层网络请求仍可能完成。在途请求上限1，避免重叠调用。
4. 旧消息若缺少 Persona 的 `force_avatar`，使用姓名回退；同名旧 Persona 可能需要人工区分对象。
5. 宿主 `saveMetadata` 内部保存调度和错误处理不完全可观察；切换聊天与保存并发须在实际服务器验收。
6. 角色卡去重以已知文本匹配为基础，无法保证任意改写的语义去重。记忆 Prompt 使用事件类型模板，牺牲叙事细节以降低指令注入风险。
7. 人格适应是显式、受限、有原因且可撤销的偏移，不是自动训练。无常模数据时只提供原始分和量表范围归一化，不提供伪造百分位。

安装和操作见 [README](../README.md)。真实宿主检查见 [ACCEPTANCE.md](ACCEPTANCE.md)。本记录不会把未执行项目标为通过。
