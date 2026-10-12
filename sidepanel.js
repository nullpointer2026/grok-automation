// ============ Grok Automation Side Panel ============
const APP_VERSION = '1.1.0';

const state = {
  mode: 'text2video',
  running: false,
  queue: [],
  settings: {},
  logs: [],
  failedPrompts: []
};

document.addEventListener('DOMContentLoaded', async () => {
  updateVersionLabel();
  await loadSettings();
  bindEvents();
  refreshQueueFromInput();
  log('插件已就绪 ✓');
});

function updateVersionLabel() {
  const versionEl = document.getElementById('appVersion');
  if (versionEl) {
    versionEl.textContent = 'v' + APP_VERSION;
  }
}

// ============ 标签页切换 ============
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.tab).classList.add('active');
  });
});

// ============ 模式切换 ============
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.mode = btn.dataset.mode;
  });
});

// ============ 事件绑定 ============
function bindEvents() {
  document.getElementById('runBtn').addEventListener('click', startBatch);
  document.getElementById('stopBtn').addEventListener('click', stopBatch);
  document.getElementById('saveSettings').addEventListener('click', saveSettings);
  document.getElementById('probeBtn').addEventListener('click', testConnection);
  document.getElementById('clearLogs').addEventListener('click', function() {
    document.getElementById('logContainer').innerHTML = '';
    state.logs = [];
    state.failedPrompts = [];
  });
  document.getElementById('exportLogs').addEventListener('click', exportLogs);

  const promptInput = document.getElementById('prompts');
  promptInput.addEventListener('input', refreshQueueFromInput);

  document.getElementById('txtUpload').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(ev) {
      document.getElementById('prompts').value = ev.target.result;
      refreshQueueFromInput();
    };
    reader.readAsText(file);
  });

  // 并发数边界检查
  const concurrentInput = document.getElementById('concurrent');
  concurrentInput.addEventListener('change', function() {
    let v = parseInt(concurrentInput.value) || 1;
    if (v < 1) v = 1;
    if (v > 20) v = 20;
    concurrentInput.value = v;
  });

  // 文件夹名预览
  const folderInput = document.getElementById('folder');
  const appendDateCheckbox = document.getElementById('appendDate');

  function updateFolderPreview() {
    const baseName = folderInput.value || 'Grok-grok-folder';
    const fullName = appendDateCheckbox.checked ? baseName + getTodayDate() : baseName;
    document.getElementById('folderPreview').textContent = '📁 实际保存到：下载/' + fullName + '/';
  }

  folderInput.addEventListener('input', updateFolderPreview);
  appendDateCheckbox.addEventListener('change', updateFolderPreview);
  updateFolderPreview();
}

// ============ 测试连接 ============
async function testConnection() {
  log('🔍 测试连接...');
  const res = await sendToContent({ action: 'probe' });
  if (res && res.ok) {
    log('✓ 连接成功！页面信息:');
    log('  输入框: ' + (res.info.hasEditor ? '✓ 找到' : '❌ 未找到'));
    if (res.info.editorClass) {
      log('    class: ' + res.info.editorClass);
    }
    log('  发送按钮: ' + (res.info.hasSendBtn ? '✓ 找到' : '❌ 未找到'));
    if (res.info.sendBtnAria) {
      log('    aria: ' + res.info.sendBtnAria);
    }
    log('  按钮禁用: ' + res.info.sendBtnDisabled);
    log('  当前视频数: ' + res.info.videoCount);
    log('  当前图片数: ' + (res.info.imageCount || 0));
  } else {
    const err = res && res.error ? res.error : '未知错误';
    log('❌ 连接失败: ' + err);
  }
}

// ============ 提示词解析 ============
function parsePrompts(text) {
  return (text || '')
    .split(/\r?\n/)
    .map(function(p) { return p.trim(); })
    .filter(Boolean);
}

function createQueue(prompts) {
  return prompts.map(function(p, i) {
    return { id: i + 1, prompt: p, status: 'waiting', progress: 0 };
  });
}

