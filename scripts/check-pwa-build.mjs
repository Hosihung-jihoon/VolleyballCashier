// Kiểm tra artifact PWA offline sau khi chạy `npm run build:web`
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const distDir = path.resolve('dist');
const read = (rel) => fs.readFileSync(path.join(distDir, rel), 'utf8');

// 0. vercel.json phải cấu hình buildCommand chạy npm run build:web để Vercel tạo sw.js
const vercelCfg = JSON.parse(fs.readFileSync(path.resolve('vercel.json'), 'utf8'));
assert.equal(vercelCfg.buildCommand, 'npm run build:web', 'vercel.json phải chạy npm run build:web');
assert.equal(vercelCfg.outputDirectory, 'dist', 'vercel.json outputDirectory phải là dist');

// 1. Files bắt buộc phải tồn tại trong dist/
for (const file of [
  'index.html',
  'session.html',
  'manifest.json',
  'logo192.png',
  'logo512.png',
  'apple-touch-icon.png',
  'favicon.ico',
  'sw.js',
]) {
  assert.ok(fs.existsSync(path.join(distDir, file)), `Thiếu file dist/${file}`);
}

// 2. Manifest hợp lệ
const manifest = JSON.parse(read('manifest.json'));
assert.equal(manifest.display, 'standalone', 'manifest.display phải là standalone');
assert.equal(manifest.start_url, '/', 'manifest.start_url phải là /');
assert.ok(manifest.icons.some((i) => i.sizes === '192x192'), 'manifest thiếu icon 192x192');
assert.ok(manifest.icons.some((i) => i.sizes === '512x512'), 'manifest thiếu icon 512x512');

// 3. HTML có thẻ PWA & đăng ký sw.js ngay lập tức (không chờ window.load)
for (const htmlFile of ['index.html', 'session.html']) {
  const html = read(htmlFile);
  assert.ok(html.includes('rel="manifest" href="/manifest.json"'), `${htmlFile} thiếu link manifest`);
  assert.ok(html.includes('apple-mobile-web-app-capable'), `${htmlFile} thiếu meta iOS standalone`);
  assert.ok(html.includes('apple-touch-icon'), `${htmlFile} thiếu apple-touch-icon`);
  assert.ok(html.includes("register('/sw.js'"), `${htmlFile} thiếu script đăng ký /sw.js`);
  assert.ok(!html.includes("addEventListener('load'"), `${htmlFile} không nên trì hoãn đăng ký SW chờ window.load`);
}

// 4. Service Worker precache gọn nhẹ, không lỗi redirect/404
const sw = read('sw.js');
assert.ok(sw.includes('"/index.html"'), 'sw.js thiếu /index.html trong PRECACHE_URLS');
assert.ok(sw.includes('"/session.html"'), 'sw.js thiếu /session.html trong PRECACHE_URLS');
assert.ok(sw.includes('"/manifest.json"'), 'sw.js thiếu /manifest.json trong PRECACHE_URLS');
assert.ok(/\/_expo\/static\/js\/web\/entry-[a-f0-9]+\.js/.test(sw), 'sw.js thiếu JS bundle web');
assert.ok(/\/_expo\/static\/css\/global-[a-f0-9]+\.css/.test(sw), 'sw.js thiếu CSS bundle');
assert.ok(/Ionicons\.[a-f0-9]+\.ttf/.test(sw), 'sw.js thiếu font Ionicons.ttf');
assert.ok(!sw.includes('/+not-found.html'), 'sw.js không được precache /+not-found.html');
assert.ok(!sw.includes('/_sitemap.html'), 'sw.js không được precache /_sitemap.html');
assert.ok(!sw.includes('MaterialCommunityIcons'), 'sw.js không được precache font thừa');
assert.ok(!sw.includes('.js.map'), 'sw.js không được precache file .map nặng');
assert.ok(!sw.includes('_expo/static/js/android/'), 'sw.js không được precache bundle native android');
assert.ok(!sw.includes('_expo/static/js/ios/'), 'sw.js không được precache bundle native ios');
assert.ok(sw.includes('ignoreSearch: true'), 'sw.js phải hỗ trợ ignoreSearch cho query ?pin=...');
assert.ok(sw.includes('new Response('), 'sw.js phải strip cờ redirected trước khi cache');
assert.ok(sw.includes("cache.put('/',"), 'sw.js phải cache tường minh đường dẫn /');
assert.ok(sw.includes("cache.put('/session',"), 'sw.js phải cache tường minh đường dẫn /session');

console.log('PWA build check OK');
