# 🚕 Flow-Taxi UX Writing 寫作規範與風格準則

本專案全面導入 [UX Writing Skill](https://github.com/content-designer/ux-writing-skill) 框架標準。專案內所有使用者介面（LINE 官方帳號對話、群組通知、LIFF 網頁表單、按鈕、錯誤提示、成功確認等）皆必須嚴格遵守以下準則。

---

## 🎯 核心品質四大標準 (The Four Quality Standards)

每句出現在介面的文字都必須通過四大檢驗：

1. **有目的性 (Purposeful)**
   - 聚焦於幫助乘客或司機快速達成目標（叫車、出價、確認上車）。
   - 清楚告知「下一步該做什麼」，不提供無意義的冗餘贅字。
2. **精準簡練 (Concise)**
   - 每個字都必須有具體作用（Every word must have a job）。
   - 前置關鍵訊息（Front-load important information）。
   - 手機介面閱讀：單行建議保持在 20~30 個中文字以內，避免長篇大論。
3. **自然對話感 (Conversational)**
   - 如同專業、親切的派單專員在說話，而非冰冷的程式報錯或機械式指令。
   - 使用以使用者為核心的人稱（「您」、「您的行程」）。
   - 適度且一致地使用 Emoji 提高視覺掃描效率（但避免堆疊雜亂）。
4. **清晰明確 (Clear)**
   - 語意零歧義，費用與地點清楚透明。
   - 使用具體行動動詞（例如：「填寫登記資料」、「確認送出」），避免使用抽象的「點擊這裡」、「OK」、「提交」。

---

## 🎨 品牌語氣與情境適配 (Voice and Tone)

- **品牌核心個性 (Voice)**：專業、可靠、透明、迅速、具溫度。
- **情境語氣調整 (Tone)**：
  - **初次引導 / 歡迎 (Onboarding)**：熱情、簡潔、突出核心服務與透明費率。
  - **日常操作 / 叫車 (Routine)**：高效、直接、步驟清晰（1. 上車地點 2. 下車地點 3. 時間人數）。
  - **錯誤與異常 (Errors)**：同理心、不怪罪使用者、指引明確修復方式（`[發生什麼事] + [原因] + [如何解決]`）。
  - **成功與確認 (Success)**：肯定、明確列出關鍵資料（姓名、車號、時間）、指引下一步。

---

## 📐 常見介面元素寫作模板 (UX Text Patterns)

### 1. 按鈕與行動呼籲 (Buttons & Links)
- **原則**：動詞 + 受詞（`[Verb] [Object]`）。
- ✅ **推薦**：
  - `📝 填寫登記資料`
  - `✏️ 修改已登記資料`
  - `🚗 市區搭乘`
  - `關閉視窗 (返回 LINE)`
- ❌ **避免**：
  - `送出`、`確認`、`點我`、`了解更多`（過於籠統缺乏預期結果）。

### 2. 錯誤提示訊息 (Error Messages)
- **結構**：`[發生什麼事] + [原因] + [如何解決]`。
- ✅ **推薦**：
  - `請輸入稱呼或司機名稱`（表單即時驗證）
  - `系統查無您的登記紀錄。請點擊下方連結完成初次登記：[連結]`（系統狀態查詢）
- ❌ **避免**：
  - `錯誤 500`、`系統發生異常`、`無效的輸入`。

### 3. 成功確認訊息 (Success Messages)
- **原則**：明確確認已完成的動作，並列出關鍵數據以供安心對照。
- ✅ **推薦**：
  - `✅【品欽】你的司機資料已經建立完成！已為您正式開通派單接單權限。`
- ❌ **避免**：
  - `操作成功。`

---

## 🔍 現有介面文案審查與持續維護

專案中以下檔案的所有文案均已校對並持續遵守此規範：
- [src/services/flex-messages.ts](file:///Users/al03153758/Documents/Side_projects/taxi-dispatch/src/services/flex-messages.ts)：Flex 卡片、1:1 歡迎詞、6 大服務快捷按鈕。
- [src/handlers/line-webhook.ts](file:///Users/al03153758/Documents/Side_projects/taxi-dispatch/src/handlers/line-webhook.ts)：群組迎賓、文字直填確認、各指令回覆。
- [public/driver/register.html](file:///Users/al03153758/Documents/Side_projects/taxi-dispatch/public/driver/register.html)：LIFF 標籤、佔位符 (Placeholders)、錯誤微互動、完成表格。
