import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

export interface ContributedTheme {
  pluginId: string
  themeId: string
  label: string
  type: 'dark' | 'light'
  vars: Record<string, string>
}

export interface ContributedSidebarSlot {
  pluginId: string
  slotId: string
  name: string
  type: 'list' | 'tree' | 'form'
}

export interface ContributedStatusBarSlot {
  pluginId: string
  slotId: string
  alignment: 'left' | 'right'
  priority: number
}

export interface AggregatedContributions {
  themes: ContributedTheme[]
  sidebar: ContributedSidebarSlot[]
  statusBar: ContributedStatusBarSlot[]
}

const EMPTY: AggregatedContributions = { themes: [], sidebar: [], statusBar: [] }

interface ContributionsContextValue {
  contributions: AggregatedContributions
  loading: boolean
  refresh: () => Promise<void>
}

const ContributionsContext = createContext<ContributionsContextValue>({
  contributions: EMPTY,
  loading: false,
  refresh: async () => {},
})

interface BridgeWithContributions {
  getContributions?: () => Promise<AggregatedContributions>
}

function getBridge(): BridgeWithContributions | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as Window & { __nodalcore?: BridgeWithContributions }).__nodalcore
}

export function ContributionsProvider({ children }: { children: ReactNode }) {
  const [contributions, setContributions] = useState<AggregatedContributions>(EMPTY)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const bridge = getBridge()
    if (!bridge?.getContributions) {
      setContributions(EMPTY)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const next = await bridge.getContributions()
      setContributions(next)
    } catch (err) {
      console.warn('[contributions] fetch failed:', err)
      setContributions(EMPTY)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const value = useMemo(
    () => ({ contributions, loading, refresh }),
    [contributions, loading, refresh],
  )

  return (
    <ContributionsContext.Provider value={value}>{children}</ContributionsContext.Provider>
  )
}

export function useContributions(): ContributionsContextValue {
  return useContext(ContributionsContext)
}
