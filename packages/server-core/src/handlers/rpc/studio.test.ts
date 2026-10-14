import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import * as config from '@tokenbird/shared/config'
import * as credentials from '@tokenbird/shared/credentials'
import * as auth from '@tokenbird/shared/auth'
import { RPC_CHANNELS } from '@tokenbird/shared/protocol'
import { CLIENT_MINDMAP_PROJECT_TOOL, type HandlerFn, type RpcServer } from '@tokenbird/server-core/transport'
import { deflateRawSync } from 'node:zlib'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerStudioHandlers } from './studio'

const originalFetch = globalThis.fetch
beforeEach(() => { spyOn(config, 'updateLlmConnection').mockReturnValue(false) })
afterEach(() => { globalThis.fetch = originalFetch; mock.restore() })

function harness() {
  const handlers = new Map<string, HandlerFn>()
  registerStudioHandlers({ handle: (channel: string, fn: HandlerFn) => { handlers.set(channel, fn) }, push: () => {} } as unknown as RpcServer)
  return (channel: string, input: unknown) => handlers.get(channel)!({ clientId: 'test', workspaceId: null, webContentsId: null }, input)
}

function connection() {
  spyOn(config, 'getLlmConnection').mockReturnValue({
    slug: 'gptimage', name: 'GPT Image', providerType: 'pi_compat', authType: 'api_key_with_endpoint',
    baseUrl: 'https://images.example/v1', createdAt: 1,
  })
  spyOn(credentials, 'getCredentialManager').mockReturnValue({ getLlmApiKey: async () => 'secret' } as never)
}

function tokenNestConnection(groups: NonNullable<config.LlmConnection['channelGroups']> = []) {
  const item: config.LlmConnection = {
    slug: 'tokennest', name: 'TokenNest', providerType: 'pi_compat', authType: 'oauth',
    oauthProvider: 'tokennest', channelGroup: 'chat', channelGroups: groups, createdAt: 1,
  }
  spyOn(config, 'getLlmConnection').mockReturnValue(item)
  spyOn(credentials, 'getCredentialManager').mockReturnValue({} as never)
  spyOn(auth, 'getValidTokenNestCredentials').mockResolvedValue({ accessToken: 'oauth-access' } as never)
  return item
}

const imageInput = { connectionSlug: 'tokennest', channelGroup: 'old', model: 'gpt-image-1', prompt: 'A cat' }
const drawingGroup = { id: 'drawing', name: 'GPT图片生成渠道', models: ['gpt-image-1'] }

