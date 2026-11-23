# Kalamos 所見即所得編輯器 → Notepad++ 外掛：評估報告與實作計畫

> 文件用途：這份文件是自足的交接文件。日後若決定開工，把它上傳給 Claude，即可依第 8 節的「接續工作指引」直接繼續，不必重做研究。
> 撰寫日期：2026-11-23
> 語言：正體中文（台灣用語）

---

## 0. 一頁摘要

**目標**：在 Notepad++ 裡就地（in place）以所見即所得（WYSIWYM，Typora 風格）方式編輯 Markdown，功能對標 Kalamos。不是預覽面板，也不是啟動外部程式。

**結論**：可行，值得做，但它是一個獨立的大專案，不是移植。粗估 **55～70 人日**（顧問估算，未經原型驗證；見第 6 節的修正說明，實際可能偏高）。

**為什麼值得做**：
- Notepad++ 的外掛清單（x64 共 229 個）裡有十幾個 Markdown 外掛，但**全部是唯讀預覽，沒有任何一個能在 WebView 內編輯並寫回**。這是空缺。
- Kalamos 的編輯器核心幾乎不依賴 Tauri，可以抽出來重用。
- 「覆蓋在編輯區上」的做法已有兩個上架外掛使用（MarkdownReader、xsvViewer++），有前例可循。

**推薦架構**：
- 每個視圖各放一個「兄弟覆蓋視窗」（sibling overlay），內含 WebView2 與 CodeMirror 6。
- **Scintilla 保持可見，只是被蓋住**，並且是**唯一的資料來源與唯一的復原堆疊**。
- CodeMirror 的變更以增量方式寫回 Scintilla；Scintilla 的變更反向同步回 CodeMirror。
- Notepad++ 的快速鍵由外掛從 WebView2 轉投遞回主視窗。

**最大單一風險**：覆蓋視窗、焦點、快速鍵與中文輸入法（IME），能否和 Notepad++ 的視窗管理穩定共存。必須先做 M0 原型驗證，再投入完整開發。

**此環境的限制**：研究是在 Linux 雲端容器完成，無法編譯或測試 Windows DLL。實作需要在 Windows 機器或 CI 上進行。

---

## 1. 資料來源與可信度

### 1.1 已閱讀的來源

| 來源 | 內容 | 版本／狀態 |
|---|---|---|
| `https://github.com/kkdai/Kalamos` | Kalamos 原始碼 | v0.4.0（tag commit `66dcf23`）；clone 時 HEAD 為 `1e55db4`；MIT 授權 |
| `https://github.com/notepad-plus-plus/notepad-plus-plus` | Notepad++ 原始碼 | v8.9.9.1（`resource.h:22`）；Scintilla 5.6.9（`scintilla/version.txt`） |
| `https://github.com/notepad-plus-plus/nppPluginList` | 官方外掛清單（`pl.x64.json`、`pl.arm64.json`、`pl.schema`、`validator.py`） | 淺層 clone |
| MarkdownReader、xsvViewer++ | 顧問額外 clone 的兩個現成外掛，作為覆蓋法的實作參考 | 唯讀，僅供參考 |

### 1.2 未能讀取的來源

- **`https://notepad-plus-plus.org/resources/` 無法連線**（此環境的網路政策擋住該網域，DNS 解析失敗）。因此官網資源頁與官方外掛開發文件**沒有讀過**，本文件未引用其內容。
- 若日後網路允許，建議補讀官方外掛開發文件，與下方「憑原始碼」的結論交叉比對。

### 1.3 標記規則

- **【見】**：在原始碼中實際看到，附路徑與行號。Notepad++ 路徑一律從 `PowerEditor/src/` 起算；Scintilla 寫成 `scintilla/...`。
- **【推】**：推測或既有知識，未在原始碼查證。
- **行號可能隨版本變動**。行號出自 Notepad++ v8.9.9.1 的淺層 clone；開工前請用 `grep` 重新定位，不要盲信行號。
- 本文件的技術細節多數出自 Opus 顧問閱讀原始碼的報告，主持人（Claude）**未逐項重驗行號**。

---

## 2. 兩個專案的關鍵事實

### 2.1 Kalamos

- 桌面 Markdown 編輯器，Tauri 2（Rust 後端）+ TypeScript 前端 + CodeMirror 6，WebView2（Windows）／WKWebView（macOS）。
- Windows 版標示為 **Experimental**、未簽章；沒有 Linux 版。
- 規模：Rust 後端約 8,000 行；前端 TypeScript 約 22,000 行（`src/editor/` 含測試）；`src/main.ts` 與 `src/ipc.ts` 各約 2,054 行。
- **沒有公開的 API、函式庫或外掛系統**，README 也聲明不做外掛市集。
- Windows 檔案關聯註冊了 `.md`、`.markdown`、`.mdown`、`.mkd`、`.mkdn`、`.mdwn`、`.mdtxt`；有 single-instance（第二次啟動會把檔案轉給既有視窗）。命令列可傳路徑，但沒有文件化的旗標。
- Tauri CSP 設定在 `src-tauri/tauri.conf.json`；圖片走 asset 協定。

**對移植有利的事實【見】**：
- 前端對 Tauri 的直接依賴集中在 `src/ipc.ts` 與 `src/editor/live-preview.ts`。
- `src/editor/` 只透過三處依賴外部：`live-preview.ts:17-18,111-112`（`openUrl`、`isTauri`）、`images.ts:20-25`（`allowAssetDir`、`allowAssetFile`、`localFileUrl`）。
- `ipc.ts` 已有瀏覽器替身分支（`isTauri()`，`:198-204`），不成立時走 mock，是現成的抽換縫。
- 編輯器 API 已具備多文件能力（`src/editor/index.ts`）：
  - 每份文件一個 `DocSession`，以 `switchSession` 切換（`:99-109`、`:139-146`），各自保有復原歷史。
  - `ExternalLoadAnnotation`（`:49`、`:311-316`）讓外部載入不觸發 `onUserChange`。
  - CRLF 由 `lineSeparatorCompartment` 處理（`:217-218`、`:262`）。
