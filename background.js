// ============ Grok Automation - Background Service Worker ============
console.log('[Grok BG] background 已启动');

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'FORWARD_TO_TAB') {
    handleForward(msg.payload, sendResponse);
    return true;
  }

  if (msg.type === 'DOWNLOAD') {
    handleDownload(msg, sendResponse);
    return true;
  }
});

// ============ 下载处理 ============
function handleDownload(msg, sendResponse) {
  const { url, filename } = msg;
  console.log('[Grok BG] 📥 下载请求:', filename);

  chrome.downloads.download({
    url: url,
    filename: filename,
    saveAs: false,
    conflictAction: 'uniquify'
  }, (downloadId) => {
    if (chrome.runtime.lastError) {
      console.error('[Grok BG] ❌ 下载失败:', chrome.runtime.lastError.message);
      sendResponse({ ok: false, error: chrome.runtime.lastError.message });
    } else {
      console.log('[Grok BG] ✓ 下载已开始, ID:', downloadId);
      sendResponse({ ok: true, id: downloadId });
    }
  });
}

// ============ 转发消息到 grok 标签页 ============
async function handleForward(payload, sendResponse) {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://grok.com/*' });
    console.log('[Grok BG] 找到', tabs.length, '个 grok 标签页');

    if (tabs.length === 0) {
      sendResponse({ success: false, error: '请先打开 grok.com/imagine 页面' });
      return;
    }

    let tab = tabs.find(t => t.active) || tabs[0];
    console.log('[Grok BG] 使用标签页:', tab.id, tab.url);

    // 心跳检测
    let alive = false;
    try {
      const pong = await Promise.race([
        chrome.tabs.sendMessage(tab.id, { action: 'ping' }),
        new Promise(r => setTimeout(() => r(null), 1500))
      ]);
      alive = pong && pong.pong === true;
      console.log('[Grok BG] ping 结果:', alive);
    } catch (e) {
      console.log('[Grok BG] ping 失败:', e.message);
      alive = false;
    }

    if (!alive) {
      console.log('[Grok BG] 自动注入 content.js...');
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        });
        await new Promise(r => setTimeout(r, 800));
      } catch (injErr) {
        console.error('[Grok BG] 注入失败:', injErr);
        sendResponse({ success: false, error: '注入失败：' + injErr.message });
        return;
      }
    }

    console.log('[Grok BG] 发送消息:', payload.action);
    try {
      const response = await chrome.tabs.sendMessage(tab.id, payload);
      console.log('[Grok BG] 收到响应:', response);
      sendResponse(response || { success: false, error: '无响应' });
    } catch (sendErr) {
      console.error('[Grok BG] 发送失败:', sendErr);
      sendResponse({ success: false, error: '通信失败：' + sendErr.message });
    }
  } catch (err) {
    console.error('[Grok BG] 异常:', err);
    sendResponse({ success: false, error: err.message });
  }
}