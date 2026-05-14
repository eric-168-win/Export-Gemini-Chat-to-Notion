function extractGeminiChat() {
    const messageElements = document.querySelectorAll('user-query div[role="heading"].query-text, message-content');

    let UserPromptTag = 'div';
    let chatHistory = [];

    const turndownService = new TurndownService({
        codeBlockStyle: 'fenced',
        headingStyle: 'atx',
        hr: '---' // 🌟 修復1：強制水平線轉換為 ---，避免變成 * * *
    });

    // 🌟 關鍵修復：關閉 Turndown 煩人的自動跳脫 (Escape) 功能
    turndownService.escape = function (string) {
        return string;
    };

    turndownService.addRule('table', {
        filter: 'table',
        replacement: function (content, node) {
            let markdown = '\n\n';
            const rows = node.querySelectorAll('tr');

            rows.forEach((row, rowIndex) => {
                let rowStr = '|';
                const cells = row.querySelectorAll('th, td');

                cells.forEach(cell => {
                    // 清理換行符號，確保每一格的文字都在同一行內
                    let cellText = cell.textContent.trim().replace(/\n/g, ' ');
                    rowStr += ` ${cellText} |`;
                });

                markdown += rowStr + '\n';

                // 在第一行（標題行）下方加入 Markdown 表格分隔線 |---|---|
                if (rowIndex === 0) {
                    markdown += '|' + Array(cells.length).fill('---').join('|') + '|\n';
                }
            });
            return markdown + '\n\n';
        }
    });

    messageElements.forEach((element) => {
        const tagName = element.tagName.toLowerCase();
        let markdownText = "";

        if (tagName === UserPromptTag) {
            // 🧑 【處理 User 的發言】
            markdownText = element.innerText.trim().replace("You said", "").trim();

        } else if (tagName === 'message-content') {
            // 🤖 【處理 Gemini 的發言】
            let contentContainer = element.querySelector('structured-content-container');
            if (!contentContainer) {
                contentContainer = element.querySelector('.markdown-main-panel');
            }

            contentContainer = removeExportToSheetsBar(contentContainer);

            if (contentContainer) {
                let clone = contentContainer.cloneNode(true);

                // 🌟 全新策略：直接找最外層的程式碼區塊容器
                const codeBlocks = clone.querySelectorAll('code-block, .code-block');

                codeBlocks.forEach(block => {
                    let lang = '';

                    // 1. 找語言 Header
                    const header = block.querySelector('.code-block-decoration');
                    if (header) {
                        // 語言名稱現在很乾淨地放在 span 裡面
                        const langSpan = header.querySelector('span');
                        if (langSpan) {
                            lang = langSpan.innerText.trim().toLowerCase();
                        }

                        // 🔪 拔除 Header，以免變成多餘的純文字
                        header.remove();
                    }

                    // 2. 找程式碼主體
                    const codeTag = block.querySelector('pre code');
                    if (codeTag) {
                        // 貼上語言標籤給 Turndown 辨識
                        if (lang) {
                            codeTag.className = `language-${lang}`;
                        }

                        // 3. 🧹 清除頭尾幽靈空行
                        let rawCode = codeTag.textContent || '';
                        rawCode = rawCode.replace(/^[\s]*\n/g, ''); // 殺掉開頭空行
                        rawCode = rawCode.replace(/\n[\s]*$/g, ''); // 殺掉結尾空行
                        codeTag.textContent = rawCode;
                    }
                });

                // 手術完成，交給 Turndown 轉換
                markdownText = turndownService.turndown(clone.innerHTML);

            } else {
                console.log("警告：在 message-content 找不到對話內容", element);
            }
        }
        if (markdownText !== "") {
            chatHistory.push({
                role: tagName === UserPromptTag ? 'User' : 'Gemini',
                text: markdownText
            });
        }
    });

    return chatHistory;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "START_EXPORT") {
        const data = extractGeminiChat();

        // 🌟 新增：精準抓取 Gemini 左上角的對話標題
        const titleElement = document.querySelector('[data-test-id="conversation-title"]');
        console.log("抓取到的標題元素：", titleElement.innerText.trim());

        // 如果有抓到標題就用抓到的，沒抓到就用預設的時間戳記當備案
        const pageTitle = titleElement
            ? titleElement.innerText.trim()
            : `Gemini 對話紀錄 - ${new Date().toLocaleString()}`;

        // 將標題 (pageTitle) 一起打包回傳給 popup.js
        sendResponse({ status: "success", data: data, title: pageTitle });
    }
    return true;
});

function removeExportToSheetsBar(container) {
    // You can target it directly from the parent using a nested CSS selector
    const target = container.querySelector('div.table-footer.hide-from-message-actions');
    if (target) {
        target.remove();
    }
    return container;
}