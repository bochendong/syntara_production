import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { nativeUiParityManifest } from './web-native-ui-parity.manifest.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const componentDirectory = path.join(repositoryRoot, 'apps/native/src/components');

async function filesUnder(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) return filesUnder(absolutePath);
      return entry.name.endsWith('.tsx') ? [path.relative(repositoryRoot, absolutePath)] : [];
    }),
  );
  return files.flat();
}

async function exists(relativePath) {
  try {
    await fs.access(path.join(repositoryRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

const errors = [];
const warnings = [];
const registeredNativeFiles = new Set(nativeUiParityManifest.map((entry) => entry.native));
const nativeComponentFiles = await filesUnder(componentDirectory);

for (const nativeFile of nativeComponentFiles) {
  if (!registeredNativeFiles.has(nativeFile)) {
    errors.push(`Native component file is missing from the manifest: ${nativeFile}`);
  }
}

for (const entry of nativeUiParityManifest) {
  if (!(await exists(entry.native))) {
    errors.push(`Missing Native component file: ${entry.native}`);
  }
  for (const webFile of entry.web) {
    if (!(await exists(webFile))) errors.push(`Missing Web visual source: ${webFile}`);
  }
  if (!entry.components.length) errors.push(`No components declared for ${entry.native}`);
  if (entry.parity !== 'verified') {
    warnings.push(`${entry.parity.padEnd(10)} ${entry.components.join(', ')}`);
  }
}

console.log(`Registered Native component files: ${registeredNativeFiles.size}`);
console.log(
  `Registered rendered components: ${nativeUiParityManifest.reduce(
    (count, entry) => count + entry.components.length,
    0,
  )}`,
);

if (warnings.length) {
  console.log('\nParity work remaining:');
  for (const warning of warnings) console.log(`- ${warning}`);
}

if (errors.length) {
  console.error('\nUI parity contract failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log('\nUI parity inventory contract passed.');
}
