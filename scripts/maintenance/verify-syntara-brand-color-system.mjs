import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const globals = read('app/globals.css');
const tokens = read('styles/syntara-ui-tokens.css');
const courseHeader = read('components/course-space/course-space-header.tsx');

const checks = [
  {
    name: 'global primary color follows the logo teal instead of legacy purple',
    pass:
      globals.includes('--primary: #087f8c;') &&
      globals.includes('--primary: #22c7d3;') &&
      !globals.includes('--primary: #722ed1;') &&
      !globals.includes('--primary: #8b47ea;'),
  },
  {
    name: 'brand tokens expose logo navy teal and gold roles',
    pass:
      tokens.includes('--syntara-color-ink: #011e46;') &&
      tokens.includes('--syntara-color-brand: #087f8c;') &&
      tokens.includes('--syntara-color-accent: #fab206;'),
  },
  {
    name: 'legacy purple utilities inherit the brand family during migration',
    pass:
      globals.includes('--color-violet-500: var(--color-brand-500);') &&
      globals.includes('--color-purple-500: var(--color-brand-500);'),
  },
  {
    name: 'shared course navigation uses semantic primary color',
    pass:
      courseHeader.includes('focus-visible:ring-primary/30') &&
      courseHeader.includes("selected ? 'text-primary'"),
  },
];

let failed = false;
for (const check of checks) {
  console.log(`${check.pass ? 'PASS' : 'FAIL'}: ${check.name}`);
  failed ||= !check.pass;
}

if (failed) process.exit(1);
