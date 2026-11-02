import { openModal } from './modal.js';
import { toast, toastError } from './toast.js';
import { icon } from '../icons.js';
import { esc } from '../dom.js';

export function runTaskModal(options = {}) {
  let logNode = null;
  let statusNode = null;
  let finished = false;

  const content =
    '<div class="task-console" style="min-height:280px">' +
      '<div class="task-console__head"><span class="task-console__lights"><i></i><i></i><i></i></span><span class="task-console__title">' + esc(options.consoleTitle || 'sakura-task') + '</span><span class="task-console__status" data-task-status>准备中</span></div>' +
      '<div class="task-console__body" data-task-log><div class="task-line task-line--muted">等待任务开始…</div></div>' +
    '</div>';

  const modal = openModal({
    title: options.title || '正在执行',
    subtitle: options.subtitle || '',
    icon: options.icon || 'sparkles',
    width: options.width || 720,
    content,
    footer: '<button class="btn btn--ghost" type="button" data-task-close>关闭</button>',
    onMount: ({ root, close }) => {
      logNode = root.querySelector('[data-task-log]');
      statusNode = root.querySelector('[data-task-status]');
      const closeButton = root.querySelector('[data-task-close]');
      if (closeButton) closeButton.addEventListener('click', close);

      const scroll = () => {
        if (logNode) logNode.scrollTop = logNode.scrollHeight;
      };
      const append = (text, type = '') => {
        if (!logNode || !text) return;
        if (logNode.querySelector('.task-line--muted') && logNode.children.length === 1) logNode.innerHTML = '';
        const line = document.createElement('div');
        line.className = 'task-line' + (type ? ' task-line--' + type : '');
        line.textContent = text;
        logNode.appendChild(line);
        while (logNode.children.length > 500) logNode.firstElementChild.remove();
        scroll();
      };
      const setStatus = (text, tone = '') => {
        if (!statusNode) return;
        statusNode.textContent = text;
        statusNode.style.color = tone === 'error' ? '#ff9eb4' : tone === 'success' ? '#6be0b3' : '';
      };

      const handlers = {
        onCancelled() {
          setStatus('已取消');
          toast('操作已取消', 'info');
          close();
        },
        onStage(label) {
          append('◆ ' + label, 'stage');
          setStatus('执行中');
        },
        onLine(line, stream) {
          append(line, stream === 'stderr' ? 'stderr' : '');
        },
        onStarted(data) {
          if (data && data.savePath) append('目标文件：' + data.savePath, 'muted');
          setStatus('执行中');
        },
        onError(event) {
          append('错误：' + (event && event.message ? event.message : '未知错误'), 'stderr');
          setStatus('失败', 'error');
        },
        onDone(result, error) {
          finished = true;
          if (error) {
            setStatus('失败', 'error');
            toast(error.message || '操作失败', 'error', error.detail || '');
          } else {
            setStatus('已完成', 'success');
            append('✓ ' + (options.successMessage || '操作完成'), 'success');
            toast(options.successMessage || '操作完成', 'success');
            if (typeof options.onComplete === 'function') {
              try { options.onComplete(result); } catch (err) { console.error(err); }
            }
          }
        }
      };

      let task;
      try {
        task = options.start(handlers);
      } catch (error) {
        setStatus('失败', 'error');
        append(String(error.message || error), 'stderr');
        toastError(error);
      }
      if (task && task.promise && typeof task.promise.catch === 'function') {
        task.promise.catch(() => {});
      }
    }
  });
  return modal;
}
