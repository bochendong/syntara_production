# OpenAI 文件上传与带文件聊天

## 目标

课程资料、教师资料、题库原始文件和聊天附件共用同一条文件入口：浏览器把文件切成小块，经 Syntara 的鉴权路由转发到 OpenAI Uploads API；完成后只在业务请求中传递签名后的 `file_id` 凭证。API Key 始终只存在于服务端。

支持格式统一为 PDF、PPTX、DOCX、MD、TXT，以及 JPG、PNG、WebP、GIF。产品单文件上限为 50 MB。

## 请求链路

1. 浏览器向 `/api/openai/uploads` 提交文件名、MIME、字节数和用途。
2. 服务端调用 OpenAI `POST /v1/uploads`，签发绑定当前用户和 `upload_id` 的短期凭证。
3. 浏览器按 3 MiB 切块；每个请求都小于 Vercel 4.5 MB 请求体限制。服务端把原始块包装为 OpenAI 所需的 multipart part。
4. 浏览器按返回顺序提交 `part_id`，服务端调用 `POST /v1/uploads/{id}/complete`。
5. 服务端返回 `file_id` 和一个绑定用户、文件信息、用途的签名文件凭证。
6. 教师资料先由浏览器分片保存进业务数据库，再创建 AI 队列任务；OpenAI 或文件解析失败不会回滚已经保存的原文件。
7. DOCX/PPTX 在队列的 `converting_to_pdf` 阶段生成并保存派生 PDF；在线预览读取派生 PDF，下载仍读取原文件。历史 Office 文件在第一次预览时补生成派生 PDF。
8. 聊天请求只携带短期 `file_id`。检测到文件输入时，后端强制使用 OpenAI Responses API，并构造 `input_file`；回答结束后删除临时聊天文件。

## 题库边界

题库文件属于课程，不属于笔记本。课程题库预览、提交和教师题库资料处理三层都强制 `notebookId = null`。题库资料处理只创建课程题目，不创建 AI 笔记本；以后如需归类，由老师在独立的整理流程中显式操作。

## 文件保真策略

- 原文件是权威来源，必须保留；不能只保存转出的 PDF 或抽取文本。
- PDF 通过 Responses 文件输入同时提供文本和页面视觉信息。
- PPTX/DOCX 保留原文件，并生成课程私有的派生 PDF 供在线预览；AI 索引继续使用确定性抽取的完整文字，避免 PDF 视觉层反向抽取造成正文丢失。
- MD/TXT 使用原文件输入，不再由浏览器截断后拼进 prompt。
- 图片继续使用 Responses 的图像输入路径；课程资料图片仍会做服务端文字提取以便检索。

## 官方依据

- [OpenAI File inputs](https://developers.openai.com/api/docs/guides/file-inputs)
- [Create upload](https://developers.openai.com/api/reference/resources/uploads/methods/create)
- [Add upload part](https://developers.openai.com/api/reference/resources/uploads/subresources/parts/methods/create)
- [Complete upload](https://developers.openai.com/api/reference/resources/uploads/methods/complete)
- [Create file](https://developers.openai.com/api/reference/resources/files/methods/create)
