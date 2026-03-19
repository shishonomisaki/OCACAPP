#!/usr/bin/env python3
"""
Web scraper that fetches content from configured URLs and builds a knowledge base.
Outputs structured JSON for the chatbot's client-side search engine.
"""

import json
import hashlib
import re
import sys
import os
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_DIR = SCRIPT_DIR.parent
CONFIG_PATH = SCRIPT_DIR / "config.json"
SCRAPED_DIR = PROJECT_DIR / "data" / "scraped"
QA_DIR = PROJECT_DIR / "data" / "qa"
OUTPUT_PATH = PROJECT_DIR / "site" / "knowledge_base.json"


def load_config() -> dict:
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def fetch_page(url: str, selector: str, user_agent: str, max_len: int) -> list[dict]:
    """Fetch a page and extract text chunks from the given CSS selector."""
    headers = {"User-Agent": user_agent}
    try:
        resp = requests.get(url, headers=headers, timeout=30)
        resp.raise_for_status()
    except requests.RequestException as e:
        print(f"  [WARN] Failed to fetch {url}: {e}")
        return []

    soup = BeautifulSoup(resp.text, "html.parser")

    # Remove script/style elements
    for tag in soup.find_all(["script", "style", "nav", "footer", "header"]):
        tag.decompose()

    container = soup.select_one(selector) if selector else soup.body
    if not container:
        print(f"  [WARN] Selector '{selector}' not found on {url}")
        return []

    chunks = []
    # Split content by headings for better granularity
    sections = _split_by_headings(container)
    for title, text in sections:
        text = _clean_text(text)
        if len(text) < 10:
            continue
        if len(text) > max_len:
            text = text[:max_len]
        chunk_id = hashlib.md5(f"{url}:{title}:{text[:100]}".encode()).hexdigest()[:12]
        chunks.append({
            "id": chunk_id,
            "source_url": url,
            "title": title,
            "content": text,
        })
    return chunks


def _split_by_headings(container) -> list[tuple[str, str]]:
    """Split container content by heading tags into (title, body_text) pairs."""
    sections = []
    current_title = ""
    current_texts = []

    for elem in container.children:
        if hasattr(elem, "name") and elem.name in ("h1", "h2", "h3", "h4", "h5", "h6"):
            # Save previous section
            if current_texts:
                sections.append((current_title, " ".join(current_texts)))
            current_title = elem.get_text(strip=True)
            current_texts = []
        else:
            text = elem.get_text(strip=True) if hasattr(elem, "get_text") else str(elem).strip()
            if text:
                current_texts.append(text)

    if current_texts:
        sections.append((current_title, " ".join(current_texts)))

    # If no headings found, return whole content as one section
    if not sections:
        full_text = container.get_text(strip=True)
        sections = [("", full_text)]

    return sections


def _clean_text(text: str) -> str:
    """Normalize whitespace and remove excess blank lines."""
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def load_qa_files() -> list[dict]:
    """Load manual Q&A pairs from JSON files in data/qa/."""
    qa_entries = []
    if not QA_DIR.exists():
        return qa_entries

    for f in sorted(QA_DIR.glob("*.json")):
        try:
            with open(f, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            if isinstance(data, list):
                for item in data:
                    _validate_qa_item(item, f.name)
                    qa_entries.append(item)
            elif isinstance(data, dict):
                _validate_qa_item(data, f.name)
                qa_entries.append(data)
        except (json.JSONDecodeError, ValueError) as e:
            print(f"  [WARN] Skipping {f.name}: {e}")
    return qa_entries


def _validate_qa_item(item: dict, filename: str):
    if "question" not in item or "answer" not in item:
        raise ValueError(f"{filename}: Q&A item must have 'question' and 'answer' fields")


def build_knowledge_base():
    """Main pipeline: scrape pages + load Q&A files -> output knowledge_base.json."""
    config = load_config()
    user_agent = config.get("user_agent", "ChatBot-Scraper/1.0")
    max_len = config.get("max_content_length", 5000)

    all_chunks = []
    print("=== Starting web scrape ===")
    for source in config.get("sources", []):
        url = source["url"]
        selector = source.get("selector", "body")
        name = source.get("name", url)
        print(f"  Scraping: {name} ({url})")
        chunks = fetch_page(url, selector, user_agent, max_len)
        for c in chunks:
            c["source_name"] = name
            c["type"] = "web"
        all_chunks.extend(chunks)
        print(f"    -> {len(chunks)} chunk(s) extracted")

    # Save raw scraped data
    SCRAPED_DIR.mkdir(parents=True, exist_ok=True)
    scraped_path = SCRAPED_DIR / f"scraped_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.json"
    with open(scraped_path, "w", encoding="utf-8") as f:
        json.dump(all_chunks, f, ensure_ascii=False, indent=2)
    print(f"  Raw scraped data saved to {scraped_path}")

    # Load manual Q&A
    print("=== Loading Q&A files ===")
    qa_entries = load_qa_files()
    print(f"  Loaded {len(qa_entries)} Q&A pair(s)")

    # Build final knowledge base
    knowledge_base = {
        "last_updated": datetime.now(timezone.utc).isoformat(),
        "stats": {
            "web_chunks": len(all_chunks),
            "qa_pairs": len(qa_entries),
        },
        "web_content": all_chunks,
        "qa_pairs": qa_entries,
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(knowledge_base, f, ensure_ascii=False, indent=2)
    print(f"=== Knowledge base saved to {OUTPUT_PATH} ===")
    print(f"    Web chunks: {len(all_chunks)}, Q&A pairs: {len(qa_entries)}")


if __name__ == "__main__":
    build_knowledge_base()