- IME 已有處理：`tables.ts:1661-1683`、`code-blocks.ts:442-477` 處理 composition 事件。

**對移植不利的事實【見】**：
- `onUserChange` **每次都回傳全文**（`index.ts:317-319`），不能直接用來做增量同步，必須新增增量掛鉤。
- `ipc.ts` 不只用 `invoke`，還用到 `listen`（fs-changed `:956`、open-files `:1587`、menu-action `:1997`）、`setTitle` `:1238`、`onCloseRequested` `:1269`、`onDragDropEvent` `:1535`、`setZoom` `:2033`、對話框 plugin `:10`、`convertFileSrc` `:1524-1529`。
- `src-tauri/src/lib.rs:52-82` 的 `generate_handler!` 共 **29 個**指令。

### 2.2 Notepad++ 外掛生態

- x64 清單 229 個外掛、arm64 清單 70 個。
- Markdown／WebView2 相關外掛（皆為唯讀預覽）：Markdown Features、Markdown with Mermaid、MahiMarkD++（含 arm64）、NppMarkdownNext、Preview HTML、MarkdownViewer++、Markdown Panel、MarkLens、Modern Markdown viewer、Another Markdown（需 .NET）等。
- **承載方式**：多數用停靠面板；**MarkdownReader**（需 ≥ 8.7.7，含 arm64）用兄弟覆蓋法；xsvViewer++（需 ≥ 8.9.8.1）也用兄弟覆蓋法。
- Plugins Admin 上架規格見第 4.8 節。

---

## 3. 架構決策

### 3.1 比較的三種承載方式

| 方式 | 就地體驗 | 結論 |
|---|---|---|
| **A. 兄弟覆蓋視窗**（推薦） | 是 | 已有兩個上架外掛使用；目前最穩 |
| B. 停靠面板 | 否（並排兩份） | **排除**：沒有 Center 容器、勿擾模式會隱藏全部面板 |
| C. 把 host 做成 Scintilla 子視窗 | 理論上是 | 備案：會與 Scintilla 捲軸和內部繪製衝突，無前例【推】 |

查證依據【見】：
- 停靠管理器只有 LEFT／RIGHT／TOP／BOTTOM 四個容器（`WinControls/DockingWnd/Docking.h:25-29`，`DOCKCONT_MAX=4`），外加浮動；沒有 Center。
- 勿擾模式隱藏所有停靠容器（`Notepad_plus.cpp:6476-6480`）。
- Notepad++ 沒有任何「以外掛視窗取代編輯區」的 API。

### 3.2 推薦架構的具體定義

1. **視窗**：為每個 Scintilla 視圖（主、副）建立一個覆蓋 host（`GetParent(scintilla)` 的子視窗），`HWND_TOP`，內含 WebView2。
2. **Scintilla 必須保持可見**。Notepad++ 以 `isVisible()` 管理視圖狀態（`Notepad_plus.cpp:5212、6455`），隱藏它會破壞版面邏輯。
3. 替 Scintilla 加上 `WS_CLIPSIBLINGS`（它預設只有 `WS_CHILD|WS_VSCROLL|WS_HSCROLL|WS_CLIPCHILDREN`，`ScintillaEditView.cpp:366`），否則重繪時會蓋掉覆蓋層。
4. 以 `SetWindowSubclass` 子類別化 Scintilla，監看 `WM_WINDOWPOSCHANGED`、`WM_SHOWWINDOW`、`WM_SETFOCUS`，用 `GetWindowRect` 同步覆蓋層的位置（MarkdownReader 的做法，`ReadingOverlay.cpp`）。
5. **Scintilla 是唯一資料來源與唯一復原堆疊**。CodeMirror 的 history 關閉。
6. **提供「原始碼模式」快速鍵**：一鍵讓覆蓋層讓位（不是隱藏 Scintilla，而是把覆蓋層隱藏／移到後面），回到純 Scintilla 編輯。

### 3.3 版面配置流程（理解覆蓋層為何要自己同步）【見】

主視窗 `WM_SIZE` → `_dockingManager.reSizeTo(rc)`（`NppBigSwitch.cpp:814-830`）→ `(*_ppMainWindow)->reSizeTo(_rcWork)`（`DockingManager.cpp:562`）→ `DocTabView::reSizeTo` → `_pView->reSizeTo`（`DocTabView.cpp:263-283`）→ `::MoveWindow`（`Window.h:45,51`）。

- 兩個主 Scintilla 都是 Notepad++ 主視窗的**直接子視窗**，不是 DocTabView 的子視窗（`Notepad_plus.cpp:290-291`）。
- 分割視圖的顯示／隱藏：`showView`/`hideView` 直接呼叫 `display(true/false)` 並送 `WM_SIZE`（`Notepad_plus.cpp:4813-4890`）。
- 主視窗 `WM_SIZE` 會經 `relayNppMessages` 轉給外掛的 `messageProc`（`NppBigSwitch.cpp:844、4653`），但 **`WM_COMMAND` 是 `return TRUE`（`:1022`），外掛收不到**。
- **沒有任何 NPPN_ 通知是專為版面改變設計的**。

---

## 4. 技術設計

### 4.1 外掛介面（必要匯出）【見】

- `NppData` 三欄位：`_nppHandle`、`_scintillaMainHandle`、`_scintillaSecondHandle`（`MISC/PluginsManager/PluginInterface.h:30-35`）。
- `FuncItem`：`_itemName[64]`、`_pFunc`、`_cmdID`、`_init2Check`、`_pShKey`（同檔 `:53-60`）。
- 六個匯出函式（同檔 `:65-72`；`PluginsManager.cpp` 載入時逐一檢查）：
  - `isUnicode`（必須存在且回傳 TRUE，`:141`）
  - `setInfo`（`:145`，先於 `getFuncsArray` 呼叫，`:163`）
  - `getName`（`:150`）
  - `beNotified`（`:155`）
  - `messageProc`（`:159`）
  - `getFuncsArray`（`:165`；`nbFunc` 必須大於 0，`:171`）
