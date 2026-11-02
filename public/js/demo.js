export function isDemoMode() {
  try {
    return new URLSearchParams(window.location.search).get('demo') === '1';
  } catch {
    return false;
  }
}

const thirdParty = [
  { package: 'com.tencent.mm', label: '微信', apkPath: '/data/app/~~a1/base.apk', system: false },
  { package: 'com.spotify.music', label: 'Spotify', apkPath: '/data/app/~~b2/base.apk', system: false },
  { package: 'com.google.android.youtube', label: 'YouTube', apkPath: '/data/app/~~c3/base.apk', system: false },
  { package: 'com.instagram.android', label: 'Instagram', apkPath: '/data/app/~~d4/base.apk', system: false },
  { package: 'com.discord', label: 'Discord', apkPath: '/data/app/~~e5/base.apk', system: false },
  { package: 'com.netflix.mediaclient', label: 'Netflix', apkPath: '/data/app/~~f6/base.apk', system: false },
  { package: 'com.valvesoftware.android.steam.community', label: 'Steam', apkPath: '/data/app/~~g7/base.apk', system: false },
  { package: 'com.google.android.apps.photos', label: '相册', apkPath: '/data/app/~~h8/base.apk', system: false },
  { package: 'com.zhiliaoapp.musically', label: 'TikTok', apkPath: '/data/app/~~i9/base.apk', system: false },
  { package: 'org.telegram.messenger', label: 'Telegram', apkPath: '/data/app/~~j0/base.apk', system: false },
  { package: 'com.Slack', label: 'Slack', apkPath: '/data/app/~~k1/base.apk', system: false },
  { package: 'com.google.android.gm', label: 'Gmail', apkPath: '/data/app/~~l2/base.apk', system: false },
  { package: 'com.google.android.apps.maps', label: 'Google 地图', apkPath: '/data/app/~~m3/base.apk', system: false },
  { package: 'com.google.android.apps.docs', label: 'Drive', apkPath: '/data/app/~~n4/base.apk', system: false },
  { package: 'com.android.chrome', label: 'Chrome', apkPath: '/data/app/~~o5/base.apk', system: false },
  { package: 'com.google.android.GoogleCamera', label: '相机', apkPath: '/data/app/~~p6/base.apk', system: false }
];

const systemApps = [
  { package: 'com.android.settings', label: '设置', apkPath: '/system_ext/priv-app/Settings/Settings.apk', system: true },
  { package: 'com.google.android.gms', label: 'Google Play 服务', apkPath: '/system/priv-app/GmsCore/GmsCore.apk', system: true },
  { package: 'com.android.systemui', label: '系统界面', apkPath: '/system_ext/priv-app/SystemUI/SystemUI.apk', system: true },
  { package: 'com.google.android.vending', label: 'Google Play 商店', apkPath: '/system/priv-app/Phonesky/Phonesky.apk', system: true },
  { package: 'com.android.phone', label: '电话', apkPath: '/system/priv-app/Telephony/Telephony.apk', system: true },
  { package: 'com.google.android.dialer', label: '拨号', apkPath: '/system/priv-app/Dialer/Dialer.apk', system: true },
  { package: 'com.android.deskclock', label: '时钟', apkPath: '/system/priv-app/DeskClock/DeskClock.apk', system: true },
  { package: 'com.google.android.apps.nexuslauncher', label: 'Pixel 启动器', apkPath: '/system/priv-app/NexusLauncher/NexusLauncher.apk', system: true }
];

function demoPackages(filter) {
  if (filter === 'system') return systemApps.slice();
  if (filter === 'all') return [...thirdParty, ...systemApps].sort((a, b) => a.package.localeCompare(b.package));
  return thirdParty.slice();
}

function logItem(id, level, source, message, ago) {
  return {
    id,
    ts: new Date(Date.now() - ago * 1000).toISOString(),
    level,
    source,
    message
  };
}

