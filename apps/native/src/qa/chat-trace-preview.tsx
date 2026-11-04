/** Local-only demo: 助教回答里的 ```trace 逐步演示块（Racket 代换、Python 变量追踪、数学推导）。 */
import { createRoot } from 'react-dom/client';
import { ChatRichText } from '../components/chat-rich/ChatRichText';
import '../tailwind.css';
import '../components/marble-tokens.css';
import '../styles.css';

if (!import.meta.env.DEV) throw new Error('仅供本机开发预览。');

const racket = `你的代码现在会做这件事：不管第一个数是奇是偶，都直接丢掉它继续往后找，所以最后总是得到 \`empty\`。拿 \`(cons 2 (cons 3 (cons 4 empty)))\` 走一遍：

\`\`\`trace (drop-until-odd (cons 2 (cons 3 (cons 4 empty))))
(drop-until-odd (cons 2 (cons 3 (cons 4 empty)))) | 列表不是 empty，走 else 那支
(drop-until-odd (cons 3 (cons 4 empty))) | 第 3 行直接递归 rest，2 被丢掉（这一步没问题）
(drop-until-odd (cons 4 empty)) | **这里出错**：3 是奇数，本该停下来，但还是被丢掉了
(drop-until-odd empty) | 4 也被丢掉
empty | 结果是 \`empty\`，而 check-expect 期望 \`(cons 3 (cons 4 empty))\`
\`\`\`

差的是：cond 里少了“第一个数是奇数”时的那一支。想一想：如果 \`(first lon)\` 是奇数，答案应该是 \`lon\` 里的哪一部分？`;

const python = `这个循环每次把 \`total\` 加上当前的数，追踪一下 \`sum_evens([3, 4, 6])\`：

\`\`\`trace sum_evens([3, 4, 6])
total = 0 | 第 2 行：循环开始前
num = 3, total = 0 | 3 % 2 == 1，不是偶数，跳过
num = 4, total = 4 | 4 是偶数，total 从 0 变成 4
num = 6, total = 10 | 6 是偶数，total 从 4 变成 10
return 10 | 循环结束，返回 10，和 docstring 里的例子一致
\`\`\``;

const math = `这是 $\\frac{0}{0}$ 型极限，先想到用等价无穷小或洛必达：

\`\`\`trace 求 lim (sin 3x)/x
$\\lim_{x\\to 0} \\frac{\\sin 3x}{x}$ | 直接代入得 $\\frac{0}{0}$，需要变形
$= \\lim_{x\\to 0} \\frac{\\sin 3x}{3x}\\cdot 3$ | 分子分母同乘 3，凑出 $\\frac{\\sin u}{u}$ 的形状
$= 1\\cdot 3$ | 令 $u=3x$，$x\\to0$ 时 $u\\to0$，用 $\\lim_{u\\to0}\\frac{\\sin u}{u}=1$
$= 3$ | 验算：$x=0.01$ 时 $\\frac{\\sin 0.03}{0.01}\\approx 2.9996$
\`\`\``;

function Bubble({ text }: { text: string }) {
  return (
    <div
      style={{
        maxWidth: 680,
        margin: '0 auto 28px',
        padding: '4px 4px 0',
        color: '#0f172a',
        fontSize: 15,
        lineHeight: 1.65,
      }}
    >
      <ChatRichText text={text} />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <main style={{ minHeight: '100vh', padding: '28px 16px', background: '#f6f8fc' }}>
    <Bubble text={racket} />
    <Bubble text={python} />
    <Bubble text={math} />
  </main>,
);
