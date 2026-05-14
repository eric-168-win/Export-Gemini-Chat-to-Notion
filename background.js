// 監聽來自 Popup 的訊息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "CALL_NOTION_API") {
        const { chatData, credentials, title } = request;

        // 因為呼叫 API 是非同步的，我們呼叫處理函式，並在完成後 sendResponse
        sendToNotion(chatData, credentials, title)
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ status: "error", error: error.message }));

        // 必須回傳 true，告訴 Chrome 這是非同步回應，保持通訊通道開啟
        return true;
    }
});

async function sendToNotion(chatData, credentials, title) {
    const NOTION_API_KEY = credentials.apiKey;
    const DATABASE_ID = credentials.dbId;
    const NOTION_VERSION = '2022-06-28';

    let notionBlocks = [];

    chatData.forEach(msg => {
        if (msg.role === 'User') {
            // 🧑 【處理 User 的發言：淨化換行與完美 Callout】

            // 1. 壓縮多餘的換行：將連續2個以上的換行符號，壓縮成單一換行
            // 這樣你的程式碼或長篇問題貼上時，就不會出現每行中間都空一行的鬆散狀況
            let cleanUserText = msg.text.replace(/\n{2,}/g, '\n').trim();

            // 2. 處理 Notion 的 2000 字元限制 (保證只生成一個 Block)
            // 將長字串每 2000 字切成一塊，放入同一個 rich_text 陣列中
            let userRichText = [];
            for (let i = 0; i < cleanUserText.length; i += 2000) {
                userRichText.push({
                    type: 'text',
                    text: { content: cleanUserText.substring(i, i + 2000) }
                });
            }

            // 3. 推入唯一的 Callout 區塊
            notionBlocks.push({
                object: 'block',
                type: 'callout',
                callout: {
                    rich_text: userRichText,
                    icon: { type: 'emoji', emoji: '💡' },
                    color: 'gray_background'
                }
            });

        } else {
            // 🤖 【處理 Gemini 的發言：保持 Regex 程式碼解析】
            notionBlocks.push({
                object: 'block',
                type: 'heading_2',
                heading_2: {
                    rich_text: [{ type: 'text', text: { content: '🤖 Gemini' } }]
                }
            });

            const regex = /```(.*)\n([\s\S]*?)```/g;
            let lastIndex = 0;
            let match;

            const addParagraphs = (text) => {
                if (!text.trim()) return;
                const lines = text.split('\n');

                // 🌟 新增：表格狀態管理
                let inTable = false;
                let currentTableBlocks = [];
                let tableWidth = 0;

                // 🌟 新增：打包並輸出 Notion 表格的輔助函數
                const flushTable = () => {
                    if (inTable && currentTableBlocks.length > 0) {
                        notionBlocks.push({
                            object: 'block',
                            type: 'table',
                            table: {
                                table_width: tableWidth,
                                has_column_header: true, // 假設第一行都是標題
                                has_row_header: false,
                                children: currentTableBlocks
                            }
                        });
                        inTable = false;
                        currentTableBlocks = [];
                        tableWidth = 0;
                    }
                };

                lines.forEach(line => {
                    const content = line.trim();
                    if (!content) return;

                    // 🌟 A. 優先判斷是否為 Table Row (特徵：以 | 開頭並以 | 結尾)
                    const isTableRow = /^\|(.+)\|$/.test(content);

                    if (isTableRow) {
                        if (!inTable) {
                            inTable = true;
                            currentTableBlocks = [];
                        }
                        // 略過 Markdown table 的純分隔線 (例如 |---|---|)
                        if (/^\|[-| :]+\|$/.test(content)) return;

                        // 拆解出每個 Cell 的內容
                        const cells = content.split('|').slice(1, -1).map(c => c.trim());
                        tableWidth = Math.max(tableWidth, cells.length);

                        currentTableBlocks.push({
                            object: 'block',
                            type: 'table_row',
                            table_row: {
                                // 將每個 cell 的文字轉為 Notion rich_text
                                cells: cells.map(cellText => markdownToRichText(cellText))
                            }
                        });
                        return; // 表格行處理完畢，直接換下一行
                    } else {
                        // 如果遇到不是表格的內容，代表表格結束了，先把累積的 Table 送出
                        flushTable();
                    }

                    // --- 以下為原本的邏輯，但優化了分隔線的判斷 ---

                    const headerMatch = content.match(/^(#{1,6})\s+(.*)/);

                    // 1. 判斷標題
                    if (headerMatch) {
                        const level = headerMatch[1].length;
                        const headerText = headerMatch[2];
                        let notionType = 'heading_1';
                        if (level === 2) notionType = 'heading_2';
                        if (level >= 3) notionType = 'heading_3';

                        notionBlocks.push({
                            object: 'block',
                            type: notionType,
                            [notionType]: { rich_text: markdownToRichText(headerText) }
                        });
                    }
                    // 🌟 2. 判斷分隔線 (嚴格匹配 --- 或 ***)
                    else if (/^(---|___|\*\*\*)$/.test(content)) {
                        notionBlocks.push({
                            object: 'block',
                            type: 'divider',
                            divider: {}
                        });
                    }
                    // 3. 判斷無序清單
                    else if (content.startsWith('* ') || content.startsWith('- ')) {
                        notionBlocks.push({
                            object: 'block',
                            type: 'bulleted_list_item',
                            bulleted_list_item: { rich_text: markdownToRichText(content.substring(2)) }
                        });
                    }
                    // 4. 判斷有序清單
                    else if (/^\d+\.\s/.test(content)) {
                        const listMatch = content.match(/^\d+\.\s(.*)/);
                        notionBlocks.push({
                            object: 'block',
                            type: 'numbered_list_item',
                            numbered_list_item: { rich_text: markdownToRichText(listMatch[1]) }
                        });
                    }
                    // 5. 普通文字段落
                    else {
                        notionBlocks.push({
                            object: 'block',
                            type: 'paragraph',
                            paragraph: { rich_text: markdownToRichText(content) }
                        });
                    }
                });

                // 確保迴圈結束後，如果最後剛好是表格，也要把它送出
                flushTable();
            };

            const addCodeBlock = (rawLang, codeStr) => {
                const cleanLang = rawLang.trim().toLowerCase();
                let notionLang = 'plain text';
                const langMap = {
                    'js': 'javascript', 'javascript': 'javascript',
                    'ts': 'typescript', 'typescript': 'typescript',
                    'c#': 'c#', 'csharp': 'c#', 'cs': 'c#',
                    'c++': 'c++', 'cpp': 'c++',
                    'py': 'python', 'python': 'python',
                    'json': 'json', 'xml': 'xml', 'yaml': 'yaml',
                    'html': 'html', 'css': 'css',
                    'java': 'java', 'sql': 'sql', 'bash': 'bash', 'sh': 'shell', 'shell': 'shell'
                };
                if (langMap[cleanLang]) notionLang = langMap[cleanLang];

                let cleanCodeStr = codeStr.trimEnd();
                cleanCodeStr = JSON.parse(JSON.stringify(codeStr.trimEnd()).replace(/\n+$/, ''));
 

                // 順便優化：處理 Gemini 產生的超長程式碼 (超過 2000 字依然不斷掉)
                let codeChunks = [];
                for (let i = 0; i < cleanCodeStr.length; i += 2000) {
                    codeChunks.push({
                        type: 'text',
                        text: { content: cleanCodeStr.substring(i, i + 2000) }
                    });
                }

                notionBlocks.push({
                    object: 'block',
                    type: 'code',
                    code: {
                        rich_text: codeChunks,
                        language: notionLang
                    }
                });
            };

            while ((match = regex.exec(msg.text)) !== null) {
                addParagraphs(msg.text.substring(lastIndex, match.index));
                addCodeBlock(match[1], match[2]);
                lastIndex = regex.lastIndex;
            }
            addParagraphs(msg.text.substring(lastIndex));

            // 對話結束分隔線
            notionBlocks.push({ object: 'block', type: 'divider', divider: {} });
            notionBlocks.push({ object: 'block', type: 'divider', divider: {} });
        }
    });

    // --- 下方的 Notion API 發送邏輯完全保持不變 ---
    const initialBlocks = notionBlocks.slice(0, 100);
    const remainingBlocks = notionBlocks.slice(100);

    try {
        const displayTitle = title || `Gemini 對話紀錄 - ${new Date().toLocaleString()}`;

        const createResponse = await fetch('https://api.notion.com/v1/pages', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${NOTION_API_KEY}`,
                'Content-Type': 'application/json',
                'Notion-Version': NOTION_VERSION
            },
            body: JSON.stringify({
                parent: { database_id: DATABASE_ID },
                properties: {
                    Name: {
                        title: [{ text: { content: displayTitle } }]
                    }
                },
                children: initialBlocks
            })
        });

        if (!createResponse.ok) {
            const errorData = await createResponse.json();
            throw new Error(errorData.message);
        }

        const pageData = await createResponse.json();
        const pageId = pageData.id;

        if (remainingBlocks.length > 0) {
            await appendBlocksInChunks(pageId, remainingBlocks, NOTION_API_KEY, NOTION_VERSION);
        }

        return { status: "success" };

    } catch (error) {
        return { status: "error", error: error.message };
    }
}

// 輔助函式：分批附加剩餘的區塊
async function appendBlocksInChunks(pageId, blocks, apiKey, version) {
    const CHUNK_SIZE = 100;
    for (let i = 0; i < blocks.length; i += CHUNK_SIZE) {
        const chunk = blocks.slice(i, i + CHUNK_SIZE);

        const appendResponse = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'Notion-Version': version
            },
            body: JSON.stringify({
                children: chunk
            })
        });

        if (!appendResponse.ok) {
            console.error("附加區塊時發生錯誤，部分對話可能遺失");
        }
    }
}

/**
 * 將簡單的 Markdown 格式轉換為 Notion 的 rich_text 陣列
 * 支援：**粗體**, *斜體*, `行內程式碼`, [連結](url)
 */
// function markdownToRichText(text) {
//     const richText = [];
//     // 正規表達式：匹配 粗體、斜體、行內程式碼、連結
//     const regex = /(\*\*\*[\s\S]+?\*\*\*|\*\*[\s\S]+?\*\*|\*[\s\S]+?\*|`[\s\S]+?`|\[[\s\S]+?\]\(.+?\))/g;

//     let lastIndex = 0;
//     let match;

//     while ((match = regex.exec(text)) !== null) {
//         // 先放入匹配項之前的純文字
//         if (match.index > lastIndex) {
//             richText.push({
//                 type: 'text',
//                 text: { content: text.substring(lastIndex, match.index) }
//             });
//         }

//         const part = match[0];
//         if (part.startsWith('***')) { // 粗斜體
//             richText.push({ type: 'text', text: { content: part.slice(3, -3) }, annotations: { bold: true, italic: true } });
//         } else if (part.startsWith('**')) { // 粗體
//             richText.push({ type: 'text', text: { content: part.slice(2, -2) }, annotations: { bold: true } });
//         } else if (part.startsWith('*')) { // 斜體
//             richText.push({ type: 'text', text: { content: part.slice(1, -1) }, annotations: { italic: true } });
//         } else if (part.startsWith('`')) { // 行內程式碼
//             richText.push({ type: 'text', text: { content: part.slice(1, -1) }, annotations: { code: true } });
//         } else if (part.startsWith('[')) { // 連結
//             const linkMatch = part.match(/\[([\s\S]+?)\]\((.+?)\)/);
//             if (linkMatch) {
//                 richText.push({
//                     type: 'text',
//                     text: { content: linkMatch[1], link: { url: linkMatch[2] } }
//                 });
//             }
//         }
//         lastIndex = regex.lastIndex;
//     }

//     // 放入剩餘的文字
//     if (lastIndex < text.length) {
//         richText.push({
//             type: 'text',
//             text: { content: text.substring(lastIndex) }
//         });
//     }

//     return richText.length > 0 ? richText : [{ type: 'text', text: { content: text } }];
// }
/**
 * 將簡單的 Markdown 格式轉換為 Notion 的 rich_text 陣列
 * 🌟 強化版：支援巢狀格式 (例如：粗體裡面包著行內程式碼)
 */
function markdownToRichText(text) {
    function parse(textStr, currentAnnotations) {
        const richTextList = [];
        const regex = /(\*\*\*[\s\S]+?\*\*\*|\*\*[\s\S]+?\*\*|\*[\s\S]+?\*|`[\s\S]+?`|\[[\s\S]+?\]\(.+?\))/g;
        let lastIndex = 0;
        let match;

        while ((match = regex.exec(textStr)) !== null) {
            // 處理標記符號前面的純文字
            if (match.index > lastIndex) {
                const content = textStr.substring(lastIndex, match.index);
                const block = { type: 'text', text: { content: content } };
                if (Object.keys(currentAnnotations).length > 0) block.annotations = currentAnnotations;
                richTextList.push(block);
            }

            const part = match[0];
            // 🌟 核心修改：遇到粗體或斜體時，把裡面的文字「再次丟入 parse 函式」進行遞迴檢查！
            if (part.startsWith('***')) {
                richTextList.push(...parse(part.slice(3, -3), { ...currentAnnotations, bold: true, italic: true }));
            } else if (part.startsWith('**')) {
                richTextList.push(...parse(part.slice(2, -2), { ...currentAnnotations, bold: true }));
            } else if (part.startsWith('*')) {
                richTextList.push(...parse(part.slice(1, -1), { ...currentAnnotations, italic: true }));
            } else if (part.startsWith('`')) {
                // 程式碼是最底層，直接輸出
                const block = { type: 'text', text: { content: part.slice(1, -1) }, annotations: { ...currentAnnotations, code: true } };
                richTextList.push(block);
            } else if (part.startsWith('[')) {
                // 連結處理
                const linkMatch = part.match(/\[([\s\S]+?)\]\((.+?)\)/);
                if (linkMatch) {
                    const block = { type: 'text', text: { content: linkMatch[1], link: { url: linkMatch[2] } } };
                    if (Object.keys(currentAnnotations).length > 0) block.annotations = currentAnnotations;
                    richTextList.push(block);
                }
            }
            lastIndex = regex.lastIndex;
        }

        // 處理最後剩下的字串
        if (lastIndex < textStr.length) {
            const content = textStr.substring(lastIndex);
            const block = { type: 'text', text: { content: content } };
            if (Object.keys(currentAnnotations).length > 0) block.annotations = currentAnnotations;
            richTextList.push(block);
        }
        return richTextList;
    }

    // 啟動第一層解析
    return parse(text, {});
}