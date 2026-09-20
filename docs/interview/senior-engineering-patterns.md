# Travel Leader Agent：Senior Engineering Patterns

這份文件用來準備面試時說明本專案的工程設計。內容分成「目前已實作」與「後續可擴充」，避免把規劃中的能力描述成已完成。

## 一分鐘版本

Travel Leader Agent 是一個將 LINE 與大型旅遊文件轉成可審查行程的系統。核心設計是：讓 LLM 負責自然語言理解，讓 deterministic code 負責資料驗證與狀態轉換；原始輸入保持 immutable，所有修改透過 Draft、Proposal、Decision 與 Trip Item 留下 lineage。大型文件則切成 Import Chunk，搭配 cache、retry budget 與 partial failure handling，降低成本並限制錯誤影響範圍。

## 目前已實作的模式

### 1. Seam / Adapter

LLM provider、LINE reply、資料庫與 webhook worker 透過介面隔離。OpenAI、Grok、Fake adapter 可以互換，核心的行程流程不需要知道 provider 細節。

面試說法：

> 我把外部依賴放在 seam 後面，讓 domain workflow 可以用 Fake adapter 測試，也能在不改商業邏輯的情況下切換 LLM provider。

### 2. Immutable Source 與 lineage

使用者輸入的 Source 永不覆寫。模型解析結果先形成 Extraction Draft，再產生 Proposal；已確認資料的修改透過 Replacement Proposal 或 Removal Proposal 表達，保留 predecessor 與原始 Source。

這讓系統能回答：「這筆行程從哪裡來？誰修改了它？原本的版本是什麼？」

### 3. Idempotency

Webhook event、Source idempotency key、Import Batch 與 Chunk cache 都有穩定識別方式。重送同一事件或重跑同一批文件時，不會無限制建立重複 Source、Draft 或 Proposal。

### 4. LLM 與 deterministic guard 分工

LLM 負責理解自由格式，例如判斷住宿、路線與活動；程式負責檢查日期、時間格式、IANA timezone、Route endpoint、重複與矛盾。

這是重要的邊界：不能把資料正確性完全交給機率模型。

### 5. Import Chunk、Cache 與成本控制

大型文件會切成多個 Chunk。Cache key 依據內容 hash、相關上下文、provider、model 與 prompt version。Cache hit 不呼叫 LLM，但仍重新執行 guards。

每個 Chunk 與整個 Batch 都有 retry／provider call budget，避免局部錯誤導致整份文件重跑。

Chunk splitter 不是單純按固定字數切割，而是結構感知的切分：優先以 Markdown heading 分隔段落，接近最大行數時尋找空白行，並避免切斷 Markdown table。這能保留局部語意與鄰近日期／地點上下文，再交給相鄰 Chunk context 補足跨段資訊。

目前的限制是極短的 heading 或孤立段落可能形成一行 Chunk，增加 provider call 與 malformed output 風險。後續可加入最小 Chunk 大小，將過短區段與前後段落合併，並以 Chunk boundary regression fixtures 驗證切分品質。

### 6. Partial failure handling

某個 Chunk malformed 或 provider timeout 時，成功 Chunk 仍會保存；失敗 Chunk 帶有狀態、錯誤碼、attempts 與 retry 指令。Draft 在所有必要問題處理前維持 `pending_confirmation`。

### 7. Explicit state machine

系統將不同意義的狀態分開：

- Extraction Draft：`pending_confirmation`、`confirmed`、`failed`、`cancelled`
- Proposal：`pending`、`confirmed`、`rejected`
- Trip Item：`confirmed`、`provisional`、`cancelled` 等
- Decision：負責互斥 Proposal 的選擇

Draft 確認不會直接寫入 Effective Itinerary，必須再經過 Proposal／Decision lifecycle。

### 8. Audit 與可追溯性

Guard Revision 紀錄 deterministic correction 的 before、after、rule version 與時間。Webhook Inbox、Source、Chunk、Draft、Proposal 也都能透過 ID 串回完整處理路徑。

### 9. 權限邊界

Originating User、Decision Owner、一般 Member 與 System Administrator 的能力不同。讀取、Draft 確認、Proposal 確認、Chunk retry 與 Trip reset 不應共用同一個權限。

### 10. Replayability

Webhook Inbox 保存事件與處理狀態，Chunk 保存輸入範圍與結果，讓錯誤可以局部重試，而不是只能重新執行整個流程。

## 後續可擴充的 senior-level 能力

### Contract tests

針對 LLM input/output schema 建立 provider-neutral contract tests，確保更換模型後仍符合 domain contract。

### Golden fixtures

把真實的 `itinerary.md` 固定成 regression fixture，驗證日期、時區、route、重複候選與低資訊項目，避免 prompt 修改造成 silent regression。

### Structured logging 與 tracing

為一次 Import Batch 建立 correlation ID，串起 Source、Chunk、provider call、cache hit、guard revision 與 Proposal，並記錄 latency、錯誤率與成本。

### Property-based testing

針對跨時區日期、夏令時間、模糊時間與重送事件產生大量測試案例，找出手寫案例未涵蓋的邊界。

### Feature flags 與 prompt version rollout

以 prompt／guard version 做 cache isolation，並透過 feature flag 小比例啟用新版本，觀察錯誤率與成本後再全面切換。

### Migration and recovery drills

定期用舊版 SQLite fixture 測試 migration、backup、restore 與 archived trip recovery，確保 schema 演進不破壞歷史資料。

## 面試回答框架

遇到「為什麼不用 LLM 直接改資料庫？」時，可以回答：

> LLM 輸出是 probabilistic，因此我把它放在 Extraction Draft 層；Source 保持 immutable，deterministic guards 做結構驗證，Proposal／Decision lifecycle 負責人類確認，最後才進入 Effective Itinerary。這樣可以保留證據、控制錯誤影響，也能局部重試與稽核。

遇到「如何控制成本？」時，可以回答：

> 我把文件切成 Chunk，使用 content/context/model/prompt version cache，並限制 Chunk attempts 與 Batch provider budget。局部失敗只重試失敗 Chunk，cache hit 仍執行 guards，因此兼顧成本與資料安全。

遇到「如何處理模型不可靠？」時，可以回答：

> 模型只負責理解語意；日期、時間、timezone、route endpoint、重複與衝突由 deterministic guard 驗證。無法安全判斷時保留 Source 並建立 Review Issue，而不是猜一個值寫入行程。
