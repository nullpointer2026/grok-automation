// ============ Grok Automation Content Script v4 ============

if (window.__GROK_AUTOMATION_INJECTED__) {
  console.log('[Grok Automation] 已注入，跳过');
} else {
  window.__GROK_AUTOMATION_INJECTED__ = true;

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'ping') {
      sendResponse({ pong: true });
      return;
    }
    if (msg.action === 'submitPrompt') {
      handleSubmit(msg).then(sendResponse).catch(err => {
        sendResponse({ success: false, error: err.message });
      });
      return true;
    }
    if (msg.action === 'probe') {
      sendResponse({ ok: true, info: probeInfo() });
      return;
    }
  });

  console.log('[Grok Automation] content.js 已注入 ✓ (v4 - 自动下载)');

  // 自动探测
  setTimeout(() => {
    console.log('===== 🔍 Grok Automation 自动探测 =====');
    const editor = findEditor();
    console.log(editor ? '✓ 输入框已找到' : '❌ 找不到输入框');

    const qb = document.querySelector('[class*="query-bar"]');
    if (qb) {
      const btns = qb.querySelectorAll('button');
      console.log(`✓ query-bar 内有 ${btns.length} 个按钮`);
      btns.forEach((b, i) => {
        const r = b.getBoundingClientRect();
        console.log(`  [${i}] aria="${b.getAttribute('aria-label')}" disabled=${b.disabled} 大小=${Math.round(r.width)}x${Math.round(r.height)}`);
      });
    }

    const videos = document.querySelectorAll('video');
    console.log(`📹 当前页面有 ${videos.length} 个视频`);
    console.log('===== 探测完成 =====');
  }, 5000);
}

// ============ 主处理函数 ============
async function handleSubmit({ mode, prompt, settings, folder }) {
  try {
    log('▶ 开始处理:', prompt.slice(0, 40));

    // ⭐ 关键：提交前记录所有现存视频的 URL（标记为旧视频）
    const oldVideoUrls = new Set();
    document.querySelectorAll('video').forEach(v => {
      if (v.src) oldVideoUrls.add(v.src);
      v.querySelectorAll('source').forEach(s => {
        if (s.src) oldVideoUrls.add(s.src);
      });
    });
    log(`📹 提交前已存在 ${oldVideoUrls.size} 个视频`);

    // 1. 找输入框
    const editor = findEditor();
    if (!editor) throw new Error('未找到输入框');
    log('✓ 找到输入框');

    // 2. 输入提示词
    await typeIntoProseMirror(editor, prompt);
    await sleep(800);
    log('✓ 已输入提示词');

    // 3. 点击提交
    const sendBtn = findSendButton();
    if (!sendBtn) throw new Error('未找到提交按钮');
    if (sendBtn.disabled) {
      await sleep(1500);
      if (sendBtn.disabled) throw new Error('提交按钮被禁用');
    }

    sendBtn.click();
    log('✓ 已点击提交，等待生成中...');

    // 4. 等待新视频出现
    const newVideoUrls = await waitForNewVideos(oldVideoUrls);
    log(`🎉 检测到 ${newVideoUrls.length} 个新视频`);

    // 5. 自动下载新视频
    const downloadFolder = folder || 'grok-folder-2';
    for (const url of newVideoUrls) {
      await downloadVideo(url, downloadFolder);
      await sleep(500);
    }
    log(`✓ 已发送 ${newVideoUrls.length} 个视频下载请求到 "${downloadFolder}/"`);

    return { success: true, downloaded: newVideoUrls.length };
  } catch (err) {
    console.error('[Grok Automation] 错误:', err);
    return { success: false, error: err.message };
  }
}

// ============ 等待新视频生成 ============
async function waitForNewVideos(oldUrls) {
  const maxWait = 6 * 60 * 1000;
  const start = Date.now();
  let lastFoundCount = 0;
  let stableCount = 0;

  log('⏳ 等待视频生成...');

  while (Date.now() - start < maxWait) {
    const currentVideos = document.querySelectorAll('video');
    const newUrls = [];

    for (const v of currentVideos) {
      if (v.src && !oldUrls.has(v.src) && isValidVideoUrl(v.src)) {
        if (!newUrls.includes(v.src)) newUrls.push(v.src);
      }
      v.querySelectorAll('source').forEach(s => {
        if (s.src && !oldUrls.has(s.src) && isValidVideoUrl(s.src)) {
          if (!newUrls.includes(s.src)) newUrls.push(s.src);
        }
      });
    }

    if (newUrls.length > 0) {
      if (newUrls.length === lastFoundCount) {
        stableCount++;
        if (stableCount >= 2) {
          await sleep(2000);
          return newUrls;
        }
      } else {
        stableCount = 0;
        lastFoundCount = newUrls.length;
        log(`📥 已检测到 ${newUrls.length} 个新视频，继续等待...`);
      }
    }

    await sleep(2000);
  }

  // 超时也返回已找到的
  const final = [];
  document.querySelectorAll('video').forEach(v => {
    if (v.src && !oldUrls.has(v.src) && isValidVideoUrl(v.src)) {
      if (!final.includes(v.src)) final.push(v.src);
    }
  });

  if (final.length === 0) {
    throw new Error('生成超时，未检测到新视频');
  }
  return final;
}

