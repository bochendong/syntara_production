import type {
  CourseForumPostDetail,
  CourseForumSnapshot,
  CourseForumStatusFilter,
} from '@/features/course-forum/domain/course-forum';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function iso(msAgo: number) {
  return new Date(Date.now() - msAgo).toISOString();
}

const authors = {
  teacher: {
    id: 'mock-teacher',
    name: 'Prof. Chen',
    image: null,
    isTeacher: true,
  },
  alice: {
    id: 'mock-alice',
    name: 'Alice Wang',
    image: null,
    isTeacher: false,
  },
  bob: {
    id: 'mock-bob',
    name: 'Bob Liu',
    image: null,
    isTeacher: false,
  },
  cara: {
    id: 'mock-cara',
    name: 'Cara Zhang',
    image: null,
    isTeacher: false,
  },
  dylan: {
    id: 'mock-dylan',
    name: 'Dylan Kim',
    image: null,
    isTeacher: false,
  },
} as const;

function preview(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`$]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function detailToSummary(post: CourseForumPostDetail) {
  return {
    id: post.id,
    title: post.title,
    bodyPreview: post.bodyPreview,
    author: post.author,
    resolved: post.resolved,
    pinned: post.pinned,
    pinnedAt: post.pinnedAt,
    isWelcome: post.isWelcome,
    answerCount: post.answerCount,
    commentCount: post.commentCount,
    attachmentCount: post.attachmentCount,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  };
}

export function buildCourseForumMockPosts(courseId: string): CourseForumPostDetail[] {
  const attachment = (id: string, fileName: string) => ({
    id,
    fileName,
    mimeType: 'image/png',
    byteSize: 248_320,
    url: `https://picsum.photos/seed/${encodeURIComponent(id)}/960/640`,
    downloadUrl: `https://picsum.photos/seed/${encodeURIComponent(id)}/960/640`,
  });

  const inductionBody = `我在做 Induction 第一讲的练习时卡住了。

## 问题

证明：对所有整数 $n \\ge 1$，

$$
1 + 3 + 5 + \\cdots + (2n-1) = n^2
$$

我已经写了 base case：当 $n=1$ 时左边是 $1$，右边是 $1^2$，成立。

归纳假设：假设对某个 $k \\ge 1$ 有

$$
1+3+\\cdots+(2k-1)=k^2
$$

下一步我该怎么接到 $k+1$？我尝试写成：

\`\`\`text
LHS(k+1)
= 1 + 3 + ... + (2k-1) + (2(k+1)-1)
= k^2 + (2k+1)
= ?
\`\`\`

后面怎么变成 $(k+1)^2$ 我有点绕。

有没有同学能用更直观的方式解释一下？最好附一个小例子。`;

  const recursionBody = `\`\`\`python
def mystery(n):
    if n <= 1:
        return 1
    return n * mystery(n - 1)
\`\`\`

这题作业要求说明函数的时间复杂度，以及它在算什么。

我猜是阶乘，但不确定递归树怎么画。老师课堂说要写清楚：

1. 递归终止条件
2. 每次问题规模如何缩小
3. 总调用次数

有人可以给一个标准答法吗？`;

  const midtermBody = `想确认一下 midterm 范围：

- Week 1–4 的 notes 都考吗？
- induction proof 会不会出完整证明题？
- 能不能带 cheat sheet？

另外 office hour 这周会改时间吗？`;

  const latexBody = `Markdown 编辑器里写公式有时渲染不对。比如：

行内：$a_n = \\frac{n(n+1)}{2}$

独立成行：

$$
\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}
$$

请问论坛这里支持哪些数学写法？代码块和公式可以混排吗？`;

  const posts: Array<
    Omit<CourseForumPostDetail, 'pinned' | 'pinnedAt' | 'isWelcome' | 'commentsPage'>
  > = [
    {
      id: `${courseId}-forum-post-induction`,
      title: 'Induction：奇数和怎么接到 (k+1)^2？',
      bodyPreview: preview(inductionBody),
      bodyMarkdown: inductionBody,
      author: authors.alice,
      resolved: false,
      answerCount: 2,
      commentCount: 3,
      attachmentCount: 1,
      createdAt: iso(3 * HOUR),
      updatedAt: iso(40 * 60_000),
      attachments: [attachment(`${courseId}-att-1`, 'handwritten-attempt.png')],
      answers: [
        {
          id: `${courseId}-ans-1`,
          bodyMarkdown: `可以继续展开：

$$
k^2 + (2k+1) = k^2 + 2k + 1 = (k+1)^2
$$

所以归纳步骤成立。

直觉上：正方形边长从 $k$ 变到 $k+1$，外围正好补上 $2k+1$ 个小格。`,
          author: authors.bob,
          accepted: false,
          acceptedAt: null,
          attachments: [],
          createdAt: iso(2 * HOUR),
          updatedAt: iso(2 * HOUR),
        },
        {
          id: `${courseId}-ans-2`,
          bodyMarkdown: `补充一个小例子，帮助建立直觉：

- $n=3$：奇数和是 $1+3+5=9=3^2$
- 再加下一项 $7$，得到 $16=4^2$

也就是说，从 $n^2$ 到 $(n+1)^2$，正好增加 $2n+1$。`,
          author: authors.cara,
          accepted: false,
          acceptedAt: null,
          attachments: [attachment(`${courseId}-att-2`, 'square-border-sketch.png')],
          createdAt: iso(70 * 60_000),
          updatedAt: iso(70 * 60_000),
        },
      ],
      comments: [
        {
          id: `${courseId}-cmt-1`,
          body: '我也卡在同一处，等老师看看哪条更适合采纳。',
          author: authors.dylan,
          parentId: null,
          replyCount: 0,
          createdAt: iso(90 * 60_000),
          updatedAt: iso(90 * 60_000),
        },
        {
          id: `${courseId}-cmt-2`,
          body: '正方形补边那个解释太好懂了。',
          author: authors.alice,
          parentId: null,
          replyCount: 0,
          createdAt: iso(55 * 60_000),
          updatedAt: iso(55 * 60_000),
        },
        {
          id: `${courseId}-cmt-3`,
          body: '建议把“归纳假设用在哪一行”写清楚，阅卷会更稳。',
          author: authors.teacher,
          parentId: null,
          replyCount: 0,
          createdAt: iso(40 * 60_000),
          updatedAt: iso(40 * 60_000),
        },
      ],
    },
    {
      id: `${courseId}-forum-post-recursion`,
      title: '递归 mystery(n) 是在算什么？时间复杂度怎么写',
      bodyPreview: preview(recursionBody),
      bodyMarkdown: recursionBody,
      author: authors.bob,
      resolved: true,
      answerCount: 1,
      commentCount: 2,
      attachmentCount: 0,
      createdAt: iso(2 * DAY),
      updatedAt: iso(18 * HOUR),
      attachments: [],
      answers: [
        {
          id: `${courseId}-ans-3`,
          bodyMarkdown: `这是阶乘：$mystery(n)=n!$。

时间复杂度：每次规模减 1，共递归约 $n$ 次，每次常数工作量，所以是 $\\Theta(n)$。

写法建议：

1. Base：$n\\le 1$ 返回 1
2. Recursive case：返回 $n \\times mystery(n-1)$
3. 递归深度 / 调用次数：$\\Theta(n)$`,
          author: authors.teacher,
          accepted: true,
          acceptedAt: iso(18 * HOUR),
          attachments: [],
          createdAt: iso(30 * HOUR),
          updatedAt: iso(18 * HOUR),
        },
      ],
      comments: [
        {
          id: `${courseId}-cmt-4`,
          body: '感谢！我之前把复杂度写成了 O(n!)，现在明白了。',
          author: authors.bob,
          parentId: null,
          replyCount: 0,
          createdAt: iso(20 * HOUR),
          updatedAt: iso(20 * HOUR),
        },
        {
          id: `${courseId}-cmt-5`,
          body: '老师采纳的这条可以直接当作业模板。',
          author: authors.cara,
          parentId: null,
          replyCount: 0,
          createdAt: iso(19 * HOUR),
          updatedAt: iso(19 * HOUR),
        },
      ],
    },
    {
      id: `${courseId}-forum-post-midterm`,
      title: 'Midterm 范围 / cheat sheet / office hour 确认',
      bodyPreview: preview(midtermBody),
      bodyMarkdown: midtermBody,
      author: authors.cara,
      resolved: false,
      answerCount: 1,
      commentCount: 1,
      attachmentCount: 0,
      createdAt: iso(5 * HOUR),
      updatedAt: iso(2 * HOUR),
      attachments: [],
      answers: [
        {
          id: `${courseId}-ans-4`,
          bodyMarkdown: `目前课程页公告是：

- 范围：Week 1–4（含 induction + recursion）
- 会有一道完整 proof
- 允许一页双面 cheat sheet（手写）

Office hour 本周四仍是 2–4pm，地点不变。`,
          author: authors.dylan,
          accepted: false,
          acceptedAt: null,
          attachments: [],
          createdAt: iso(3 * HOUR),
          updatedAt: iso(3 * HOUR),
        },
      ],
      comments: [
        {
          id: `${courseId}-cmt-6`,
          body: '等老师最终确认一下 cheat sheet 规则。',
          author: authors.alice,
          parentId: null,
          replyCount: 0,
          createdAt: iso(2 * HOUR),
          updatedAt: iso(2 * HOUR),
        },
      ],
    },
    {
      id: `${courseId}-forum-post-latex`,
      title: '论坛 Markdown / 公式写法支持哪些？',
      bodyPreview: preview(latexBody),
      bodyMarkdown: latexBody,
      author: authors.dylan,
      resolved: true,
      answerCount: 1,
      commentCount: 0,
      attachmentCount: 0,
      createdAt: iso(4 * DAY),
      updatedAt: iso(3 * DAY),
      attachments: [],
      answers: [
        {
          id: `${courseId}-ans-5`,
          bodyMarkdown: `支持常见 Markdown + KaTeX 风格数学：

- 行内：\`$...$\`
- 独立公式：\`$$...$$\`
- 代码块：\`\`\`python ... \`\`\`

公式和代码可以同帖混排；图片请用附件上传。`,
          author: authors.teacher,
          accepted: true,
          acceptedAt: iso(3 * DAY),
          updatedAt: iso(3 * DAY),
          createdAt: iso(3.5 * DAY),
          attachments: [],
        },
      ],
      comments: [],
    },
    {
      id: `${courseId}-forum-post-empty`,
      title: '有人一起组 Week 3 习题讨论吗？',
      bodyPreview: '想找 2–3 个同学周末线上对一下 homework 思路，不求完整答案。',
      bodyMarkdown:
        '想找 2–3 个同学周末线上对一下 homework 思路，不求完整答案。\n\n我主要卡在 recursion tree 和 worst-case 分析。有兴趣的评论区扣 1～',
      author: authors.alice,
      resolved: false,
      answerCount: 0,
      commentCount: 0,
      attachmentCount: 0,
      createdAt: iso(25 * 60_000),
      updatedAt: iso(25 * 60_000),
      attachments: [],
      answers: [],
      comments: [],
    },
  ];

  return posts.map((post) => ({
    ...post,
    pinned: false,
    pinnedAt: null,
    isWelcome: false,
    commentsPage: {
      hasMore: false,
      nextOffset: post.comments.length,
      totalCount: post.comments.length,
    },
  }));
}

