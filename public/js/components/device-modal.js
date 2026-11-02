import { openModal } from './modal.js';
import { toast, toastError } from './toast.js';
import { icon } from '../icons.js';
import { state } from '../store.js';
import { api } from '../api.js';

export function openAddDeviceModal(options = {}) {
  const content =
    '<div class="callout">' + icon('usb') + '<div><strong>USB 调试</strong><br>在手机上开启开发者选项 → USB 调试，连接数据线后点击“刷新设备”，并在弹窗中允许授权。</div></div>' +
    '<div class="divider"></div>' +
    '<div class="form-grid">' +
      '<div class="wireless-card">' +
        '<h3>无线连接</h3><p>先在同一 Wi-Fi 下通过 USB 执行一次 adb tcpip 5555，或使用 Android 11+ 无线调试。</p>' +
        '<div class="input-row"><input class="input" data-wifi-host placeholder="192.168.1.8" autocomplete="off"><input class="input" data-wifi-port placeholder="5555" value="5555" inputmode="numeric" style="max-width:80px"></div>' +
        '<button class="btn btn--primary btn--wide btn--sm" type="button" data-connect style="margin-top:7px">' + icon('wifi') + '连接设备</button>' +
      '</div>' +
      '<div class="wireless-card">' +
        '<h3>无线调试配对</h3><p>从手机“无线调试 → 使用配对码配对设备”获取 IP、端口和 6 位配对码。</p>' +
        '<div class="input-row"><input class="input" data-pair-host placeholder="192.168.1.8" autocomplete="off"><input class="input" data-pair-port placeholder="37123" inputmode="numeric" style="max-width:80px"></div>' +
        '<div class="input-row" style="margin-top:5px"><input class="input" data-pair-code placeholder="6 位配对码" inputmode="numeric" maxlength="6"><button class="btn btn--soft btn--sm" type="button" data-pair>配对</button></div>' +
      '</div>' +
    '</div>' +
    '<div class="divider"></div>' +
    '<div class="callout callout--warn">' + icon('alert') + '<div>仍看不到设备？请检查数据线、USB 驱动，或尝试重启 ADB 服务。</div></div>';

  const modal = openModal({
    title: '添加或连接设备',
    subtitle: '支持 USB、无线 ADB 与无线调试配对',
    icon: 'plug',
    width: 650,
    content,
    footer:
      '<button class="btn btn--ghost" type="button" data-close>关闭</button>' +
      '<button class="btn btn--primary" type="button" data-refresh>刷新设备</button>',
    onMount: ({ root, close }) => {
      const host = root.querySelector('[data-wifi-host]');
      const port = root.querySelector('[data-wifi-port]');
      const pairHost = root.querySelector('[data-pair-host]');
      const pairPort = root.querySelector('[data-pair-port]');
      const pairCode = root.querySelector('[data-pair-code]');

      root.querySelector('[data-close]').addEventListener('click', close);
      root.querySelector('[data-refresh]').addEventListener('click', () => {
        if (typeof options.onRefresh === 'function') options.onRefresh();
        toast('正在刷新设备列表', 'info');
        close();
      });

      root.querySelector('[data-connect]').addEventListener('click', async (event) => {
        if (state.demo) {
          toast('演示模式不会建立真实连接', 'info');
          return;
        }
        const button = event.currentTarget;
        button.classList.add('is-loading');
        try {
          const result = await api.devices.connect(host.value.trim(), port.value.trim());
          toast('无线连接成功', 'success', result.address);
          if (typeof options.onConnected === 'function') await options.onConnected();
          close();
        } catch (error) {
          toastError(error);
        } finally {
          button.classList.remove('is-loading');
        }
      });

      root.querySelector('[data-pair]').addEventListener('click', async (event) => {
        if (state.demo) {
          toast('演示模式不会建立真实配对', 'info');
          return;
        }
        const button = event.currentTarget;
        button.classList.add('is-loading');
        try {
          const result = await api.devices.pair(pairHost.value.trim(), pairPort.value.trim(), pairCode.value.trim());
          toast('配对成功，可以连接了', 'success', result.address);
          if (typeof options.onConnected === 'function') await options.onConnected();
        } catch (error) {
          toastError(error);
        } finally {
          button.classList.remove('is-loading');
        }
      });
    }
  });
  return modal;
}
