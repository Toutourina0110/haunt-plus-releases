import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

const dev = process.argv.includes('--dev');

const common = {
  bundle: true,
  minify: !dev,
  sourcemap: dev,
  target: 'es2022',
  logLevel: 'info',
};

await rm('dist', { recursive: true, force: true });

await build({
  ...common,
  platform: 'node',
  format: 'cjs',
  external: ['electron', 'electron-updater'],
  entryPoints: {
    main: 'src/main/main.ts',
    'preload-ui': 'src/preload/ui.ts',
    'preload-site': 'src/preload/site.ts',
  },
  outdir: 'dist',
});

await build({
  ...common,
  platform: 'browser',
  format: 'iife',
  entryPoints: {
    shell: 'src/renderer/shell.ts',
    overlay: 'src/renderer/overlay.ts',
    popup: 'src/renderer/popup.ts',
    capture: 'src/renderer/capture.ts',
    imagehost: 'src/renderer/imagehost.ts',
  },
  outdir: 'dist/renderer',
});

await mkdir('dist/renderer/assets', { recursive: true });
for (const file of ['shell.html', 'overlay.html', 'popup.html', 'capture.html', 'imagehost.html', 'base.css', 'shell.css', 'overlay.css', 'popup.css', 'capture.css', 'imagehost.css']) {
  await cp(`src/renderer/${file}`, `dist/renderer/${file}`);
}
await cp('src/renderer/assets', 'dist/renderer/assets', { recursive: true });
await cp('resources/assets', 'dist/assets', { recursive: true });
await cp('resources/userscripts', 'dist/userscripts', { recursive: true });

console.log(dev ? 'Dev build ready in dist/' : 'Build ready in dist/');
