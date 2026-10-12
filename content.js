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
    const mediaType = mode === 'text2image' ? 'image' : 'video';
    const mediaLabel = mediaType === 'image' ? '图片' : '视频';
    log(`▶ 开始处理${mediaLabel}:`, prompt.slice(0, 40));

    const oldMediaKeys = mediaType === 'image' ? collectImageKeys() : collectVideoUrls();
    log(`📦 提交前已存在 ${oldMediaKeys.size} 个${mediaLabel}`);

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

    // 4. 等待新媒体出现
    const newMediaItems = mediaType === 'image'
      ? await waitForNewImages(oldMediaKeys)
      : await waitForNewVideos(oldMediaKeys);
    log(`🎉 检测到 ${newMediaItems.length} 个新${mediaLabel}`);

    // 5. 自动下载新媒体
    const downloadFolder = folder || 'grok-folder-2';
    for (const item of newMediaItems) {
      if (mediaType === 'image') {
        await downloadImage(item, downloadFolder);
      } else {
        await downloadVideo(item, downloadFolder);
      }
      await sleep(500);
    }
    log(`✓ 已发送 ${newMediaItems.length} 个${mediaLabel}下载请求到 "${downloadFolder}/"`);

    return { success: true, downloaded: newMediaItems.length, mediaType };
  } catch (err) {
    const message = getErrorMessage(err);
    console.warn('[Grok Automation] 任务失败:', message);
    return { success: false, error: message };
  }
}

function getErrorMessage(err) {
  if (!err) return '未知错误';
  if (typeof err === 'string') return err;
  if (err.message) return err.message;
  try {
    return JSON.stringify(err);
  } catch (e) {
    return String(err);
  }
}

// ============ 视频收集与等待 ============
function collectVideoUrls() {
  const urls = new Set();
  document.querySelectorAll('video').forEach(v => {
    if (v.src && isValidVideoUrl(v.src)) urls.add(v.src);
    v.querySelectorAll('source').forEach(s => {
      if (s.src && isValidVideoUrl(s.src)) urls.add(s.src);
    });
  });
  return urls;
}

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

// ============ 图片收集与等待 ============
function collectImageKeys() {
  const keys = new Set();
  collectImageItems().forEach(item => keys.add(item.key));
  return keys;
}

async function waitForNewImages(oldKeys) {
  const maxWait = 6 * 60 * 1000;
  const start = Date.now();
  let lastFoundCount = 0;
  let stableCount = 0;

  log('⏳ 等待图片生成...');

  while (Date.now() - start < maxWait) {
    const newItems = collectImageItems().filter(item => !oldKeys.has(item.key));

    if (newItems.length > 0) {
      if (newItems.length === lastFoundCount) {
        stableCount++;
        if (stableCount >= 2) {
          await sleep(2000);
          return newItems;
        }
      } else {
        stableCount = 0;
        lastFoundCount = newItems.length;
        log(`📥 已检测到 ${newItems.length} 个新图片，继续等待...`);
      }
    }

    await sleep(2000);
  }

  const final = collectImageItems().filter(item => !oldKeys.has(item.key));
  if (final.length === 0) {
    throw new Error('生成超时，未检测到新图片');
  }
  return final;
}

function collectImageItems() {
  const items = [];
  const seen = new Set();

  document.querySelectorAll('img').forEach(img => {
    const urls = getImageUrls(img);
    if (urls.length === 0) return;

    const url = urls[0];
    if (!isGeneratedImageCandidate(img, url)) return;

    const key = normalizeMediaKey(url);
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ url, key, ext: inferImageExtension(url) });
  });

  document.querySelectorAll('a[href]').forEach(link => {
    const url = link.href;
    if (!isValidImageLinkUrl(url)) return;
    const key = normalizeMediaKey(url);
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ url, key, ext: inferImageExtension(url) });
  });

  return items;
}

function getImageUrls(img) {
  const urls = [];
  if (img.currentSrc) urls.push(img.currentSrc);
  if (img.src) urls.push(img.src);
  if (img.srcset) {
    img.srcset.split(',').forEach(part => {
      const candidate = part.trim().split(/\s+/)[0];
      if (candidate) {
        try {
          urls.push(new URL(candidate, location.href).href);
        } catch (e) {
          urls.push(candidate);
        }
      }
    });
  }
  return urls.filter(isValidImageUrl);
}

