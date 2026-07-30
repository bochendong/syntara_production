import type { LocalConversation, LocalMessage, LocalNotebook } from '../domain/models';
import { bundledProblemCourses, bundledProblems } from './bundled-problem-snapshot';
import { NATIVE_MAT136_REVIEW_PLAN } from './mock-review-plan';

const now = Date.now();
const day = 86_400_000;

export const bundledMockConversationVersion = 'mat136-v9-lecture-eligibility';
export const legacyMockConversationIds = ['conversation-mat136-riemann-endpoints-local'];
export const legacyMockMessageIds = [
  'message-mat136-riemann-endpoints-user-local',
  'message-mat136-riemann-endpoints-assistant-local',
];

export const seedCourses = bundledProblemCourses;

export const seedNotebooks: LocalNotebook[] = [
  {
    id: 'notebook-riemann-local',
    courseId: 'course-mat136-local',
    name: '01 · 黎曼积分',
    description: '从面积近似到定积分定义。',
    kind: 'image',
    tags: ['Riemann sum'],
    sectionCount: 8,
    createdAt: now - 20 * day,
    updatedAt: now - 10_000,
  },
  {
    id: 'notebook-techniques-local',
    courseId: 'course-mat136-local',
    name: '02 · 积分技巧',
    description: '换元、分部积分与常见策略。',
    kind: 'markdown',
    tags: ['substitution', 'integration by parts'],
    sectionCount: 6,
    createdAt: now - 14 * day,
    updatedAt: now - 2 * day,
  },
];

export const seedProblems = bundledProblems;

export const seedConversations: LocalConversation[] = [
  {
    id: 'conversation-mat136-memory-correction-local',
    courseId: 'course-mat136-local',
    notebookId: null,
    title: '你记错了，我已经会左右端点了',
    createdAt: now - 12 * 60_000,
    updatedAt: now - 11 * 60_000,
  },
  {
    id: 'conversation-mat136-personalized-practice-local',
    courseId: 'course-mat136-local',
    notebookId: 'notebook-riemann-local',
    title: '给我三道真正适合我的题',
    createdAt: now - 18 * 60_000,
    updatedAt: now - 17 * 60_000,
  },
  {
    id: 'conversation-mat136-reexplain-endpoint-local',
    courseId: 'course-mat136-local',
    notebookId: 'notebook-riemann-local',
    title: '我还是不懂为什么不能取 3',
    createdAt: now - 26 * 60_000,
    updatedAt: now - 23 * 60_000,
  },
  {
    id: 'conversation-mat136-progressive-hint-local',
    courseId: 'course-mat136-local',
    notebookId: 'notebook-riemann-local',
    title: '先别告诉我答案，给我提示',
    createdAt: now - 36 * 60_000,
    updatedAt: now - 31 * 60_000,
  },
  {
    id: 'conversation-mat136-mistake-diagnosis-local',
    courseId: 'course-mat136-local',
    notebookId: 'notebook-riemann-local',
    title: '我这道黎曼和题为什么错？',
    createdAt: now - 44 * 60_000,
    updatedAt: now - 43 * 60_000,
  },
  {
    id: 'conversation-mat136-learning-status-local',
    courseId: 'course-mat136-local',
    notebookId: null,
    title: '我现在学到哪了？',
    createdAt: now - 52 * 60_000,
    updatedAt: now - 51 * 60_000,
  },
  {
    id: 'conversation-mat136-weakness-summary-local',
    courseId: 'course-mat136-local',
    notebookId: null,
    title: '我的薄弱点是什么？',
    createdAt: now - 5 * 60_000,
    updatedAt: now - 4 * 60_000,
  },
  {
    id: 'conversation-mat136-review-plan-local',
    courseId: 'course-mat136-local',
    notebookId: 'notebook-riemann-local',
    title: '帮我制定测验前复习计划',
    createdAt: now - 15 * 60_000,
    updatedAt: now - 13 * 60_000,
  },
  {
    id: 'conversation-mat136-local',
    courseId: 'course-mat136-local',
    notebookId: 'notebook-riemann-local',
    title: '为什么要取极限？',
    createdAt: now - 6 * day,
    updatedAt: now - 6 * day + 60_000,
  },
  {
    id: 'conversation-mat136-water-leak-problem-local',
    courseId: 'course-mat136-local',
    notebookId: null,
    title: '漏水速率题为什么取这些左端点？',
    createdAt: now - 4 * day,
    updatedAt: now - 4 * day + 60_000,
  },
  {
    id: 'conversation-mat136-substitution-local',
    courseId: 'course-mat136-local',
    notebookId: 'notebook-techniques-local',
    title: '换元后为什么要一起换 dx？',
    createdAt: now - 2 * day,
    updatedAt: now - 2 * day + 60_000,
  },
  {
    id: 'conversation-csc148-local',
    courseId: 'course-csc148-local',
    notebookId: 'local-queue-csc148-08-trees',
    title: '递归基线条件',
    createdAt: now - 2 * day,
    updatedAt: now - 2 * day,
  },
];

