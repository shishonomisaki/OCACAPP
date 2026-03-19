/**
 * Chatbot Engine — client-side search over a pre-built knowledge base.
 * Uses Fuse.js for fuzzy search. Answers ONLY from the knowledge base;
 * if no confident match is found, replies honestly that no info is available.
 */

const KNOWLEDGE_BASE_URL = "knowledge_base.json";
const MATCH_THRESHOLD = 0.45; // Fuse.js threshold (0=exact, 1=match anything)
const MAX_RESULTS = 3;

let knowledgeBase = null;
let fuseWeb = null;
let fuseQA = null;

// ─── Init ───────────────────────────────────────────────────────────────────

async function initChatbot() {
  try {
    const resp = await fetch(KNOWLEDGE_BASE_URL);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    knowledgeBase = await resp.json();
    buildSearchIndices();
    updateKBStatus();
    showWelcome();
  } catch (err) {
    console.error("Failed to load knowledge base:", err);
    showSystemMessage("知識庫載入失敗，請確認 knowledge_base.json 是否存在。");
  }
}

function buildSearchIndices() {
  const fuseOptions = {
    includeScore: true,
    threshold: MATCH_THRESHOLD,
    ignoreLocation: true,
    minMatchCharLength: 2,
  };

  if (knowledgeBase.web_content && knowledgeBase.web_content.length > 0) {
    fuseWeb = new Fuse(knowledgeBase.web_content, {
      ...fuseOptions,
      keys: [
        { name: "title", weight: 2 },
        { name: "content", weight: 1 },
        { name: "source_name", weight: 0.5 },
      ],
    });
  }

  if (knowledgeBase.qa_pairs && knowledgeBase.qa_pairs.length > 0) {
    fuseQA = new Fuse(knowledgeBase.qa_pairs, {
      ...fuseOptions,
      keys: [
        { name: "question", weight: 2 },
        { name: "answer", weight: 1 },
        { name: "tags", weight: 0.8 },
      ],
    });
  }
}

// ─── Search ─────────────────────────────────────────────────────────────────

function search(query) {
  const results = { qa: [], web: [] };

  if (fuseQA) {
    results.qa = fuseQA.search(query, { limit: MAX_RESULTS });
  }
  if (fuseWeb) {
    results.web = fuseWeb.search(query, { limit: MAX_RESULTS });
  }

  return results;
}

function buildResponse(query) {
  if (!knowledgeBase) {
    return { text: "知識庫尚未載入，請稍後再試。", sources: [] };
  }

  const results = search(query);
  const qaHits = results.qa.filter((r) => r.score <= MATCH_THRESHOLD);
  const webHits = results.web.filter((r) => r.score <= MATCH_THRESHOLD);

  // Priority 1: exact Q&A match
  if (qaHits.length > 0) {
    const best = qaHits[0];
    return {
      text: best.item.answer,
      sources: qaHits.slice(0, 2).map((r) => ({
        type: "qa",
        question: r.item.question,
        score: r.score,
      })),
    };
  }

  // Priority 2: web content match
  if (webHits.length > 0) {
    const best = webHits[0];
    let answer = best.item.content;
    // Trim to a reasonable length for display
    if (answer.length > 500) {
      const cutoff = answer.indexOf("。", 400);
      answer = answer.substring(0, cutoff > 0 ? cutoff + 1 : 500) + "...";
    }
    const titlePrefix = best.item.title ? `【${best.item.title}】\n` : "";
    return {
      text: titlePrefix + answer,
      sources: webHits.slice(0, 2).map((r) => ({
        type: "web",
        title: r.item.source_name || r.item.title,
        url: r.item.source_url,
        score: r.score,
      })),
    };
  }

  // No match
  return {
    text: "抱歉，目前知識庫中查無與您問題相關的資訊。請嘗試用不同的關鍵字提問，或聯繫管理員補充相關內容。",
    sources: [],
  };
}

// ─── UI ─────────────────────────────────────────────────────────────────────

