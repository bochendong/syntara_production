#!/usr/bin/env node

/** Build a second, reviewable patch for ECO101WA text and content errors. */
import { readFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const require = createRequire(import.meta.url);
const JSZip = require('jszip');
const here = dirname(fileURLToPath(import.meta.url));
const jiti = createJiti(import.meta.url, { interopDefault: true });
const { courseProblemRevision } = jiti(
  join(here, '../../lib/server/admin-course-problem-upload.ts'),
);
const { repairMalformedProblemMath } = jiti(
  join(here, '../../lib/problem-bank/repair-malformed-math.ts'),
);

const courseId = 'cmu8nl0tn0009l204d5j0w4gl';
const choiceNumbers = new Set([
  21, 23, 34, 44, 47, 48, 49, 52, 54, 67, 69, 70, 76, 80, 82, 91, 96, 97, 98,
]);
const [archivePath, outputPath] = process.argv.slice(2);
if (!archivePath || !outputPath || process.argv.length !== 4) {
  console.error(
    'Usage: node scripts/maintenance/prepare-eco101-wa-text-repairs.mjs BACKUP.zip OUTPUT.json',
  );
  process.exit(2);
}

function mathTokens(value) {
  return [...value.matchAll(/\\[A-Za-z]+|[A-Za-z]+|\d+(?:\.\d+)?/g)]
    .map((match) => match[0])
    .join('|');
}

function cleanStem(value, number) {
  if (!/(\${3,}|\$[\u3400-\u9fff])/.test(value)) return value;
  let fixed = repairMalformedProblemMath(value);
  if (mathTokens(value) !== mathTokens(fixed)) {
    throw new Error(`Mathematical text changed in problem ${number}`);
  }
  if ((fixed.match(/\$/g) ?? []).length % 2 !== 0 || /\${3,}/.test(fixed)) {
    throw new Error(`Unbalanced math delimiters in problem ${number}`);
  }
  return fixed;
}

const zip = await JSZip.loadAsync(readFileSync(archivePath));
const changes = [];
for (const [name, file] of Object.entries(zip.files)) {
  const match = name.match(/\/04-organized-problem-bank\/problems\/(\d{4})_/);
  if (!match || file.dir) continue;
  const number = Number(match[1]);
  if (choiceNumbers.has(number)) continue;
  const original = JSON.parse(await file.async('string'));
  if (original.courseId !== courseId) {
    throw new Error(`Unexpected course for problem ${number}`);
  }
  let publicContent = { ...original.publicContentJson };
  let grading = { ...original.gradingJson };
  let title = original.title;
  const stemKey = 'stemTemplate' in publicContent ? 'stemTemplate' : 'stem';
  if (typeof publicContent[stemKey] === 'string') {
    publicContent[stemKey] = cleanStem(publicContent[stemKey], number);
  }

  switch (number) {
    case 3:
      publicContent.stem = publicContent.stem
        .replace(/\\\s*\$\s*(\d+)/g, '$1 dollars')
        .replace(
          'Treat quantities as divisible when drawing the budget line.',
          'Treat quantities as divisible when drawing the budget line. For a fractional quantity between the second and third cup, apply the half-price rate proportionally to that fraction.',
        )
        .replace('1 dollars', '1 dollar');
      break;
    case 6:
      publicContent.stem = publicContent.stem.replace(
        '请写出必要的计算过程。',
        '假定在价格下限造成的过剩中，实际交易的单位由边际成本最低的生产者供给。请写出必要的计算过程。',
      );
      break;
    case 7:
      publicContent.stem = publicContent.stem.replace('$Q_d=40-0.5p$政府', '$Q_d=40-0.5p$。政府');
      break;
    case 10:
      title = '需求价格弹性与需求移动';
      publicContent.stem =
        '太阳镜市场最初的供给与需求为 $Q_S=P$、$Q_D=45-0.5P$。随后泳装价格从 $30$ 降至 $20$，太阳镜需求变为 $Q_D^{\\prime}=30-0.5P$，供给不变。\n\n1. 求太阳镜市场的初始均衡，并计算初始均衡点的自身价格弹性绝对值。\n2. 求需求移动后的新均衡。\n3. 用中点法计算太阳镜均衡成交量与泳装价格的百分比变化之比。说明为什么这个比值**不能直接当作标准交叉价格弹性**，并根据需求曲线移动方向判断两种商品是替代品还是互补品。\n\n请写出必要的计算过程。';
      grading = {
        type: 'short_answer',
        graderKind: 'rubric',
        rubricCriteria: [
          {
            id: 'initial',
            points: 2,
            description: '初始均衡 $P_0=30,Q_0=30$；自身价格弹性绝对值为 $0.5$，需求缺乏弹性。',
          },
          { id: 'new_equilibrium', points: 2, description: '需求移动后的均衡 $P_1=20,Q_1=20$。' },
          {
            id: 'interpretation',
            points: 2,
            description:
              '中点法所得两个百分比变化之比为 $1$，但太阳镜自身价格也变化，故它不是保持自身价格不变的标准交叉价格弹性；泳装降价使太阳镜需求左移，说明两者为替代品。',
          },
        ],
        referenceAnswer:
          '初始均衡由 $P=45-0.5P$ 得 $P_0=30,Q_0=30$。自身价格弹性绝对值为 $0.5(30/30)=0.5$，需求缺乏弹性。新均衡由 $P=30-0.5P$ 得 $P_1=20,Q_1=20$。用中点法，两段百分比变化均为 $-0.4$，比值为 $1$。但太阳镜自身价格也从 $30$ 变为 $20$，均衡成交量的变化包含自身价格效应，不能用这一比值识别保持自身价格不变的交叉价格弹性。泳装降价使太阳镜需求曲线左移，支持两者为替代品的判断。',
      };
      break;
    case 11:
      publicContent.stem =
        '两名室友 Chuck（C）和 Judy（J）为公寓购买植物。购买总量为 $Q$ 时，两人的边际收益分别为 $MB_C=20-Q$、$MB_J=30-2Q$；每株植物的边际成本为 $MC=4+0.25Q$。\n\n1. 假设每次由其中一名室友**独自支付全部购买成本**、不与另一人分摊。分别求两人各自会选择的购买量，并给出其中较大的数量。\n2. 两人的边际收益均计入社会收益时，求社会最优购买数量。\n\n结果保留至少两位小数。';
      break;
    case 24:
      publicContent.stemTemplate = publicContent.stemTemplate
        .replace('$p=80-2Q_d$计算', '$p=80-2Q_d$。计算')
        .replace('。 - 均衡价格', '。\n\n- 均衡价格');
      break;
    case 75:
      publicContent.stem = publicContent.stem.replace('accounting profit', 'economic profit');
      grading.rubricCriteria = grading.rubricCriteria.map((criterion) => ({
        ...criterion,
        description: criterion.description.replace('accounting profit', 'economic profit'),
      }));
      grading.referenceAnswer = grading.referenceAnswer.replaceAll(
        'accounting profit',
        'economic profit',
      );
      break;
    case 83:
      title = 'Minimum Long-Run Break-Even Price';
      publicContent.stem = publicContent.stem
        .replace(
          'the minimum price at which the firm can operate profitably in the long run',
          'the minimum price at which the firm breaks even (earns zero economic profit) in the long run',
        )
        .replace('q>0.$', 'q>0$.');
      break;
    case 86:
      publicContent.stem = publicContent.stem
        .replace('$MC=10$请', '$MC=10$。请')
        .replace('计算过程。 1.', '计算过程。\n\n1.');
      break;
    case 93:
      publicContent.stem =
        '某市场的反需求、边际收益和边际成本曲线分别为 $p=105-\\frac{Q}{2}$、$MR=105-Q$、$MC=Q$。完全竞争均衡为 $(Q_C,p_C)=(70,70)$，垄断均衡为 $(Q_M,p_M)=(52.5,78.75)$。\n\n请说明如何在横轴为数量、纵轴为价格或成本的图中绘制并标注：\n\n- 需求、边际收益和边际成本曲线；\n- 完全竞争均衡与垄断均衡；\n- 垄断后的消费者剩余、生产者剩余以及无谓损失；\n- 消费者剩余的下降和生产者剩余的净增加分别对应哪些区域。';
      break;
  }

  const fields = {};
  if (title !== original.title) fields.title = title;
  if (JSON.stringify(publicContent) !== JSON.stringify(original.publicContentJson)) {
    fields.publicContent = publicContent;
  }
  if (JSON.stringify(grading) !== JSON.stringify(original.gradingJson)) fields.grading = grading;
  if (Object.keys(fields).length === 0) continue;
  fields.sourceMeta = {
    ...(original.sourceMeta || {}),
    contentReview: {
      note: '题面格式或题目条件经审查修订；原始资料和修订前题目保存在课程归档。',
      reviewedAt: '2026-09-25',
    },
  };
  changes.push({
    id: original.id,
    expectedRevision: courseProblemRevision({
      ...original,
      updatedAt: new Date(original.updatedAt),
    }),
    ...fields,
  });
}

const handle = await open(outputPath, 'wx', 0o600);
try {
  await handle.writeFile(`${JSON.stringify({ courseId, changes }, null, 2)}\n`);
} finally {
  await handle.close();
}
console.log(JSON.stringify({ output: outputPath, count: changes.length }));
