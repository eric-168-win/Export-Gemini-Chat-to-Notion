
// function extractGeminiChat() {
//     // 保留你精準的選擇器
//     const messageElements = document.querySelectorAll('user-query div[role="heading"].query-text, message-content');
//     let UserPromptTag = 'div';

//     let chatHistory = [];
//     const turndownService = new TurndownService({
//         codeBlockStyle: 'fenced' // 強制使用 ``` 來包裝程式碼，保留語言標籤
//     });

//     messageElements.forEach((element) => {
//         const tagName = element.tagName.toLowerCase();
//         let markdownText = "";

//         if (tagName === UserPromptTag) {
//             // 🧑 【處理 User 的發言】
//             // 保留你的清除邏輯
//             markdownText = element.innerText.trim().replace("You said", "").trim();

//         } else if (tagName === 'message-content') {
//             // 🤖 【處理 Gemini 的發言】
//             let contentContainer = element.querySelector('structured-content-container');

//             // 防呆機制
//             if (!contentContainer) {
//                 contentContainer = element.querySelector('.markdown-main-panel');
//             }
//             console.log("找到對話內容容器：", contentContainer);
//             if (contentContainer) {
//                 // 🌟 開始進行「DOM 手術」
//                 // 複製一個 DOM，避免改動到使用者原本網頁的畫面
//                 let clone = contentContainer.cloneNode(true);

//                 // 尋找所有的 <pre> 標籤 (程式碼區塊的主體)
//                 const preTags = clone.querySelectorAll('pre');

//                 preTags.forEach(pre => {
//                     const wrapper = pre.parentElement;
//                     let lang = '';

//                     if (wrapper) {
//                         // 尋找頂部包含語言名稱的 Header (例如 "JSON Copy code")
//                         const header = wrapper.querySelector('.code-block-header, div[class*="header"]');
//                         if (header) {
//                             // 提取語言文字，並移除複製按鈕的字眼
//                             lang = header.innerText.replace(/Copy code|複製程式碼|Copy/ig, '').trim();

//                             // 🔪 切除 Header！避免它變成 Notion 裡多餘的純文字段落
//                             header.remove();
//                         }
//                     }

//                     // 處理內部的 <code> 標籤
//                     const codeTag = pre.querySelector('code');
//                     if (codeTag) {
//                         // 移植語言標籤給 Turndown 辨識
//                         if (lang) {
//                             const cleanLang = lang.split('\n')[0].trim().toLowerCase();
//                             codeTag.className = `language-${cleanLang}`;
//                         }

//                         // 🧹 淨化空行：強制移除最前面和最後面的隱藏空白/換行符號
//                         codeTag.innerHTML = codeTag.innerHTML.replace(/^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g, '');
//                     }
//                 });

//                 // 手術完成，將這個乾淨的 clone 交給 Turndown 轉換
//                 markdownText = turndownService.turndown(clone.innerHTML);

//             } else {
//                 console.log("警告：在 message-content 找不到對話內容", element);
//             }
//         }

//         // 確保不是空字串才塞入陣列
//         if (markdownText !== "") {
//             chatHistory.push({
//                 role: tagName === UserPromptTag ? 'User' : 'Gemini',
//                 text: markdownText
//             });
//         }
//     });

//     return chatHistory;
// }


// 接收按鈕指令的地方

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
        const data = extractGeminiChat(); // 按下按鈕的這瞬間，才執行抓取！
        sendResponse({ status: "success", data: data });
    }
    return true;
});