function refreshQueueFromInput() {
  if (state.running) return;
  const promptInput = document.getElementById('prompts');
  if (!promptInput) return;
  state.queue = createQueue(parsePrompts(promptInput.value));
  renderQueue();
}

// ============ 设置 ============
async function loadSettings() {
  const data = await chrome.storage.local.get('settings');
  state.settings = data.settings || {};
  if (state.settings.videoDuration) {
    document.getElementById('videoDuration').value = state.settings.videoDuration;
  }
  if (state.settings.aspectRatio) {
    document.getElementById('aspectRatio').value = state.settings.aspectRatio;
  }
  if (state.settings.maxRetries) {
    document.getElementById('maxRetries').value = state.settings.maxRetries;
  }
  if (state.settings.videoQuality) {
    document.getElementById('videoQuality').value = state.settings.videoQuality;
  }
}

async function saveSettings() {
  state.settings = {
    videoDuration: document.getElementById('videoDuration').value,
    aspectRatio: document.getElementById('aspectRatio').value,
    maxRetries: parseInt(document.getElementById('maxRetries').value),
    videoQuality: document.getElementById('videoQuality').value
  };
  await chrome.storage.local.set({ settings: state.settings });
  log('✓ 设置已保存');
}

// ============ 批量处理（支持并发） ============
async function startBatch() {
  if (state.running) return;

  const text = document.getElementById('prompts').value;
  const prompts = parsePrompts(text);
  if (prompts.length === 0) {
    alert('请输入提示词');
    return;
  }

  state.queue = createQueue(prompts);

  renderQueue();
  state.running = true;
  state.failedPrompts = [];
  log('🚀 开始处理 ' + prompts.length + ' 条提示词');

  const delayMin = parseInt(document.getElementById('delayMin').value) || 0;
  const delayMax = parseInt(document.getElementById('delayMax').value) || 0;

  // 读取并发数（限制 1-20）
  let concurrent = parseInt(document.getElementById('concurrent').value) || 1;
  if (concurrent < 1) concurrent = 1;
  if (concurrent > 20) concurrent = 20;
  // 不超过任务总数
  if (concurrent > prompts.length) concurrent = prompts.length;

  let warning = '';
  if (concurrent > 3) warning = '（⚠️ 高并发可能触发 Grok 限流）';
  log('⚙️ 并发数：' + concurrent + warning);

  // 计算保存文件夹（自动加日期）
  let folder = document.getElementById('folder').value || 'Grok-grok-folder';
  if (document.getElementById('appendDate').checked) {
    folder = folder + getTodayDate();
  }
  log('📁 文件将保存到「下载/' + folder + '/」');

  // 共享的索引计数器
  let nextIndex = 0;
  const total = state.queue.length;

  // 单个 worker：不断从队列取下一条处理
  async function worker(workerId) {
    while (state.running) {
      const myIndex = nextIndex++;
      if (myIndex >= total) break;

      const item = state.queue[myIndex];
      item.status = 'running';
      renderQueue();
      log('▶ [' + item.id + '] (worker' + workerId + ') 提交: ' + item.prompt.slice(0, 50) + '...');

      const result = await sendToContent({
        action: 'submitPrompt',
        mode: state.mode,
        prompt: item.prompt,
        settings: state.settings,
        folder: folder
      });

      if (result && result.success) {
        item.status = 'done';
        item.progress = 100;
        let dlInfo = '';
        if (result.downloaded) {
          const mediaLabel = result.mediaType === 'image' ? '图片' : '视频';
          dlInfo = '（已下载 ' + result.downloaded + ' 个' + mediaLabel + '）';
        }
        log('✓ [' + item.id + '] 完成' + dlInfo);
      } else {
        item.status = 'error';
        const errMsg = result && result.error ? result.error : '未知错误';
        log('✗ [' + item.id + '] 失败: ' + errMsg);
        state.failedPrompts.push(item.prompt);
      }
      renderQueue();

      // 随机延迟
      if (delayMax > 0) {
        const delay = (delayMin + Math.random() * (delayMax - delayMin)) * 1000;
        await sleep(delay);
      }
    }
  }

  // 启动 N 个 worker 并发跑
  const workers = [];
  for (let i = 0; i < concurrent; i++) {
    workers.push(worker(i + 1));
  }

  await Promise.all(workers);

  state.running = false;
  log('🎉 批量处理完成');
  if (state.failedPrompts.length > 0) {
    log('⚠️ 共 ' + state.failedPrompts.length + ' 条失败，可点击「📥 导出日志」查看');
  }
}