- **沒有「外掛宣告最低版本」的匯出函式**。相容性只有兩個來源：
  - Plugins Admin 清單中的 `npp-compatible-versions`／`old-versions-compatibility`（只對清單上版本對得上的 DLL 生效，`PluginsManager.cpp:353-416`）。
  - 外掛自己執行期以 `NPPM_GETNPPVERSION` 判斷（`Notepad_plus_msgs.h:400`）。

### 4.2 雙向同步設計

**CodeMirror → Scintilla（主流量）**
1. 在 Kalamos 編輯器新增 `onChanges(tr)` 掛鉤（取代回傳全文的 `onUserChange`，`index.ts:311-320`）。
2. 以 `changes.iterChanges` 產生 `{rev, [{fromLine, fromCol16, toLine, toCol16, text}]}`。
3. 外掛端以 `SCI_BEGINUNDOACTION` 包住，依序呼叫 `SCI_DELETERANGE`（`Scintilla.h:53`）與 `SCI_INSERTTEXT`（`:50`），最後 `SCI_ENDUNDOACTION`（`:357-358`）。

**位置換算（高風險，需模糊測試）**
- Scintilla 用 UTF-8 位元組、CRLF 算 2；CodeMirror 用 UTF-16 code unit、換行算 1。
- 因此**一律用「行號＋UTF-16 欄」傳遞位置**，不要傳 offset。
- 外掛端需自行配置 line character index（Notepad++ 本身沒配置）【見】：
  - `SCI_ALLOCATELINECHARACTERINDEX`（2711）搭配 `SC_LINECHARACTERINDEX_UTF16`（2）（`Scintilla.h:1202-1204`）
  - `SCI_INDEXPOSITIONFROMLINE`（2714，`:1207`）、`SCI_LINEFROMINDEXPOSITION`（`:1206`）
  - `SCI_POSITIONRELATIVECODEUNITS`（2716，`:924`）、`SCI_COUNTCODEUNITS`（2715，`:493`）

**Scintilla → CodeMirror（反向）**
1. 監聽 `SCN_MODIFIED`（`SC_MOD_INSERTTEXT`／`SC_MOD_DELETETEXT`），用 `position`、`length`、`text` 組出變更。
2. **預設遮罩只有 DELETE、INSERT、UNDO、REDO、CHANGEINDICATOR**（`Parameters.h:2010`）。若要在刪除前記錄行／欄，需用 `NPPM_ADDSCNMODIFIEDFLAGS` 加上 `SC_MOD_BEFOREDELETE`（`NppBigSwitch.cpp:4173-4180`）。**不要**自己呼叫 `SCI_SETMODEVENTMASK`，下次換頁會被 Notepad++ 覆寫。
3. 送進 CodeMirror 時使用自訂 annotation 並 `addToHistory(false)`。
4. **組字中（`view.composing`）不得套用反向同步**，等組字結束再套用，否則會中斷輸入法。

**防回音迴圈**
- C++ 端：套用來自 Web 的變更時設 `applyingFromWeb` 重入旗標，期間略過 `SCN_MODIFIED`。
- JS 端：以 annotation 辨識外部變更，不再回送。
- 雙方各維護遞增 `rev`；基準版本不符時，以 Scintilla 為準做一次全量重同步（`SCI_GETTEXT` → `setContent` → 還原選取）。
- **全量取代只用於**：啟用分頁、外部重載、版本不同步。絕不能每次按鍵都做（會清掉裝飾快取與復原歷史）。

**必須處理的 Notepad++ 特殊行為【見】**
- **切換分頁會替換 document pointer**：`activateBuffer` 先關事件遮罩，再 `SCI_SETDOCPOINTER`，再重設遮罩（`ScintillaEditView.cpp:2371-2374`）。**換頁時不會產生 `SCN_MODIFIED`**。
- **`NPPN_BUFFERACTIVATED` 不夠用**：`Notepad_plus.cpp:7041` 有 `if (view != currentView()) return;`，**非作用中視圖換文件時不會通知**；通知發送位置在 `:7062`。
- **Replace All 不送 `SCN_MODIFIED`**：期間遮罩設為 0（`FindReplaceDlg.cpp:3428`），結束後改發 `NPPN_GLOBALMODIFIED`，`hwndFrom` 放 Buffer*（`NppBigSwitch.cpp:4147-4151`；`Notepad_plus_msgs.h:1268-1271`，v8.6.5 加入）。
- **背景 buffer 被改時外掛收不到通知**（例如「在所有已開文件中取代」走 `_invisibleEditView`；重新載入走 `_fileEditView`，其遮罩是 OFF，`Notepad_plus.cpp:294`【推】）。
- 因此：**每個 buffer 的 `DocSession` 只能當快取**。每次啟用時以 Scintilla 為準比對（`SCI_GETUNDOCURRENT`，`Scintilla.h:368`，加上長度或雜湊）。
- 偵測換頁：由於 Scintilla 子類別化看不到 direct function 呼叫（Notepad++ 一律用 direct function，`ScintillaEditView.h:276-278`），需另外在 `WM_PAINT`、`SCN_UPDATEUI` 或計時器中比對 `SCI_GETDOCPOINTER`（`Scintilla.h:833`）。
- 同一份文件開在兩個視圖時，兩個 Scintilla 各送一次 `SCN_MODIFIED`【推】，需去重。

### 4.3 復原／重做

- 關閉 CodeMirror 的 history（`index.ts:309` 的 `historyKeymap` 移除），**Ctrl+Z／Y 轉給 Notepad++**，只保留一個復原堆疊（Scintilla）。
- 內建命令分派【見】：`IDM_EDIT_UNDO` 對 `_pEditView` 送 `WM_UNDO`，`IDM_EDIT_REDO` 送 `SCI_REDO`（`NppCommands.cpp:477-492`）。
- 驗收：Ctrl+Z 一次只撤銷一個 CodeMirror 交易；存檔後 `SCN_SAVEPOINTREACHED`／`SCN_SAVEPOINTLEFT`（`Scintilla.h:1316-1317`）狀態正確。

### 4.4 鍵盤與焦點（前一輪遺漏的重大缺口）

