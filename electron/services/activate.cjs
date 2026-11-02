'use strict';
const { validateSerial } = require('./command.cjs');

const CATALOG = [
  {
    id: 'shizuku',
    name: 'Shizuku',
    package: 'moe.shizuku.privileged.api',
    method: 'adb',
    methodLabel: 'ADB 命令',
    level: 'oneclick',
    actionLabel: '启动 Shizuku',
    summary: '为其他应用提供受控的 shell 权限，是黑阈、安装狮、FreezeYou 等应用的常用授权方式。',
    steps: [
      '在手机上打开 Shizuku，选择「通过连接电脑启动（使用 adb）」。',
      '开启 USB 调试，保持屏幕解锁并连接本工具。',
      '点击「启动 Shizuku」；工具会自动读取安装路径并执行 libshizuku.so。',
      '看到 Shizuku 显示服务已启动后，再回到目标应用授权。'
    ],
    command: 'adb shell <Shizuku 安装目录>/lib/arm64/libshizuku.so',
    warning: 'Android 11 及以上使用 Shizuku 提供的 libshizuku.so 启动；每次重启后都需要重新执行。'
  },
  {
    id: 'brevent',
    name: '黑阈',
    package: 'me.piebridge.brevent',
    method: 'adb',
    methodLabel: 'ADB 脚本',
    level: 'oneclick',
    actionLabel: '激活黑阈',
    summary: '通过 ADB 启动黑阈服务，用系统权限管理后台应用，不需要 Root。',
    steps: [
      '安装并打开黑阈一次，允许通知与后台运行。',
      '开启 USB 调试，保持屏幕解锁并连接本工具。',
      '点击「激活黑阈」，等待命令执行完成。',
      '如果失败，打开黑阈 →「通过 ADB 激活」生成脚本后再试。'
    ],
    command: 'output=$(pm path me.piebridge.brevent); export CLASSPATH=${output#*:}; app_process /system/bin me.piebridge.brevent.server.BreventServer bootstrap; /system/bin/sh /data/local/tmp/brevent.sh',
    warning: '黑阈服务同样会在重启后失效；需要重新连接 ADB 激活。'
  },
  {
    id: 'greenify',
    name: '绿色守护',
    package: 'com.oasisfeng.greenify',
    method: 'grant',
    methodLabel: '系统授权',
    level: 'oneclick',
    actionLabel: '授予 DUMP 权限',
    summary: '为绿色守护授予 DUMP 权限，用于开启「嗜睡模式」等需要系统级信息的省电功能。',
    steps: [
      '安装并打开绿色守护，进入「嗜睡模式」设置。',
      '连接本工具，点击「授予 DUMP 权限」。',
      '回到绿色守护开启「嗜睡模式」，按应用提示完成剩余设置。'
    ],
    command: 'pm grant com.oasisfeng.greenify android.permission.DUMP',
    warning: 'DUMP 是高级权限，授予后可通过「撤销权限」恢复；只建议授予你信任的应用。'
  },
  {
    id: 'icebox',
    name: '冰箱 IceBox',
    package: 'com.catchingnow.icebox',
    method: 'owner',
    methodLabel: '设备所有者',
    level: 'guide',
    summary: '通过设备所有者权限冻结应用，不需要 Root。',
    steps: [
      '安装并打开冰箱，阅读应用内的设备管理员说明。',
      '退出系统账户、关闭锁屏密码（设备所有者要求）。',
      '连接本工具，在冰箱内选择「设备所有者」激活方式。',
      '激活成功后不要直接卸载冰箱，先在应用内解除管理。'
    ],
    command: 'dpm set-device-owner com.catchingnow.icebox/.receiver.DPMReceiver',
    warning: '设备所有者权限很高，设置后可能无法直接卸载或恢复；请先备份重要数据。'
  },
  {
    id: 'stopapp',
    name: '小黑屋',
    package: 'web1n.stopapp',
    method: 'owner',
    methodLabel: '设备所有者',
    level: 'guide',
    summary: '冻结、隐藏应用，支持免 Root 的设备所有者模式。',
    steps: [
      '安装并打开小黑屋，选择「设备所有者」激活方式。',
      '退出系统账户并关闭锁屏密码，确保没有其他设备管理员。',
      '按应用内引导完成设备所有者设置。',
      '设置完成后不要直接卸载小黑屋。'
    ],
    warning: '设备所有者模式会影响系统账户与卸载流程，请先阅读应用内说明。'
  },
  {
    id: 'airfrozen',
    name: 'AirFrozen',
    package: 'me.yourbay.airfrozen',
    method: 'owner',
    methodLabel: '设备管理员',
    level: 'guide',
    summary: '冻结不常用应用，减少后台唤醒。',
    steps: [
      '安装并打开 AirFrozen。',
      '按应用内提示启用设备管理员；部分版本需要 Root。',
      '如果应用只提供 Root 模式，请改用 Shizuku 或设备所有者方案。'
    ],
    warning: '不同版本的 AirFrozen 激活方式可能不同，请以应用内说明为准。'
  },
  {
    id: 'freezeyou',
    name: 'FreezeYou',
    package: 'cf.playhi.freezeyou',
    method: 'owner',
    methodLabel: '设备所有者 / Shizuku',
    level: 'guide',
    summary: '轻量级应用冻结工具，支持设备所有者或 Shizuku 授权。',
    steps: [
      '安装并打开 FreezeYou。',
      '在设置中选择「设备所有者」或「Shizuku」模式。',
      '按应用内引导完成授权；Shizuku 模式需要先启动 Shizuku。'
    ],
    warning: '设备所有者模式要求设备没有账户和锁屏密码。'
  },
  {
    id: 'installer',
    name: '安装狮',
    package: 'com.modosa.apkinstaller',
    method: 'owner',
    methodLabel: 'Shizuku / 设备所有者',
    level: 'guide',
    summary: '替代系统安装器，支持静默安装、指定安装器等高级功能。',
    steps: [
      '安装并打开安装狮，允许「安装未知应用」。',
      '在应用内选择 Shizuku 或设备所有者授权方式。',
      '按应用内引导完成设置；Shizuku 模式需要先启动 Shizuku。'
    ],
    warning: '静默安装会跳过系统确认，请只安装可信来源的 APK。'
  },
  {
    id: 'island',
    name: '炼妖壶',
    package: 'com.oasisfeng.island',
    method: 'owner',
    methodLabel: '工作资料 / 设备所有者',
    level: 'guide',
    summary: '创建隔离的工作资料空间，冻结或克隆应用。',
    steps: [
      '安装并打开炼妖壶，阅读工作资料说明。',
      '退出系统账户并关闭锁屏密码。',
      '按应用内引导设置工作资料或设备所有者。',
      '已有工作资料 / 分身用户时可能无法重复设置。'
    ],
    command: 'dpm set-profile-owner --user 0 com.oasisfeng.island/.IslandDeviceAdminReceiver',
    warning: '工作资料会创建独立用户空间；设置前请确认没有重要的工作资料。'
  },
  {
    id: 'blackhole',
    name: '黑洞隐藏',
    package: 'com.hld.apurikakusu',
    method: 'owner',
    methodLabel: '设备管理员',
    level: 'guide',
    summary: '隐藏、冻结应用，保护隐私并减少后台耗电。',
    steps: [
      '安装并打开黑洞，选择「设备管理员」模式。',
      '按应用内引导启用设备管理员。',
      '如果应用提示需要设备所有者，请先退出所有账户。'
    ],
    warning: '隐藏应用可能影响桌面图标与通知，请先阅读应用内说明。'
  },
  {
    id: 'twospace',
    name: '第二空间',
    package: 'com.heyy.messenger.launch',
    method: 'owner',
    methodLabel: '设备所有者',
    level: 'guide',
    summary: '创建独立的应用分身空间，隔离工作与生活数据。',
    steps: [
      '安装并打开第二空间。',
      '按应用内引导创建设备所有者或工作资料。',
      '已有分身用户 / 工作资料时可能无法重复创建。'
    ],
    warning: '分身空间会占用额外存储；删除空间会清除其中的应用数据。'
  }
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class ActivateService {
  constructor(options) {
    this.runner = options.runner;
    this.getTools = options.getTools;
    this.log = options.log;
  }

  adb(serial, args, timeoutMs = 30000) {
    return this.runner.run(this.getTools().adbPath, ['-s', serial, ...args], { timeoutMs, maxBytes: 8 * 1024 * 1024 });
  }

  async installedPackages(serial) {
    const result = await this.adb(serial, ['shell', 'pm', 'list', 'packages'], 30000);
    const set = new Set();
    for (const line of String(result.stdout || '').split(/\r?\n/)) {
      const match = /^package:(\S+)/.exec(line.trim());
      if (match) set.add(match[1]);
    }
    return set;
  }

  async list(serial) {
    const target = validateSerial(serial);
    const tools = this.getTools();
    if (!tools.adbPath) throw new Error('未找到 adb');
    const [installed, owners, processes, accounts, greenifyDump, sdkProp] = await Promise.all([
      this.installedPackages(target),
      this.adb(target, ['shell', 'dpm', 'list-owners'], 15000).catch(() => ({ stdout: '' })),
      this.adb(target, ['shell', 'ps', '-A'], 15000).catch(() => ({ stdout: '' })),
      this.adb(target, ['shell', 'dumpsys', 'account'], 15000).catch(() => ({ stdout: '' })),
      this.adb(target, ['shell', 'dumpsys', 'package', 'com.oasisfeng.greenify'], 15000).catch(() => ({ stdout: '' })),
      this.adb(target, ['shell', 'getprop', 'ro.build.version.sdk'], 10000).catch(() => ({ stdout: '' }))
    ]);
    const ownerText = String(owners.stdout || '');
    const ownerMatch = /ComponentInfo\{([^/}]+)/.exec(ownerText);
    const owner = ownerMatch ? ownerMatch[1] : '';
    const ps = String(processes.stdout || '');
    const accountCount = (String(accounts.stdout || '').match(/Account \{/g) || []).length;
    const sdk = Number(String(sdkProp.stdout || '').trim()) || 0;
    const apps = CATALOG.map((app) => {
      const isInstalled = installed.has(app.package);
      let active = false;
      if (isInstalled) {
        if (app.id === 'shizuku') active = /shizuku_server/.test(ps);
        else if (app.id === 'brevent') active = /brevent_server|brevent_daemon/.test(ps);
        else if (app.id === 'greenify') active = /android\.permission\.DUMP: granted=true/.test(String(greenifyDump.stdout || ''));
        else active = owner === app.package;
      }
      return { ...app, installed: isInstalled, active };
    });
    return { serial: target, sdk, owner, accounts: accountCount, apps };
  }

  async ensureInstalled(serial, app) {
    const result = await this.adb(serial, ['shell', 'pm', 'list', 'packages', app.package], 15000);
    if (!String(result.stdout || '').includes('package:' + app.package)) {
      throw new Error(app.name + ' 尚未安装');
    }
  }

  async run(serial, id) {
    const target = validateSerial(serial);
    const app = CATALOG.find((item) => item.id === id);
    if (!app) throw new Error('未知的激活项目');
    await this.ensureInstalled(target, app);
    if (app.id === 'shizuku') return this.startShizuku(target, app);
    if (app.id === 'brevent') return this.startBrevent(target, app);
    if (app.id === 'greenify') return this.grantGreenify(target, app);
    throw new Error('该应用需要设备所有者，安全模式不会自动执行。请按「查看步骤」手动设置。');
  }

  async startShizuku(serial, app) {
    const paths = await this.adb(serial, ['shell', 'pm', 'path', 'moe.shizuku.privileged.api'], 15000);
    const line = String(paths.stdout || '').split(/\r?\n/).map((item) => item.trim()).find((item) => item.startsWith('package:'));
    if (!line) throw new Error('无法获取 Shizuku 安装路径，请确认已安装 Shizuku');
    const apk = line.slice('package:'.length);
    const slash = apk.lastIndexOf('/');
    if (slash <= 0) throw new Error('Shizuku 安装路径异常');
    const baseDir = apk.slice(0, slash);
    const abiResult = await this.adb(serial, ['shell', 'getprop', 'ro.product.cpu.abi'], 10000).catch(() => ({ stdout: '' }));
    const abi = String(abiResult.stdout || '').trim();
    const libDirs = [];
    if (abi.includes('arm64')) libDirs.push('arm64');
    else if (abi.includes('armeabi') || abi === 'arm') libDirs.push('arm');
    else if (abi.includes('x86_64')) libDirs.push('x86_64');
    else if (abi.includes('x86')) libDirs.push('x86');
    for (const fallback of ['arm64', 'arm']) if (!libDirs.includes(fallback)) libDirs.push(fallback);

    let command = null;
    for (const libDir of libDirs) {
      const candidate = baseDir + '/lib/' + libDir + '/libshizuku.so';
      const check = await this.adb(serial, ['shell', 'test', '-f', candidate], 10000);
      if (check.code === 0) { command = { args: ['shell', candidate], label: candidate }; break; }
    }
    if (!command) {
      const script = '/sdcard/Android/data/moe.shizuku.privileged.api/start.sh';
      const check = await this.adb(serial, ['shell', 'test', '-f', script], 10000);
      if (check.code === 0) command = { args: ['shell', 'sh', script], label: script };
    }
    if (!command) throw new Error('未找到 libshizuku.so 或 start.sh，请更新 Shizuku 后重试');

    this.log.add({ level: 'info', source: 'activate', message: '启动 Shizuku · ' + serial + ' · ' + command.label });
    const result = await this.adb(serial, command.args, 45000);
    await sleep(2200);
    const ps = await this.adb(serial, ['shell', 'ps', '-A'], 15000).catch(() => ({ stdout: '' }));
    const active = /shizuku_server/.test(String(ps.stdout || ''));
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    if (result.code !== 0 || !active) {
      const failure = new Error(active ? 'Shizuku 启动命令失败' : '未检测到 Shizuku 服务，请查看手机通知或 Shizuku 日志');
      failure.detail = output;
      throw failure;
    }
    this.log.add({ level: 'success', source: 'activate', message: 'Shizuku 已启动 · ' + serial });
    return { ok: true, active: true, output: output || 'Shizuku 服务已启动' };
  }

  async startBrevent(serial, app) {
    const command = 'output=$(pm path me.piebridge.brevent); export CLASSPATH=${output#*:}; app_process /system/bin me.piebridge.brevent.server.BreventServer bootstrap; /system/bin/sh /data/local/tmp/brevent.sh';
    this.log.add({ level: 'info', source: 'activate', message: '激活黑阈 · ' + serial });
    const result = await this.adb(serial, ['shell', command], 90000);
    await sleep(1800);
    const ps = await this.adb(serial, ['shell', 'ps', '-A'], 15000).catch(() => ({ stdout: '' }));
    const active = /brevent_server|brevent_daemon/.test(String(ps.stdout || ''));
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    if (result.code !== 0 || !active) {
      const failure = new Error(active ? '黑阈激活命令失败' : '未检测到黑阈服务，请在黑阈内使用「通过 ADB 激活」生成脚本后再试');
      failure.detail = output;
      throw failure;
    }
    this.log.add({ level: 'success', source: 'activate', message: '黑阈已激活 · ' + serial });
    return { ok: true, active: true, output: output || '黑阈服务已启动' };
  }

  async grantGreenify(serial, app) {
    const result = await this.adb(serial, ['shell', 'pm', 'grant', 'com.oasisfeng.greenify', 'android.permission.DUMP'], 30000);
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    if (result.code !== 0) {
      const failure = new Error('授予 DUMP 权限失败');
      failure.detail = output;
      throw failure;
    }
    this.log.add({ level: 'success', source: 'activate', message: '已授予绿色守护 DUMP 权限 · ' + serial });
    return { ok: true, active: true, output: output || '已授予 DUMP 权限' };
  }

  async open(serial, id) {
    const target = validateSerial(serial);
    const app = CATALOG.find((item) => item.id === id);
    if (!app) throw new Error('未知的激活项目');
    await this.ensureInstalled(target, app);
    const result = await this.adb(target, ['shell', 'monkey', '-p', app.package, '-c', 'android.intent.category.LAUNCHER', '1'], 25000);
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    if (result.code !== 0) {
      const failure = new Error('打开应用失败');
      failure.detail = output;
      throw failure;
    }
    return { ok: true, output };
  }

  async openAccounts(serial) {
    const target = validateSerial(serial);
    const result = await this.adb(target, ['shell', 'am', 'start', '-a', 'android.settings.SYNC_SETTINGS'], 20000);
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    if (result.code !== 0) {
      const failure = new Error('无法打开账户设置');
      failure.detail = output;
      throw failure;
    }
    return { ok: true, output };
  }
}

module.exports = { ActivateService, ACTIVATE_CATALOG: CATALOG };