'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('no-sandbox');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1440, height: 900, show: false, backgroundColor: '#fbf8ff', webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.webContents.on('console-message', (...args) => console.error('WEB_CONSOLE', JSON.stringify(args.slice(1))));
  try {
    await win.loadURL('http://127.0.0.1:4400/');
    await new Promise((r) => setTimeout(r, 5000));
    const image = await win.webContents.capturePage();
    fs.writeFileSync("D:\\DSHWORKS\\sakura-adb-toolbox\\docs\\screenshots\\web-mode-1440.png", image.toPNG());
    console.log('WEB_SHOT_OK');
  } catch (error) { console.error('WEB_SHOT_FAIL', error); }
  app.exit(0);
});