const seedMessagesRaw: LocalMessage[] = [
  {
    id: 'message-mat136-memory-correction-user-local',
    conversationId: 'conversation-mat136-memory-correction-local',
    role: 'user',
    text: '你记错我了，我现在已经会区分左右端点了，不要再把它说成我的薄弱点。',
    createdAt: now - 12 * 60_000,
  },
  {
    id: 'message-mat136-memory-correction-assistant-local',
    conversationId: 'conversation-mat136-memory-correction-local',
    role: 'assistant',
    text: `你说得对：学习状态会变化，之前的记录不能自动代表你现在的水平。我不应该继续把旧判断当成当前事实。

## 我现在掌握的记录

之前把“左右端点采样混淆”标记为薄弱点，主要依据是：

- 你曾经问过，为什么把 $[0,3]$ 分成 6 段时，左端点只取到 $2.5$，不取 $3$；
- 当时的学习记录显示，你容易把“7 个分点”和“6 个矩形需要的 6 个采样点”混在一起。

这些证据只能说明你**当时在这里遇到过困难**，不能证明你现在仍然不会。你刚才提供了新的自我报告：“现在已经能够区分左右端点。”这条信息应该进入判断，但仅凭一句自我报告，我也不应该直接把状态改成“稳定掌握”。

## 我建议怎样修正

我建议先把这项状态从：

> 当前薄弱点

调整为：

> 学生报告已掌握，等待一次短验证

这样既尊重你现在的判断，也不会抹掉有助于理解学习过程的历史记录。旧记录仍然保留为“曾经发生过”，但不会继续被当作安排复习的唯一依据。

## 最短验证方式

不需要重新学一遍，只做下面两个判断题：

1. 把 $[1,5]$ 平均分成 4 段，分别写出左端点和右端点；
2. 如果函数在 $[1,5]$ 上递增，判断左端点和、右端点和分别更可能高估还是低估积分。

如果你能独立完成，并且能解释为什么一组去掉最后一个分点、另一组去掉第一个分点，我就会把它更新为：

> 已掌握：能够稳定选择左右端点，并判断递增函数下的高估与低估。

在验证完成前，我不会再把它直接称为你的“当前薄弱点”，只会标记为“待确认”。这次对学习记忆的修改还没有执行；你可以回复“开始验证”，或者明确说“直接标记为已掌握”。如果选择后者，我会注明这是你的自我确认，而不是作答验证结果。`,
    createdAt: now - 11 * 60_000,
  },
  {
    id: 'message-mat136-personalized-practice-user-local',
    conversationId: 'conversation-mat136-personalized-practice-local',
    role: 'user',
    text: '根据我现在的情况，给我三道真正适合我的题。不要只是随机从题库里拿三道。',
    createdAt: now - 18 * 60_000,
  },
  {
    id: 'message-mat136-personalized-practice-assistant-local',
    conversationId: 'conversation-mat136-personalized-practice-local',
    role: 'assistant',
    text: `可以。我不会按“从简单到困难”随便抽三题，而是让每道题分别验证一个具体环节。

## 选题依据

从现有学习记录看：

- 你已经能说明有限黎曼和为什么只是近似，也知道取极限是为了得到稳定的定积分；
- 你曾在“6 个区间为什么不取最后一个分点”这里出现过混淆；
- 你正在学习换元法，但目前还缺少独立作答来证明变量与微分的转换已经稳定。

所以这组三题先围绕黎曼和建立闭环：**辨认采样点 → 写出黎曼和 → 从黎曼和识别定积分**。暂时不把复杂换元混进来，否则即使做错，也无法判断错误来自哪一层。

---

## 第 1 题：只判断采样点

把区间 $[2,6]$ 平均分成 4 个小区间。

1. 写出全部分点；
2. 写出左端点；
3. 写出右端点；
4. 不计算函数值，只说明为什么两组采样点都只有 4 个。

**这题在检查什么：**你能否把“区间数、分点数、矩形数、采样点数”分开。

**完成标准：**不仅写对两组点，还要能用一句话解释为什么左端点不包含 $6$。

---

## 第 2 题：把采样点变成黎曼和

函数

$$
f(x)=x^2+1
$$

定义在 $[0,2]$ 上。把区间平均分成 4 段，使用右端点写出黎曼和 $R_4$，并计算它的值。

请把下面三项分开写：

$$
\\Delta x,\qquad x_i,\qquad
R_4=\\sum_{i=1}^{4}f(x_i)\\Delta x.
$$

**这题在检查什么：**你是否会把采样规则、函数高度和矩形宽度组合起来，而不是只会列出端点。

**完成标准：**式子里必须出现 4 个函数值，每一项最终都乘同一个 $\\Delta x$，答案单位应当是“面积”而不是函数值本身。

---

## 第 3 题：从和式看出定积分

判断下面极限表示哪个定积分，并解释每个部分是怎样对应的：

$$
\\lim_{n\\to\\infty}
\\sum_{i=1}^{n}
\\left(1+\\frac{3i}{n}\\right)^2
\\frac{3}{n}.
$$

请明确写出：

1. $\\Delta x$；
2. 区间左端点 $a$ 和右端点 $b$；
3. 采样点 $x_i$；
4. 函数 $f(x)$；
5. 最终的定积分。

**这题在检查什么：**你是否真正连接了“很多个矩形的和”与“定积分的定义”，而不只是记住左右端点的机械规则。

**完成标准：**能够从 $\\Delta x=3/n$ 看出区间总长度是 3，并从 $1+3i/n$ 看出区间从 1 开始。

## 作答方式

请先只做第 1 题。我会根据你的答案判断：

- 如果采样点仍然混淆，就用数轴继续处理这一层；
- 如果第 1 题稳定通过，就直接进入第 2 题；
- 如果三题都通过，我会把“左右端点采样”从薄弱点降级，并把下一组练习转向定积分换元。

这样三道题不是一份固定作业，而是一条会根据你答案改变的诊断路径。`,
    createdAt: now - 17 * 60_000,
  },
  {
    id: 'message-mat136-reexplain-endpoint-user-1-local',
    conversationId: 'conversation-mat136-reexplain-endpoint-local',
    role: 'user',
    text: '我看了公式还是没懂。明明 3 也在区间里面，为什么左端点不能取 3？你换一种方式讲。',
    createdAt: now - 26 * 60_000,
  },
  {
    id: 'message-mat136-reexplain-endpoint-assistant-1-local',
    conversationId: 'conversation-mat136-reexplain-endpoint-local',
    role: 'assistant',
    text: `好，我们先完全不用求和公式，只看“位置”和“任务”。

## 把区间想成一排房间

区间 $[0,3]$ 被分成 6 段以后，可以把它想成 6 个连续的房间：

$$
[0,0.5],\ [0.5,1],\ [1,1.5],\ [1.5,2],\ [2,2.5],\ [2.5,3].
$$

现在每个房间都要选一个位置，去测量函数高度。题目说使用“左端点”，意思是：

> 每个房间都派自己的左门框去测量。

于是：

| 房间 | 左门框 |
|---|---:|
| $[0,0.5]$ | $0$ |
| $[0.5,1]$ | $0.5$ |
| $[1,1.5]$ | $1$ |
| $[1.5,2]$ | $1.5$ |
| $[2,2.5]$ | $2$ |
| $[2.5,3]$ | $2.5$ |

$3$ 确实在整个区间里，但它的身份是**最后一个房间的右门框**。它没有错，也没有被删掉；只是这次招聘的是“每个房间的左门框”，所以它没有对应的任务。

## 为什么不能把 $3$ 也加进去

现在已经有 6 个房间，也已经选出了 6 个高度。假如再把 $3$ 加进去，就会得到 7 个高度。

但第 7 个高度应该对应哪一个小区间？

- 它不能继续代表 $[2.5,3]$，因为这个房间已经由左端点 $2.5$ 代表；
- 它也不能代表 $[3,3.5]$，因为这个区间根本不在题目给出的 $[0,3]$ 中。

所以问题不是“3 在不在大区间里”，而是：

> $3$ 有没有一个小区间，让它担任那个小区间的左端点？

在这道题中没有。

你先不用计算，回答我一个很小的问题：最后一个小区间 $[2.5,3]$ 的左边界和右边界分别是什么？`,
    createdAt: now - 25 * 60_000,
  },
  {
    id: 'message-mat136-reexplain-endpoint-user-2-local',
    conversationId: 'conversation-mat136-reexplain-endpoint-local',
    role: 'user',
    text: '左边界是 2.5，右边界是 3。所以取左端点的时候最后一个高度用 2.5。但如果是右端点，就会用 3，对吗？',
    createdAt: now - 24 * 60_000,
  },
  {
    id: 'message-mat136-reexplain-endpoint-assistant-2-local',
    conversationId: 'conversation-mat136-reexplain-endpoint-local',
    role: 'assistant',
    text: `对，这次你抓到关键了。

同一个小区间 $[2.5,3]$：

- 使用左端点时，高度是 $f(2.5)$；
- 使用右端点时，高度是 $f(3)$。

所以 $3$ 并不是“永远不能取”，而是它只会在题目选择右端点时，代表最后一个矩形的高度。

## 把规则压缩成一个稳定判断

遇到这类题，不要先背“左端点去掉最后一个、右端点去掉第一个”。先做这两步：

1. 把每个小区间写成 $[\\text{左边界},\\text{右边界}]$；
2. 题目要左端点，就从每一行拿左边界；题目要右端点，就从每一行拿右边界。

“去掉第一个或最后一个分点”只是这个过程产生的结果。

对于完整分点

$$
0,\ 0.5,\ 1,\ 1.5,\ 2,\ 2.5,\ 3,
$$

左端点是每个小区间的第一个数，因此得到

$$
0,\ 0.5,\ 1,\ 1.5,\ 2,\ 2.5;
$$

右端点是每个小区间的第二个数，因此得到

$$
0.5,\ 1,\ 1.5,\ 2,\ 2.5,\ 3.
$$

你刚才的回答已经说明你能在最后一个小区间上区分两种规则。要确认是不是整体理解，而不是只记住这个例子，下一步只需要换一个区间，例如把 $[1,5]$ 分成 4 段，再分别写左右端点。`,
    createdAt: now - 23 * 60_000,
  },
  {
    id: 'message-mat136-progressive-hint-user-1-local',
    conversationId: 'conversation-mat136-progressive-hint-local',
    role: 'user',
    text: '函数 f(x)=x²+1，在 [0,2] 上分成 4 段，用右端点求黎曼和。我不会做，但先别告诉我答案，只给我一个提示。',
    createdAt: now - 36 * 60_000,
  },
  {
    id: 'message-mat136-progressive-hint-assistant-1-local',
    conversationId: 'conversation-mat136-progressive-hint-local',
    role: 'assistant',
    text: `好，我先只给第一层提示，不写采样点，也不代入函数。

黎曼和的第一步永远是确定每个小区间的宽度：

$$
\\Delta x=\\frac{b-a}{n}.
$$

这道题里：

- $a=0$；
- $b=2$；
- $n=4$。

你先算出 $\\Delta x$。暂时不要往后做，只回复我这个宽度是多少。`,
    createdAt: now - 35 * 60_000,
  },
  {
    id: 'message-mat136-progressive-hint-user-2-local',
    conversationId: 'conversation-mat136-progressive-hint-local',
    role: 'user',
    text: 'Δx = (2-0)/4 = 0.5。',
    createdAt: now - 34 * 60_000,
  },
  {
    id: 'message-mat136-progressive-hint-assistant-2-local',
    conversationId: 'conversation-mat136-progressive-hint-local',
    role: 'assistant',
    text: `对，第一步完全正确：

$$
\\Delta x=0.5.
$$

现在给第二层提示，仍然不写完整答案。

从 $0$ 开始，每次增加 $0.5$，先列出全部 5 个分点。因为题目要求 4 个小区间，所以会有 5 个分点。

然后题目指定使用**右端点**，你需要从每个小区间中选择右边的那个数。换句话说，在 5 个分点里，第一个分点 $0$ 不会被选作右端点。

请你现在只写出：

1. 全部 5 个分点；
2. 其中 4 个右端点。

先不要计算 $f(x)$。`,
    createdAt: now - 33 * 60_000,
  },
  {
    id: 'message-mat136-progressive-hint-user-3-local',
    conversationId: 'conversation-mat136-progressive-hint-local',
    role: 'user',
    text: '分点是 0、0.5、1、1.5、2；右端点是 0.5、1、1.5、2。',
    createdAt: now - 32 * 60_000,
  },
  {
    id: 'message-mat136-progressive-hint-assistant-3-local',
    conversationId: 'conversation-mat136-progressive-hint-local',
    role: 'assistant',
    text: `很好，第二步也完全正确。现在你已经完成了这道题最容易出错的部分：

$$
\\Delta x=0.5,
$$

右端点为

$$
0.5,\ 1,\ 1.5,\ 2.
$$

我再给最后一层提示，但仍然不替你算出数值。

每个矩形的面积是

$$
\\text{高度}\\times\\text{宽度}
=f(\\text{右端点})\\Delta x.
$$

因此你需要建立一个包含 4 个函数值的式子：

$$
R_4=
\\big[
f(\\square)+f(\\square)+f(\\square)+f(\\square)
\\big]\\times 0.5.
$$

把刚才找到的四个右端点依次填进方框，再使用

$$
f(x)=x^2+1
$$

计算四个高度。你把这一行式子写出来，我再只检查结构是否正确，不会提前给出最后结果。`,
    createdAt: now - 31 * 60_000,
  },
  {
    id: 'message-mat136-mistake-diagnosis-user-local',
    conversationId: 'conversation-mat136-mistake-diagnosis-local',
    role: 'user',
    text: `我这道题为什么错？

题目：把 [0,3] 分成 6 段，用左端点估算函数 f(t)=sin(2t)+1 的积分。

我的式子是：

L₆ = 0.5[f(0)+f(0.5)+f(1)+f(1.5)+f(2)+f(2.5)+f(3)]`,
    createdAt: now - 44 * 60_000,
  },
  {
    id: 'message-mat136-mistake-diagnosis-assistant-local',
    conversationId: 'conversation-mat136-mistake-diagnosis-local',
    role: 'assistant',
    text: `## 先说诊断

你这次不是三角函数算错了，也不是忘记乘 $\\Delta t$。真正的错误发生在**选择采样点**这一步：

> 题目有 6 个小区间，但你的式子放进了 7 个函数高度。

这属于“把全部分点都当成左端点”的结构性错误。

## 逐步定位

你正确算出了

$$
\\Delta t=\\frac{3-0}{6}=0.5.
$$

因此完整分点确实是：

$$
0,\ 0.5,\ 1,\ 1.5,\ 2,\ 2.5,\ 3.
$$

到这里都没有错。关键在于：

- **7 个分点**负责划出 6 个小区间；
- **6 个矩形**只需要 6 个高度；
- 使用左端点时，每个矩形取所在小区间的左边界。

把小区间写出来就能看到：

| 小区间 | 应选的左端点 |
|---|---:|
| $[0,0.5]$ | $0$ |
| $[0.5,1]$ | $0.5$ |
| $[1,1.5]$ | $1$ |
| $[1.5,2]$ | $1.5$ |
| $[2,2.5]$ | $2$ |
| $[2.5,3]$ | $2.5$ |

所以 $3$ 虽然是分点，也属于大区间 $[0,3]$，但它是最后一个小区间的**右端点**。如果把 $f(3)$ 也加进去，你就相当于为不存在的第 7 个矩形又增加了一个高度。

正确的结构应该是：

$$
L_6
=0.5\\big[
f(0)+f(0.5)+f(1)+f(1.5)+f(2)+f(2.5)
\\big].
$$

## 这是不是计算粗心？

从你的式子看，不像普通的漏写或算术失误，原因有两个：

1. 你正确列出了所有分点，说明你知道怎样划分区间；
2. 你把每个分点都系统地代入函数，说明你暂时把“分点集合”当成了“左端点集合”。

因此更准确的薄弱点不是“不会黎曼和”，而是：

> 尚未稳定区分分点的作用与采样点的作用。

这个判断目前只基于这一次作答。如果下一道同结构题能够独立做对，就应该把它视为一次已修正的错误，而不是长期薄弱点。

## 怎样避免下次再错

每次写和式前先做一个数量检查：

$$
n\\text{ 个小区间}
\\Longrightarrow
n+1\\text{ 个分点}
\\Longrightarrow
n\\text{ 个采样点}
\\Longrightarrow
n\\text{ 个函数值}.
$$

这道题中 $n=6$，所以最后的中括号里必须恰好有 6 个函数值。只要数出 7 个，就能在计算之前发现结构有问题。

## 立即验证

先不做完整计算。假设仍然把 $[0,3]$ 分成 6 段，但改用右端点：

- 第一个采样点应该是什么？
- 最后一个采样点应该是什么？
- 一共应该有几个函数值？

如果你能回答“$0.5$、$3$、6 个”，就说明你已经开始从“小区间选择采样点”，而不是机械地使用全部分点。`,
    createdAt: now - 43 * 60_000,
  },
  {
    id: 'message-mat136-learning-status-user-local',
    conversationId: 'conversation-mat136-learning-status-local',
    role: 'user',
    text: '我现在学到哪了？不要只告诉我看过哪些章节，我想知道哪些是真的会了，哪些还不会。',
    createdAt: now - 52 * 60_000,
  },
  {
    id: 'message-mat136-learning-status-assistant-local',
    conversationId: 'conversation-mat136-learning-status-local',
    role: 'assistant',
    text: `## 当前结论

你现在大致处在 MAT136 的“黎曼和与定积分已经建立概念连接，正在过渡到换元法”的阶段。

但“看过”不等于“掌握”。根据目前能看到的提问、对话和学习记忆，我会把你的状态分成四层：**已有理解、仍不稳定、正在建立、尚未验证**。

## 已有理解

### 1. 有限黎曼和与定积分的关系

你已经追问过“黎曼和已经能近似面积，为什么还要取极限”，并能够沿着下面的逻辑继续学习：

1. 有限数量的矩形只给出近似；
2. 不同采样方式可能得到不同数值；
3. 当最大子区间宽度趋近于 0 时，近似误差被压缩；
4. 如果不同分割与采样方式趋向同一个稳定值，这个值才定义为定积分。

这说明你不只是见过定积分符号，而是在建立“近似为什么能变成严格定义”的概念连接。

不过，目前证据主要来自提问与后续解释，还没有看到你独立完成“从一个黎曼和极限识别定积分”的正式作答。因此这里更准确的状态是：

> 概念理解已建立，独立应用尚待验证。

### 2. 换元必须统一变量系统

你问过为什么换元时不能只替换函数，还必须替换 $dx$。这表明你已经注意到换元不是局部替换，而是把整个积分从 $x$ 的变量系统转换到 $u$ 的变量系统：

$$
u=g(x),\qquad du=g'(x)\\,dx.
$$

你目前至少知道一个重要检查标准：

> 换元完成后，积分中不能同时残留 $u$、$x$、$du$ 和 $dx$。

但同样，因为缺少连续的独立作答，我还不能把“换元法计算”标记为稳定掌握。

## 仍不稳定

### 左右端点采样与分点数量

这是当前最明确、也最具体的风险点。

你曾经在把 $[0,3]$ 分成 6 段时疑惑，为什么左端点只取

$$
0,\ 0.5,\ 1,\ 1.5,\ 2,\ 2.5
$$

而不取 $3$。

这里涉及三个容易混在一起的数量：

- 6 个小区间；
- 7 个分点；
- 6 个矩形需要的 6 个采样点。

这并不意味着你“不会黎曼和”。更精确的描述是：

> 你理解黎曼和的整体目的，但在把区间划分转换成具体采样点时还不够稳定。

这是目前最值得优先验证的地方，因为它会直接影响黎曼和的式子是否正确。

## 正在建立

### 从黎曼和过渡到定积分计算

你已经接触了：

- 区间宽度 $\\Delta x$；
- 左、右端点；
- 函数高度 $f(x_i)$；
- 极限与定积分；
- 换元时的 $du$ 和 $dx$。

这些知识点并不是互相独立的。你正在建立的完整链条是：

$$
\\text{划分区间}
\\to
\\text{选择采样点}
\\to
\\text{写出黎曼和}
\\to
\\text{取极限得到定积分}
\\to
\\text{使用换元等方法计算}.
$$

目前前半段已经理解，但还需要用独立作答把链条接牢。

## 目前不能下结论的部分

现有记录不足以可靠判断你是否已经掌握：

- 定积分换元时更换上下限；
- 逆换元法；
- 分部积分；
- 综合题中选择哪一种积分策略；
- 在时间限制下独立完成完整计算。

没有作答证据不等于你不会，只表示我现在不能诚实地把它标成“会”或“不会”。

## 最合适的下一步

你现在不需要重新看完整章节，也不适合立刻刷大量综合题。建议先做一个 12 分钟的小验证：

1. **3 分钟：**给定一个新区间，只写左右端点；
2. **4 分钟：**根据指定采样点写出一个黎曼和，不计算；
3. **5 分钟：**从一个求和极限识别对应的定积分。

完成标准是：

- 连续两次正确区分分点和采样点；
- 黎曼和中函数值数量与小区间数量一致；
- 能明确说出 $\\Delta x$、区间和采样点分别来自哪里。

如果这三项通过，我会把“左右端点采样”从当前薄弱点调整为已掌握，并把下一步移动到“定积分换元与上下限转换”。如果没有通过，也不需要退回整章，只针对出错的那一层补一个例子。`,
    createdAt: now - 51 * 60_000,
  },
  {
    id: 'message-mat136-weakness-summary-user-local',
    conversationId: 'conversation-mat136-weakness-summary-local',
    role: 'user',
    text: '我的薄弱点是什么？',
    createdAt: now - 5 * 60_000,
  },
  {
    id: 'message-mat136-weakness-summary-assistant-local',
    conversationId: 'conversation-mat136-weakness-summary-local',
    role: 'assistant',
    text: `## 目前最明确的薄弱点

你在 MAT136 里最需要优先补的是：**黎曼和中的采样点选择，尤其是左端点和右端点的区分。**

### 我为什么这样判断

- 你之前专门问过：把 $[0,3]$ 分成 6 段时，为什么左端点只取到 $2.5$，不取 $3$。
- 学习记忆也把“左右端点采样混淆”标记成了当前薄弱点。
- 这说明你已经理解“用矩形近似面积”的整体想法，但在把区间分点转换成实际取样点时还不够稳定。

具体来说，你容易混淆这两件事：

1. **6 个小区间会产生 7 个分点**；
2. **左端点和右端点都只选其中 6 个点**：左端点去掉最后一个分点，右端点去掉第一个分点。

例如把 $[0,3]$ 分成 6 段，$\\Delta t=0.5$：

$$
\\text{左端点： }0,0.5,1,1.5,2,2.5
$$

$$
\\text{右端点： }0.5,1,1.5,2,2.5,3
$$

## 次要风险点

你也问过换元时为什么必须把 $dx$ 一起替换。这更像是一个**正在建立中的概念连接**：换元后，被积函数、积分变量和微分必须属于同一个变量系统。目前证据还不足以把它判定为稳定薄弱点，但做换元题时值得继续检查。

## 下一步怎么补

先不用大量刷题。建议你马上做两道短题：

1. 一道递增函数的左、右端点和，先只圈出采样点，不计算；
2. 一道把黎曼和写成定积分的题，同时标出 $\\Delta x$、区间和采样点。

如果这两题都能独立做对，再进入换元法；如果仍然把分点数和矩形数混在一起，就先继续补黎曼和这一处。`,
    createdAt: now - 4 * 60_000,
  },
  {
    id: 'message-mat136-review-plan-user-local',
    conversationId: 'conversation-mat136-review-plan-local',
    role: 'user',
    text: '我 7 月 31 日有 MAT136 阶段测验。帮我制定一个三天复习计划，每天不超过 45 分钟，重点补黎曼积分。',
    createdAt: now - 15 * 60_000,
  },
  {
    id: 'message-mat136-review-plan-assistant-local',
    conversationId: 'conversation-mat136-review-plan-local',
    role: 'assistant',
    text: `可以。我先核对了你的考试日程、最近作答和学习记忆，再把复习拆成“修正采样点 → 连接定积分 → 考前复述”。

这样排不是平均分配知识点，而是先处理已经出现过的错误。每个任务都附有具体依据；题目完成状态会读取本机真实作答记录。`,
    metadata: {
      schemaVersion: 1,
      reviewPlan: NATIVE_MAT136_REVIEW_PLAN,
      evidence: NATIVE_MAT136_REVIEW_PLAN.evidence,
      teachingRunId: 'bundled-mat136-review-plan-v1',
      model: {
        provider: 'bundled-mock',
        model: 'mat136-reference',
      },
    },
    createdAt: now - 13 * 60_000,
  },
  {
    id: 'message-mat136-user-local',
    conversationId: 'conversation-mat136-local',
    role: 'user',
    text: '黎曼和已经能近似面积了，为什么定义积分时还要取极限？',
    createdAt: now - 6 * day,
  },
  {
    id: 'message-mat136-assistant-local',
    conversationId: 'conversation-mat136-local',
    role: 'assistant',
    text: `## 先说结论

黎曼和在分割次数有限时只是一个**近似值**。我们取极限，是为了让每个小区间越来越窄，把近似误差压到 0，并得到一个不依赖具体分割方式的确定数值。这个稳定值才被定义为定积分。

## 1. 为什么有限个矩形还不够

用矩形近似曲边面积时，会同时受到三个选择的影响：

- 把区间分成多少段；
- 每一段的宽度是否相同；
- 在每一段使用左端点、右端点还是中点作为矩形高度。

只要矩形还有可见宽度，矩形顶部通常就不能与曲线完全重合，因此一定会留下误差。改变取样方式，得到的近似值也可能不同。

例如函数递增时：

- 左端点矩形通常落在曲线下方，所以左端点和偏小；
- 右端点矩形通常伸到曲线上方，所以右端点和偏大。

因此，“算出了一个黎曼和”还不能说明我们已经找到了真正的面积。

## 2. 极限具体消除了什么

假设把区间分成很多个小区间，记其中最宽的小区间宽度为 $\\|P\\|$。当

$$
\\|P\\| \\to 0
$$

时，每个矩形都变得越来越窄。只要函数在这个区间上可积，不同分割方法、不同取样点产生的黎曼和都会趋近于同一个数。

这个共同的极限就是

$$
\\int_a^b f(x)\\,dx.
$$

关键并不只是“矩形数量变多”，而是**最大子区间宽度趋近于 0**。这样才能保证没有某一段始终特别宽，留下无法消除的误差。

## 3. 用 $f(x)=x$ 看一个具体例子

考虑区间 $[0,1]$，把它平均分成 $n$ 段。每段宽度为

$$
\\Delta x=\\frac{1}{n}.
$$

左端点和为

$$
L_n=\\frac{1}{n}\\left(0+\\frac{1}{n}+\\frac{2}{n}+\\cdots+\\frac{n-1}{n}\\right)
=\\frac{n-1}{2n}.
$$

右端点和为

$$
R_n=\\frac{1}{n}\\left(\\frac{1}{n}+\\frac{2}{n}+\\cdots+\\frac{n}{n}\\right)
=\\frac{n+1}{2n}.
$$

当 $n\\to\\infty$ 时，

$$
L_n\\to\\frac12,
\\qquad
R_n\\to\\frac12.
$$

虽然每个有限的 $n$ 都会给出两个不同的近似值，但它们最终逼近同一个数 $1/2$。因此

$$
\\int_0^1 x\\,dx=\\frac12.
$$

## 4. 做题时应该抓住什么

看到“把黎曼和写成定积分”或“解释为什么要取极限”时，可以按下面的逻辑回答：

1. 有限分割只产生近似值；
2. 让最大子区间宽度趋近于 0；
3. 近似误差随之消失；
4. 若不同分割和取样方式都趋向同一个数，该数就是定积分。

所以，极限的作用不是让答案“看起来更精确”，而是把一个依赖近似方法的结果，变成一个严格定义、唯一并且可以证明的数学对象。`,
    createdAt: now - 6 * day + 60_000,
  },
  {
    id: 'message-mat136-water-leak-problem-user-local',
    conversationId: 'conversation-mat136-water-leak-problem-local',
    role: 'user',
    text: '题目说水箱以 f(t) = sin(2t) + 1 L/h 的速率漏水，要用 6 个区间和左端点估算前 3 小时的漏水量。为什么取样点是 0、0.5、1、1.5、2、2.5，而不是一直取到 3？',
    createdAt: now - 4 * day,
  },
  {
    id: 'message-mat136-water-leak-problem-assistant-local',
    conversationId: 'conversation-mat136-water-leak-problem-local',
    role: 'assistant',
    text: `## 先看结论

不取 $3$，是因为题目要求使用**左端点**。区间 $[0,3]$ 被分成 6 个小区间后，$3$ 是最后一个小区间的右端点，不是左端点。

## 1. 先求每个小区间的宽度

总时间是 3 小时，一共分成 6 段，因此

$$
\\Delta t=\\frac{3-0}{6}=0.5\\text{ 小时}.
$$

这 6 个小区间分别是：

| 小区间 | 左端点 | 右端点 |
|---|---:|---:|
| $[0,0.5]$ | $0$ | $0.5$ |
| $[0.5,1]$ | $0.5$ | $1$ |
| $[1,1.5]$ | $1$ | $1.5$ |
| $[1.5,2]$ | $1.5$ | $2$ |
| $[2,2.5]$ | $2$ | $2.5$ |
| $[2.5,3]$ | $2.5$ | $3$ |

所以六个左端点就是

$$
0,\\ 0.5,\\ 1,\\ 1.5,\\ 2,\\ 2.5.
$$

**为什么不能再取 $3$？** 因为加入 $3$ 后就有 7 个取样点，会对应 7 个高度，而题目只要求 6 个矩形。$3$ 只有在使用右端点时才会被选中。

## 2. 写出左端点黎曼和

漏水速率为

$$
f(t)=\\sin(2t)+1\\quad (\\mathrm{L/h}).
$$

每个矩形的面积是“速率 × 时间宽度”，因此

$$
L_6
=\\Delta t\\,[f(0)+f(0.5)+f(1)+f(1.5)+f(2)+f(2.5)].
$$

注意这里的 $2t$ 也要一起代入。六个函数值分别对应

| $t$ | $2t$ | $f(t)=\\sin(2t)+1$ |
|---:|---:|---:|
| $0$ | $0$ | $1$ |
| $0.5$ | $1$ | $\\sin(1)+1$ |
| $1$ | $2$ | $\\sin(2)+1$ |
| $1.5$ | $3$ | $\\sin(3)+1$ |
| $2$ | $4$ | $\\sin(4)+1$ |
| $2.5$ | $5$ | $\\sin(5)+1$ |

代入 $\\Delta t=0.5$ 后：

$$
L_6
=0.5\\big[(\\sin 0+1)+(\\sin 1+1)+(\\sin 2+1)
+(\\sin 3+1)+(\\sin 4+1)+(\\sin 5+1)\\big].
$$

使用弧度制计算：

$$
L_6\\approx 0.5(1+1.8415+1.9093+1.1411+0.2432+0.0411)
\\approx 3.088.
$$

因此，前 3 小时漏水量的左端点估计为

$$
\\boxed{L_6\\approx 3.088\\ \\mathrm{L}}.
$$

## 3. 为什么要乘 $0.5$

$f(t)$ 是漏水速率，单位为升每小时；$\\Delta t=0.5$ 的单位是小时。每个矩形表示这一小段时间内的估计漏水量：

$$
\\text{漏水速率}\\times\\text{时间}
=\\mathrm{L/h}\\times\\mathrm{h}
=\\mathrm{L}.
$$

如果只把六个函数值相加而不乘 $0.5$，单位和数值都会错误。

## 4. 最容易混淆的地方

- **6 个区间需要 7 个分点**：$0,0.5,1,1.5,2,2.5,3$。
- **6 个左端点只取前 6 个分点**，所以不取 $3$。
- 如果题目要求右端点，才会取 $0.5,1,1.5,2,2.5,3$。
- 计算 $f(0.5)$ 时要得到 $\\sin(1)+1$，不能误写成 $\\sin(0.5)+1$。
- 三角函数数值必须使用**弧度制**。
- $f(t)$ 的单位是 $\\mathrm{L/h}$，乘上 $\\Delta t$ 的小时后，最终单位是升 $\\mathrm{L}$。`,
    createdAt: now - 4 * day + 60_000,
  },
  {
    id: 'message-mat136-substitution-user-local',
    conversationId: 'conversation-mat136-substitution-local',
    role: 'user',
    text: 'u-substitution 里为什么不只替换函数，还必须把 dx 一起换掉？',
    createdAt: now - 2 * day,
  },
  {
    id: 'message-mat136-substitution-assistant-local',
    conversationId: 'conversation-mat136-substitution-local',
    role: 'assistant',
    text: `## 先说结论

因为换元积分不是只替换一个表达式，而是在**更换整个积分变量**。设 $u=g(x)$ 后，原来的变化量 $dx$ 必须按照

$$
du=g'(x)\\,dx
$$

一起转换。否则同一个积分里会同时出现 $u$ 和 $x$，说明换元没有完成。

## 1. $dx$ 在积分里代表什么

在

$$
\\int f(x)\\,dx
$$

中，$dx$ 不只是写在末尾的装饰。它告诉我们：

- 当前积分变量是 $x$；
- 我们在累加宽度为 $dx$ 的微小区间；
- 被积函数中的其他量最终都应该用 $x$ 表示。

当我们令 $u=g(x)$ 时，新变量 $u$ 的变化速度通常与 $x$ 不同。由链式法则，

$$
\\frac{du}{dx}=g'(x),
$$

因此

$$
du=g'(x)\\,dx.
$$

这就是为什么函数内部换成 $u$ 后，外面的微分也必须一起换。

## 2. 用这道典型例子来看

考虑

$$
\\int 2x\\cos(x^2)\\,dx.
$$

被积函数中出现了复合函数 $\\cos(x^2)$，而外面正好还有内层函数 $x^2$ 的导数 $2x$。因此令

$$
u=x^2.
$$

对两边求微分：

$$
du=2x\\,dx.
$$

现在可以把原积分中的两个部分一起替换：

| 原来的部分 | 换元后的部分 |
|---|---|
| $x^2$ | $u$ |
| $2x\\,dx$ | $du$ |

于是

$$
\\int 2x\\cos(x^2)\\,dx
=\\int\\cos(u)\\,du.
$$

现在整个积分只含变量 $u$，说明换元已经完成。积分得到

$$
\\int\\cos(u)\\,du=\\sin(u)+C.
$$

最后把 $u=x^2$ 换回来：

$$
\\boxed{\\sin(x^2)+C}.
$$

## 3. 如果只替换 $x^2$ 会发生什么

如果只写成

$$
\\int 2x\\cos(u)\\,dx,
$$

式子里同时出现了 $u$、$x$ 和 $dx$。这不是一个可以直接关于 $u$ 积分的表达式，因为：

- $\\cos(u)$ 使用变量 $u$；
- $2x$ 仍然使用变量 $x$；
- $dx$ 又表示仍在关于 $x$ 积分。

变量混用就是最直接的警告：你只换了函数内部，还没有完成积分变量的转换。

## 4. 定积分还要多做一步

如果原题是

$$
\\int_0^1 2x\\cos(x^2)\\,dx,
$$

令 $u=x^2$ 后，积分上下限也应该换成 $u$ 的值：

- 当 $x=0$ 时，$u=0$；
- 当 $x=1$ 时，$u=1$。

所以

$$
\\int_0^1 2x\\cos(x^2)\\,dx
=\\int_0^1\\cos(u)\\,du
=\\sin(1).
$$

如果已经把上下限换成 $u$ 的范围，最后就不需要再换回 $x$。

## 5. 换元积分的检查清单

每次做 $u$-substitution，可以检查下面四点：

1. 选择的 $u$ 是否能简化复合函数；
2. 是否正确算出 $du=g'(x)\\,dx$；
3. 换元后是否只剩下 $u$ 和 $du$，没有残留 $x$；
4. 如果是定积分，是否同步更换上下限。

最核心的判断标准是：**换元完成后，积分中只能保留同一个积分变量。**`,
    createdAt: now - 2 * day + 60_000,
  },
  {
    id: 'message-csc148-user-local',
    conversationId: 'conversation-csc148-local',
    role: 'user',
    text: '为什么空树的高度通常定义为 -1？',
    createdAt: now - 2 * day,
  },
];

const bundledLectureEligibleConversationIds = new Set([
  'conversation-mat136-reexplain-endpoint-local',
  'conversation-mat136-progressive-hint-local',
  'conversation-mat136-mistake-diagnosis-local',
  'conversation-mat136-local',
  'conversation-mat136-water-leak-problem-local',
  'conversation-mat136-substitution-local',
]);

export const seedMessages: LocalMessage[] = seedMessagesRaw.map((message) => {
  if (
    message.role !== 'assistant' ||
    !bundledLectureEligibleConversationIds.has(message.conversationId)
  ) {
    return message;
  }
  return {
    ...message,
    metadata: {
      ...(message.metadata ?? {}),
      schemaVersion: 1,
      lectureEligible: true,
      lectureEligibilityReason: 'bundled_reference',
    },
  };
});
