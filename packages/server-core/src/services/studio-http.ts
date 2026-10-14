import { getGlobalDispatcher, type Dispatcher } from 'undici'

/** Preserve the current proxy routing while removing Node fetch's HTTP deadlines. */
export const studioTextDispatcher = {
  dispatch(options: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandler): boolean {
    return getGlobalDispatcher().dispatch({ ...options, headersTimeout: 0, bodyTimeout: 0 }, handler)
  },
}

export function studioTextFetchOptions(): RequestInit {
  if (typeof Bun !== 'undefined') return {}
  // Node's bundled undici types may differ from the installed dispatcher types.
  return { dispatcher: studioTextDispatcher } as unknown as RequestInit
}