**主訊息迴圈【見】**（`winmain.cpp:1008-1018`）：
1. `isDlgsMsg`：依序處理 TabSwitch、IncrFind、Find 三組加速鍵，再對 `_hModelessDlgs` 逐一呼叫 `IsDialogMessageW`（`Notepad_plus_Window.cpp:456-472`）。
2. `TranslateAccelerator(主視窗, 主加速鍵表)`。
3. 最後 Translate／Dispatch。

**問題**：WebView2 的鍵盤輸入發生在瀏覽器行程【推】，Notepad++ 的 `TranslateAccelerator` 看不到，所以 Ctrl+S、Ctrl+Tab、Ctrl+F、F3 預設到不了 Notepad++。

**解法（MarkdownReader 的做法，`WebViewHost.cpp:297-330`【見】）**：
- 在 WebView2 的 `AcceleratorKeyPressed` 事件中，把**帶 Ctrl／Alt 的鍵與 F 鍵**以 `PostMessage WM_KEYDOWN` 重新投遞到 Notepad++ **主視窗**，交給主迴圈的加速鍵表處理。使用者自訂快速鍵也因此生效。
- **Ctrl+C／X／V／A 留在網頁內處理**：因為 `IDM_EDIT_CUT/COPY/PASTE` 在焦點不是 Scintilla 時，會對 `GetFocus()` 送 `WM_CUT`／`WM_PASTE`（`NppCommands.cpp:495-530, 639-660`），對 Chromium 視窗無效。

**其他【見】**：
- `ScintillaAccelerator` 是用 `SCI_ASSIGNCMDKEY` 把按鍵寫進 Scintilla 本身（`shortcut.cpp:1122-1140`），不在訊息迴圈處理。
- `StaticDialog` 建立時會自動以 `NPPM_MODELESSDIALOG` 註冊（`StaticDialog.cpp:536`）。
- **外掛無法查詢或攔截內建快速鍵**：`NPPM_GETSHORTCUTBYCMDID` 只查得到外掛自己的命令（`NppBigSwitch.cpp:1089-1094`）；唯一攔截手段是子類別化主視窗，或掛 `WH_GETMESSAGE` hook（xsvViewer++ 的做法）。
- Kalamos 自己的快速鍵（`keymaps.ts:275-297` 的 `Mod-s/o/n`）要改綁或停用，避免與 Notepad++ 衝突。

### 4.5 編碼與換行

- **`NPPM_GETCURRENTLINEENDING` 不存在**。正確訊息【見】：
  - `NPPM_GETBUFFERFORMAT`：0=CRLF、1=CR、2=LF（`Notepad_plus_msgs.h:524`；處理 `NppBigSwitch.cpp:646`）
  - `NPPM_GETBUFFERENCODING`：回傳 UniMode，0=ANSI…7（`Notepad_plus_msgs.h:501`；處理 `NppBigSwitch.cpp:615`）
- **沒有任何 NPPM 能取得 `Buffer::_encoding`**；外掛必須問 `SCI_GETCODEPAGE`（`Scintilla.h:505`）。
- Scintilla codepage 規則【見】（`ScintillaEditView.cpp:2486-2504`）：各種 Unicode 編碼一律 `SC_CP_UTF8`；uni8Bit（ANSI）在 CJK 系統上用系統 codepage（如 950），否則 `CP_ACP`。使用者明確選了字元集（如 Big5）時，載入轉成 UTF-8（`Buffer.cpp:2224, 2384, 2423`），存檔轉回（`:1386`）。
- **M0／MVP 決策**：只支援 UTF-8；非 UTF-8 的 codepage（ANSI、Big5 等 DBCS）先**唯讀**或不啟用覆蓋層。後續再用 `MultiByteToWideChar` 轉換。

### 4.6 深色模式與工具列【見】

NPPMSG = `WM_USER+1000` = 2024。
- `NPPM_ISDARKMODEENABLED`＝+107＝2131（`Notepad_plus_msgs.h:851`）
- `NPPM_GETDARKMODECOLORS`＝+108＝2132（`:858`）：`wParam` 必須等於 `sizeof(Colors)`（12 個 COLORREF，`NppDarkMode.h:28-42`），檢查在 `NppBigSwitch.cpp:3810`
- `NPPN_DARKMODECHANGED`＝1027（`:1235`；發送位置 `NppBigSwitch.cpp:400`）
- `NPPM_ADDTOOLBARICON_FORDARKMODE`＝+101（`:800`），用 `toolbarIconsWithDarkMode{hBmp, hIcon, hIconDark}`，要在 `NPPN_TBMODIFICATION`（`Notepad_plus.cpp:789`）時呼叫
- `NPPM_DARKMODESUBCLASSANDTHEME`＝+112（`:912`）
- 各訊息引入版本【推】：dark 系列 v8.0、SUBCLASSANDTHEME 約 v8.5.4、ADDSCNMODIFIEDFLAGS v8.7.7（淺層 clone 無歷史可佐證）。
- 對應：把 Notepad++ 的深／淺色映射到 Kalamos 的主題（內建 melan／papyros 等）。

### 4.7 外掛載入與安全【見】

- DLL 路徑：`<npp>\plugins\<資料夾>\<資料夾>.dll`，跳過 `Config` 與 disabled（`PluginsManager.cpp:317-372`）。
- 以 `LoadLibraryEx` + `LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR` 載入（`:130`），所以 **`WebView2Loader.dll` 可放在同一資料夾**。
- 會檢查 PE 架構，x86／x64／arm64 不可混用（`:56-127`）。
- **外掛 DLL 不做簽章檢查**；只有 `nppPluginList.dll` 與 GUP 會用 `SecurityGuard` 驗證（`pluginsAdmin.cpp:822-828`）。
- 外掛設定目錄：`NPPM_GETPLUGINSCONFIGDIR`（`NppBigSwitch.cpp:3356`）。可攜版 `<npp>\plugins\Config`；安裝版 `%APPDATA%\Notepad++\plugins\Config`（`Parameters.cpp:1336-1362`）。
- **WebView2 userDataFolder 必須指到外掛設定目錄**（預設在 exe 旁，Program Files 不可寫）【推】。
- WebView2 Runtime 偵測：`GetAvailableCoreWebView2BrowserVersionString`；沒裝就提示；外掛描述欄寫上 `[Requires Microsoft Edge WebView2 Runtime]`（比照其他外掛）。