export function buildCourseForumMockSnapshot(args: {
  courseId: string;
  status?: CourseForumStatusFilter;
  q?: string;
  postId?: string;
  asTeacher?: boolean;
}): CourseForumSnapshot {
  const allPosts = buildCourseForumMockPosts(args.courseId);
  const query = (args.q || '').trim().toLowerCase();
  const status = args.status || 'unresolved';

  const filtered = allPosts.filter((post) => {
    if (status === 'unresolved' && post.resolved) return false;
    if (status === 'resolved' && !post.resolved) return false;
    if (!query) return true;
    return (
      post.title.toLowerCase().includes(query) ||
      post.bodyMarkdown.toLowerCase().includes(query) ||
      post.bodyPreview.toLowerCase().includes(query)
    );
  });

  const selected =
    filtered.find((post) => post.id === args.postId) ||
    allPosts.find((post) => post.id === args.postId) ||
    filtered[0] ||
    null;

  return {
    course: {
      id: args.courseId,
      name: 'Introduction to Computer Science',
      code: 'CSC108',
      academicYear: 2026,
      term: 'fall',
      problemCount: 24,
    },
    viewer: {
      ...(args.asTeacher ? authors.teacher : authors.alice),
      accessRole: args.asTeacher ? 'owner' : 'enrolled',
    },
    unresolvedCount: allPosts.filter((post) => !post.resolved).length,
    totalCount: allPosts.length,
    pinnedPosts: allPosts.filter((post) => post.pinned).map(detailToSummary),
    posts: filtered.map(detailToSummary),
    selectedPost: selected,
  };
}
