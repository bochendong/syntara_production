// Exercise the real component's request lifecycle without a live server or database.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function mount() {
  const slots = [];
  const effects = [];
  const requests = [];
  const messages = [];
  let cursor = 0;
  let dirty = true;
  let tree;
  let refreshed = 0;
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [
        slots[index],
        (value) => {
          const next = typeof value === 'function' ? value(slots[index]) : value;
          if (next !== slots[index]) {
            slots[index] = next;
            dirty = true;
          }
        },
      ];
    },
    useRef(initial) {
      const index = cursor++;
      return (slots[index] ??= { current: initial });
    },
    useEffect(run, dependencies) {
      const index = cursor++;
      if (
        !slots[index] ||
        dependencies.some((value, i) => value !== slots[index].dependencies[i])
      ) {
        effects.push(() => {
          slots[index]?.cleanup?.();
          slots[index] = { dependencies, cleanup: run() };
        });
      }
    },
  };
  const jsx = (type, props) => ({ type, props });
  const mod = { exports: {} };
  const code = ts.transpileModule(
    readFileSync('components/teacher/course-bulk-move-dialog.tsx', 'utf8'),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText;
  new Function('require', 'module', 'exports', code)(
    (id) => {
      if (id === 'react') return react;
      if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (id === '@/lib/notifications/client-toast')
        return {
          toast: {
            success: (message) => messages.push(message),
            info: (message) => messages.push(message),
          },
        };
      if (id === '@/lib/utils/backend-api')
        return {
          backendJson: (path, options) =>
            new Promise((resolve, reject) => requests.push({ path, options, resolve, reject })),
        };
      if (id === '@/lib/teacher/course-bulk-move')
        return { groupBulkMoveCourses: (courses) => [{ term: 'Fall', courses }] };
      if (id === 'lucide-react' || id.startsWith('@/components/ui/'))
        return new Proxy({}, { get: (_, key) => key });
      throw new Error(`Unexpected dependency: ${id}`);
    },
    mod,
    mod.exports,
  );
  async function flush() {
    for (let n = 0; n < 15; n++) {
      if (dirty) {
        dirty = false;
        cursor = 0;
        tree = mod.exports.CourseBulkMoveDialog({
          courseId: 'source',
          courseName: 'BUS200',
          onMoved: async () => {
            refreshed++;
          },
        });
        effects.splice(0).forEach((effect) => effect());
      }
      await Promise.resolve();
    }
  }
  function nodes(node) {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap(nodes);
    return [node, ...nodes(node.props?.children)];
  }
  const text = (node) => {
    if (typeof node === 'string') return node;
    if (Array.isArray(node)) return node.map(text).join('');
    return node && typeof node === 'object' ? text(node.props?.children) : '';
  };
  return {
    flush,
    requests,
    messages,
    get refreshed() {
      return refreshed;
    },
    find: (test) => {
      const result = nodes(tree).find(test);
      assert.ok(result, 'Expected element');
      return result;
    },
    button: (label) => {
      const result = nodes(tree).find((node) => node.type === 'Button' && text(node) === label);
      assert.ok(result, `Expected button: ${label}`);
      return result;
    },
  };
}
const preview = {
  targets: [
    {
      id: 'target',
      name: 'Economics',
      courseCode: 'ECO101',
      academicYear: 2026,
      academicTerm: 'fall',
    },
  ],
  notebooks: {
    count: 3,
    version: 'book-version',
    items: [
      { id: 'n1', name: 'One' },
      { id: 'n2', name: 'Two' },
      { id: 'n3', name: 'Three' },
    ],
  },
  problems: {
    count: 12,
    version: 'problem-version',
    chapters: [
      { id: 'ch1', name: 'Chapter 1', count: 5 },
      { id: 'ch2', name: 'Chapter 2', count: 7 },
    ],
  },
};
async function open(app) {
  await app.flush();
  app.find((node) => node.type === 'Dialog').props.onOpenChange(true);
  await app.flush();
}
const app = mount();
await open(app);
assert.equal(app.button('确认复制').props.disabled, true);
app.requests[0].resolve(preview);
await app.flush();
assert.equal(app.button('确认复制').props.disabled, true, 'Target selection is required');
app.find((node) => node.type === 'input' && node.props.type === 'radio').props.onChange();
app
  .find((node) => node.type === 'input' && node.props.type === 'checkbox')
  .props.onChange({ target: { checked: false } });
await app.flush();
const submit = app.button('确认复制');
submit.props.onClick();
submit.props.onClick();
assert.equal(app.requests.length, 2, 'Rapid double click must send exactly one POST');
assert.deepEqual(JSON.parse(app.requests[1].options.body), {
  targetCourseId: 'target',
  operation: 'copy',
  notebookIds: ['n1', 'n2', 'n3'],
  chapterIds: ['ch1', 'ch2'],
  notebooks: false,
  problems: true,
  notebookVersion: 'book-version',
  problemVersion: 'problem-version',
});
await app.flush();
assert.equal(app.button('取消').props.disabled, true);
app.find((node) => node.type === 'Dialog').props.onOpenChange(false);
await app.flush();
assert.equal(app.find((node) => node.type === 'Dialog').props.open, true);
app.requests[1].resolve({ targetCourseId: 'target', notebooks: 0, problems: 12 });
await app.flush();
assert.equal(app.find((node) => node.type === 'Dialog').props.open, false);
assert.equal(app.refreshed, 1);
assert.ok(app.messages[0].includes('0 本笔记本、12 道题'));

await open(app);
app.requests[2].resolve(preview);
await app.flush();
app.find((node) => node.type === 'input' && node.props.type === 'radio').props.onChange();
await app.flush();
app.button('确认复制').props.onClick();
app.requests[3].reject(new Error('network interrupted'));
await app.flush();
assert.equal(
  app.button('确认复制').props.disabled,
  true,
  'Unknown write outcome requires a fresh preview',
);
assert.equal(app.refreshed, 1);
app.button('刷新列表').props.onClick();
await app.flush();
app.requests[4].resolve({
  ...preview,
  notebooks: { count: 0, version: 'empty', items: [] },
  problems: { count: 0, version: 'empty', chapters: [] },
});
await app.flush();
assert.equal(app.button('确认复制').props.disabled, true, 'An empty source cannot be moved again');

const stale = mount();
await open(stale);
stale.find((node) => node.type === 'Dialog').props.onOpenChange(false);
await stale.flush();
assert.ok(stale.requests[0].options.signal.aborted);
await open(stale);
stale.requests[1].resolve({ ...preview, targets: [] });
await stale.flush();
stale.requests[0].resolve(preview);
await stale.flush();
assert.equal(
  stale.button('确认复制').props.disabled,
  true,
  'A late response must not overwrite the reopened dialog',
);
console.log(
  'PASS: UI selection payload, double-submit guard, pending close guard, refresh after success, uncertain writes, empty source, stale read cancellation.',
);
