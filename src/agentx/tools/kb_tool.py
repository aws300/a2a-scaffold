"""Knowledge Base retrieval tool for Strands agent.

Calls the Go backend's KnowledgeService.Retrieve RPC via ConnectRPC (HTTP/JSON)
to search knowledge bases and return relevant chunks. Used by the Agent Playground
to provide RAG context.

The Go backend registers KnowledgeService as a ConnectRPC handler (not native gRPC),
so we use HTTP POST with JSON body to the Connect protocol endpoint.
"""
from __future__ import annotations

import json
import logging
from typing import Any
from urllib.parse import urljoin

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


def retrieve_from_kb(
    knowledge_base_id: str,
    query: str,
    top_k: int = 5,
    min_score: float = 0.0,
    backend_addr: str = "localhost:8080",
) -> list[dict[str, Any]]:
    """
    Retrieve relevant chunks from a knowledge base via the Go backend's ConnectRPC endpoint.

    Uses HTTP POST with JSON body (Connect protocol) instead of native gRPC.
    Returns a list of dicts with keys: content, score, source_filename.
    """
    client = _get_http_client()
    base_url = f"http://{backend_addr}"
    url = urljoin(base_url + "/", "agentx.knowledge.v1beta.KnowledgeService/Retrieve")

    payload: dict[str, Any] = {
        "knowledgeBaseId": knowledge_base_id,
        "query": query,
        "topK": top_k,
    }
    if min_score > 0:
        payload["minScore"] = min_score

    headers = {
        "Content-Type": "application/json",
    }

    try:
        resp = client.post(url, json=payload, headers=headers)
        resp.raise_for_status()
        data = resp.json()

        chunks = []
        for chunk in data.get("chunks", []):
            chunks.append({
                "content": chunk.get("content", ""),
                "score": chunk.get("score", 0.0),
                "source_filename": chunk.get("sourceFilename", ""),
            })
        log.info(
            "kb_tool: retrieved %d chunks from KB %s",
            len(chunks), knowledge_base_id,
        )
        return chunks
    except httpx.HTTPStatusError as e:
        log.error(
            "kb_tool: retrieve failed (HTTP %d): %s",
            e.response.status_code, e.response.text[:500],
        )
        return []
    except Exception as e:
        log.error("kb_tool: retrieve error: %s", str(e))
        return []


def make_kb_retrieve_tool(knowledge_base_ids: list[str], backend_addr: str = "localhost:8080") -> Any:
    """
    Create a Strands @tool function that searches across the given knowledge bases.

    Args:
        knowledge_base_ids: List of KB IDs to search.
        backend_addr: Address of the Go backend (host:port).

    Returns:
        A Strands tool callable.
    """
    from strands import tool

    kb_names = ", ".join(knowledge_base_ids)

    @tool
    def knowledge_base_search(query: str, top_k: int = 5) -> dict:
        """Search knowledge bases for information relevant to a query.

        This tool searches across configured knowledge bases using semantic search
        and returns the most relevant document chunks. Use this when the user asks
        questions that might be answered by the knowledge base documents.

        Args:
            query: The search query to find relevant information.
            top_k: Maximum number of results to return (default 5).
        """
        all_chunks: list[dict] = []

        for kb_id in knowledge_base_ids:
            try:
                # retrieve_from_kb is synchronous (uses httpx sync client),
                # so it works directly inside Strands @tool (which is sync).
                chunks = retrieve_from_kb(
                    kb_id, query, top_k=top_k, backend_addr=backend_addr,
                )
                all_chunks.extend(chunks)
            except Exception as e:
                log.warning("kb_tool: error searching KB %s: %s", kb_id, str(e))

        # Sort by score descending and take top_k
        all_chunks.sort(key=lambda c: c.get("score", 0), reverse=True)
        all_chunks = all_chunks[:top_k]

        if not all_chunks:
            return {
                "status": "success",
                "content": [{"text": f"No relevant results found in knowledge bases: {kb_names}"}],
            }

        # Format results
        results = []
        for i, chunk in enumerate(all_chunks, 1):
            source = chunk.get("source_filename", "unknown")
            score = chunk.get("score", 0)
            content = chunk.get("content", "")
            results.append(f"[{i}] (score: {score:.2f}, source: {source})\n{content}")

        text = f"Found {len(all_chunks)} relevant chunks from knowledge bases:\n\n" + "\n\n---\n\n".join(results)
        return {
            "status": "success",
            "content": [{"text": text}],
        }

    return knowledge_base_search
