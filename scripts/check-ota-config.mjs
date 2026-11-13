// Kiểm tra đồng bộ cấu hình expo-updates giữa app.json và native Android
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const appJson = JSON.parse(fs.readFileSync(path.resolve('app.json'), 'utf8')).expo;
const stringsXml = fs.readFileSync(
  path.resolve('android/app/src/main/res/values/strings.xml'),
  'utf8'
);
const manifestXml = fs.readFileSync(
  path.resolve('android/app/src/main/AndroidManifest.xml'),
  'utf8'
);

const runtimeMatch = stringsXml.match(/<string name="expo_runtime_version">([^<]+)<\/string>/);
assert.ok(runtimeMatch, 'Thiếu expo_runtime_version trong strings.xml');
const androidRuntime = runtimeMatch[1].trim();

const appRuntime =
  typeof appJson.runtimeVersion === 'string'
    ? appJson.runtimeVersion
    : appJson.runtimeVersion?.policy === 'appVersion'
      ? appJson.version
      : null;

assert.ok(appRuntime, 'app.json thiếu runtimeVersion hợp lệ');
assert.equal(
  appRuntime,
  androidRuntime,
  `Lệch runtimeVersion: app.json="${appRuntime}" khác Android strings.xml="${androidRuntime}"`
);

assert.ok(
  manifestXml.includes('android:name="expo.modules.updates.ENABLED" android:value="true"'),
  'AndroidManifest.xml chưa bật expo.modules.updates.ENABLED'
);
assert.ok(
  manifestXml.includes(`android:value="${appJson.updates?.url}"`),
  'AndroidManifest.xml EXPO_UPDATE_URL không khớp app.json updates.url'
);
assert.ok(
  manifestXml.includes('expo-channel-name') && manifestXml.includes('main'),
  'AndroidManifest.xml thiếu expo-channel-name=main'
);

console.log(`OTA config check OK (runtimeVersion=${appRuntime})`);
