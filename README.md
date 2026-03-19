# OCACAPP — 知識問答助手

一個輕量、可部署於 GitHub Pages 的知識問答 chatbot。知識來源透過定時爬取指定網站 + 手動 Q&A 檔案建立，所有搜尋在客戶端完成，不需要後端伺服器。

## 架構

```
OCACAPP/
├── site/                    # 前端靜態檔（部署到 GitHub Pages）
│   ├── index.html
│   ├── css/style.css
│   ├── js/chatbot.js
│   └── knowledge_base.json  # 自動產生的知識庫
├── scraper/                 # Python 爬蟲
│   ├── scraper.py
│   ├── config.json          # 爬取目標設定
│   └── requirements.txt
├── data/
│   ├── qa/                  # 手動 Q&A 檔案（JSON 格式）
│   └── scraped/             # 爬取的原始資料備份
└── .github/workflows/
    └── scrape.yml           # 定時自動爬取 (GitHub Actions)
```

## 快速開始

### 1. 設定爬取來源

編輯 `scraper/config.json`：

```json
{
  "sources": [
    {
      "url": "https://your-site.com/faq",
      "selector": "main",
      "name": "Your FAQ Page"
    }
  ]
}
```

- `url`: 要爬取的頁面網址
- `selector`: CSS 選擇器，指定要擷取的頁面區域（如 `main`, `#content`, `.article-body`）
- `name`: 來源名稱（顯示用）

### 2. 新增手動 Q&A

在 `data/qa/` 放入 JSON 檔案：

```json
[
  {
    "question": "你們的營業時間？",
    "answer": "週一至週五 9:00-18:00",
    "tags": ["營業時間"]
  }
]
```

### 3. 產生知識庫

```bash
pip install -r scraper/requirements.txt
python scraper/scraper.py
```

### 4. 本地預覽

```bash
cd site
python -m http.server 8000
# 開啟 http://localhost:8000
```

### 5. 部署到 GitHub Pages

在 GitHub repo 設定中：
1. 進入 Settings → Pages
2. Source 選擇你的分支
3. 資料夾選擇 `/site`（或將 site/ 內容搬到 docs/）

## 自動更新

GitHub Actions 每日 UTC 03:00 自動執行爬蟲並更新知識庫。也可在 Actions 頁面手動觸發。

## 回應邏輯

1. **Q&A 精確匹配優先**：優先從手動建立的 Q&A 檔案中尋找匹配
2. **網頁內容搜尋**：次之從爬取的網頁內容中檢索
3. **誠實回應**：找不到相關資訊時，明確告知使用者「查無相關資訊」，不進行揣測

## 維護

- **新增網站來源**：編輯 `scraper/config.json`，加入新的 source
- **新增 Q&A**：在 `data/qa/` 新增 JSON 檔案
- **調整搜尋敏感度**：修改 `site/js/chatbot.js` 中的 `MATCH_THRESHOLD`（0 = 完全匹配，1 = 最寬鬆）
- **爬取頻率**：修改 `.github/workflows/scrape.yml` 中的 cron 設定
