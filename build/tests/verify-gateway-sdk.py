"""Real MCP/OpenAI client interoperability against an isolated loopback gateway.
Run: uv run --with 'mcp>=1.20,<2' --with openai build/tests/verify-gateway-sdk.py
"""
import asyncio
import json
from pathlib import Path
import socket
import subprocess
import tempfile

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client
from openai import OpenAI

ROOT = Path(__file__).resolve().parents[2]
KEY = 'zy_sdk_fixture_0123456789abcdef0123456789abcdef'

async def verify_mcp(base):
    async with streamablehttp_client(base + '/mcp', headers={'Authorization': f'Bearer {KEY}'}) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()
            tools = await session.list_tools()
            assert {t.name for t in tools.tools} == {'search_memories', 'get_memory', 'create_memory'}
            created = await session.call_tool('create_memory', {'text': 'SDK 验证，记忆长出花', 'tags': ['SDK']})
            assert not created.isError
            note_id = json.loads(created.content[0].text)['memory']['id']
            found = await session.call_tool('search_memories', {'query': 'SDK'})
            assert json.loads(found.content[0].text)['memories'][0]['id'] == note_id
            fetched = await session.call_tool('get_memory', {'id': note_id})
            assert json.loads(fetched.content[0].text)['memory']['text'] == 'SDK 验证，记忆长出花'
    print('PASS MCP SDK initialize / tools / create / search / read')

with tempfile.TemporaryDirectory(prefix='zhiyan-sdk-') as directory:
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    process = subprocess.Popen([str(ROOT / 'core/target/debug/zhiyan-core'), str(Path(directory) / 'notes.db')], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    def call(body):
        process.stdin.write(json.dumps(body) + '\n')
        process.stdin.flush()
        response = json.loads(process.stdout.readline())
        assert response['ok'], response.get('error')
        return response['data']
    try:
        call({'op': 'gatewayStart', 'key': KEY, 'config': {'port': port, 'allow_write': True}})
        base = f'http://127.0.0.1:{port}'
        asyncio.run(verify_mcp(base))
        client = OpenAI(api_key=KEY, base_url=base + '/v1', max_retries=0)
        assert client.models.list().data[0].id == 'zhiyan-memory-search'
        args = {'model': 'zhiyan-memory-search', 'messages': [{'role': 'user', 'content': 'SDK'}]}
        reply = client.chat.completions.create(**args)
        assert json.loads(reply.choices[0].message.content)['memories'][0]['text'].startswith('SDK')
        with client.chat.completions.create(**args, stream=True) as stream:
            text = ''.join(chunk.choices[0].delta.content or '' for chunk in stream)
        assert json.loads(text)['memories'][0]['text'].startswith('SDK')
        print('PASS OpenAI SDK models / chat completions / SSE')
        call({'op': 'gatewayRotate', 'key': 'zy_rotated_fixture_0123456789abcdef0123456789abcdef'})
        assert httpx.get(base + '/v1/models', headers={'Authorization': f'Bearer {KEY}'}).status_code == 401
        call({'op': 'gatewayStop'})
        print('PASS old key revoked / gateway stopped')
    finally:
        process.stdin.close()
        process.wait(timeout=5)