describe('Studio server requests', () => {
  it('refreshes stale image groups and sends the same model through a newly available group', async () => {
    tokenNestConnection()
    const discover = spyOn(auth, 'fetchTokenNestChannelGroups').mockResolvedValue([drawingGroup])
    const save = spyOn(config, 'updateLlmConnection').mockReturnValue(true)
    const pushed = mock(() => {})
    const handlers = new Map<string, HandlerFn>()
    registerStudioHandlers({ handle: (channel: string, fn: HandlerFn) => handlers.set(channel, fn), push: pushed } as unknown as RpcServer)
    let request: RequestInit | undefined
    globalThis.fetch = mock(async (_url, init) => { request = init; return Response.json({ data: [{ b64_json: 'aGVsbG8=' }] }) }) as unknown as typeof fetch
    await handlers.get(RPC_CHANNELS.studio.GENERATE_IMAGE)!({ clientId: 'test', workspaceId: null, webContentsId: null }, imageInput)
    expect(discover).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('tokennest', { channelGroups: [drawingGroup] })
    expect(pushed).toHaveBeenCalledWith(RPC_CHANNELS.llmConnections.CHANGED, { to: 'all' })
    expect(new Headers(request?.headers).get('X-TokenNest-Group')).toBe('drawing')
    expect(JSON.parse(String(request?.body)).model).toBe('gpt-image-1')
  })

  it('resolves an omitted image group without using the account chat group', async () => {
    tokenNestConnection([drawingGroup])
    const discover = spyOn(auth, 'fetchTokenNestChannelGroups').mockResolvedValue([])
    let request: RequestInit | undefined
    globalThis.fetch = mock(async (_url, init) => { request = init; return Response.json({ data: [{ b64_json: 'aGVsbG8=' }] }) }) as unknown as typeof fetch
    await harness()(RPC_CHANNELS.studio.GENERATE_IMAGE, { ...imageInput, channelGroup: undefined })
    expect(discover).not.toHaveBeenCalled()
    expect(new Headers(request?.headers).get('X-TokenNest-Group')).toBe('drawing')
  })

  it('recovers a definite no-channel rejection once using another authorized group for the same model', async () => {
    tokenNestConnection([{ ...drawingGroup, id: 'old' }])
    spyOn(auth, 'fetchTokenNestChannelGroups').mockResolvedValue([{ ...drawingGroup, id: 'old' }, drawingGroup])
    const sent: RequestInit[] = []
    globalThis.fetch = mock(async (_url, init) => {
      sent.push(init!)
      return sent.length === 1
        ? Response.json({ error: { code: 'no_available_channel', message: 'Temporarily unavailable' } }, { status: 503 })
        : Response.json({ data: [{ b64_json: 'aGVsbG8=' }] })
    }) as unknown as typeof fetch
    const result = await harness()(RPC_CHANNELS.studio.GENERATE_IMAGE, imageInput)
    expect(result.imageBase64).toBe('aGVsbG8=')
    expect(result.channelGroup).toBe('drawing')
    expect(sent.map(init => new Headers(init.headers).get('X-TokenNest-Group'))).toEqual(['old', 'drawing'])
    expect(sent.map(init => JSON.parse(String(init.body)).model)).toEqual(['gpt-image-1', 'gpt-image-1'])
  })

  it('rebuilds the edit multipart body when retrying a rejected image route', async () => {
    tokenNestConnection([{ ...drawingGroup, id: 'old' }])
    spyOn(auth, 'fetchTokenNestChannelGroups').mockResolvedValue([drawingGroup])
    const bodies: FormData[] = []
    globalThis.fetch = mock(async (_url, init) => {
      bodies.push(init?.body as FormData)
      return bodies.length === 1
        ? Response.json({ error: { message: '无可用渠道' } }, { status: 503 })
        : Response.json({ data: [{ b64_json: 'aGVsbG8=' }] })
    }) as unknown as typeof fetch
    await harness()(RPC_CHANNELS.studio.GENERATE_IMAGE, { ...imageInput, imageBase64: 'iVBORw0KGgo=', maskBase64: 'iVBORw0KGgo=' })
    expect(bodies).toHaveLength(2)
    expect(bodies[0]).not.toBe(bodies[1])
    for (const body of bodies) {
      expect(body.get('model')).toBe('gpt-image-1')
      expect(body.get('image')).toBeInstanceOf(File)
      expect(body.get('mask')).toBeInstanceOf(File)
    }
  })

  it('does not retry a model in a group that only advertises other image models', async () => {
    tokenNestConnection([{ ...drawingGroup, id: 'old' }])
    spyOn(auth, 'fetchTokenNestChannelGroups').mockResolvedValue([{ ...drawingGroup, models: ['gpt-image-2'] }])
    const send = mock(async () => Response.json({ error: { message: '无可用渠道' } }, { status: 503 }))
    globalThis.fetch = send as unknown as typeof fetch
    await expect(harness()(RPC_CHANNELS.studio.GENERATE_IMAGE, imageInput)).rejects.toThrow('STUDIO_TOKENNEST_CHANNEL_UNAVAILABLE')
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('stops after one alternative route fails', async () => {
    tokenNestConnection([{ ...drawingGroup, id: 'old' }])
    const discover = spyOn(auth, 'fetchTokenNestChannelGroups').mockResolvedValue([drawingGroup, { ...drawingGroup, id: 'third' }])
    const send = mock(async () => Response.json({ error: { message: '无可用渠道' } }, { status: 503 }))
    globalThis.fetch = send as unknown as typeof fetch
    await expect(harness()(RPC_CHANNELS.studio.GENERATE_IMAGE, imageInput)).rejects.toThrow('STUDIO_TOKENNEST_CHANNEL_UNAVAILABLE')
    expect(send).toHaveBeenCalledTimes(2)
    expect(discover).toHaveBeenCalledTimes(1)
  })

  it('renews a rejected discovery credential before deciding whether an image group exists', async () => {
    tokenNestConnection()
    const discover = spyOn(auth, 'fetchTokenNestChannelGroups')
      .mockRejectedValueOnce(new auth.TokenNestRequestError('Expired', 401))
      .mockResolvedValueOnce([drawingGroup])
    const renew = spyOn(auth, 'getValidTokenNestCredentials').mockResolvedValue({ accessToken: 'oauth-access' } as never)
    globalThis.fetch = mock(async () => Response.json({ data: [{ b64_json: 'aGVsbG8=' }] })) as unknown as typeof fetch
    await harness()(RPC_CHANNELS.studio.GENERATE_IMAGE, imageInput)
    expect(discover).toHaveBeenCalledTimes(2)
    expect(renew).toHaveBeenCalledWith('tokennest', expect.anything(), true)
  })

  it('preserves cached groups and does not turn a discovery network failure into an authorization error', async () => {
    const cached = [{ id: 'chat', name: 'Chat', models: ['gpt-text'] }]
    const item = tokenNestConnection(cached)
    spyOn(auth, 'fetchTokenNestChannelGroups').mockRejectedValue(new Error('Network offline'))
    const send = mock(async () => Response.json({ data: [] }))
    globalThis.fetch = send as unknown as typeof fetch
    await expect(harness()(RPC_CHANNELS.studio.GENERATE_IMAGE, imageInput)).rejects.toThrow('Network offline')
    expect(item.channelGroups).toEqual(cached)
    expect(config.updateLlmConnection).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('does not retry ambiguous image failures', async () => {
    tokenNestConnection([{ ...drawingGroup, id: 'old' }])
    const discover = spyOn(auth, 'fetchTokenNestChannelGroups').mockResolvedValue([drawingGroup])
    const send = mock(async () => { throw new Error('Request timed out') })
    globalThis.fetch = send as unknown as typeof fetch
    await expect(harness()(RPC_CHANNELS.studio.GENERATE_IMAGE, imageInput)).rejects.toThrow('Request timed out')
    expect(send).toHaveBeenCalledTimes(1)
    expect(discover).not.toHaveBeenCalled()
  })

  it('returns a transport-safe recovery code when image generation has no TokenNest group', async () => {
    spyOn(config, 'getLlmConnection').mockReturnValue({
      slug: 'tokennest', name: 'TokenNest', providerType: 'pi_compat', authType: 'oauth',
      oauthProvider: 'tokennest', channelGroups: [{ id: 'chat', models: ['gpt-text'] }], createdAt: 1,
    } as never)
    spyOn(credentials, 'getCredentialManager').mockReturnValue({} as never)
    spyOn(auth, 'getValidTokenNestCredentials').mockResolvedValue({ accessToken: 'oauth-access' } as never)
    spyOn(auth, 'fetchTokenNestChannelGroups').mockResolvedValue([{ id: 'chat', name: 'chat', models: ['gpt-text'] }])
    try {
      await harness()(RPC_CHANNELS.studio.GENERATE_IMAGE, { connectionSlug: 'tokennest', model: 'gpt-image-1', prompt: 'A cat' })
      throw new Error('Expected missing image group')
    } catch (error) {
      expect((error as Error & { code: string }).code).toBe('STUDIO_TOKENNEST_CHANNEL_UNAVAILABLE')
    }
  })
  it('asks GPT about one canvas session and validates the suggested adjustment', async () => {
    connection()
    let body: any
    globalThis.fetch = mock(async (_url, init) => {
      body = JSON.parse(String(init?.body))
      return Response.json({ choices: [{ message: { content: JSON.stringify({ reply: '可以增强对比度', operation: 'adjust', adjustments: { contrast: 999, blur: -2, style: 'noir' } }) } }] })
    }) as unknown as typeof fetch
    const result = await harness()(RPC_CHANNELS.studio.ASSIST_CANVAS, {
      connectionSlug: 'gptimage', model: 'gpt-4.1', sessionId: 'canvas-123', sessionTitle: '海边日落',
      question: '如何更有电影感？', imageBase64: 'iVBORw0KGgo=', selection: { x: 10, y: 20, width: 100, height: 80 },
    })
    expect(result).toEqual({ reply: '可以增强对比度', operation: 'adjust', adjustments: { contrast: 200, blur: 0, style: 'noir' } })
    expect(body.messages[1].content[0].text).toContain('canvas-123')
    expect(body.messages[1].content[1].image_url.url.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('treats a plain GPT answer as advice without an automatic canvas edit', async () => {
    connection()
    globalThis.fetch = mock(async () => Response.json({ choices: [{ message: { content: '可以让主体更突出。' } }] })) as unknown as typeof fetch
    expect(await harness()(RPC_CHANNELS.studio.ASSIST_CANVAS, {
      connectionSlug: 'gptimage', model: 'gpt-4.1', sessionId: 'canvas-123', sessionTitle: '海边日落', question: '点评画面',
    })).toEqual({ reply: '可以让主体更突出。', operation: 'none' })
  })

  it('includes both sides of the canvas conversation in a follow-up request', async () => {
    connection()
    let body: { messages: Array<{ role: string; content: unknown }> } | undefined
    globalThis.fetch = mock(async (_url, init) => {
      body = JSON.parse(String(init?.body))
      return Response.json({ choices: [{ message: { content: '{"reply":"可以调低亮度","operation":"none"}' } }] })
    }) as unknown as typeof fetch
    await harness()(RPC_CHANNELS.studio.ASSIST_CANVAS, {
      connectionSlug: 'gptimage', model: 'gpt-4.1', sessionId: 'canvas-123', sessionTitle: 'Portrait',
      question: '那现在应该怎么改？',
      history: [{ role: 'user', text: '想要电影感' }, { role: 'assistant', text: '可以降低亮度并增加对比度' }],
    })
    expect(body?.messages.slice(1, 3)).toEqual([
      { role: 'user', content: '想要电影感' },
      { role: 'assistant', content: '可以降低亮度并增加对比度' },
    ])
    expect((body?.messages.at(-1)?.content as Array<{ text: string }>)[0].text).toContain('那现在应该怎么改？')
  })

  it('passes the selected canvas thinking level to the text model', async () => {
    connection()
    let body: { reasoning_effort?: string } | undefined
    globalThis.fetch = mock(async (_url, init) => {
      body = JSON.parse(String(init?.body))
      return Response.json({ choices: [{ message: { content: '{"reply":"可以提高对比度","operation":"none"}' } }] })
    }) as unknown as typeof fetch
    await harness()(RPC_CHANNELS.studio.ASSIST_CANVAS, {
      connectionSlug: 'gptimage', model: 'gpt-6-sol', sessionId: 'canvas-123', sessionTitle: 'Portrait',
      question: '如何调整？', thinkingLevel: 'high',
    })
    expect(body?.reasoning_effort).toBe('high')
    expect(body).toHaveProperty('stream', true)
  })

  it('uses the server-owned API key for GPT Image generation', async () => {
    connection()
    let request: RequestInit | undefined
    globalThis.fetch = mock(async (_url, init) => { request = init; return Response.json({ data: [{ b64_json: 'aGVsbG8=' }] }) }) as unknown as typeof fetch
    const invoke = harness()
    const result = await invoke(RPC_CHANNELS.studio.GENERATE_IMAGE, { connectionSlug: 'gptimage', model: 'gpt-image-1', prompt: 'A tree' })
    expect(result.imageBase64).toBe('aGVsbG8=')
    expect(new Headers(request?.headers).get('authorization')).toBe('Bearer secret')
    expect(JSON.parse(String(request?.body))).toEqual({ model: 'gpt-image-1', prompt: 'A tree', size: '1024x1024' })
  })

  it('requests and returns multiple image candidates', async () => {
    connection()
    let body: string | undefined
    globalThis.fetch = mock(async (_url, init) => {
      body = init?.body as string
      return Response.json({ data: [{ b64_json: 'aGVsbG8=' }, { b64_json: 'd29ybGQ=' }] })
    }) as unknown as typeof fetch
    const result = await harness()(RPC_CHANNELS.studio.GENERATE_IMAGE, {
      connectionSlug: 'gptimage', model: 'gpt-image-1', prompt: 'A tree', count: 2,
    })
    expect(JSON.parse(body!).n).toBe(2)
    expect(result.images.map((image: { imageBase64: string }) => image.imageBase64)).toEqual(['aGVsbG8=', 'd29ybGQ='])
    expect(result.imageBase64).toBe('aGVsbG8=')
  })

  it('rejects image counts outside the supported range before dispatch', async () => {
    connection()
    const request = mock(async () => Response.json({ data: [{ b64_json: 'aGVsbG8=' }] }))
    globalThis.fetch = request as unknown as typeof fetch
    await expect(harness()(RPC_CHANNELS.studio.GENERATE_IMAGE, {
      connectionSlug: 'gptimage', model: 'gpt-image-1', prompt: 'A tree', count: 5,
    })).rejects.toThrow('Image count must be between 1 and 4')
    expect(request).not.toHaveBeenCalled()
  })

  it('sends an image and transparent mask to the edit endpoint', async () => {
    connection()
    const png = 'iVBORw0KGgo=' // PNG signature is sufficient for input validation
    let url = ''
    let body: FormData | undefined
    globalThis.fetch = mock(async (input, init) => { url = String(input); body = init?.body as FormData; return Response.json({ data: [{ b64_json: png }] }) }) as unknown as typeof fetch
    const invoke = harness()
    await invoke(RPC_CHANNELS.studio.GENERATE_IMAGE, { connectionSlug: 'gptimage', model: 'gpt-image-1', prompt: 'Fill', imageBase64: png, maskBase64: png, count: 2 })
    expect(url).toBe('https://images.example/v1/images/edits')
    expect(body?.get('image')).toBeInstanceOf(File)
    expect(body?.get('mask')).toBeInstanceOf(File)
    expect(body?.get('n')).toBe('2')
  })

  it('requests transparent output for GPT Image background removal', async () => {
    connection()
    const png = 'iVBORw0KGgo='
    let body: FormData | undefined
    globalThis.fetch = mock(async (_url, init) => { body = init?.body as FormData; return Response.json({ data: [{ b64_json: png }] }) }) as unknown as typeof fetch
    await harness()(RPC_CHANNELS.studio.GENERATE_IMAGE, {
      connectionSlug: 'gptimage', model: 'gpt-image-1', prompt: 'Remove background',
      imageBase64: png, transparentBackground: true,
    })
    expect(body?.get('background')).toBe('transparent')
  })

  it('routes image generation through the selected TokenNest image group', async () => {
    spyOn(config, 'getLlmConnection').mockReturnValue({
      slug: 'tokennest', name: 'TokenNest', providerType: 'pi_compat', authType: 'oauth',
      oauthProvider: 'tokennest', channelGroup: 'chat',
      channelGroups: [{ id: 'chat', name: '聊天', models: ['gpt-text'] }, { id: 'drawing', name: 'GPT图片生成渠道', models: ['gpt-image-1'] }],
      createdAt: 1,
    } as never)
    spyOn(credentials, 'getCredentialManager').mockReturnValue({} as never)
    spyOn(auth, 'getValidTokenNestCredentials').mockResolvedValue({ accessToken: 'oauth-access' } as never)
    let request: RequestInit | undefined
    globalThis.fetch = mock(async (_url, init) => { request = init; return Response.json({ data: [{ b64_json: 'aGVsbG8=' }] }) }) as unknown as typeof fetch
    const invoke = harness()
    await invoke(RPC_CHANNELS.studio.GENERATE_IMAGE, { connectionSlug: 'tokennest', channelGroup: 'drawing', model: 'gpt-image-1', prompt: 'A tree' })
    expect(new Headers(request?.headers).get('X-TokenNest-Group')).toBe('drawing')
    expect(new Headers(request?.headers).get('Authorization')).toBe('Bearer oauth-access')
  })

  it('sends a Chinese TokenNest image group as UTF-8 header bytes', async () => {
    const group = 'GPT图片生成渠道'
    spyOn(config, 'getLlmConnection').mockReturnValue({
      slug: 'tokennest', name: 'TokenNest', providerType: 'pi_compat', authType: 'oauth',
      oauthProvider: 'tokennest', channelGroup: 'Normal',
      channelGroups: [{ id: group, name: group, models: ['gpt-image-2.5'] }], createdAt: 1,
    } as never)
    spyOn(credentials, 'getCredentialManager').mockReturnValue({} as never)
    spyOn(auth, 'getValidTokenNestCredentials').mockResolvedValue({ accessToken: 'oauth-access' } as never)
    let request: RequestInit | undefined
    globalThis.fetch = mock(async (_url, init) => {
      request = init
      // Constructing Headers reproduces Fetch's ByteString validation.
      new Headers(init?.headers)
      return Response.json({ data: [{ b64_json: 'aGVsbG8=' }] })
    }) as unknown as typeof fetch

    await harness()(RPC_CHANNELS.studio.GENERATE_IMAGE, {
      connectionSlug: 'tokennest', channelGroup: group, model: 'gpt-image-2.5', prompt: 'A tree',
    })
    const header = new Headers(request?.headers).get('X-TokenNest-Group')!
    expect(Buffer.from(header, 'latin1').toString('utf8')).toBe(group)
  })

  it('does not send an image request without an available OAuth image group', async () => {
    spyOn(config, 'getLlmConnection').mockReturnValue({
      slug: 'tokennest', name: 'TokenNest', providerType: 'pi_compat', authType: 'oauth',
      oauthProvider: 'tokennest', channelGroup: 'Normal', createdAt: 1,
    } as never)
    spyOn(credentials, 'getCredentialManager').mockReturnValue({} as never)
    spyOn(auth, 'getValidTokenNestCredentials').mockResolvedValue({ accessToken: 'old-oauth-access' } as never)
    spyOn(auth, 'fetchTokenNestChannelGroups').mockResolvedValue([])
    const request = mock(async () => Response.json({ data: [{ b64_json: 'aGVsbG8=' }] }))
    globalThis.fetch = request as unknown as typeof fetch

    await expect(harness()(RPC_CHANNELS.studio.GENERATE_IMAGE, {
      connectionSlug: 'tokennest', model: 'gpt-image-2.5', prompt: 'A tree',
    })).rejects.toThrow('STUDIO_TOKENNEST_CHANNEL_UNAVAILABLE')
    expect(request).not.toHaveBeenCalled()
  })

  it('asks for OAuth reauthorization when an image request reveals missing group scope', async () => {
    spyOn(config, 'getLlmConnection').mockReturnValue({
      slug: 'tokennest', name: 'TokenNest', providerType: 'pi_compat', authType: 'oauth',
      oauthProvider: 'tokennest', channelGroup: 'Normal',
      channelGroups: [{ id: 'drawing', name: 'GPT图片生成渠道', models: ['gpt-image-2.5'] }], createdAt: 1,
    } as never)
    spyOn(credentials, 'getCredentialManager').mockReturnValue({} as never)
    spyOn(auth, 'getValidTokenNestCredentials').mockResolvedValue({ accessToken: 'old-oauth-access' } as never)
    globalThis.fetch = mock(async input => String(input).endsWith('/api/oauth2/groups')
      ? Response.json({ error: 'insufficient_scope' }, { status: 403 })
      : Response.json({ error: { message: '分组 drawing 下模型 gpt-image-2.5 无可用渠道（distributor）' } }, { status: 503 })) as unknown as typeof fetch

    await expect(harness()(RPC_CHANNELS.studio.GENERATE_IMAGE, {
      connectionSlug: 'tokennest', channelGroup: 'drawing', model: 'gpt-image-2.5', prompt: 'A tree',
    })).rejects.toThrow('STUDIO_TOKENNEST_REAUTH_REQUIRED')
  })

  it('keeps a no-channel failure distinct when OAuth group access still works', async () => {
    spyOn(config, 'getLlmConnection').mockReturnValue({
      slug: 'tokennest', name: 'TokenNest', providerType: 'pi_compat', authType: 'oauth',
      oauthProvider: 'tokennest', channelGroup: 'Normal',
      channelGroups: [{ id: 'Normal', name: 'Normal', models: ['gpt-image-2.5'] }], createdAt: 1,
    } as never)
    spyOn(credentials, 'getCredentialManager').mockReturnValue({} as never)
    spyOn(auth, 'getValidTokenNestCredentials').mockResolvedValue({ accessToken: 'current-oauth-access' } as never)
    globalThis.fetch = mock(async input => String(input).endsWith('/api/oauth2/groups')
      ? Response.json({ data: { Normal: { desc: 'Normal', models: ['gpt-image-2.5'] } } })
      : Response.json({ error: { message: '分组 Normal 下模型 gpt-image-2.5 无可用渠道（distributor）' } }, { status: 503 })) as unknown as typeof fetch

    await expect(harness()(RPC_CHANNELS.studio.GENERATE_IMAGE, {
      connectionSlug: 'tokennest', channelGroup: 'Normal', model: 'gpt-image-2.5', prompt: 'A tree',
    })).rejects.toThrow('STUDIO_TOKENNEST_CHANNEL_UNAVAILABLE')
  })

  it('sends the existing draw.io document and returns an editable revision', async () => {
    connection()
    const currentXml = '<mxfile><diagram><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="topic" value="Plan" vertex="1" parent="1"><mxGeometry x="40" y="40" width="120" height="40" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>'
    const changedXml = currentXml.replace('value="Plan"', 'value="Revised plan"')
    let body: { model: string; messages: { content: string }[] } | undefined
    globalThis.fetch = mock(async (_url, init) => {
      body = JSON.parse(String(init?.body))
      return Response.json({ choices: [{ message: { content: JSON.stringify({ xml: changedXml, summary: '已修改主题' }) } }] })
    }) as unknown as typeof fetch
    const invoke = harness()
    expect(await invoke(RPC_CHANNELS.studio.GENERATE_MIND_MAP, { connectionSlug: 'gptimage', model: 'gpt-4.1', prompt: 'Rename topic', currentXml, priorRequests: ['Create a plan'] }))
      .toEqual({ xml: changedXml, summary: '已修改主题' })
    expect(body?.model).toBe('gpt-4.1')
    expect(JSON.parse(body!.messages[1].content)).toEqual({ instruction: 'Rename topic', priorRequests: ['Create a plan'], currentXml })
  })

  it('does not create provider deadlines for mind map and canvas text generation', async () => {
    connection()
    const timeout = spyOn(AbortSignal, 'timeout')
    globalThis.fetch = mock(async () => Response.json({ choices: [{ message: { content: '项目说明' } }] })) as unknown as typeof fetch
    const invoke = harness()
    await invoke(RPC_CHANNELS.studio.GENERATE_MIND_MAP, {
      connectionSlug: 'gptimage', model: 'gpt-4.1', prompt: '说明项目', mode: 'ask',
    })
    await invoke(RPC_CHANNELS.studio.ASSIST_CANVAS, {
      connectionSlug: 'gptimage', model: 'gpt-4.1', sessionId: 'canvas', sessionTitle: 'Canvas', question: '说明画布',
    })
    expect(timeout).not.toHaveBeenCalled()
  })

  it('shares the cancellation signal across TokenNest authorization renewal', async () => {
    tokenNestConnection([{ id: 'chat', name: '文本', models: ['gpt-4.1'] }])
    const timeout = spyOn(AbortSignal, 'timeout')
    const signals: Array<AbortSignal | null | undefined> = []
    globalThis.fetch = mock(async (_url, init) => {
      signals.push(init?.signal)
      return signals.length === 1
        ? Response.json({ error: 'expired' }, { status: 401 })
        : Response.json({ choices: [{ message: { content: '项目说明' } }] })
    }) as unknown as typeof fetch
    await expect(harness()(RPC_CHANNELS.studio.GENERATE_MIND_MAP, {
      connectionSlug: 'tokennest', model: 'gpt-4.1', prompt: '说明项目', mode: 'ask',
    })).resolves.toEqual({ mode: 'ask', summary: '项目说明' })
    expect(signals).toHaveLength(2)
    expect(signals[0]).toBe(signals[1])
    expect(timeout).not.toHaveBeenCalled()
  })

  it('does not start another generation after cancellation during authorization renewal', async () => {
    tokenNestConnection([{ id: 'chat', name: '文本', models: ['gpt-4.1'] }])
    const controller = new AbortController()
    spyOn(auth, 'getValidTokenNestCredentials').mockImplementation(async (_slug, _manager, refresh) => {
      if (refresh) controller.abort(new Error('Client disconnected'))
      return { accessToken: 'oauth-access' } as never
    })
    const request = mock(async () => Response.json({ error: 'expired' }, { status: 401 }))
    globalThis.fetch = request as unknown as typeof fetch
    const handlers = new Map<string, HandlerFn>()
    registerStudioHandlers({ handle: (channel: string, fn: HandlerFn) => handlers.set(channel, fn), push: () => {} } as unknown as RpcServer)
    await expect(handlers.get(RPC_CHANNELS.studio.GENERATE_MIND_MAP)!({ clientId: 'test', workspaceId: null, webContentsId: null, signal: controller.signal }, {
      connectionSlug: 'tokennest', model: 'gpt-4.1', prompt: '说明项目', mode: 'ask',
    })).rejects.toThrow('Client disconnected')
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('runs a project tool, reports its real progress to the caller, and continues generation', async () => {
    connection()
    const directory = await mkdtemp(join(tmpdir(), 'studio-tool-loop-'))
    try {
      await writeFile(join(directory, 'schema.sql'), 'CREATE TABLE users (id INT PRIMARY KEY);')
      const handlers = new Map<string, HandlerFn>()
      const pushed: any[][] = []
      registerStudioHandlers({ handle: (channel: string, fn: HandlerFn) => handlers.set(channel, fn), push: (...args: any[]) => pushed.push(args) } as unknown as RpcServer)
      let calls = 0
      let followup: Record<string, any> | undefined
      globalThis.fetch = mock(async (_url, init) => {
        if (++calls === 1) return Response.json({ choices: [{ message: { content: null, tool_calls: [{ id: 'read-schema', type: 'function', function: { name: 'read_project_file', arguments: '{"path":"schema.sql"}' } }] } }] })
        followup = JSON.parse(String(init?.body))
        return Response.json({ choices: [{ message: { content: '项目定义了 users 表。' } }] })
      }) as unknown as typeof fetch
      await expect(handlers.get(RPC_CHANNELS.studio.GENERATE_MIND_MAP)!({ clientId: 'caller', workspaceId: null, webContentsId: null }, {
        requestId: 'request-1', connectionSlug: 'gptimage', model: 'gpt-4.1', prompt: '读取项目数据表', mode: 'ask', workspaceDirectory: directory,
      })).resolves.toEqual({ mode: 'ask', summary: '项目定义了 users 表。' })
      const toolMessage = followup?.messages.find((message: any) => message.role === 'tool')
      expect(JSON.parse(toolMessage.content).content).toContain('CREATE TABLE users')
      expect(followup?.tools).toHaveLength(2)
      const tools = pushed.filter(item => item[2].type === 'tool')
      expect(tools.map(item => item[2].status)).toEqual(['running', 'completed'])
      expect(tools.every(item => item[0] === RPC_CHANNELS.studio.WORK_EVENT && item[1].clientId === 'caller' && item[2].requestId === 'request-1')).toBe(true)
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  it('reads the desktop project through the requesting client when its model server is remote', async () => {
    connection()
    const handlers = new Map<string, HandlerFn>()
    const invokeClient = mock(async () => '{"content":"CREATE TABLE users (id INT);"}')
    registerStudioHandlers({
      handle: (channel: string, fn: HandlerFn) => handlers.set(channel, fn), push: () => {},
      hasClientCapability: (_client: string, capability: string) => capability === CLIENT_MINDMAP_PROJECT_TOOL,
      invokeClient,
    } as unknown as RpcServer)
    let calls = 0
    globalThis.fetch = mock(async () => ++calls === 1
      ? Response.json({ choices: [{ message: { tool_calls: [{ id: 'tool-1', type: 'function', function: { name: 'read_project_file', arguments: '{"path":"schema.sql"}' } }] } }] })
      : Response.json({ choices: [{ message: { content: 'users table' } }] })) as unknown as typeof fetch
    await expect(handlers.get(RPC_CHANNELS.studio.GENERATE_MIND_MAP)!({ clientId: 'desktop', workspaceId: null, webContentsId: null }, {
      requestId: 'local-project', connectionSlug: 'gptimage', model: 'gpt-4.1', prompt: '读取项目', mode: 'ask', workspaceDirectory: 'Z:\\client-only-project',
    })).resolves.toEqual({ mode: 'ask', summary: 'users table' })
    expect(invokeClient).toHaveBeenCalledWith('desktop', CLIENT_MINDMAP_PROJECT_TOOL, { requestId: 'local-project', name: 'read_project_file', args: { path: 'schema.sql' } })
  })

  it.each(['repeated', 'oversized'])('completes a streamed mind map tool round with %s call IDs', async (variant) => {
    connection()
    const handlers = new Map<string, HandlerFn>()
    const invokeClient = mock(async () => '{"content":"CREATE TABLE users (id INT);"}')
    registerStudioHandlers({
      handle: (channel: string, fn: HandlerFn) => handlers.set(channel, fn), push: () => {},
      hasClientCapability: () => true, invokeClient,
    } as unknown as RpcServer)
    const id = variant === 'oversized' ? 'x'.repeat(222) : 'call_' + 'a'.repeat(32)
    const xml = '<mxfile><diagram><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="users" value="users" vertex="1" parent="1"><mxGeometry x="40" y="40" width="120" height="40" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>'
    const event = (delta: unknown, finish_reason?: string) => `data: ${JSON.stringify({ choices: [{ delta, finish_reason }] })}\n\n`
    let requests = 0
    globalThis.fetch = mock(async (_url, init) => {
      const body = JSON.parse(String(init?.body))
      if (++requests === 1) {
        const stream = ['{"path":', '"schema', '.sql', '"', '}', ''].map(argumentsDelta => event({
          tool_calls: [{ index: 0, id, function: { name: 'read_project_file', arguments: argumentsDelta } }],
        })).join('') + event({}, 'tool_calls')
        return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
      }
      const outgoingId = body.messages[2].tool_calls[0].id
      expect(outgoingId.length).toBeLessThanOrEqual(64)
      if (variant === 'repeated') expect(outgoingId).toBe(id)
      else expect(outgoingId).not.toBe(id)
      expect(body.messages[2].tool_calls[0].function.name).toBe('read_project_file')
      expect(body.messages[3].tool_call_id).toBe(outgoingId)
      expect(body.messages[3].content).toContain('CREATE TABLE users')
      return new Response(event({ content: JSON.stringify({ xml, summary: '已生成导图' }) }, 'stop'), {
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }) as unknown as typeof fetch
    await expect(handlers.get(RPC_CHANNELS.studio.GENERATE_MIND_MAP)!({ clientId: 'desktop', workspaceId: null, webContentsId: null }, {
      requestId: 'repeated-tool-id', connectionSlug: 'gptimage', model: 'gpt-4.1', prompt: '生成项目导图', workspaceDirectory: 'Z:\\client-project',
    })).resolves.toEqual({ xml, summary: '已生成导图' })
    expect(requests).toBe(2)
    expect(invokeClient).toHaveBeenCalledTimes(1)
    expect(invokeClient).toHaveBeenCalledWith('desktop', CLIENT_MINDMAP_PROJECT_TOOL, {
      requestId: 'repeated-tool-id', name: 'read_project_file', args: { path: 'schema.sql' },
    })
  })

  it('stops immediately while waiting for a desktop file tool', async () => {
    connection()
    const handlers = new Map<string, HandlerFn>()
    let entered!: () => void
    const ready = new Promise<void>(resolve => { entered = resolve })
    registerStudioHandlers({
      handle: (channel: string, fn: HandlerFn) => handlers.set(channel, fn), push: () => {},
      hasClientCapability: () => true,
      invokeClient: () => { entered(); return new Promise(() => {}) },
    } as unknown as RpcServer)
    globalThis.fetch = mock(async () => Response.json({ choices: [{ message: { tool_calls: [{ id: 'tool-1', type: 'function', function: { name: 'read_project_file', arguments: '{"path":"schema.sql"}' } }] } }] })) as unknown as typeof fetch
    const ctx = { clientId: 'desktop', workspaceId: null, webContentsId: null }
    const pending = handlers.get(RPC_CHANNELS.studio.GENERATE_MIND_MAP)!(ctx, {
      requestId: 'stop-file', connectionSlug: 'gptimage', model: 'gpt-4.1', prompt: '读取项目', workspaceDirectory: 'Z:\\project',
    })
    await ready
    await handlers.get(RPC_CHANNELS.studio.CANCEL_TEXT)!(ctx, 'stop-file')
    await expect(pending).rejects.toThrow('cancelled')
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('only allows the requesting client to stop a running generation', async () => {
    connection()
    const handlers = new Map<string, HandlerFn>()
    registerStudioHandlers({ handle: (channel: string, fn: HandlerFn) => handlers.set(channel, fn), push: () => {} } as unknown as RpcServer)
    let entered!: () => void
    const ready = new Promise<void>(resolve => { entered = resolve })
    let signal: AbortSignal | undefined
    globalThis.fetch = mock(async (_url, init) => {
      signal = init?.signal ?? undefined
      entered()
      return new Response(new ReadableStream(), { headers: { 'Content-Type': 'text/event-stream' } })
    }) as unknown as typeof fetch
    const ctx = { clientId: 'caller', workspaceId: null, webContentsId: null }
    const pending = handlers.get(RPC_CHANNELS.studio.GENERATE_MIND_MAP)!(ctx, {
      requestId: 'cancel-test', connectionSlug: 'gptimage', model: 'gpt-4.1', prompt: '生成导图',
    })
    await ready
    await handlers.get(RPC_CHANNELS.studio.CANCEL_TEXT)!({ ...ctx, clientId: 'other-client' }, 'cancel-test')
    expect(signal?.aborted).toBe(false)
    await handlers.get(RPC_CHANNELS.studio.CANCEL_TEXT)!(ctx, 'cancel-test')
    await expect(pending).rejects.toThrow('cancelled')
    expect(signal?.aborted).toBe(true)
  })

  it('includes both sides of the mind map conversation in follow-up requests', async () => {
    connection()
    const xml = '<mxfile><diagram><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>'
    const revisedXml = xml.replace('</root>', '<mxCell id="risk" value="Risk" vertex="1" parent="1"/></root>')
    let body: { messages: Array<{ role: string; content: string }> } | undefined
    globalThis.fetch = mock(async (_url, init) => {
      body = JSON.parse(String(init?.body))
      return Response.json({ choices: [{ message: { content: JSON.stringify({ xml: revisedXml, summary: '已添加节点' }) } }] })
    }) as unknown as typeof fetch
    await harness()(RPC_CHANNELS.studio.GENERATE_MIND_MAP, {
      connectionSlug: 'gptimage', model: 'gpt-4.1', prompt: '再添加风险节点', currentXml: xml,
      history: [{ role: 'user', text: '创建项目计划' }, { role: 'assistant', text: '已创建目标和里程碑' }],
    })
    expect(body?.messages.slice(1, 3)).toEqual([
      { role: 'user', content: '创建项目计划' },
      { role: 'assistant', content: '已创建目标和里程碑' },
    ])
    expect(JSON.parse(body!.messages[3].content).instruction).toBe('再添加风险节点')
  })

  it('maps the mind map thinking setting and leaves automatic effort to the model', async () => {
    connection()
    const xml = '<mxfile><diagram><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="topic" value="Plan" vertex="1" parent="1"/></root></mxGraphModel></diagram></mxfile>'
    const bodies: Array<{ reasoning_effort?: string }> = []
    globalThis.fetch = mock(async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)))
      return Response.json({ choices: [{ message: { content: JSON.stringify({ xml, summary: '已更新' }) } }] })
    }) as unknown as typeof fetch
    const invoke = harness()
    await invoke(RPC_CHANNELS.studio.GENERATE_MIND_MAP, { connectionSlug: 'gptimage', model: 'gpt-6-sol', prompt: '添加节点', thinkingLevel: 'off' })
    await invoke(RPC_CHANNELS.studio.GENERATE_MIND_MAP, { connectionSlug: 'gptimage', model: 'gpt-6-sol', prompt: '添加节点', thinkingLevel: 'auto' })
    expect(bodies[0]?.reasoning_effort).toBe('none')
    expect(bodies[1]).not.toHaveProperty('reasoning_effort')
  })

  it('routes a mind map model through its TokenNest text group', async () => {
    spyOn(config, 'getLlmConnection').mockReturnValue({
      slug: 'tokennest', name: 'TokenNest', providerType: 'pi_compat', authType: 'oauth',
      oauthProvider: 'tokennest', channelGroup: 'astra', createdAt: 1,
      channelGroups: [
        { id: 'astra', name: 'Astra', models: ['gpt-6-astra'] },
        { id: 'text', name: '文本', models: ['gpt-6-sol'] },
      ],
    } as never)
    spyOn(credentials, 'getCredentialManager').mockReturnValue({} as never)
    spyOn(auth, 'getValidTokenNestCredentials').mockResolvedValue({ accessToken: 'oauth-access' } as never)
    const xml = '<mxfile><diagram><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="topic" value="Plan" vertex="1" parent="1"/></root></mxGraphModel></diagram></mxfile>'
    let request: RequestInit | undefined
    globalThis.fetch = mock(async (_url, init) => {
      request = init
      const reply = JSON.stringify({ xml, summary: '已生成导图' })
      return new Response([
        `data: ${JSON.stringify({ choices: [{ delta: { content: reply.slice(0, 40) } }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: reply.slice(40) } }] })}\n\n`,
        'data: [DONE]\n\n',
      ].join(''), { headers: { 'Content-Type': 'text/event-stream' } })
    }) as unknown as typeof fetch

    expect(await harness()(RPC_CHANNELS.studio.GENERATE_MIND_MAP, {
      connectionSlug: 'tokennest', model: 'gpt-6-sol', channelGroup: 'text', prompt: 'Make a plan',
    })).toEqual({ xml, summary: '已生成导图' })
    expect(new Headers(request?.headers).get('X-TokenNest-Group')).toBe('text')
    expect(JSON.parse(String(request?.body)).stream).toBe(true)
    await expect(harness()(RPC_CHANNELS.studio.GENERATE_MIND_MAP, {
      connectionSlug: 'tokennest', model: 'gpt-6-sol', channelGroup: 'astra', prompt: 'Make a plan',
    })).rejects.toThrow('STUDIO_TOKENNEST_CHANNEL_UNAVAILABLE')
  })

  it('expands compressed draw.io input before asking the model to edit it', async () => {
    connection()
    const graph = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="topic" value="Plan" vertex="1" parent="1"/></root></mxGraphModel>'
    const compressed = deflateRawSync(Buffer.from(encodeURIComponent(graph))).toString('base64')
    let body: { messages: { content: string }[] } | undefined
    globalThis.fetch = mock(async (_url, init) => {
      body = JSON.parse(String(init?.body))
      return Response.json({ choices: [{ message: { content: `<mxfile><diagram>${graph.replace('value="Plan"', 'value="Updated"')}</diagram></mxfile>` } }] })
    }) as unknown as typeof fetch
    await harness()(RPC_CHANNELS.studio.GENERATE_MIND_MAP, { connectionSlug: 'gptimage', model: 'gpt-4.1', prompt: 'Change color', currentXml: `<mxfile><diagram>${compressed}</diagram></mxfile>` })
    expect(JSON.parse(body!.messages[1].content).currentXml).toContain('id="topic"')
  })

  it('does not preserve an empty editor scaffold as diagram content', async () => {
    connection()
    let body: { messages: { content: string }[] } | undefined
    const xml = '<mxfile><diagram><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>'
    const generatedXml = xml.replace('</root>', '<mxCell id="topic" value="Plan" vertex="1" parent="1"/></root>')
    globalThis.fetch = mock(async (_url, init) => {
      body = JSON.parse(String(init?.body))
      return Response.json({ choices: [{ message: { content: generatedXml } }] })
    }) as unknown as typeof fetch
    await harness()(RPC_CHANNELS.studio.GENERATE_MIND_MAP, { connectionSlug: 'gptimage', model: 'gpt-4.1', prompt: 'New plan', currentXml: xml })
    expect(JSON.parse(body!.messages[1].content).currentXml).toBeNull()
  })

  it('does not report an empty or unchanged mind map as applied', async () => {
    connection()
    const empty = '<mxfile><diagram><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>'
    globalThis.fetch = mock(async () => Response.json({ choices: [{ message: { content: JSON.stringify({ xml: empty, summary: '无法读取项目' }) } }] })) as unknown as typeof fetch
    await expect(harness()(RPC_CHANNELS.studio.GENERATE_MIND_MAP, {
      connectionSlug: 'gptimage', model: 'gpt-6-sol', prompt: '生成 ER 图', currentXml: empty,
    })).rejects.toThrow('did not create any editable mind map nodes')

    const existing = empty.replace('</root>', '<mxCell id="topic" value="Plan" vertex="1" parent="1"/></root>')
    globalThis.fetch = mock(async () => Response.json({ choices: [{ message: { content: JSON.stringify({ xml: existing, summary: '已修改' }) } }] })) as unknown as typeof fetch
    await expect(harness()(RPC_CHANNELS.studio.GENERATE_MIND_MAP, {
      connectionSlug: 'gptimage', model: 'gpt-6-sol', prompt: '修改导图', currentXml: existing,
    })).rejects.toThrow('without changes')
  })

  it('answers mind map questions without returning an applied edit', async () => {
    connection()
    globalThis.fetch = mock(async () => Response.json({ choices: [{ message: { content: '当前导图包含项目计划节点。' } }] })) as unknown as typeof fetch
    expect(await harness()(RPC_CHANNELS.studio.GENERATE_MIND_MAP, {
      connectionSlug: 'gptimage', model: 'gpt-6-sol', prompt: '这个导图是什么？', mode: 'ask',
    })).toEqual({ mode: 'ask', summary: '当前导图包含项目计划节点。' })
  })

  it('rejects an invalid mind map response', async () => {
    connection()
    globalThis.fetch = mock(async () => Response.json({ choices: [{ message: { content: '{"title":"Plan","children":[{"title":"A"}]}' } }] })) as unknown as typeof fetch
    await expect(harness()(RPC_CHANNELS.studio.GENERATE_MIND_MAP, { connectionSlug: 'gptimage', model: 'gpt-4.1', prompt: 'Make a plan' }))
      .rejects.toThrow('AI did not return draw.io XML')
  })
})
