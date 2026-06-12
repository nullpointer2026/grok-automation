// ============ Grok Automation Side Panel ============
const state = {
  mode: 'text2video',
  running: false,
  queue: [],
  settings: {},
  logs: [],
  failedPrompts: [],
  currentFolder: ''  // ⭐ 新增：记录当前任务的保存文件夹
};

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  bindEvents();
  log('插件已就绪 ✓');
});

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
  document.getElementById('exportLogs').addEventListener('click', function() {
    exportLogs(false); // 手动导出，弹出"另存为"
  });

  document.getElementById('txtUpload').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(ev) {
      document.getElementById('prompts').value = ev.target.result;
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

  // 文件夹名预览 + 日志路径预览
  const folderInput = document.getElementById('folder');
  const appendDateCheckbox = document.getElementById('appendDate');
  const autoExportCheckbox = document.getElementById('autoExportLog');

  function updateFolderPreview() {
    const baseName = folderInput.value || 'Grok-grok-folder';
    const fullName = appendDateCheckbox.checked ? baseName + getTodayDate() : baseName;
    document.getElementById('folderPreview').textContent = '📁 实际保存到：下载/' + fullName + '/';
    updateLogPathPreview(fullName);
  }

  function updateLogPathPreview(folderName) {
    const pathInfo = document.getElementById('logPathInfo');
    const pathText = document.getElementById('logPathText');
    if (autoExportCheckbox.checked) {
      pathInfo.style.display = 'block';
      pathText.textContent = '下载/' + folderName + '/Grok日志_xxx.txt';
    } else {
      pathInfo.style.display = 'none';
    }
  }

  folderInput.addEventListener('input', updateFolderPreview);
  appendDateCheckbox.addEventListener('change', updateFolderPreview);
  autoExportCheckbox.addEventListener('change', updateFolderPreview);
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
  } else {
    const err = res && res.error ? res.error : '未知错误';
    log('❌ 连接失败: ' + err);
  }
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

  const text = document.getElementById('prompts').value.trim();
  if (!text) {
    alert('请输入提示词');
    return;
  }

  const prompts = text.split(/\n\s*\n/).map(function(p) { return p.trim(); }).filter(Boolean);
  state.queue = prompts.map(function(p, i) {
    return { id: i + 1, prompt: p, status: 'waiting', progress: 0 };
  });

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
  if (concurrent > prompts.length) concurrent = prompts.length;

  let warning = '';
  if (concurrent > 3) warning = '（⚠️ 高并发可能触发 Grok 限流）';
  log('⚙️ 并发数：' + concurrent + warning);

  // 计算保存文件夹（自动加日期）
  let folder = document.getElementById('folder').value || 'Grok-grok-folder';
  if (document.getElementById('appendDate').checked) {
    folder = folder + getTodayDate();
  }
  state.currentFolder = folder; // ⭐ 记录当前文件夹
  log('📁 视频将保存到「下载/' + folder + '/」');

  // 共享的索引计数器
  let nextIndex = 0;
  const total = state.queue.length;

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
          dlInfo = '（已下载 ' + result.downloaded + ' 个视频）';
        }
        log('✓ [' + item.id + '] 完成' + dlInfo);
      } else {
        item.status = 'error';
        const errMsg = result && result.error ? result.error : '未知错误';
        log('✗ [' + item.id + '] 失败: ' + errMsg);
        state.failedPrompts.push(item.prompt);
      }
      renderQueue();

      if (delayMax > 0) {
        const delay = (delayMin + Math.random() * (delayMax - delayMin)) * 1000;
        await sleep(delay);
      }
    }
  }

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

  // ⭐ 自动导出日志
  if (document.getElementById('autoExportLog').checked) {
    log('📥 自动保存日志中...');
    await sleep(500);
    exportLogs(true); // true = 自动导出（不弹"另存为"，保存到视频文件夹）
  }
}

function stopBatch() {
  state.running = false;
  log('⏹ 已停止');
}

// ============ 渲染队列 ============
function renderQueue() {
  const container = document.getElementById('queueList');
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
  return s.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>');
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

  state.logs.push(fullLine);

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
// auto = true：自动导出（保存到视频文件夹，不弹窗）
// auto = false：手动导出（弹"另存为"对话框）
function exportLogs(auto) {
  if (state.logs.length === 0) {
    if (!auto) alert('暂无日志可导出');
    return;
  }

  // 构建文件内容
  let content = '🚀 Grok Automation v1.0.6\n';
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
                  pad(now.getMinutes()) + '-' +
                  pad(now.getSeconds());
  const filenameOnly = 'Grok日志_' + dateStr + '.txt';

  // ⭐ 决定保存路径
  let filename;
  let saveAs;
  if (auto && state.currentFolder) {
    // 自动导出：保存到视频文件夹
    filename = state.currentFolder + '/' + filenameOnly;
    saveAs = false;
  } else {
    // 手动导出：弹出"另存为"
    filename = filenameOnly;
    saveAs = true;
  }

  try {
    chrome.downloads.download({
      url: url,
      filename: filename,
      saveAs: saveAs,
      conflictAction: 'uniquify'
    }, function(downloadId) {
      if (chrome.runtime.lastError) {
        console.error('日志下载失败:', chrome.runtime.lastError);
        // 备用方法
        const a = document.createElement('a');
        a.href = url;
        a.download = filenameOnly;
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
    a.download = filenameOnly;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function() {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  if (auto) {
    log('✓ 日志已自动保存到：下载/' + filename);
  } else {
    log('📥 已导出日志：' + filenameOnly + '（共 ' + state.logs.length + ' 行，失败 ' + state.failedPrompts.length + ' 条）');
  }
}