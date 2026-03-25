"""Document content tool for the Agent Playground.

Fetches library document content from the Go backend's LibraryService.GetLibraryItem
RPC via ConnectRPC (HTTP/JSON). Documents can be:
  1. Injected directly into the system prompt (for small documents)
  2. Provided as a searchable tool (for larger documents or many documents)
  3. Downloaded to the agent's working directory for file-based access

Uses the same httpx-based ConnectRPC pattern as kb_tool.py.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

import httpx

log = logging.getLogger(__name__)

# Reusable HTTP client (connection pooling)
_http_client: httpx.Client | None = None


def _get_http_client() -> httpx.Client:
    """Lazily create and cache the HTTP client."""
    global _http_client
    if _http_client is None:
        _http_client = httpx.Client(
            timeout=httpx.Timeout(30.0, connect=10.0),
            http2=True,
        )
    return _http_client


def fetch_document(doc_id: str, backend_addr: str = "localhost:8080") -> dict[str, Any] | None:
    """
    Fetch a single document by ID from the Go backend's LibraryService.GetLibraryItem.

    Returns a dict with keys: id, title, description, content, file_name, file_url.
    Returns None on error.
    """
    client = _get_http_client()
    url = f"http://{backend_addr}/library.v1.LibraryService/GetLibraryItem"

    payload = {"id": doc_id}
    headers = {"Content-Type": "application/json"}

    try:
        resp = client.post(url, json=payload, headers=headers)
        resp.raise_for_status()
        data = resp.json()

        return {
            "id": data.get("id", doc_id),
            "title": data.get("title", ""),
            "description": data.get("description", ""),
            "content": data.get("content", ""),
            "file_name": data.get("fileName", ""),
            "file_url": data.get("fileUrl", ""),
        }
    except httpx.HTTPStatusError as e:
        log.error(
            "doc_tool: fetch failed for %s (HTTP %d): %s",
            doc_id, e.response.status_code, e.response.text[:500],
        )
        return None
    except Exception as e:
        log.error("doc_tool: fetch error for %s: %s", doc_id, str(e))
        return None


def fetch_documents(doc_ids: list[str], backend_addr: str = "localhost:8080") -> list[dict[str, Any]]:
    """
    Fetch multiple documents by ID. Returns only successfully fetched documents.
    """
    docs = []
    for did in doc_ids:
        doc = fetch_document(did, backend_addr=backend_addr)
        if doc:
            docs.append(doc)
            log.info("doc_tool: loaded document %s (%s)", did, doc.get("title", ""))
        else:
            log.warning("doc_tool: skipping document %s (not found)", did)
    return docs


def download_document_file(
    doc_id: str,
    target_dir: str,
    backend_addr: str = "localhost:8080",
) -> str | None:
    """
    Download a document's file attachment from the Go backend's DocumentDownload
    endpoint and write it to target_dir.

    Returns the local file path on success, None on error.
    """
    client = _get_http_client()
    url = f"http://{backend_addr}/library.v1.LibraryService/DocumentDownload"

    try:
        resp = client.get(url, params={"id": doc_id}, follow_redirects=True)
        resp.raise_for_status()

        # Extract filename from Content-Disposition header or fall back
        filename = None
        cd = resp.headers.get("content-disposition", "")
        if "filename=" in cd:
            # Parse filename="xxx" or filename=xxx
            parts = cd.split("filename=")
            if len(parts) > 1:
                filename = parts[1].strip().strip('"').strip("'")
        if not filename:
            filename = f"document-{doc_id}"

        os.makedirs(target_dir, exist_ok=True)
        local_path = os.path.join(target_dir, filename)

        with open(local_path, "wb") as f:
            f.write(resp.content)

        log.info(
            "doc_tool: downloaded file for %s -> %s (%d bytes)",
            doc_id, local_path, len(resp.content),
        )
        return local_path

    except httpx.HTTPStatusError as e:
        log.error(
            "doc_tool: download failed for %s (HTTP %d): %s",
            doc_id, e.response.status_code, e.response.text[:500],
        )
        return None
    except Exception as e:
        log.error("doc_tool: download error for %s: %s", doc_id, str(e))
        return None


def download_document_files(
    documents: list[dict[str, Any]],
    target_dir: str,
    backend_addr: str = "localhost:8080",
) -> list[str]:
    """
    Download file attachments for all documents that have a file_url.
    Returns a list of local file paths that were successfully downloaded.
    """
    downloaded = []
    for doc in documents:
        file_url = doc.get("file_url", "")
        if not file_url:
            continue
        local_path = download_document_file(
            doc["id"], target_dir, backend_addr=backend_addr,
        )
        if local_path:
            downloaded.append(local_path)
    return downloaded


def prepare_documents_in_workdir(
    doc_ids: list[str],
    work_dir: str,
    backend_addr: str = "localhost:8080",
) -> list[dict[str, Any]]:
    """
    Download document files into the agent's work_dir so the agent can
    access them directly with file tools. Cleans previous document files
    in the work_dir/documents/ sub-directory before downloading.

    Returns list of document dicts with 'local_path' and 'content' populated.
    """
    import shutil

    docs_subdir = os.path.join(work_dir, "documents")

    # Clean previous document files
    if os.path.exists(docs_subdir):
        try:
            shutil.rmtree(docs_subdir)
            log.info("doc_tool: cleaned previous documents in %s", docs_subdir)
        except Exception as e:
            log.warning("doc_tool: failed to clean %s: %s", docs_subdir, e)
    os.makedirs(docs_subdir, exist_ok=True)

    # Fetch document metadata
    documents = fetch_documents(doc_ids, backend_addr=backend_addr)
    if not documents:
        return []

    # Download files and read text content
    for doc in documents:
        file_url = doc.get("file_url", "")
        if not file_url:
            continue

        # Clear bogus content field (stores filename instead of content)
        file_name = doc.get("file_name", "")
        if doc.get("content", "").strip() == file_name.strip():
            doc["content"] = ""

        local_path = download_document_file(
            doc["id"], docs_subdir, backend_addr=backend_addr,
        )
        if local_path:
            doc["local_path"] = local_path
            # Try to read text content from the file
            text_content = read_text_file(local_path)
            if text_content:
                doc["content"] = text_content
                log.info(
                    "doc_tool: read file for %s (%d chars) -> %s",
                    doc["id"], len(text_content), local_path,
                )
            else:
                log.info(
                    "doc_tool: binary file for %s -> %s",
                    doc["id"], local_path,
                )

    return documents


def read_text_file(path: str, max_chars: int = 100_000) -> str | None:
    """
    Read a text file and return its content (up to max_chars).
    Returns None if the file is binary or unreadable.
    """
    try:
        with open(path, "r", encoding="utf-8", errors="strict") as f:
            return f.read(max_chars)
    except (UnicodeDecodeError, OSError):
        return None


def build_document_prompt_section(documents: list[dict[str, Any]], work_dir: str | None = None) -> str:
    """
    Build a system prompt section from fetched document data.

    Each document's content is included inline so the agent has direct
    access to the information. For documents with downloaded files in
    work_dir, references are provided with the local file path.
    """
    if not documents:
        return ""

    sections = []
    for doc in documents:
        title = doc.get("title", doc.get("id", "Unknown"))
        content = doc.get("content", "")
        file_name = doc.get("file_name", "")
        local_path = doc.get("local_path", "")

        if content:
            sections.append(
                f"### Document: {title}\n\n{content}"
            )
        elif local_path:
            sections.append(
                f"### Document: {title}\n\n"
                f"File available at: `{local_path}`\n"
                f"Use file reading tools to access the content."
            )
        elif file_name:
            sections.append(
                f"### Document: {title}\n\n"
                f"_File: {file_name} (file not available)_"
            )

    if not sections:
        return ""

    return "## Reference Documents\n\n" + "\n\n---\n\n".join(sections)


def make_document_search_tool(
    documents: list[dict[str, Any]],
) -> Any:
    """
    Create a Strands @tool function that searches across loaded documents.

    This is useful when there are many documents or the content is large —
    instead of putting everything in the system prompt, provide a search tool.
    """
    from strands import tool

    # Build a simple in-memory index
    doc_index: list[dict[str, str]] = []
    for doc in documents:
        content = doc.get("content", "")
        if content:
            doc_index.append({
                "id": doc.get("id", ""),
                "title": doc.get("title", "Unknown"),
                "content": content,
            })

    if not doc_index:
        return None

    doc_names = ", ".join(d["title"] for d in doc_index)

    @tool
    def document_search(query: str, max_results: int = 3) -> dict:
        """Search through loaded documents for information matching a query.

        This tool searches across user-provided documents using keyword matching
        and returns relevant sections. Use this when the user asks questions that
        might be answered by the loaded documents.

        Args:
            query: The search query to find relevant information in documents.
            max_results: Maximum number of document sections to return (default 3).
        """
        query_lower = query.lower()
        query_words = set(query_lower.split())

        scored: list[tuple[float, dict]] = []
        for doc in doc_index:
            content_lower = doc["content"].lower()
            # Simple relevance scoring: count matching query words
            score = sum(1 for w in query_words if w in content_lower)
            if score > 0:
                scored.append((score, doc))

        # Sort by score descending
        scored.sort(key=lambda x: x[0], reverse=True)
        top = scored[:max_results]

        if not top:
            return {
                "status": "success",
                "content": [{"text": f"No relevant results found in documents: {doc_names}"}],
            }

        results = []
        for i, (score, doc) in enumerate(top, 1):
            title = doc["title"]
            content = doc["content"]
            # Truncate long content for readability
            if len(content) > 2000:
                # Find the most relevant section
                best_pos = 0
                cl = content.lower()
                for word in query_words:
                    idx = cl.find(word)
                    if idx >= 0:
                        best_pos = max(0, idx - 200)
                        break
                content = "..." + content[best_pos:best_pos + 2000] + "..."
            results.append(f"[{i}] Document: {title}\n{content}")

        text = f"Found {len(top)} relevant document sections:\n\n" + "\n\n---\n\n".join(results)
        return {
            "status": "success",
            "content": [{"text": text}],
        }

    return document_search
