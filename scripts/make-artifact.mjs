// Готовит dist/ к публикации ссылкой (claude.ai artifact): страница без собственных <html>/<head>/<body>
// (их добавляет хостинг), ассеты рядом в hero/. Результат — папка artifact/.
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync('dist/index.html', 'utf8');
const title = '<title>Главный экран MVP</title>';
const head = src.match(/<head>([\s\S]*?)<\/head>/)[1]
  .replace(/<meta charset[^>]*>\s*/i, '')
  .replace(/<meta name="viewport"[^>]*>\s*/i, '')
  .replace(/<title>[\s\S]*?<\/title>\s*/i, '')
  .replace(/<link rel="icon"[^>]*>\s*/i, '');
const body = src.match(/<body>([\s\S]*?)<\/body>/)[1];
const page = `${title}\n<style>:root{color-scheme:dark}html,body{background:#030f1c}</style>\n${head.trim()}\n${body.trim()}\n`;

fs.rmSync('artifact', { recursive: true, force: true });
fs.mkdirSync('artifact');
fs.writeFileSync('artifact/index.html', page);
fs.cpSync('dist/hero', 'artifact/hero', { recursive: true });

const files = [];
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
  const p = path.join(d, e.name);
  if (e.isDirectory()) walk(p); else if (!e.name.startsWith('.')) files.push(path.relative('artifact', p));
});
walk('artifact/hero');
console.log(JSON.stringify({ pageKB: Math.round(page.length / 1024), files }));