function isGeneratedImageCandidate(img, url) {
  if (!isValidImageUrl(url)) return false;

  const text = [
    img.alt || '',
    img.className || '',
    img.id || '',
    img.getAttribute('aria-label') || ''
  ].join(' ').toLowerCase();

  if (/(avatar|profile|user|icon|logo|emoji|sprite|favicon|thumbnail|thumb|placeholder)/i.test(text)) {
    return false;
  }

  const rect = img.getBoundingClientRect();
  const width = Math.max(img.naturalWidth || 0, rect.width || 0);
  const height = Math.max(img.naturalHeight || 0, rect.height || 0);
  return width >= 128 && height >= 128;
}

function isValidImageUrl(url) {
  if (!url) return false;
  if (url.startsWith('data:image/svg')) return false;
  if (url.startsWith('data:image/')) return true;
  if (url.startsWith('blob:')) return true;

  try {
    const parsed = new URL(url, location.href);
    if (!/^https?:$/.test(parsed.protocol)) return false;
    if (/\.(svg)(?:$|[?#])/i.test(parsed.pathname)) return false;
    if (/(avatar|profile|icon|logo|emoji|sprite|favicon|placeholder)/i.test(parsed.href)) {
      return false;
    }
    return true;
  } catch (e) {
    return false;
  }
}

function isValidImageLinkUrl(url) {
  if (!isValidImageUrl(url)) return false;
  if (url.startsWith('data:image/') || url.startsWith('blob:')) return true;

  try {
    const parsed = new URL(url, location.href);
    return /\.(png|jpe?g|webp|gif)(?:$|[?#])/i.test(parsed.pathname);
  } catch (e) {
    return /\.(png|jpe?g|webp|gif)(?:$|[?#])/i.test(url);
  }
}

function normalizeMediaKey(url) {
  if (!url) return '';
  if (url.startsWith('data:')) return url.slice(0, 128) + ':' + url.length;
  if (url.startsWith('blob:')) return url;

  try {
    const parsed = new URL(url, location.href);
    parsed.hash = '';
    return parsed.href;
  } catch (e) {
    return url;
  }
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

// ============ 下载图片 ============
async function downloadImage(item, folder) {
  const url = typeof item === 'string' ? item : item.url;
  let ext = (item && item.ext) || inferImageExtension(url);

  if (url.startsWith('blob:')) {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      ext = imageExtensionFromMime(blob.type) || ext;
      const filename = buildMediaFilename(folder, 'image', ext);
      const reader = new FileReader();
      return new Promise((resolve) => {
        reader.onloadend = () => {
          sendDownload(reader.result, filename).then(resolve);
        };
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      log('❌ blob 图片下载失败: ' + e.message);
      return;
    }
  }

  const filename = buildMediaFilename(folder, 'image', ext);
  return sendDownload(url, filename);
}

function buildMediaFilename(folder, type, ext) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const suffix = Math.random().toString(36).slice(2, 7);
  return `${folder}/grok-${type}-${timestamp}-${suffix}.${ext}`;
}

function sendDownload(url, filename) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({
      type: 'DOWNLOAD',
      url: url,
      filename: filename
    }, () => resolve());
  });
}

function inferImageExtension(url) {
  if (!url) return 'png';

  const dataMatch = url.match(/^data:image\/([a-z0-9.+-]+);/i);
  if (dataMatch) return normalizeImageExtension(dataMatch[1]);

  try {
    const parsed = new URL(url, location.href);
    const match = parsed.pathname.match(/\.([a-z0-9]+)$/i);
    if (match) return normalizeImageExtension(match[1]);
  } catch (e) {
    const match = url.match(/\.([a-z0-9]+)(?:$|[?#])/i);
    if (match) return normalizeImageExtension(match[1]);
  }

  return 'png';
}

function imageExtensionFromMime(mime) {
  const match = String(mime || '').match(/^image\/([a-z0-9.+-]+)/i);
  return match ? normalizeImageExtension(match[1]) : '';
}

function normalizeImageExtension(ext) {
  const value = String(ext || '').toLowerCase();
  if (value === 'jpeg' || value === 'pjpeg') return 'jpg';
  if (value === 'png' || value === 'jpg' || value === 'webp' || value === 'gif') return value;
  return 'png';
}

// ============ 探测信息 ============
function probeInfo() {
  const editor = findEditor();
  const sendBtn = findSendButton();
  const videos = document.querySelectorAll('video');
  const images = collectImageItems();
  return {
    hasEditor: !!editor,
    editorClass: editor ? editor.className.slice(0, 100) : null,
    hasSendBtn: !!sendBtn,
    sendBtnAria: sendBtn ? sendBtn.getAttribute('aria-label') : null,
    sendBtnDisabled: sendBtn ? sendBtn.disabled : null,
    videoCount: videos.length,
    imageCount: images.length
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
