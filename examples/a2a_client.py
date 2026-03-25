#!/usr/bin/env python3
"""
Example A2A Client — Demonstrates how to interact with the A2A Scaffold agent.

Usage:
  # Discover the agent
  python examples/a2a_client.py discover http://localhost:8080

  # Send a message (unary — waits for full response)
  python examples/a2a_client.py ask http://localhost:8080 "What is 2+2?"

  # Stream a message (server-streaming — prints tokens as they arrive)
  python examples/a2a_client.py stream http://localhost:8080 "Write a haiku about coding"

Requirements:
  pip install httpx
"""

import json
import struct
import sys

try:
    import httpx
except ImportError:
    print("Install httpx first: pip install httpx")
    sys.exit(1)


def discover(base_url: str) -> dict:
    """Fetch the agent card from /.well-known/agent-card.json"""
    url = f"{base_url.rstrip('/')}/.well-known/agent-card.json"
    resp = httpx.get(url, timeout=10)
    resp.raise_for_status()
    card = resp.json()

    print(f"Agent: {card['name']}")
    print(f"Description: {card.get('description', 'N/A')}")
    print(f"Version: {card.get('version', 'N/A')}")
    print(f"Provider: {card.get('provider', {}).get('organization', 'N/A')}")
    print(f"Capabilities: streaming={card.get('capabilities', {}).get('streaming', False)}")
    print(f"Skills ({len(card.get('skills', []))}):")
    for skill in card.get("skills", []):
        print(f"  - {skill['id']}: {skill.get('description', '')}")
    print(f"Interfaces:")
    for iface in card.get("supportedInterfaces", []):
        print(f"  - {iface['protocolBinding']} @ {iface['url']}")

    return card


def ask(base_url: str, message: str) -> str:
    """Send a message and wait for the full response (server-streaming, collected)."""
    url = f"{base_url.rstrip('/')}/lf.a2a.v1.A2AService/SendStreamingMessage"

    # Build Connect server-stream request envelope
    payload = json.dumps({
        "message": {
            "taskId": f"client-{id(message)}",
            "contextId": f"client-{id(message)}",
            "role": 1,  # USER
            "parts": [{"text": message}],
        }
    }).encode()

    # Connect envelope: [flags:1][length:4][payload]
    envelope = struct.pack(">BI", 0, len(payload)) + payload

    full_text = ""
    text_event_count = 0  # Dedup: AG-UI adapter sends pairs of TEXT_MESSAGE_CONTENT
    with httpx.Client(timeout=120) as client:
        with client.stream(
            "POST", url,
            headers={
                "Content-Type": "application/connect+json",
                "Connect-Protocol-Version": "1",
            },
            content=envelope,
        ) as resp:
            if resp.status_code != 200:
                print(f"Error: HTTP {resp.status_code}")
                print(resp.read().decode()[:200])
                return ""

            buffer = b""
            for chunk in resp.iter_bytes():
                buffer += chunk
                while len(buffer) >= 5:
                    flags = buffer[0]
                    frame_len = struct.unpack(">I", buffer[1:5])[0]
                    if len(buffer) < 5 + frame_len:
                        break
                    frame = buffer[5:5 + frame_len]
                    buffer = buffer[5 + frame_len:]

                    if flags & 0x02:  # trailer
                        continue

                    try:
                        msg = json.loads(frame)
                        artifact_update = msg.get("artifactUpdate", {})
                        artifact = artifact_update.get("artifact", msg.get("artifact", {}))
                        for part in artifact.get("parts", []):
                            # AG-UI events in data field (primary text source)
                            data = part.get("data")
                            if data:
                                evt = json.loads(data) if isinstance(data, str) else data
                                if evt.get("type") == "TEXT_MESSAGE_CONTENT":
                                    delta = evt.get("delta", "")
                                    text_event_count += 1
                                    if delta:
                                        full_text += delta
                    except (json.JSONDecodeError, TypeError):
                        pass

    return full_text


def stream(base_url: str, message: str) -> None:
    """Send a message and stream the response token-by-token."""
    url = f"{base_url.rstrip('/')}/lf.a2a.v1.A2AService/SendStreamingMessage"

    payload = json.dumps({
        "message": {
            "taskId": f"stream-{id(message)}",
            "contextId": f"stream-{id(message)}",
            "role": 1,
            "parts": [{"text": message}],
        }
    }).encode()
    envelope = struct.pack(">BI", 0, len(payload)) + payload

    with httpx.Client(timeout=120) as client:
        with client.stream(
            "POST", url,
            headers={
                "Content-Type": "application/connect+json",
                "Connect-Protocol-Version": "1",
            },
            content=envelope,
        ) as resp:
            if resp.status_code != 200:
                print(f"Error: HTTP {resp.status_code}")
                return

            buffer = b""
            text_event_count = 0
            for chunk in resp.iter_bytes():
                buffer += chunk
                while len(buffer) >= 5:
                    flags = buffer[0]
                    frame_len = struct.unpack(">I", buffer[1:5])[0]
                    if len(buffer) < 5 + frame_len:
                        break
                    frame = buffer[5:5 + frame_len]
                    buffer = buffer[5 + frame_len:]

                    if flags & 0x02:
                        continue

                    try:
                        msg = json.loads(frame)
                        artifact_update = msg.get("artifactUpdate", {})
                        artifact = artifact_update.get("artifact", msg.get("artifact", {}))
                        for part in artifact.get("parts", []):
                            data = part.get("data")
                            if data:
                                evt = json.loads(data) if isinstance(data, str) else data
                                evt_type = evt.get("type", "")
                                if evt_type == "TEXT_MESSAGE_CONTENT":
                                    delta = evt.get("delta", "")
                                    text_event_count += 1
                                    if delta:
                                        sys.stdout.write(delta)
                                        sys.stdout.flush()
                                if evt_type in ("RUN_FINISHED", "RUN_ERROR"):
                                    print()
                                    return

                        status = msg.get("statusUpdate", {}).get("status", {})
                        state = status.get("state")
                        if state == "TASK_STATE_COMPLETED" or state == 4:
                            print()
                            return
                        if state == "TASK_STATE_FAILED" or state == 6:
                            print("\n[FAILED]")
                            return
                    except (json.JSONDecodeError, TypeError):
                        pass

    print()


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)

    command = sys.argv[1]
    base_url = sys.argv[2]

    if command == "discover":
        discover(base_url)
    elif command == "ask":
        if len(sys.argv) < 4:
            print("Usage: a2a_client.py ask <url> <message>")
            sys.exit(1)
        message = " ".join(sys.argv[3:])
        print(f"You: {message}")
        response = ask(base_url, message)
        print(f"\nAgent: {response}")
    elif command == "stream":
        if len(sys.argv) < 4:
            print("Usage: a2a_client.py stream <url> <message>")
            sys.exit(1)
        message = " ".join(sys.argv[3:])
        print(f"You: {message}")
        print("Agent: ", end="")
        stream(base_url, message)
    else:
        print(f"Unknown command: {command}")
        print("Commands: discover, ask, stream")
        sys.exit(1)


if __name__ == "__main__":
    main()
