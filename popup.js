// popup.js

document.addEventListener('DOMContentLoaded', () => {
    const apiKeyInput = document.getElementById('apiKey');
    const dbIdInput = document.getElementById('dbId');
    const saveBtn = document.getElementById('saveBtn');
    const exportBtn = document.getElementById('exportBtn');
    const statusDiv = document.getElementById('status');

    // 1. 初始化：載入已儲存的設定
    chrome.storage.sync.get(['notionApiKey', 'notionDbId'], (result) => {
        if (result.notionApiKey) apiKeyInput.value = result.notionApiKey;
        if (result.notionDbId) dbIdInput.value = result.notionDbId;
    });

    // 2. 儲存按鈕邏輯
    saveBtn.addEventListener('click', () => {
        const apiKey = apiKeyInput.value.trim();
        const dbId = dbIdInput.value.trim();

        chrome.storage.sync.set({
            notionApiKey: apiKey,
            notionDbId: dbId
        }, () => {
            showStatus('設定已儲存！', 'success');
        });
    });

    // 3. 匯出按鈕邏輯
    exportBtn.addEventListener('click', () => {
        const apiKey = apiKeyInput.value.trim();
        const dbId = dbIdInput.value.trim();

        if (!apiKey || !dbId) {
            showStatus('請先填寫並儲存 Notion 設定！', 'error');
            return;
        }

        showStatus('正在抓取資料...', '');
        exportBtn.disabled = true;

        // 向當前分頁的 Content Script 發送指令
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const currentTab = tabs[0];

            // 確保是在 Gemini 網頁上
            if (!currentTab.url.includes("gemini.google.com")) {
                showStatus('請在 Gemini 聊天頁面使用此功能。', 'error');
                exportBtn.disabled = false;
                return;
            }

            // 發送訊息給 content.js (你的 turndown.js 邏輯就在那邊執行)
            chrome.tabs.sendMessage(currentTab.id, { action: "START_EXPORT" }, (response) => {
                if (chrome.runtime.lastError) {
                    showStatus('請重新整理 Gemini 網頁後再試一次。' + JSON.stringify(chrome.runtime.lastError), 'error');
                    exportBtn.disabled = false;
                    return;
                }

                if (response && response.status === "success") {
                    showStatus('抓取成功，正在寫入 Notion...', '');

                    // 將資料轉發給 Background Script 執行 API 呼叫
                    chrome.runtime.sendMessage({
                        action: "CALL_NOTION_API",
                        chatData: response.data,
                        title: response.title,
                        credentials: { apiKey, dbId } // 一併傳遞設定檔
                    }, (bgResponse) => {
                        if (bgResponse.status === "success") {
                            showStatus('🎉 成功匯出至 Notion！', 'success');
                        } else {
                            showStatus(`匯出失敗：${bgResponse.error}` + JSON.stringify(bgResponse), 'error');
                        }
                        exportBtn.disabled = false;
                    });
                } else {
                    showStatus('無法抓取對話，請確認頁面內容。', 'error');
                    exportBtn.disabled = false;
                }
            });
        });
    });

    // 輔助函式：顯示狀態訊息
    function showStatus(message, type) {
        statusDiv.textContent = message;
        statusDiv.className = type; // 'success' 或 'error'
        // 如果是成功訊息，3秒後清除
        if (type === 'success') {
            setTimeout(() => {
                statusDiv.textContent = '';
                statusDiv.className = '';
            }, 3000);
        }
    }
});