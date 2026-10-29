# GitHub 分发

目标仓库：https://github.com/nddjdjsj/Public 。扩展 manifest 与入口位于仓库根目录，可供 SillyTavern 的 Git URL 安装流程使用。

安装包和校验值位于仓库的 `downloads/` 目录，当前发布说明位于 `docs/RELEASE-v1.1.0.md`，历史说明仍保留。当前 GitHub 连接提供源码写入接口，但没有创建 GitHub Release 或上传 Release asset 的接口，因此采用仓库文件下载分发，不能将其描述成已创建 GitHub Release。

扩展沿用该目标仓库在首次发布前已有的 Apache 2.0 LICENSE。没有上传开发时下载的第三方参考源码目录、浏览器配置、凭据或私人聊天数据。

重新打包：运行 `npm test`、`npm run build`，再在 PowerShell 执行 `./scripts/package.ps1`。脚本按 SHA256 清单构造 ZIP，不递归打包 `.git`、`.env` 或依赖目录，并在打包后逐文件校验。上传更新后的源码、ZIP 和 ZIP 的 `.sha256`；保持安装包与源码版本一致。
