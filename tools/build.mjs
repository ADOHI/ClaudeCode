// 빌드: (1) 로컬 개발용 index.html  (2) 단일 파일 배포본 dist/academy-city.html (three는 CDN importmap)
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const THREE_VER = '0.160.0';
const app = readFileSync('src/app.html', 'utf8');

const devMap = { imports: { three: './node_modules/three/build/three.module.js', 'three/addons/': './node_modules/three/examples/jsm/' } };
const cdnMap = { imports: { three: `https://cdn.jsdelivr.net/npm/three@${THREE_VER}/build/three.module.js`, 'three/addons/': `https://cdn.jsdelivr.net/npm/three@${THREE_VER}/examples/jsm/` } };

const head = '<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n</head>\n<body>\n';
writeFileSync('index.html', `${head}${app}\n<script type="importmap">${JSON.stringify(devMap)}</script>\n<script type="module" src="./src/main.js"></script>\n</body>\n</html>\n`);

const res = await build({
  entryPoints: ['src/main.js'], bundle: true, format: 'esm', write: false, minify: true, target: 'es2020',
  external: ['three', 'three/addons/*'], legalComments: 'none', charset: 'utf8',
});
let js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
mkdirSync('dist', { recursive: true });
// 배포본: 아티팩트 규약상 doctype/html/head/body 없이 본문만
writeFileSync('dist/academy-city.html', `${app}\n<script type="importmap">${JSON.stringify(cdnMap)}</script>\n<script type="module">\n${js}\n</script>\n`);
// 로컬 확인용 전체 문서 버전
writeFileSync('dist/standalone.html', `${head}${app}\n<script type="importmap">${JSON.stringify(cdnMap)}</script>\n<script type="module">\n${js}\n</script>\n</body>\n</html>\n`);
console.log(`index.html, dist/academy-city.html (${(js.length / 1024).toFixed(0)} KB js)`);
