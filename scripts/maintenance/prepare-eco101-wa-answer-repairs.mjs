#!/usr/bin/env node

/** Replace malformed teacher-draft answer/explanation markup without changing source files. */
import { readFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const require = createRequire(import.meta.url);
const JSZip = require('jszip');
const katex = require('katex');
const here = dirname(fileURLToPath(import.meta.url));
const { courseProblemRevision } = createJiti(import.meta.url, { interopDefault: true })(
  join(here, '../../lib/server/admin-course-problem-upload.ts'),
);

const courseId = 'cmu8nl0tn0009l204d5j0w4gl';
const answers = {
  5: String.raw`The initial equilibrium satisfies $34-2p=p+10$, so $p^*=8$ and $Q^*=18$.

The outward supply shift changes supply to $Q_S'=p+16$. Solving $34-2p=p+16$ gives the new equilibrium $p^*=6$ and $Q^*=22$.

If price stayed at $p=8$, demand would be $Q_D=18$ and new supply would be $Q_S'=24$; the surplus would be $24-18=6$ units.`,
  7: String.raw`征税前令 $4p-5=40-0.5p$，得 $p^*=10$、$Q^*=35$。

征税后同时满足 $Q=4p_p-5$、$Q=40-0.5p_c$ 和 $p_c-p_p=22.5$。解得 $p_p=7.5$、$p_c=30$、$Q=25$，因此成交量减少 $10$。

消费者支付的价格从 $10$ 升至 $30$，每单位承担 $20$；生产者收到的价格从 $10$ 降至 $7.5$，每单位承担 $2.5$。两者合计为 $22.5$。`,
  23: String.raw`利润为 $\pi=pQ-C$。厂商是价格接受者，且订单把 $Q$ 固定为 $160$，因此收入 $pQ$ 固定。选择投入只能改变成本 $C$；成本越低，利润越高。因此固定产量下的成本最小化等同于利润最大化。`,
  32: String.raw`新的内部最优条件为 $MU_A/MU_P=2P/A=p_A/p_P=5/10=1/2$，所以 $A=4P$。新预算约束为 $5A+10P=300$。联立得到 $A=40$、$P=10$。

新预算线为 $P=30-\frac12A$，横截距 $(60,0)$，纵截距 $(0,30)$，斜率 $-1/2$。新无差异曲线经过 $(40,10)$，并在该点与预算线相切。

消费者变得更好：原组合为 $\left(40,\frac{20}{3}\right)$，其效用满足 $U_{\mathrm{old}}^3=40^2\frac{20}{3}=\frac{32000}{3}$；新组合满足 $U_{\mathrm{new}}^3=40^2(10)=16000>\frac{32000}{3}$，故 $U_{\mathrm{new}}>U_{\mathrm{old}}$。`,
  33: String.raw`原组合 $B$ 的效用满足 $U_B^3=40^2\left(\frac{20}{3}\right)=\frac{32000}{3}$。新价格下的补偿最优点满足 $2P/A=5/10=1/2$，所以 $A=4P$。令 $q=\left(\frac{2000}{3}\right)^{1/3}$；由 $A^2P=32000/3$ 得补偿点 $D=(4q,q)\approx(34.94,8.74)$。

从 $B$ 到 $D$ 的替代效应：苹果为 $4q-40\approx-5.06$，梨为 $q-\frac{20}{3}\approx2.07$。

从 $D$ 到新最优点 $C$ 的收入效应：苹果为 $40-4q\approx5.06$，梨为 $10-q\approx1.26$。

总效应中苹果变化为 $0$，梨增加 $10-\frac{20}{3}=\frac{10}{3}$。两种商品从补偿点到最终点的消费量都增加，收入效应均为正，因此都是正常品。`,
  36: String.raw`无法从可见材料独立推导。解答页给出的候选结果为：当 $Q\leq15$ 时，$SMB(Q)=50-3Q$；当 $15<Q\leq20$ 时，$SMB(Q)=20-Q$；当 $Q>20$ 时，$SMB(Q)=0$。由于个体边际收益函数缺失，该结果无法独立核验；本题需补充原始题面后核对答案。`,
  45: String.raw`新预算约束为 $50T+2P=600$，等价于 $P=300-25T$。教科书轴截距为 $12$，钢笔轴截距为 $300$，斜率为 $-25$。`,
  48: String.raw`由任意相邻两点可得 $\Delta Q/\Delta P=-2.5$；代入 $(Q,P)=(10,20)$，得到 $Q_D(P)=60-2.5P$。`,
  49: String.raw`由任意相邻两点可得 $\Delta Q/\Delta P=2$；代入 $(Q,P)=(4,4)$，得到 $Q_S(P)=2P-4$。`,
  52: String.raw`在横轴为 $Q$、纵轴为 $P$ 的图中，需求曲线经过 $(Q,P)=(0,60)$ 和 $(240,0)$，向右下倾斜；供给曲线经过 $(0,0)$ 和 $(120,60)$，向右上倾斜。`,
  61: String.raw`当 $U=36$ 时，无差异曲线为 $Y=36/X$，例如 $(2,18)$、$(6,6)$、$(18,2)$ 都在曲线上。边际效用为 $MU_X=Y$、$MU_Y=X$。内部最优条件给出 $Y/X=p_X/p_Y=10/5=2$，即 $Y=2X$。

初始预算线为 $10X+5Y=120$。代入 $Y=2X$ 得最优点 $A=(6,12)$，无差异曲线斜率为 $-Y/X=-2$，效用为 $U_A=72$。

当 $p_X$ 降至 $5$ 时，最优条件变为 $X=Y$，预算线为 $5X+5Y=120$，所以新最优点 $C=(12,12)$。

希克斯补偿点 $B$ 同时满足 $X=Y$ 和原效用 $XY=72$，所以 $B=(6\sqrt2,6\sqrt2)\approx(8.485,8.485)$。

从 $A$ 到 $B$ 的替代效应为 $\Delta X_{SE}=6\sqrt2-6\approx2.485$、$\Delta Y_{SE}=6\sqrt2-12\approx-3.515$。从 $B$ 到 $C$ 的收入效应为 $\Delta X_{IE}=12-6\sqrt2\approx3.515$、$\Delta Y_{IE}=12-6\sqrt2\approx3.515$。`,
  77: String.raw`$(p^*,Q^*)=(10,100)$`,
  85: String.raw`$(p^*,Q^*)=(12,96)$`,
};

const [archivePath, outputPath] = process.argv.slice(2);
if (!archivePath || !outputPath || process.argv.length !== 4) {
  console.error(
    'Usage: node scripts/maintenance/prepare-eco101-wa-answer-repairs.mjs BACKUP.zip OUTPUT.json',
  );
  process.exit(2);
}

const zip = await JSZip.loadAsync(readFileSync(archivePath));
const changes = [];
for (const [name, file] of Object.entries(zip.files)) {
  const match = name.match(/\/04-organized-problem-bank\/problems\/(\d{4})_/);
  if (!match || file.dir) continue;
  const number = Number(match[1]);
  const replacement = answers[number];
  if (!replacement) continue;
  const original = JSON.parse(await file.async('string'));
  if (original.courseId !== courseId) {
    throw new Error(`Unexpected course for problem ${number}`);
  }
  if ((replacement.match(/\$/g) ?? []).length % 2 !== 0 || /\${3,}/.test(replacement)) {
    throw new Error(`Unbalanced math delimiters in answer ${number}`);
  }
  for (const match of replacement.matchAll(/\$([^$]+)\$/g)) {
    katex.renderToString(match[1], { throwOnError: true, strict: 'ignore' });
  }
  const key = original.type === 'choice' ? 'analysis' : 'referenceAnswer';
  const grading = { ...original.gradingJson, [key]: replacement };
  changes.push({
    id: original.id,
    expectedRevision: courseProblemRevision({
      ...original,
      updatedAt: new Date(original.updatedAt),
    }),
    grading,
    sourceMeta: {
      ...(original.sourceMeta || {}),
      answerMarkupReview: {
        note: '整理解析中的数学标记与段落；修订前版本保存在课程归档。',
        reviewedAt: '2026-09-25',
      },
    },
  });
}
if (changes.length !== Object.keys(answers).length) {
  throw new Error(
    `Expected ${Object.keys(answers).length} answer revisions, got ${changes.length}`,
  );
}
const handle = await open(outputPath, 'wx', 0o600);
try {
  await handle.writeFile(`${JSON.stringify({ courseId, changes }, null, 2)}\n`);
} finally {
  await handle.close();
}
console.log(JSON.stringify({ output: outputPath, count: changes.length }));
