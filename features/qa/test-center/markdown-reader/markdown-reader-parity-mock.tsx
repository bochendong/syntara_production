'use client';

import { useState } from 'react';
import { MarkdownNotebookReader } from '@/components/stage/markdown-notebook-reader';
import type { Scene, Stage } from '@/lib/types/stage';

const STAGE: Stage = {
  id: 'mat136-reader-parity',
  courseId: 'mat136',
  name: '01 - 定积分：从矩形到基本定理',
  description: 'MAT136 课程笔记',
  notebookKind: 'markdown',
  createdAt: 0,
  updatedAt: 0,
};

const SCENES: Scene[] = [
  {
    id: 'riemann-sum',
    stageId: STAGE.id,
    type: 'markdown',
    title: '黎曼和与矩形近似',
    order: 0,
    content: {
      type: 'markdown',
      summary: '从分割、采样点与矩形面积理解黎曼和。',
      markdown:
        '## 核心概念\n\n把区间分成许多小段，每段宽度记作 $\\Delta x$。在每一段选取采样点 $x_i^*$，矩形面积之和为\n\n$$\\sum_{i=1}^{n} f(x_i^*)\\Delta x$$\n\n> 分割越细，矩形面积之和越接近曲线下的真实面积。\n\n### 检查要点\n\n- 区间与分点是否正确\n- 采样点是否落在对应子区间\n- 是否保留了 $\\Delta x$',
    },
  },
  {
    id: 'fundamental-theorem',
    stageId: STAGE.id,
    type: 'markdown',
    title: '微积分基本定理',
    order: 1,
    content: {
      type: 'markdown',
      summary: '连接面积累计、导数与原函数。',
      markdown: `## 从面积到导数

如果 $F(x)=\\int_a^x f(t)\\,dt$，那么

$$F'(x)=f(x).$$

这说明面积累计函数的瞬时变化率，就是前沿位置的函数高度。`,
    },
  },
  {
    id: 'substitution',
    stageId: STAGE.id,
    type: 'markdown',
    title: '换元法',
    order: 2,
    content: {
      type: 'markdown',
      summary: '把复合函数积分改写为更直接的形式。',
      markdown: `## 反向链式法则

令 $u=g(x)$，同时替换 $du=g'(x)dx$。`,
    },
  },
];

export function MarkdownReaderParityMock() {
  const [currentSceneId, setCurrentSceneId] = useState(SCENES[0].id);

  return (
    <main className="h-dvh overflow-hidden">
      <MarkdownNotebookReader
        stage={STAGE}
        scenes={SCENES}
        currentSceneId={currentSceneId}
        onSelectScene={setCurrentSceneId}
      />
    </main>
  );
}
