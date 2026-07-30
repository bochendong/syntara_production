# 从网页版迁移到本机

迁移采用版本化的 `.syntara.json` 文件。导出只读取 PostgreSQL，导入只写当前设备的
SQLite；两边不需要同时在线。

## 1. 导出网页版数据

在仓库根目录运行：

```bash
pnpm native:archive:export -- --email your@email.com --output ~/Downloads/syntara.syntara.json
```

如果数据库只有一个课程所有者，可以省略 `--email`。也可以使用
`--owner-id <user-id>` 精确指定账号。

导出内容包括：

- 课程和笔记本元数据
- 图片笔记本页面、动作与白板 JSON
- Markdown 章节
- 页面和 Markdown 引用的图片资源（二进制内容随迁移包携带）
- 题库、作答记录和学习进度
- 课程对话和消息
- 学习记忆

迁移包不会包含登录凭据、OAuth 会话、API Key、支付记录、题目私密判题配置或管理员
数据。

OpenAI API Key 不属于课程数据迁移范围。首次在新设备使用助教时，请在“课程工具 → 设置”
中单独保存到该设备的 Apple Keychain。

## 2. 导入 macOS / iPadOS 应用

1. 打开 Syntara。
2. 在 Learn 首页点击“迁移数据”。
3. 选择导出的 `.syntara.json` 文件。

导入采用主键合并，相同迁移包可以重复导入；已有记录会更新，不会生成重复课程或消息。
如果导入中断，重新选择同一个文件即可恢复。

## 离线资源

导出器会扫描页面、讲解动作、Markdown、题面和评分公开内容中的本地资源路径，并从
`Asset` / `NotebookImageAsset` 读取相应二进制内容。导入时原生层会校验每个文件的
SHA-256，并写入 App Data 内容寻址目录；SQLite 只保存索引和相对路径。打开某一页时才会
读取该页实际显示的资源。

如果数据库里只有路径而没有二进制内容，导出摘要会列出 `missingAssets`，应用导入后也会
显示缺失数量。内嵌 data URL 不受影响。纯外部网页 URL 不会在迁移时自动下载，避免导出
过程无边界访问第三方网络。

## 验证

不连接 PostgreSQL 也可以验证归档解析、SQLite 五版迁移、重复导入、本机全文检索和
本地详情读取：

```bash
pnpm native:verify
```