export function seedDemoState() {
  const adb = [
    {
      serial: '2B171FDH2000',
      state: 'device',
      model: 'Pixel 8 Pro',
      product: 'husky',
      device: 'husky',
      transportId: '3',
      raw: '2B171FDH2000 device product:husky model:Pixel_8_Pro device:husky transport_id:3'
    },
    {
      serial: 'R5CN30K9L8P',
      state: 'offline',
      model: 'Galaxy S24',
      product: 'eureka',
      device: 'eureka',
      transportId: '5',
      raw: 'R5CN30K9L8P offline product:eureka model:Galaxy_S24'
    },
    {
      serial: '9BQDY4M7XK',
      state: 'unauthorized',
      model: 'Redmi Note 12',
      product: 'tapas',
      device: 'tapas',
      transportId: '7',
      raw: '9BQDY4M7XK unauthorized product:tapas model:Redmi_Note_12'
    }
  ];
  const fastboot = [{ serial: 'FAST8PRO001', state: 'fastboot' }];
  const metrics = {
    cpuPercent: 45,
    memTotalKb: 12 * 1024 * 1024,
    memUsedKb: 6.2 * 1024 * 1024,
    storageTotalKb: 256 * 1024 * 1024,
    storageUsedKb: 128 * 1024 * 1024,
    batteryPercent: 86,
    temperatureC: 38.5,
    capturedAt: new Date().toISOString()
  };
  return {
    health: {
      appVersion: '1.0.0',
      platform: 'win32',
      arch: 'x64',
      dataDir: 'C:\\Users\\28616\\AppData\\Roaming\\Sakura ADB Toolbox',
      tools: {
        adbPath: 'D:\\Android\\Sdk\\platform-tools\\adb.exe',
        fastbootPath: 'D:\\Android\\Sdk\\platform-tools\\fastboot.exe',
        adbFound: true,
        fastbootFound: true,
        platform: 'win32'
      },
      adb: {
        found: true,
        path: 'D:\\Android\\Sdk\\platform-tools\\adb.exe',
        version: 'Android Debug Bridge version 1.0.41 (Version 35.0.2-12147458)'
      },
      fastboot: {
        found: true,
        path: 'D:\\Android\\Sdk\\platform-tools\\fastboot.exe',
        version: 'fastboot version 35.0.2-12147458'
      }
    },
    settings: {
      adbPath: '',
      fastbootPath: '',
      reducedMotion: false
    },
    tools: {
      adbPath: 'D:\\Android\\Sdk\\platform-tools\\adb.exe',
      fastbootPath: 'D:\\Android\\Sdk\\platform-tools\\fastboot.exe',
      adbFound: true,
      fastbootFound: true,
      platform: 'win32'
    },
    devices: { adb, fastboot, errors: [], checkedAt: new Date().toISOString() },
    activeAdbSerial: adb[0].serial,
    activeFastbootSerial: fastboot[0].serial,
    metrics,
    history: {
      cpu: [42, 46, 44, 49, 47, 51, 46, 45, 48, 45],
      mem: [50, 51, 50.4, 51.6, 51.1, 50.8, 51.3, 51.6, 51.2, 51.6],
      temp: [37.1, 37.4, 37.7, 38.1, 38.3, 38.4, 38.3, 38.5, 38.5, 38.5],
      storage: [50]
    },
    logs: [
      logItem(1, 'info', 'adb', 'daemon started successfully', 82),
      logItem(2, 'info', 'adb', 'List of devices attached', 76),
      logItem(3, 'success', 'device', '2B171FDH2000 · device', 70),
      logItem(4, 'info', 'apps', '读取应用列表 · 2B171FDH2000', 65),
      logItem(5, 'success', 'apps', '应用列表已更新 · 8 个第三方应用', 60),
      logItem(6, 'info', 'terminal', 'adb shell dumpsys battery', 54),
      logItem(7, 'info', 'screenshot', '正在截取设备屏幕 · 2B171FDH2000', 48),
      logItem(8, 'success', 'screenshot', '截图已保存到本地', 44),
      logItem(9, 'info', 'device', '重新枚举 USB 设备', 39),
      logItem(10, 'success', 'device', '设备已就绪 · Pixel 8 Pro', 35),
      logItem(11, 'info', 'terminal', 'adb devices -l', 30),
      logItem(12, 'success', 'terminal', '终端命令完成 · exit 0', 27),
      logItem(13, 'info', 'system', '读取设备性能采样', 23),
      logItem(14, 'info', 'adb', 'daemon started successfully', 19),
      logItem(15, 'success', 'device', '2B171FDH2000 · device', 15),
      logItem(16, 'info', 'system', '设备性能监控已就绪', 11),
      logItem(17, 'info', 'adb', 'List of devices attached', 8),
      logItem(18, 'info', 'screenshot', '准备下一次屏幕捕获', 5),
      logItem(19, 'info', 'system', '正在同步设备状态', 3),
      logItem(20, 'success', 'system', 'Sakura ADB Toolbox 已就绪', 1)
    ],
    apps: {
      serial: adb[0].serial,
      filter: 'third',
      packages: demoPackages('third'),
      count: thirdParty.length,
      checkedAt: new Date().toISOString()
    }
  };
}

export function demoApps(filter = 'third') {
  const packages = demoPackages(filter);
  return {
    serial: '2B171FDH2000',
    filter,
    packages,
    count: packages.length,
    checkedAt: new Date().toISOString()
  };
}
