# 作答反馈与代码题输入文件

做题器提交后用统一通知显示答对、答错、部分正确或批改未完成，并显示本次提交的得分。通知可关闭，六秒后自动消失；答对不自动切换题目。分小问通知只汇总本次提交的部分。切换题目后，尚未返回的旧批改仍保存和同步，但不覆盖当前题目的反馈或提交状态。

代码题的输入文件在测试区直接展示，首个文件默认展开。Python 调试在每次运行独立的虚拟 `/work` 目录中准备输入文件，并以题目预设文本提供标准输入；文件必须使用安全的相对路径，参考输出文件不作为输入传入。

## 来源与验收

这些改动按用户要求从 `ipad-handwriting/syntara_production` 工作树显式迁入，来源基线为 `7c7da4d7f8588540d0753f3d749d59aa93dba31d` 上的未提交改动；范围为通知、手动切题、分小问反馈、异步反馈隔离、输入文件展示和 Python 调试。合并保留了已发布的右侧试卷系列筛选面板。原工作树未修改；完整文件哈希和补丁收据保存在本机私有 receipts 目录。

- `node --test scripts/maintenance/verify-submission-feedback.test.mjs`
- `node --test scripts/maintenance/verify-python-debug-worker.test.mjs`
- `pnpm verify:local`

本机 Vite 可打开 `/submission-feedback-preview.html` 与 `/csv-input-preview.html`，使用隔离的本地课程样例验证真实做题器。这两个入口只供开发预览，不进入生产网页构建，也不向测试服写入学生作答。
