/** Offline provider that asks for a proxy tool once, then ends the turn. */
let calls = 0;
globalThis.fetch = Object.assign(async (input: string | URL | Request) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url !== 'https://proxy-operation.invalid/v1/chat/completions') throw new Error('OFFLINE_FETCH_BLOCKED');
  const first = ++calls === 1;
  const delta = first ? { tool_calls: [{ index: 0, id: 'operation-once', type: 'function',
    function: { name: 'mcp__session__browser_tool', arguments: '{"command":"screenshot"}' } }] } : { content: 'Verified proxy result.' };
  const chunk = { id: `response-${calls}`, object: 'chat.completion.chunk', created: 1, model: 'proxy-test',
    choices: [{ index: 0, delta, finish_reason: first ? 'tool_calls' : 'stop' }] };
  return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
    headers: { 'content-type': 'text/event-stream' },
  });
}, { preconnect() { throw new Error('OFFLINE_FETCH_BLOCKED'); } }) as typeof fetch;
