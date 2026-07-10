import { useEffect, useState } from 'react'

/** Debounce a value; used to re-simulate ~300ms after slider drags settle. */
export function useDebounced<T>(value: T, delay = 300, key?: string): T {
  const [debounced, setDebounced] = useState(value)
  const changeKey = key ?? (value as unknown as string)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changeKey, delay])
  return debounced
}