const chatArea = document.getElementById("chat-area");
const inputField = document.getElementById("user-input");
const sendBtn = document.getElementById("send-btn");

function showWelcome() {
  const quickQuestions = (knowledgeBase.qa_pairs || [])
    .slice(0, 4)
    .map((qa) => qa.question);

  const welcome = document.createElement("div");
  welcome.className = "welcome";
  welcome.innerHTML = `
    <h2>歡迎使用知識問答助手</h2>
    <p>請輸入您的問題，我會從知識庫中為您查找答案。</p>
    ${
      quickQuestions.length > 0
        ? `<div class="quick-questions">
        ${quickQuestions.map((q) => `<button onclick="askQuestion('${escapeHTML(q)}')">${escapeHTML(q)}</button>`).join("")}
      </div>`
        : ""
    }
  `;
  chatArea.appendChild(welcome);
}

function addMessage(text, type, sources = []) {
  // Remove welcome if exists
  const welcome = chatArea.querySelector(".welcome");
  if (welcome) welcome.remove();

  const msg = document.createElement("div");
  msg.className = `message ${type}`;

  let sourceHTML = "";
  if (sources.length > 0) {
    const sourceLinks = sources
      .map((s) => {
        if (s.type === "web" && s.url) {
          return `<a href="${escapeHTML(s.url)}" target="_blank" rel="noopener">${escapeHTML(s.title || "來源")}</a>`;
        } else if (s.type === "qa") {
          return `Q&A: ${escapeHTML(s.question)}`;
        }
        return "";
      })
      .filter(Boolean)
      .join(" | ");
    if (sourceLinks) {
      sourceHTML = `<div class="message-source">來源: ${sourceLinks}</div>`;
    }
  }

  msg.innerHTML = `
    <div class="message-bubble">
      ${escapeHTML(text).replace(/\n/g, "<br>")}
      ${sourceHTML}
    </div>
  `;
  chatArea.appendChild(msg);
  chatArea.scrollTop = chatArea.scrollHeight;
}

function showTypingIndicator() {
  const indicator = document.createElement("div");
  indicator.className = "message bot";
  indicator.id = "typing-indicator";
  indicator.innerHTML = `
    <div class="typing-indicator">
      <span></span><span></span><span></span>
    </div>
  `;
  chatArea.appendChild(indicator);
  chatArea.scrollTop = chatArea.scrollHeight;
}

function removeTypingIndicator() {
  const indicator = document.getElementById("typing-indicator");
  if (indicator) indicator.remove();
}

function showSystemMessage(text) {
  addMessage(text, "bot");
}

function updateKBStatus() {
  const el = document.getElementById("kb-status");
  if (!el || !knowledgeBase) return;
  const stats = knowledgeBase.stats || {};
  const updated = knowledgeBase.last_updated
    ? new Date(knowledgeBase.last_updated).toLocaleString("zh-TW")
    : "未知";
  el.textContent = `知識庫: ${stats.web_chunks || 0} 筆網頁資料 | ${stats.qa_pairs || 0} 筆問答 | 更新時間: ${updated}`;
}

// ─── Interaction ────────────────────────────────────────────────────────────

function handleSend() {
  const query = inputField.value.trim();
  if (!query) return;

  inputField.value = "";
  addMessage(query, "user");

  showTypingIndicator();
  sendBtn.disabled = true;

  // Simulate brief processing delay for natural feel
  setTimeout(() => {
    removeTypingIndicator();
    const response = buildResponse(query);
    addMessage(response.text, "bot", response.sources);
    sendBtn.disabled = false;
    inputField.focus();
  }, 300 + Math.random() * 400);
}

function askQuestion(question) {
  inputField.value = question;
  handleSend();
}

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// Event listeners
sendBtn.addEventListener("click", handleSend);
inputField.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.isComposing) {
    handleSend();
  }
});

// Boot
document.addEventListener("DOMContentLoaded", initChatbot);