// ============ 验证视频 URL ============
function isValidVideoUrl(url) {
  if (!url) return false;
  if (url.startsWith('data:')) return false;
  return url.startsWith('http') || url.startsWith('blob:');
}

// ============ 下载视频 ============
async function downloadVideo(url, folder) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `${folder}/grok-video-${timestamp}-${Math.random().toString(36).slice(2, 7)}.mp4`;

  // blob: 链接需要先 fetch 转换为 dataURL
  if (url.startsWith('blob:')) {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const reader = new FileReader();
      return new Promise((resolve) => {
        reader.onloadend = () => {
          chrome.runtime.sendMessage({
            type: 'DOWNLOAD',
            url: reader.result,
            filename: filename
          }, () => resolve());
        };
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      log('❌ blob 下载失败: ' + e.message);
      return;
    }
  }

  // 普通 URL 直接下载
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({
      type: 'DOWNLOAD',
      url: url,
      filename: filename
    }, () => resolve());
  });
}

// ============ 探测信息 ============
function probeInfo() {
  const editor = findEditor();
  const sendBtn = findSendButton();
  const videos = document.querySelectorAll('video');
  return {
    hasEditor: !!editor,
    editorClass: editor ? editor.className.slice(0, 100) : null,
    hasSendBtn: !!sendBtn,
    sendBtnAria: sendBtn ? sendBtn.getAttribute('aria-label') : null,
    sendBtnDisabled: sendBtn ? sendBtn.disabled : null,
    videoCount: videos.length
  };
}

// ============ 找编辑器 ============
function findEditor() {
  let el = document.querySelector('[data-testid="chat-input"] [contenteditable="true"]');
  if (el) return el;
  el = document.querySelector('.ProseMirror[contenteditable="true"]');
  if (el) return el;
  el = document.querySelector('.tiptap[contenteditable="true"]');
  if (el) return el;

  const candidates = document.querySelectorAll('[contenteditable="true"]');
  for (const c of candidates) {
    if (c.offsetParent !== null) return c;
  }
  return null;
}

// ============ 输入文字 ============
async function typeIntoProseMirror(editor, text) {
  editor.focus();
  await sleep(150);

  editor.innerHTML = '<p></p>';
  const p = editor.querySelector('p');
  if (p) {
    p.textContent = text;
  } else {
    editor.textContent = text;
  }

  editor.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    cancelable: true,
    inputType: 'insertText',
    data: text
  }));
  editor.dispatchEvent(new Event('change', { bubbles: true }));
  editor.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }));

  await sleep(300);
}

// ============ 找发送按钮 ============
function findSendButton() {
  const queryBar = document.querySelector('[class*="query-bar"]');

  if (queryBar) {
    const btns = queryBar.querySelectorAll('button');

    for (const btn of btns) {
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      if (aria.includes('submit') || aria.includes('send') ||
          aria.includes('发送') || aria.includes('提交')) {
        return btn;
      }
    }

    let candidates = [];
    for (const btn of btns) {
      const svg = btn.querySelector('svg');
      const rect = btn.getBoundingClientRect();
      if (svg && rect.width >= 28 && rect.width <= 60) {
        candidates.push({ btn, rect });
      }
    }

    if (candidates.length > 0) {
      candidates.sort((a, b) => (b.rect.x + b.rect.y) - (a.rect.x + a.rect.y));
      const enabled = candidates.find(c => !c.btn.disabled);
      if (enabled) return enabled.btn;
      return candidates[0].btn;
    }

    const enabled = Array.from(btns).filter(b => !b.disabled);
    if (enabled.length > 0) return enabled[enabled.length - 1];
  }

  return document.querySelector('button[type="submit"]:not([disabled])');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function log(...args) {
  console.log('[Grok Automation]', ...args);
}