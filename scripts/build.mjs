import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLIC_FILES } from './public-files.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

// Tests supply an empty temporary directory. CLI builds always replace this project's dist/.
export async function build(output) {
  for (const path of PUBLIC_FILES) {
    const target = join(output, path);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(root, path), target);
  }
  await writeFile(join(output, '.nojekyll'), '');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = join(root, 'dist');
  await rm(output, { recursive: true, force: true });
  await build(output);
  console.log(`Built ${PUBLIC_FILES.length} runtime files in dist/`);
}
