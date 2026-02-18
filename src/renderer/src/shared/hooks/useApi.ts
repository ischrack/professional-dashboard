// Typed wrapper around window.api
declare global {
  interface Window {
    api: Record<string, (...args: unknown[]) => Promise<unknown>>
  }
}

export const api = window.api
