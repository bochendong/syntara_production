# MAT102 试卷系列标签

`scripts/learn/tag-mat102-paper-series.mjs` 为测试服 UTM-MAT102 的模拟卷题补充可搜索的试卷系列标签。它只修改题目的 `tags` 和 `updatedAt`，并在实际修改后将课程 `contentVersion` 加一，供客户端同步。

- TT1 A–H：`TT1模拟A卷` 等，每卷 10 道选择题、4 道大题。
- TT2 A–J：`TT2模拟A卷` 等代表修订后的完整卷。按来源 `sourceItem` 将修订题替换到原卷对应题位，未修改的题仍属于新版。
- TT2 原版：`TT2原版模拟A卷` 等独立保留。未修改的题可同时属于两版；原版被替换的题只属于原版。
- 非模拟卷题不加系列标签。原有知识点和来源标签全部保留。

归属只从明确的模拟卷来源文件及其题位推导，不能仅凭标题或 `TT2` 标签推断。每套试卷须完整，来源冲突、重复题位或标签超限均停止。完整中文卷名在题库搜索中不会混入另一版本。学生端打开搜索结果时，练习范围使用完整搜索结果，而不是该题所在的知识点章节，因此可跨章节练同一张卷；搜索词作为练习标题，不覆盖上次章节学习位置。此操作不增加新的筛选界面。

## 受保护的测试服维护

日常课程导入接口仅支持新增，不允许通过导入覆盖旧题。该维护命令使用既有 `createStagingProblemImportOperator`，验证 Railway 项目、测试环境、服务、部署、数据库主机、精确课程和数据所有者，不使用或提升学生账号权限，不提供 HTTP 编辑入口。

在已明确选定的测试服 API 运维环境中运行，默认只读预览：

```sh
node /tmp/reviewed/tag-mat102-paper-series.mjs \
  --workspace /app --plan /tmp/private/series-plan.json \
  --receipt /tmp/private/series-preview.json
```

核对私有计划后，使用相同 `--plan` 和单独的 `--receipt`，增加 `--apply` 提交。计划绑定原标签、内容哈希及精确版本；串行化事务内再次检查权限与来源，使用条件更新避免覆盖并发编辑。相同计划重放不重复加标签或增加课程版本。提交后逐题核对标签和所有其他字段，并确认题数、笔记不变。收据包含私有评分数据，必须留在 0700 目录下的 0600 文件中，不入 Git。

离线回归：

```sh
node --test scripts/learn/tag-mat102-paper-series.test.mjs
```
