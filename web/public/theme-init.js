// Apply persisted theme/mode before first paint to avoid a flash.
// Kept as a separate file (not inline) so the CSP can stay script-src 'self'.
;(function () {
  try {
    var t = localStorage.getItem('gol.theme')
    var m = localStorage.getItem('gol.mode')
    var root = document.documentElement
    if (t === 'fintech' || t === 'game') root.setAttribute('data-theme', t)
    if (m === 'light' || m === 'dark') root.setAttribute('data-mode', m)
    else
      root.setAttribute(
        'data-mode',
        window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark',
      )
  } catch (e) {
    /* first paint keeps defaults */
  }
})()
