/** jsdom polyfills for the app smoke test. No-op under node env. */

if (typeof window !== 'undefined') setupDom()

function setupDom() {
class RO {
  private cb: ResizeObserverCallback
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb
  }
  observe(el: Element) {
    // report a fixed width so charts render real geometry
    this.cb(
      [{ contentRect: { width: 800, height: 400 } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    )
    void el
  }
  unobserve() {}
  disconnect() {}
}

if (!('ResizeObserver' in globalThis)) {
  ;(globalThis as Record<string, unknown>).ResizeObserver = RO
}

if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList
}

if (!SVGElement.prototype.getBoundingClientRect) {
  SVGElement.prototype.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 800, height: 400, right: 800, bottom: 400, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
}
}
