import { defineConfig, type Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Демо-сборка открывается двойным кликом (file://), без сервера:
 * браузер не грузит module-скрипты и шрифты с file://, поэтому JS и CSS кладём прямо в index.html,
 * а шрифты встраиваются в CSS (assetsInlineLimit). Видео и картинки лежат рядом по относительным путям.
 */
function inlineForFileProtocol(): Plugin {
  return {
    name: 'inline-for-file-protocol',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const html = Object.values(bundle).find((f) => f.type === 'asset' && f.fileName.endsWith('.html'));
      if (!html || html.type !== 'asset') return;
      let page = String(html.source);
      for (const [name, file] of Object.entries(bundle)) {
        if (file.type === 'chunk' && file.isEntry) {
          const code = file.code.replace(/<\/script/gi, '<\\/script');
          page = page.replace(new RegExp(`<script type="module" crossorigin src="[^"]*${escapeRe(name)}"></script>`), () => `<script type="module">${code}</script>`);
          delete bundle[name];
        } else if (file.type === 'asset' && name.endsWith('.css')) {
          page = page.replace(new RegExp(`<link rel="stylesheet" crossorigin href="[^"]*${escapeRe(name)}">`), () => `<style>${String(file.source)}</style>`);
          delete bundle[name];
        }
      }
      // текстуры WebGL (data-tex-*): с file:// браузер не даёт загрузить картинку в WebGL, поэтому встраиваем как data URI
      const mime: Record<string, string> = { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
      page = page.replace(/(data-tex-[a-z]+)="([^"]+)"/g, (_, attr: string, file: string) => {
        const abs = path.resolve('public', file);
        const data = fs.readFileSync(abs).toString('base64');
        return `${attr}="data:${mime[path.extname(abs)] ?? 'application/octet-stream'};base64,${data}"`;
      });
      html.source = page;
    },
  };
}

export default defineConfig({
  base: './',
  build: {
    assetsInlineLimit: 120_000,
    modulePreload: false,
  },
  plugins: [inlineForFileProtocol()],
});