### 4.8 Plugins Admin 上架規格

出自 `nppPluginList` 的 `pl.schema` 與 `validator.py`：

- 頂層必填：`name`（固定 `npp-pluginList`）、`version`（pattern `^\d+(\.\d+){,3}$`）、`arch`（`32`／`64`／`arm64`）、`npp-plugins`。
- 每個外掛必填：`folder-name`、`display-name`、`version`、`id`、`repository`、`description`、`author`、`homepage`。可選：`npp-compatible-versions`、`old-versions-compatibility`。
- `id`：64 位十六進位字串，**必須等於 zip 的 SHA-256**（`validator.py:241-244`）。
- zip 內必須含 `<folder-name>.dll`，比對完整路徑，**DLL 必須放在 zip 根目錄**（`:254-263`）。
- DLL 的版本資源補齊四段後，**必須等於 JSON 的 `version`**（`:270-283`）。
- `repository` 為 URI；`homepage` 可為空字串或 URI。
- 清單分 `pl.x86.json`、`pl.x64.json`、`pl.arm64.json` 三份。
- README 的收錄規則僅寫「任何外掛都歡迎提交，請先在本機測試」，沒有更嚴格門檻。
- 建議 `npp-compatible-versions` 設為 `[8.4.1,]`【推；依深色模式訊息引入版本決定；若使用 ADDSCNMODIFIEDFLAGS 則需 ≥ 8.7.7，見風險表】。
- zip 結構建議：根目錄放 `Kalamos.dll`（等於 `folder-name`）、`web\`（Vite 產出）、`WebView2Loader.dll`（若動態載入）、`LICENSE`。x64 與 arm64 各一個 zip。

---

## 5. 前端抽取計畫

### 5.1 保留

`src/editor/**`、`src/platform.ts`、`src/styles`、`src/theme`、`src/export/html.ts`（以後匯出用）。

### 5.2 改寫

- 新增 `ipc-npp.ts`，匯出與 `ipc.ts` 同名的函式，內部走 `window.chrome.webview.postMessage`（附 request-id 與回應）。
- 新增約 300 行的 `npp-main.ts` 取代 `main.ts`。
- 編輯器新增增量變更掛鉤 `onChanges(tr)`，並關閉 history。

### 5.3 從 `main.ts` 丟棄的區塊（行號出自 clone 當時的 HEAD `1e55db4`，開工前請重新定位）

- 分頁 `548-914`
- 選單同步與分派 `1011-1130`、`1175-1268`
- Windows 快捷浮鈕 `1142-1174`
- Pandoc 與匯出 `1321-1449`、`1712-1746`
- 開檔／存檔／新檔 `1598-1711`
- 復原檔 `1450-1462`、`1747-1775`
- 關窗／結束 `1776-1867`
- 側邊欄與檔案樹（`src/sidebar`）、`src/tabs`、`src/menu`

**保留**：`applyTheme`（`:164`）、`setStatus`、圖片根目錄 `1269-1320`、貼上與拖放圖片 `1463-1597` 的核心部分。

### 5.4 29 個 Tauri 指令的處置

| 處置 | 指令 |
|---|---|
| **刪除，交給 Notepad++（16 個）** | `open_file`、`save_file`、`create_file`、`rename_path`、`trash_path`、`read_tree`、`list_files`、`watch_folder`、`search_in_folder`、`write_recovery`、`list_recovery`、`clear_recovery`、`take_pending_open_files`、`sync_menu_state`、`quit_app`、`open_themes_dir` |
| **MVP 必須橋接（6 個）** | `get_settings`、`set_settings`（存到 `NPPM_GETPLUGINSCONFIGDIR`）、`allow_asset_dir`、`allow_asset_file`（改成虛擬主機或請求攔截授權）、`import_image`、`import_image_bytes` |
| **後期再做（7 個）** | `list_themes`、`read_theme_css`、`export_pdf`、`pandoc_status`、`export_pandoc`、`import_pandoc`、`upload_images` |

**新增橋接**：`open_url`（取代 plugin-opener）、`open_relative`（`NPPM_DOFILEOPEN`）、`get_doc_path`（`NPPM_GETFULLCURRENTPATH`）、`zoom`、`save`（轉給 Notepad++ 的存檔命令）。

**PDF 匯出**：可改用 WebView2 的 `PrintToPdf`（`ICoreWebView2_7`）【推】，不必再走 `export.rs:323-413` 的無頭 Edge。

### 5.5 打包與載入

- **建置**：Vite 產出單一 `dist/` 靜態目錄；保留 `vite.config.ts` 的 `PACKAGE_VERSION` define（mathjax 需要）。
- **載入**：`SetVirtualHostNameToFolderMapping("kalamos.npp", <plugin>\web)`，從 `https://kalamos.npp/index.html` 載入。**不建議 `file://`**（module 與 CSP 麻煩）。
- **本機圖片**：取代 `localFileUrl`（`ipc.ts:1524-1529`），改成 `https://localfile.npp/<encoded path>`；C++ 端以 `WebResourceRequested` 回應，並重做 `images.rs:306-330` 的範圍檢查（不允許整個家目錄、只允許圖片副檔名）。
- **CSP**：從 `tauri.conf.json` 移到 `index.html` 的 meta 標籤；`connect-src` 拿掉 `ipc:`；`img-src` 把 `asset:` 換成 `https://localfile.npp`；`style-src 'unsafe-inline'` 保留。
- **字型**：`@fontsource/noto-*-tc` 很大，建議改用系統字型（微軟正黑體）縮小 zip【推】。

---

## 6. 風險登記表

| # | 風險 | 可能性 | 嚴重度 | 緩解／需先做的驗證 |
|---|---|---|---|---|
| R1 | 覆蓋層與 Notepad++ 版面不同步（分割視圖、切分頁、全螢幕、勿擾模式、文件地圖、函式清單、Post-it） | 高 | 高 | **M0 驗證 #1**；子類別化 + `WS_CLIPSIBLINGS` |
| R2 | 鍵盤／焦點：加速鍵進不到 Notepad++；Ctrl+C/X/V 不能轉發 | 高 | 高 | **M0 驗證 #2**；`AcceleratorKeyPressed` 轉投遞 |
| R3 | 中文 IME：候選窗位置；組字中收到反向同步而中斷 | 中 | 高 | **M0 驗證 #2**；組字中延後反向同步 |
| R4 | CRLF／UTF-16 位置換算錯一格造成內容損毀 | 中 | **極高** | 單元測試 + 模糊測試（M1 驗收） |
| R5 | 換分頁偵測不完整（非作用中視圖、`SCI_SETDOCPOINTER` 看不到） | 高 | 高 | 比對 `SCI_GETDOCPOINTER`；啟用時以 Scintilla 為準 |
| R6 | Replace All／背景 buffer 修改收不到通知 | 中 | 高 | `NPPN_GLOBALMODIFIED`；工作階段只當快取 |
| R7 | 大型檔案（≥5 MB）：表格／數學／圖表裝飾掃描全文 + 同步序列化 | 中 | 中 | M0 量測；必要時降級為原始碼模式 |
| R8 | 非 UTF-8 編碼（Big5／ANSI） | 中 | 中 | MVP 只支援 UTF-8，其餘唯讀 |
| R9 | 巨集錄製、其他外掛同時修改內容 | 中 | 低 | 反向同步涵蓋 |
| R10 | WebView2 未安裝／企業環境停用 | 低 | 中 | 偵測並提示；退回純 Scintilla |
| R11 | mermaid、mathjax 讓冷啟動變慢（數百毫秒【推】） | 中 | 低 | 量測；延遲載入 |
| R12 | 最低相容版本：ADDSCNMODIFIEDFLAGS 需 ≥ v8.7.7，dark mode 系列需 ≥ v8.0 | 中 | 中 | 依實際使用的訊息決定 `npp-compatible-versions`；舊版降級處理 |
| R13 | Kalamos Windows 版自身標示 Experimental；上游前端變動 | 中 | 中 | 抽出後 fork 維護；鎖定 commit；保留 MIT 授權聲明 |
| R14 | **工作量估算偏樂觀**：顧問的 55～70 人日未計入鍵盤轉發、換頁偵測、背景 buffer 比對等新增項目 | 高 | 中 | M0 後重新估算 |

---

## 7. 里程碑與工作項目（可依循的 Work Breakdown）

> 人日為顧問粗估（以熟悉 Win32 與 TypeScript 的資深工程師計）；第二輪查證後新增的工作未計入，詳見 R14。

### M0：原型（約 8～10 人日）— **決定是否繼續的關卡**

**目標**：驗證覆蓋法在 Notepad++ 內穩定可用。

工作項目：
- [ ] M0-1 建立 C++ 外掛骨架（Win32、六個匯出函式、`FuncItem`、基本選單命令「切換所見即所得」）。
- [ ] M0-2 建立 WebView2 host：兄弟覆蓋視窗、`HWND_TOP`、替 Scintilla 加 `WS_CLIPSIBLINGS`、子類別化同步位置與焦點。
- [ ] M0-3 把 Kalamos 編輯器抽成可獨立載入的 Vite bundle（先不做橋接，只載入編輯器核心與固定內容）。
- [ ] M0-4 單向全量同步（Scintilla → CodeMirror 載入；CodeMirror → Scintilla 以全量取代即可）。
- [ ] M0-5 加速鍵轉投遞（`AcceleratorKeyPressed` → `PostMessage` 到主視窗），Ctrl+C/X/V/A 留在網頁。
- [ ] M0-6 量測：開啟 5 MB 檔案的時間與記憶體。

**驗收標準（三項缺一不可）**：
1. **覆蓋穩定性**：縮放視窗、拖分割線、開關文件地圖與函式清單、隱藏分頁列、全螢幕、勿擾模式、Post-it、開關分割視圖、把文件搬到另一個視圖——每個操作後，覆蓋層與 Scintilla 位置誤差 **0 px**，無閃爍或殘影；Scintilla 被替換文件後 100 ms 內覆蓋層換成正確內容。
2. **鍵盤與焦點**：在 CodeMirror 內按 Ctrl+S、Ctrl+Tab、Ctrl+F、F3、Ctrl+W、使用者自訂快速鍵，全部觸發 Notepad++ 命令；Ctrl+C/X/V/A 與注音／倉頡組字留在 CodeMirror；切換分頁或 Find 之後焦點回到覆蓋層。
3. **雙向增量同步與單一復原**（可用 M0 後段的簡化版驗收）：含中文、emoji 與 CRLF 混合的 UTF-8 檔，在 CodeMirror 連續編輯 1000 次，再做 Notepad++ 的 Undo／Redo、Replace All、外部修改後重載，兩端全文逐位元組相同；Ctrl+Z 一次只撤銷一個 CodeMirror 交易；存檔後 `SCN_SAVEPOINT` 狀態正確。

**Go／No-Go**：若驗收 #1 或 #2 無法達成，停止並改走「方案 A 啟動器外掛」或「現成預覽外掛」。

### M1：MVP（約 20～25 人日）

- [ ] M1-1 增量雙向同步（第 4.2 節完整實作）：`onChanges` 掛鉤、行＋UTF-16 欄位置換算、`BEGIN/ENDUNDOACTION`、`SCN_MODIFIED` 反向同步、`rev` 與重入旗標。
- [ ] M1-2 關閉 CodeMirror history，Undo／Redo 轉給 Notepad++。
- [ ] M1-3 每個 buffer 一個 `DocSession`；`NPPN_BUFFERACTIVATED` + `SCI_GETDOCPOINTER` 比對；啟用時以 Scintilla 為準校驗。
- [ ] M1-4 `NPPM_ADDSCNMODIFIEDFLAGS`、`NPPN_GLOBALMODIFIED` 處理；組字中延後反向同步。
- [ ] M1-5 原始碼模式切換（覆蓋層讓位）。
- [ ] M1-6 `ipc-npp.ts` + `npp-main.ts` + 6 個必要橋接（設定、圖片）。
- [ ] M1-7 本機圖片載入（虛擬主機 + `WebResourceRequested` + 範圍檢查）。
- [ ] M1-8 深色模式與主題對應；選單與工具列（`NPPM_ADDTOOLBARICON_FORDARKMODE`）。
- [ ] M1-9 編碼／換行偵測（`NPPM_GETBUFFERFORMAT`、`SCI_GETCODEPAGE`）；非 UTF-8 唯讀。

**驗收標準**：一萬次隨機編輯的模糊測試，兩端內容逐位元組相同；外部修改後重載正確；Notepad++「取代全部」能反映到 CodeMirror；CRLF 與 LF 檔案皆正確。

### M2：完整編輯（約 15～20 人日）

- [ ] M2-1 貼上與拖放圖片匯入；相對連結開檔（`NPPM_DOFILEOPEN`）。
- [ ] M2-2 Undo／Redo 選單整合細節；第二視圖（分割視圖）完整支援；同一文件雙視圖去重。
- [ ] M2-3 arm64 版本（`WebView2Loader`、編譯目標）。
- [ ] M2-4 Kalamos 既有 vitest 測試（`src/editor/*.test.ts`）在新的 ipc 替身下全數通過。
- [ ] M2-5 大檔案策略（降級或延遲裝飾）。

### M3：進階與上架（約 10～15 人日）

- [ ] M3-1 PDF／HTML 匯出（`PrintToPdf`）。
- [ ] M3-2 自訂主題；Pandoc（選做）。
- [ ] M3-3 CI：x64 與 arm64 建置、zip 打包、計算 SHA-256、DLL 版本資源與 JSON `version` 一致。
- [ ] M3-4 向 `nppPluginList` 提交 PR（`pl.x64.json`、`pl.arm64.json`）；先在本機以 Plugins Admin 測試。
- [ ] M3-5 授權聲明（MIT）、README、使用說明。

---

## 8. 接續工作指引（給日後的 Claude）

**開工前先確認**：
1. 使用者是否已準備 **Windows 開發環境**（Visual Studio + Windows SDK + WebView2 SDK、Node 22+）或 CI。此容器是 Linux，無法編譯或測試外掛 DLL。
2. 重新 clone 並鎖定版本（雲端容器重啟後 clone 會消失）：
   ```
   git clone --depth 1 https://github.com/kkdai/kalamos
   git clone --depth 1 https://github.com/notepad-plus-plus/notepad-plus-plus
   git clone --depth 1 https://github.com/notepad-plus-plus/nppPluginList
   ```
   讀取非 session 附加的公開儲存庫時，先用 `add_repo` 工具取得唯讀存取。
3. 本文件的行號出自：Kalamos HEAD `1e55db4`（v0.4.0 之後 5 個 commit）、Notepad++ v8.9.9.1。**行號開工前用 `grep` 重新定位**。
4. 補讀官方外掛開發文件（`notepad-plus-plus.org` 與 `npp-user-manual.org`）；本次因網路政策未能讀取。

**建議開工順序**（可在 Linux 容器完成的部分，不需 Windows）：
1. **抽出 Kalamos 前端**：建立獨立 Vite 專案，保留 `src/editor/**`、`platform.ts`、`styles`、`theme`；移除 `@tauri-apps/*` 依賴；寫 `ipc-npp.ts` 介面與瀏覽器 mock。
2. **新增編輯器增量掛鉤** `onChanges(tr)`，關閉 history；寫單元測試。
3. **位置換算模組**（行＋UTF-16 欄 ↔ CodeMirror 位置）與**模糊測試**：隨機編輯含中文、emoji、CRLF，驗證兩端同步邏輯（可用純 TypeScript 模擬 Scintilla 的 UTF-8 + CRLF 語意）。
4. 設計 WebView2 訊息協定（JSON schema）：`init`、`setContent`、`changes`、`requestSync`、`setTheme`、`key`、`command` 等，雙方各維護 `rev`。
5. （需 Windows）M0 的 C++ 外掛骨架與覆蓋視窗。

**需要使用者決策的事項**：
- 是否接受「M0 失敗就停」的 Go／No-Go 關卡。
- 外掛名稱、授權（Kalamos 為 MIT，需保留授權聲明）、是否 fork Kalamos 維護。
- 最低支援的 Notepad++ 版本（建議 ≥ 8.7.7；若不用 `NPPM_ADDSCNMODIFIEDFLAGS` 可放寬）。
- 技術棧：C++（推薦；x64 與 arm64 原生、無 .NET 啟動成本）或 .NET（NppPluginNET + WebView2 WinForms；前例 TroiaLens；缺點是需要 .NET Framework 4.8、DllExport 在 arm64 麻煩）。

**使用者偏好**：所有對話與工作一律使用正體中文（台灣用語）；全域設定在 `~/.claude/CLAUDE.md`（雲端容器中，若容器重建需重新寫入）。

---

## 9. 替代方案（若 M0 失敗或需求降級）

| 方案 | 說明 | 工作量 |
|---|---|---|
| **A. 啟動器外掛** | 選單命令呼叫 `kalamos.exe <目前檔案路徑>`，利用 single-instance 開在既有視窗。兩邊各自存檔，需處理外部修改重載。Windows 上的命令列行為需實測。 | 很小（約一個下午～數日） |
| **D. 使用現成預覽外掛** | 若只需預覽：Markdown Features、Markdown with Mermaid、MahiMarkD++ 等。 | 零 |

---

## 附錄 A：Notepad++ 訊息與通知清單

### A.1 NPPM_（`MISC/PluginsManager/Notepad_plus_msgs.h`）

| 訊息 | 定義行 | 處理位置 |
|---|---|---|
| `NPPM_GETCURRENTSCINTILLA` | :55 | `NppBigSwitch.cpp:1277` |
| `NPPM_GETCURRENTVIEW` | :697 | — |
| `NPPM_GETCURRENTBUFFERID` | :473 | `NppBigSwitch.cpp:696` |
| `NPPM_GETBUFFERIDFROMPOS` | :466 | — |
| `NPPM_GETCURRENTDOCINDEX` | :175 | — |
| `NPPM_GETFULLPATHFROMBUFFERID` | :458 | — |
| `NPPM_GETBUFFERENCODING` | :501 | `NppBigSwitch.cpp:615` |
| `NPPM_GETBUFFERFORMAT` | :524 | `NppBigSwitch.cpp:646` |
| `NPPM_MENUCOMMAND` | :386 | `NppBigSwitch.cpp:1097` |
| `NPPM_ADDSCNMODIFIEDFLAGS` | :992 | `NppBigSwitch.cpp:4173` |
| `NPPM_GETPLUGINSCONFIGDIR` | :362 | `NppBigSwitch.cpp:3356` |
| `NPPM_ISDARKMODEENABLED` | :851 | — |
| `NPPM_GETDARKMODECOLORS` | :858 | `NppBigSwitch.cpp:3810` |
| `NPPM_DARKMODESUBCLASSANDTHEME` | :912 | — |
| `NPPM_ADDTOOLBARICON_FORDARKMODE` | :800 | — |
| `NPPM_SETMENUITEMCHECK` | :314 | — |
| `NPPM_GETNPPVERSION` | :400 | — |
| `NPPM_MODELESSDIALOG` | :93 | — |
| `NPPM_GETEDITORDEFAULTFOREGROUNDCOLOR`／`BACKGROUNDCOLOR` | :718 / :725 | — |

### A.2 NPPN_（同檔）

| 通知 | 定義行 | 備註 |
|---|---|---|
| `NPPN_READY` | :1093 | |
| `NPPN_TBMODIFICATION` | :1098 | 註冊工具列圖示的時機（`Notepad_plus.cpp:789`） |
| `NPPN_FILEBEFORECLOSE` | :1103 | 發送：`NppIO.cpp:870` |
| `NPPN_FILEOPENED` | :1108 | 發送：`NppIO.cpp:506` |
| `NPPN_FILECLOSED` | :1113 | 發送：`NppIO.cpp:937` |
| `NPPN_FILEBEFORESAVE` | :1123 | 發送：`NppIO.cpp:700` |
| `NPPN_FILESAVED` | :1128 | 發送：`NppIO.cpp:710` |
| `NPPN_SHUTDOWN` | :1133 | |
| `NPPN_BUFFERACTIVATED` | :1138 | 發送：`Notepad_plus.cpp:7062`；非作用中視圖不通知（`:7041`） |
| `NPPN_LANGCHANGED` | :1143 | |
| `NPPN_WORDSTYLESUPDATED` | :1148 | |
| `NPPN_READONLYCHANGED` | :1175 | |
| `NPPN_BEFORESHUTDOWN` | :1195 | |
| `NPPN_FILERENAMED` | :1215 | |
| `NPPN_DARKMODECHANGED` | :1235 | 發送：`NppBigSwitch.cpp:400` |
| `NPPN_GLOBALMODIFIED` | :1268 | v8.6.5 加入；Replace All 後發送（`NppBigSwitch.cpp:4147-4151`） |

### A.3 SCI_／SCN_（`scintilla/include/Scintilla.h`）

| 訊息 | 行號 |
|---|---|
| `SCI_GETDIRECTFUNCTION`／`SCI_GETDIRECTPOINTER` | :591 / :593 |
| `SCI_INSERTTEXT` | :50 |
| `SCI_DELETERANGE` | :53 |
| `SCI_BEGINUNDOACTION`／`SCI_ENDUNDOACTION` | :357 / :358 |
| `SCI_GETUNDOCURRENT` | :368 |
| `SCI_GETDOCPOINTER` | :833 |
| `SCI_GETCODEPAGE` | :505 |
| `SCI_GETEOLMODE` | :97 |
| `SCI_GETCHARACTERPOINTER` | :1020 |
| `SCI_GETRANGEPOINTER` | :1021 |
| `SCI_GETTEXTRANGEFULL` | :566 |
| `SCI_GETLENGTH` | :55 |
| `SCI_ALLOCATELINECHARACTERINDEX` | :1204（`SC_LINECHARACTERINDEX_UTF16` = 2） |
| `SCI_INDEXPOSITIONFROMLINE` | :1207 |
| `SCI_LINEFROMINDEXPOSITION` | :1206 |
| `SCI_POSITIONRELATIVECODEUNITS` | :924 |
| `SCI_COUNTCODEUNITS` | :493 |
| `SCI_SETSEL` | :561 |
| `SCI_GETSELECTIONSTART` | :510 |
| `SCN_MODIFIED` | :1322 |
| `SC_MOD_BEFOREDELETE` | :1256 |
| `SC_PERFORMED_UNDO` | :1250 |
| `SCN_SAVEPOINTREACHED`／`SCN_SAVEPOINTLEFT` | :1316-1317 |

所有 `SCN_` 通知都經主視窗的 `WM_NOTIFY` 轉給外掛（`NppBigSwitch.cpp:2511`）。

### A.4 選單命令 ID（`menuCmdID.h`）

`IDM_EDIT_UNDO` :89、`IDM_EDIT_REDO` :90、`IDM_FILE_SAVE` :29、`IDM_SEARCH_FIND` :203。

---

## 附錄 B：名詞對照

| 詞 | 說明 |
|---|---|
| WYSIWYM | What You See Is What You Mean；邊寫邊渲染的 Markdown 編輯（Typora 風格） |
| Scintilla | Notepad++ 的編輯元件 |
| CodeMirror 6 | Kalamos 使用的網頁編輯器核心 |
| WebView2 | Windows 的 Chromium 內嵌網頁控制項 |
| 兄弟覆蓋（sibling overlay） | 與 Scintilla 同一父視窗、疊在其上的子視窗 |
| Plugins Admin | Notepad++ 內建的外掛管理員，資料來源為 `nppPluginList` |
| M0／M1… | 里程碑；M0 是決定是否繼續的原型關卡 |
