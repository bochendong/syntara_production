export type LocalDemoStudentRosterItem = {
  userId: string;
  name: string;
  phoneLast4: string | null;
  notebookAccessLimit: number | null;
};

export const LOCAL_DEMO_STUDENT_ROSTER: LocalDemoStudentRosterItem[] = [
  { userId: 'stu-li-wei', name: '李维', phoneLast4: '1028', notebookAccessLimit: null },
  { userId: 'stu-wang-min', name: '王敏', phoneLast4: '6671', notebookAccessLimit: 3 },
  { userId: 'stu-chen-hao', name: '陈浩', phoneLast4: '4316', notebookAccessLimit: 2 },
  { userId: 'stu-zhao-lin', name: '赵琳', phoneLast4: '9054', notebookAccessLimit: null },
  { userId: 'stu-sun-yue', name: '孙悦', phoneLast4: '2189', notebookAccessLimit: 1 },
  { userId: 'stu-zhou-qi', name: '周琪', phoneLast4: null, notebookAccessLimit: null },
  { userId: 'stu-wu-fang', name: '吴芳', phoneLast4: '7740', notebookAccessLimit: 3 },
  { userId: 'stu-zheng-kai', name: '郑凯', phoneLast4: '5502', notebookAccessLimit: null },
];

export function findLocalDemoStudent(userId: string) {
  return LOCAL_DEMO_STUDENT_ROSTER.find((student) => student.userId === userId) || null;
}
