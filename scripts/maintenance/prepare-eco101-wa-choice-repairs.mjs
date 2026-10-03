#!/usr/bin/env node

/**
 * Build a reviewable patch from the frozen ECO101WA course backup.
 * Does not connect to or change the database.
 *
 * Usage: node scripts/maintenance/prepare-eco101-wa-choice-repairs.mjs BACKUP.zip OUTPUT.json
 */
import { readFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const require = createRequire(import.meta.url);
const JSZip = require('jszip');
const here = dirname(fileURLToPath(import.meta.url));
const { courseProblemRevision } = createJiti(import.meta.url, { interopDefault: true })(
  join(here, '../../lib/server/admin-course-problem-upload.ts'),
);

const courseId = 'cmu8nl0tn0009l204d5j0w4gl';
const choice = {
  21: {
    stem: '某厂商的生产函数为 $Q=K^{1/2}L^{1/2}$，且 $MPL/MPK=K/L$。工资率 $w=10$，资本租赁价格 $r=40$。在长期成本最小化时，$K/L$ 为多少？请选择同时给出正确条件和结果的一项。',
    options: [
      '由 $MPL/MPK=w/r$ 得 $K/L=1/4$。',
      '由 $MPL/MPK=r/w$ 得 $K/L=4$。',
      '由 $MPL/MPK=w+r$ 得 $K/L=50$。',
      '因为 $K$ 与 $L$ 的指数相同，所以 $K/L=1$，与价格无关。',
    ],
  },
  23: {
    stem: '某价格接受厂商必须完成固定数量 $Q=160$ 的订单，产品价格 $p$ 也已由市场给定。厂商可调整劳动和资本的投入。为什么此时成本最小化等同于利润最大化？',
    options: [
      '因为收入 $pQ$ 固定，而利润为 $pQ-C$；降低总成本会等量提高利润。',
      '因为价格接受者可以通过降低成本直接提高市场价格，所以利润增加。',
      '因为订单数量固定，利润恒等于总成本，选择投入组合不会改变利润。',
      '因为任何成本最低的投入组合必然使产量超过订单数量，从而提高收入。',
    ],
  },
  34: {
    stem: '某生产者每生产一单位产品造成价值 $10$ 的外部损害。哪一种单位税及其作用机制能够使生产者内部化该外部成本？',
    options: [
      '向生产者每单位征税 $10$，使其面对的边际成本增加 $10$ 并把损害计入产量决策。',
      '向生产者每单位补贴 $10$，使其边际成本下降 $10$，从而减少过度生产。',
      '向消费者每单位征税 $10$，但保持生产者面对的边际成本不变；这必然使其按社会边际成本生产。',
      '向生产者一次性征税 $10$，不论产量多少都相同；这使每一单位的边际成本增加 $10$。',
    ],
  },
  44: {
    stem: '教科书每本 $50$ 美元，钢笔每支 $2$ 美元。一本教科书和一支钢笔各自的机会成本分别是什么？',
    options: [
      '一本教科书为 $25$ 支钢笔；一支钢笔为 $1/25$ 本教科书。',
      '一本教科书为 $1/25$ 支钢笔；一支钢笔为 $25$ 本教科书。',
      '一本教科书为 $50$ 支钢笔；一支钢笔为 $2$ 本教科书。',
      '一本教科书为 $48$ 支钢笔；一支钢笔为 $48$ 本教科书。',
    ],
  },
  47: {
    stem: '教科书与钢笔的价格不变，消费者收入增加后购买更多教科书、更少钢笔。根据这些观察，如何分类并说明理由？',
    options: [
      '教科书是正常品，因为其需求随收入增加而增加；钢笔是劣等品，因为其需求随收入增加而减少。',
      '教科书是劣等品，因为其需求随收入增加而增加；钢笔是正常品，因为其需求随收入增加而减少。',
      '两者都是正常品，因为收入上升会使预算线外移，单个商品的购买量变化不影响分类。',
      '两者都是劣等品，因为两种商品的价格均未变化。',
    ],
  },
  48: {
    stem: '线性需求曲线经过 $(Q,P)=(10,20),(20,16),(30,12),(40,8),(50,4)$。以价格 $P$ 表示需求量时，斜率 $\\Delta Q/\\Delta P$ 和需求函数 $Q_D(P)$ 分别是什么？',
    options: [
      '$\\Delta Q/\\Delta P=-2.5$，$Q_D(P)=60-2.5P$。',
      '$\\Delta Q/\\Delta P=-0.4$，$Q_D(P)=24-0.4P$。',
      '$\\Delta Q/\\Delta P=2.5$，$Q_D(P)=60+2.5P$。',
      '$\\Delta Q/\\Delta P=-2.5$，$Q_D(P)=50-2.5P$。',
    ],
  },
  49: {
    stem: '线性供给曲线经过 $(Q,P)=(4,4),(12,8),(20,12),(28,16)$。以价格 $P$ 表示供给量时，斜率 $\\Delta Q/\\Delta P$ 和供给函数 $Q_S(P)$ 分别是什么？',
    options: [
      '$\\Delta Q/\\Delta P=2$，$Q_S(P)=2P-4$。',
      '$\\Delta Q/\\Delta P=1/2$，$Q_S(P)=P/2+2$。',
      '$\\Delta Q/\\Delta P=2$，$Q_S(P)=2P+4$。',
      '$\\Delta Q/\\Delta P=-2$，$Q_S(P)=12-2P$。',
    ],
  },
  52: {
    stem: '市场需求为 $Q_D=240-4P$，供给为 $Q_S=2P$。横轴是数量 $Q$、纵轴是价格 $P$。哪一组作图点和曲线方向都正确？每组的坐标均写为 $(Q,P)$。',
    options: [
      '需求经过 $(0,60)$ 与 $(240,0)$，向右下倾斜；供给经过 $(0,0)$ 与 $(120,60)$，向右上倾斜。',
      '需求经过 $(0,240)$ 与 $(60,0)$，向右下倾斜；供给经过 $(0,0)$ 与 $(60,120)$，向右上倾斜。',
      '需求经过 $(0,60)$ 与 $(240,0)$，向右上倾斜；供给经过 $(0,0)$ 与 $(120,60)$，向右下倾斜。',
      '需求经过 $(0,0)$ 与 $(240,60)$，向右上倾斜；供给经过 $(0,60)$ 与 $(120,0)$，向右下倾斜。',
    ],
  },
  54: {
    stem: '已知 $Q_D=240-4P$、$Q_S=2P$。横轴为 $Q$、纵轴为 $P$。两条逆曲线的斜率分别是多少？能否仅凭其绝对值小于 $1$ 判定两者富有弹性？',
    options: [
      '需求斜率 $-1/4$，供给斜率 $1/2$；不能，弹性还取决于考察点的 $P/Q$。',
      '需求斜率 $-4$，供给斜率 $2$；不能，因为弹性只取决于截距。',
      '需求斜率 $-1/4$，供给斜率 $1/2$；能，因为斜率绝对值小于 $1$ 就等于富有弹性。',
      '需求斜率 $1/4$，供给斜率 $-1/2$；能，因为正负号不影响弹性。',
    ],
  },
  67: {
    stem: 'A price-taking firm faces $p=200$ and $C(q)=11{,}000+q^2$. Its profit-maximizing positive output is $q=100$. Which statement correctly applies the short-run shutdown rule and compares the two profits?',
    options: [
      'Produce: $AVC(100)=100<200$; profit is $-1{,}000$ when producing versus $-11{,}000$ when shut down.',
      'Shut down: profit is $-1{,}000$ when producing versus $0$ when shut down because fixed cost disappears immediately.',
      'Shut down: $ATC(100)=210>200$ is sufficient, even though operating covers variable cost.',
      'Produce: $AVC(100)=210<200$; profit is $1{,}000$ when producing versus $-11{,}000$ when shut down.',
    ],
  },
  69: {
    stem: 'A price-taking firm faces $p=200$. Its cost changes from $C_0(q)=11{,}000+q^2$ to $C_1(q)=12{,}000+2q^2$. What happens to its profit-maximizing positive output, and why?',
    options: [
      'It falls from $100$ to $50$: with $MR=200$, the marginal-cost condition changes from $2q=200$ to $4q=200$.',
      'It rises from $100$ to $200$: the larger fixed cost requires more output to cover costs.',
      'It stays at $100$: the market price and marginal revenue did not change.',
      'It falls from $100$ to $50$ solely because fixed cost rises; the marginal-cost curve is unchanged.',
    ],
  },
  70: {
    stem: 'A price-taking firm’s cost changes from $C_0(q)=11{,}000+q^2$ to $C_1(q)=12{,}000+2q^2$. Under what circumstance can its optimal output be unchanged? Is an unchanged strictly positive interior optimum possible at a fixed positive price?',
    options: [
      'Both outputs can be $q=0$ at the shutdown corner (for these cost functions, at a nonpositive price); at any fixed positive price, $MC_0=2q$ and $MC_1=4q$ imply different positive optima.',
      'At any positive price both outputs remain $q=0$, because the fixed costs are positive; no positive output is profitable.',
      'At any positive price both positive optima are equal, because the same market price implies the same marginal revenue.',
      'Both outputs can be unchanged only if the fixed costs are equal; their marginal costs do not matter for the interior optimum.',
    ],
  },
  76: {
    stem: 'A competitive market has 20 identical firms, each with $TC(q)=36+q^2$ and $MC(q)=2q$. If each firm’s short-run supply follows marginal cost, what is market supply $Q_S(p)$ for $p\\geq0$?',
    options: [
      '$Q_S(p)=10p$: each firm supplies $q=p/2$, then market quantities sum across 20 firms.',
      '$Q_S(p)=p/2$: one firm’s supply is also the market supply.',
      '$Q_S(p)=40p$: multiply the marginal-cost slope $2$ by 20 firms.',
      '$Q_S(p)=10p-720$: subtract total fixed cost from market quantity.',
    ],
  },
  80: {
    stem: 'In a perfectly competitive market with free entry and exit, every firm currently earns economic profit of $-11$. What happens to the number of firms in the long run, and why?',
    options: [
      'It decreases: losses induce exit until the remaining firms approach zero economic profit.',
      'It increases: a negative profit attracts entrants seeking a lower market price.',
      'It stays constant: free entry and exit matters only when profits are positive.',
      'It decreases because existing firms earn positive accounting profit of $11$ each.',
    ],
  },
  82: {
    stem: 'A firm has $TC(q)=36+q^2$ for $q>0$. Which average total cost function follows from dividing total cost by output?',
    options: ['$ATC(q)=36/q+q$.', '$ATC(q)=36+q$.', '$ATC(q)=q/36+q$.', '$ATC(q)=2q$.'],
  },
  91: {
    stem: '垄断者面临需求 $Q_D=210-2p$。将边际收益表示为产量 $Q$ 的函数，哪一项同时正确写出反需求和边际收益？',
    options: [
      '$p(Q)=105-Q/2$，$MR(Q)=105-Q$。',
      '$p(Q)=105-Q/2$，$MR(Q)=105-Q/2$。',
      '$p(Q)=210-2Q$，$MR(Q)=210-4Q$。',
      '$p(Q)=105-Q$，$MR(Q)=105-2Q$。',
    ],
  },
  96: {
    stem: '垄断竞争企业的需求曲线 $D$ 向下倾斜，$MR$ 位于其下方，$MC$ 向上倾斜，$SRATC$ 和 $LRAC$ 呈 U 形。在利润最大化产量处，需求曲线给出的价格高于 $SRATC$。哪一项完整描述其短期产量、价格与利润？',
    options: [
      '在 $MR=MC$ 处选产量，从 $D$ 读取该产量的价格；利润为 $[P-SRATC(Q)]Q>0$。',
      '在 $D=MC$ 处选产量，从 $MR$ 读取价格；利润为 $[P-SRATC(Q)]Q>0$。',
      '在 $MR=MC$ 处选产量，从 $D$ 读取价格；因 $P>SRATC$，利润为负。',
      '在 $MR=MC$ 处选产量，从 $SRATC$ 读取售价；利润恒为零。',
    ],
  },
  97: {
    stem: '一家垄断竞争企业在产量 $Q^*$ 处的售价为 $p^*$，且 $LRAC(Q^*)<SRATC(Q^*)$。如果它保持 $Q^*$ 不变、充分调整投入并实现长期成本最小化，哪一项给出其利润及相对短期利润的变化？',
    options: [
      '利润为 $[p^*-LRAC(Q^*)]Q^*$，比短期利润高 $[SRATC(Q^*)-LRAC(Q^*)]Q^*$。',
      '利润为 $[p^*-SRATC(Q^*)]Q^*$，与短期利润相同，因为产量未变。',
      '利润为 $[LRAC(Q^*)-p^*]Q^*$，比短期利润低 $[SRATC(Q^*)-LRAC(Q^*)]Q^*$。',
      '利润为 $p^*Q^*$，因为长期投入可调整，所以成本为零。',
    ],
  },
  98: {
    stem: '垄断竞争市场的现有企业获得正经济利润。长期中企业数量与每家现有企业面对的个别需求会怎样变化？',
    options: [
      '正利润吸引企业进入，企业数量增加；消费者分散至更多替代品，现有企业的个别需求向左移动。',
      '正利润吸引企业进入，企业数量增加；现有企业的个别需求向右移动。',
      '正利润迫使企业退出，企业数量减少；现有企业的个别需求向左移动。',
      '企业数量不变，因为垄断竞争与完全竞争一样不允许自由进入。',
    ],
  },
};

const [archivePath, outputPath] = process.argv.slice(2);
if (!archivePath || !outputPath || process.argv.length !== 4) {
  console.error(
    'Usage: node scripts/maintenance/prepare-eco101-wa-choice-repairs.mjs BACKUP.zip OUTPUT.json',
  );
  process.exit(2);
}

const zip = await JSZip.loadAsync(readFileSync(archivePath));
const changes = [];
for (const [name, file] of Object.entries(zip.files)) {
  const match = name.match(/\/04-organized-problem-bank\/problems\/(\d{4})_/);
  if (!match || file.dir) continue;
  const number = Number(match[1]);
  const proposed = choice[number];
  if (!proposed) continue;
  const original = JSON.parse(await file.async('string'));
  if (original.courseId !== courseId) {
    throw new Error(`Unexpected course for problem ${number}`);
  }
  const optionIds = ['a', 'b', 'c', 'd'];
  const shift = number % optionIds.length;
  const orderedOptions = [...proposed.options.slice(shift), ...proposed.options.slice(0, shift)];
  const correctOptionId = optionIds[(optionIds.length - shift) % optionIds.length];
  const publicContent = {
    type: 'choice',
    taskKind: original.publicContentJson.taskKind || 'concept',
    responseKind: 'choice',
    contractVersion: 'syntara.problem.v1',
    statementFormat: 'syntara-markdown-v1',
    stem: proposed.stem,
    selectionMode: 'single',
    options: orderedOptions.map((label, index) => ({
      id: optionIds[index],
      label,
      format: 'syntara-markdown-inline-v1',
    })),
    assets: original.publicContentJson.assets ?? { images: [] },
  };
  const grading = {
    type: 'choice',
    graderKind: 'exact_choice',
    correctOptionIds: [correctOptionId],
    analysis:
      original.gradingJson.referenceAnswer ?? original.gradingJson.analysis ?? proposed.options[0],
  };
  const sourceMeta = {
    ...(original.sourceMeta || {}),
    responseTypeReview: {
      from: original.type,
      to: 'choice',
      reason: '完整结论与典型错误干扰项保留原考点；适配平台稳定作答与评分。',
      reviewedAt: '2026-09-25',
    },
  };
  changes.push({
    id: original.id,
    expectedRevision: courseProblemRevision({
      ...original,
      updatedAt: new Date(original.updatedAt),
    }),
    type: 'choice',
    publicContent,
    grading,
    sourceMeta,
  });
}

if (changes.length !== Object.keys(choice).length) {
  throw new Error(`Expected ${Object.keys(choice).length} choice revisions, got ${changes.length}`);
}
const handle = await open(outputPath, 'wx', 0o600);
try {
  await handle.writeFile(`${JSON.stringify({ courseId, changes }, null, 2)}\n`);
} finally {
  await handle.close();
}
console.log(JSON.stringify({ output: outputPath, count: changes.length }));
