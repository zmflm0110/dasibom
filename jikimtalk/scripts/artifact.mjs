// dist-artifact의 js·css를 한 HTML 조각으로 합친다(아티팩트는 doctype·head 없이 내용만 받는다).
import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
const js = readFileSync('dist-artifact/app.js', 'utf8');
const css = readFileSync('dist-artifact/app.css', 'utf8');
mkdirSync('artifact/samples', { recursive: true });
writeFileSync('artifact/index.html', `<title>지킴톡</title>\n<meta name="description" content="단톡방 괴롭힘을 신고용 기록으로 정리해요.">\n<style>${css}</style>\n<div id="app"></div>\n<script type="module">${js.replace(/<\/script/g, '<\\/script')}</script>\n`);
cpSync('public/model.json', 'artifact/model.json');
cpSync('public/samples/example-android.txt', 'artifact/samples/example-android.txt');
console.log('artifact/index.html', Math.round(readFileSync('artifact/index.html').length / 1024) + 'KB');
