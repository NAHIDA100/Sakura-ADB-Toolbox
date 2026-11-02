'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
app.disableHardwareAcceleration(); app.commandLine.appendSwitch('disable-gpu'); app.commandLine.appendSwitch('no-sandbox');
app.whenReady().then(async()=>{ const win=new BrowserWindow({width:1440,height:900,show:false,backgroundColor:'#fbf8ff',webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}}); try { await win.loadURL('http://127.0.0.1:4400/#/apps'); await new Promise(r=>setTimeout(r,8000)); const img=await win.webContents.capturePage(); fs.writeFileSync("D:\\DSHWORKS\\sakura-adb-toolbox\\docs\\screenshots\\web-apps-1440.png",img.toPNG()); console.log('APPS_SHOT_OK'); } catch(e){console.error(e);} app.exit(0); });