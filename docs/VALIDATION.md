# 交付验证记录

日期：2026-10-29。版本：PsycheEngine 1.0.0。开发环境：Windows 11 x64、PowerShell 7.6.5、Node.js v26.8.1、npm 11.19.0。

## 已执行

| 验证 | 结果 | 证据 |
|---|---|---|
| 官方 release 源码与扩展示例核对 | SillyTavern 1.19.0，提交 `06bde939fb1e9c4c8d8641d810f0a916b5bce127`；所用 API 和注入时序已查看实际实现 | [API-COMPATIBILITY.md](API-COMPATIBILITY.md)、[upstream-audit.json](upstream-audit.json) |
| 自动化测试 `node --test --test-reporter=spec` | **106 / 106 通过**；失败0、跳过0、TODO0；本次约550ms | [完整终端结果](test-results.txt) |
| `npm run build` | 25 个 JavaScript 模块语法、相对导入、JSON 和安装 manifest 校验通过；无需转译 | `scripts/check.mjs` |
| 人格倾向实验 | 1,000 个固定种子下，外向/内向模拟人格的参与/回避选择分布具有预期方向差异；可复现 | `tests/statistics.test.js`，不代表心理学实证效度 |
| 独立1,000事件性能样本 | 首批约773ms，索引检索约1ms，单次追加约10ms，快照重建约40ms | [performance.json](performance.json)，单机单次测量，无生产延迟保证 |
| ZIP 文件完整性 | 打包脚本逐条读取 ZIP，核对所有文件数量、相对路径和 SHA-256；ZIP 旁提供独立 `.sha256` | `scripts/package.ps1`、`SHA256SUMS.txt` |

测试覆盖纯核心、提取与导入、Prompt、模拟 host 生命周期、异步竞态、隐私与人格统计倾向。重新生成、Swipe、编辑/删除、聊天切换、分支、角色与 Persona 隔离、禁用清理、保存重载和缺失 API 均有实际执行的模拟 host 回归。测试详情以完整终端结果为准。

## 未执行

- **浏览器 UI 冒烟**：本地夹具已创建并通过脚本语法检查；首轮授权未完成，后续启动又在执行前被工具拒绝，因此没有运行结果或截图。详见 [BROWSER-UI.md](BROWSER-UI.md)。
- **真实 SillyTavern 端到端**：当前没有用户的运行中安装、角色与模型服务。尚未实测实际流式/非流式生成、不同 API Prompt 排序、真实分支/导入、服务器保存、主题、移动端和其他扩展交互。
- **生产长聊天与模型分析质量**：性能样本不等于20,000条重要记忆的生产测试，也未对真实模型的事件识别精度作评价。

## 已知限制

1. 群聊采用保守降级，不自动注入或提交角色私有状态。
2. 规则模式只识别有限、明确的完整行为陈述；复杂叙事需要手动确认事件，或显式开启当前模型分析。
3. 当前模型分析超时/取消会丢弃迟到结果；宿主 `generateRaw` 没有 caller AbortSignal，底层网络请求仍可能完成。在途请求上限1，避免重叠调用。
4. 旧消息若缺少 Persona 的 `force_avatar`，使用姓名回退；同名旧 Persona 可能需要人工区分对象。
5. 宿主 `saveMetadata` 内部保存调度和错误处理不完全可观察；切换聊天与保存并发须在实际服务器验收。
6. 角色卡去重以已知文本匹配为基础，无法保证任意改写的语义去重。记忆 Prompt 使用事件类型模板，牺牲叙事细节以降低指令注入风险。
7. 人格适应是显式、受限、有原因且可撤销的偏移，不是自动训练。无常模数据时只提供原始分和量表范围归一化，不提供伪造百分位。

安装和操作见 [README](../README.md)。真实宿主检查见 [ACCEPTANCE.md](ACCEPTANCE.md)。本记录不会把未执行项目标为通过。
