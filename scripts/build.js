// Сборка. Из src/page.html (шаблон) и src/engine.js получаются:
//   index.html           — сайт для GitHub Pages (Firebase + игра по ссылке). Его отдаёт Pages, руками не править.
//   dist/preview.html    — превью без Firebase (только игра на одном телефоне), для публикации в Claude.
//   mock/www/index.html  — для локальной проверки с подменной базой (npm run mock).
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const write = (p, s) => { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), s); };

const engine = read('src/engine.js');
const src = read('src/page.html');
const parts = src.split('<!--__BODY__-->');
if (parts.length !== 2 || !src.includes('/*__ENGINE__*/') || !src.includes('<!--__FIREBASE__-->')) throw new Error('нет меток в шаблоне');
const [head, body] = parts;

// Конфиг веб-приложения Firebase. Он публичный по задумке: доступ к данным ограничивают правила базы.
const config = {
  apiKey: 'AIzaSyBoVbR1HohZJaeznSvnk8ZQtgi1YrysH1g',
  authDomain: 'dots-5b009.firebaseapp.com',
  databaseURL: 'https://dots-5b009-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'dots-5b009',
  storageBucket: 'dots-5b009.firebasestorage.app',
  messagingSenderId: '521337821893',
  appId: '1:521337821893:web:6f358c07ef8d6a8659eeac',
};
const FB_VER = '10.12.2';
const cfg = `<script>window.TOCHKI_FIREBASE = ${JSON.stringify(config, null, 2)};</script>`;
const fbScripts = ['app', 'auth', 'database']
  .map((n) => `<script src="https://www.gstatic.com/firebasejs/${FB_VER}/firebase-${n}-compat.js"></script>`)
  .join('\n') + '\n' + cfg;
const mockScripts = `<script src="/mock-firebase.js"></script>\n${cfg}`;

const inject = (s, fbPart) => s.replace('/*__ENGINE__*/', () => engine).replace('<!--__FIREBASE__-->', () => fbPart);
const icon = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#FBFCFD"/>' +
  '<path d="M16 0v64M32 0v64M48 0v64M0 16h64M0 32h64M0 48h64" stroke="#C3D4E7" stroke-width="2"/>' +
  '<circle cx="16" cy="32" r="7" fill="#CC2F2B"/><circle cx="48" cy="32" r="7" fill="#2747AE"/></svg>');

function doc(fbPart) {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="Игра в точки на листе в клетку: вдвоём на одном телефоне или по ссылке, каждый со своего.">
<meta name="theme-color" content="#E4E9EF" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0D1116" media="(prefers-color-scheme: dark)">
<link rel="icon" href="${icon}">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}[hidden]{display:none!important}</style>
${head.trim()}
</head>
<body>
${inject(body, fbPart).trim()}
</body>
</html>
`;
}

// Превью публикуется как Artifact: обёртку <html>/<head> добавляет сама платформа
write('dist/preview.html', inject(head + body, ''));
write('index.html', doc(fbScripts));
write('mock/www/index.html', doc(mockScripts));
for (const f of ['index.html', 'dist/preview.html', 'mock/www/index.html']) {
  console.log(f.padEnd(22), fs.statSync(path.join(root, f)).size, 'байт');
}