function stopBatch() {
  state.running = false;
  log('⏹ 已停止');
}

// ============ 渲染队列 ============
function renderQueue() {
  const container = document.getElementById('queueList');
  const count = document.getElementById('queueCount');
  if (count) {
    count.textContent = '共 ' + state.queue.length + ' 个提示词';
  }
  if (state.queue.length === 0) {
    container.innerHTML = '<div class="queue-empty">粘贴或输入提示词后会自动显示队列</div>';
    return;
  }
  let html = '';
  for (const item of state.queue) {
    html += '<div class="queue-item">';
    html += '<div><span class="status-' + item.status + '">●</span> ';
    html += '[' + item.id + '] ' + escapeHtml(item.prompt.slice(0, 50)) + '...</div>';
    html += '<div class="progress"><div class="progress-bar" style="width:' + item.progress + '%"></div></div>';
    html += '</div>';
  }
  container.innerHTML = html;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============ 与 content.js 通信 ============
function sendToContent(payload) {
  return new Promise(function(resolve) {
    try {
      chrome.runtime.sendMessage({
        type: 'FORWARD_TO_TAB',
        payload: payload
      }, function(response) {
        if (chrome.runtime.lastError) {
          console.error('sendMessage error:', chrome.runtime.lastError);
          resolve({ success: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response || { success: false, error: '无响应' });
      });
    } catch (err) {
      resolve({ success: false, error: err.message });
    }
  });
}

// ============ 工具函数 ============
function sleep(ms) {
  return new Promise(function(r) { setTimeout(r, ms); });
}

function log(msg) {
  const time = new Date().toLocaleTimeString();
  const fullLine = '[' + time + '] ' + msg;

  // 保存到日志数组（用于导出）
  state.logs.push(fullLine);

  // 显示到 UI
  const line = document.createElement('div');
  line.className = 'log-line';
  line.textContent = fullLine;
  const c = document.getElementById('logContainer');
  c.appendChild(line);
  line.scrollIntoView();
}

// ============ 获取当天日期（格式：YYYY-M-D） ============
function getTodayDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  return year + '-' + month + '-' + day;
}

// ============ 导出日志 ============
function exportLogs() {
  if (state.logs.length === 0) {
    alert('暂无日志可导出');
    return;
  }

  // 构建文件内容
  let content = '🚀 Grok Automation v' + APP_VERSION + '\n';
  content += 'grok.com 批量自动化工具\n\n';
  content += '日志\n';

  for (const line of state.logs) {
    content += line + '\n';
  }

  content += '清空日志\n';
  content += '\n';
  content += '---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------\n';
  content += ' 失败：\n';

  if (state.failedPrompts.length === 0) {
    content += '（本次没有失败的提示词）\n';
  } else {
    content += state.failedPrompts.join('\n\n') + '\n';
  }

  // 触发下载
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  // 生成文件名（带日期时间）
  const now = new Date();
  const pad = function(n) { return String(n).padStart(2, '0'); };
  const dateStr = now.getFullYear() + '-' +
                  (now.getMonth() + 1) + '-' +
                  now.getDate() + '_' +
                  pad(now.getHours()) + '-' +
                  pad(now.getMinutes());
  const filename = 'Grok日志_' + dateStr + '.txt';

  try {
    chrome.downloads.download({
      url: url,
      filename: filename,
      saveAs: true
    }, function(downloadId) {
      if (chrome.runtime.lastError) {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
      setTimeout(function() {
        URL.revokeObjectURL(url);
      }, 1000);
    });
  } catch (e) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function() {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  log('📥 已导出日志：' + filename + '（共 ' + state.logs.length + ' 行，失败 ' + state.failedPrompts.length + ' 条）');
}
