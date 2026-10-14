const fs = require("node:fs"),
  path = require("node:path");
const manifest = path.resolve(
  __dirname,
  "../src-tauri/gen/android/app/src/main/AndroidManifest.xml",
);
let xml = fs.readFileSync(manifest, "utf8");
if (!xml.includes("android.permission.RECORD_AUDIO"))
  xml = xml.replace(
    "<application",
    '<uses-permission android:name="android.permission.RECORD_AUDIO" />\n    <application',
  );
xml = xml.replace(/android:allowBackup="true"/g, 'android:allowBackup="false"');
fs.writeFileSync(manifest, xml);
console.log(
  "Android microphone permission configured; cloud backup disabled for local credentials.",
);
