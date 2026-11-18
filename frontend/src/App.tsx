// App shell: router + embedded-mode dispatch (mirrors legacy app.py).
// Query params keep the Ora iframe contract:
//   ?session_id=<oraSessionId>&agent_type=<opencode|claude_code>
//   ?app_mode=compare   (camelCase variants also honored)

import { lazy, Suspense } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes, useSearchParams } from 'react-router-dom'
import TrajectoryView from './pages/TrajectoryView'

const ImportView = lazy(() => import('./pages/ImportView'))
const EmbeddedView = lazy(() => import('./pages/EmbeddedView'))
const CompareView = lazy(() => import('./pages/compare/CompareView'))
const OpencodeView = lazy(() => import('./pages/opencode/OpencodeView'))
const ClaudeCodeView = lazy(() => import('./pages/claude/ClaudeCodeView'))
const GeminiView = lazy(() => import('./pages/gemini/GeminiView'))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, retry: 1 },
  },
})

function Root() {
  const [params] = useSearchParams()
  const sessionId = params.get('session_id') ?? params.get('sessionId')
  const agentType = params.get('agent_type') ?? params.get('agentType')
  const appMode = params.get('app_mode') ?? params.get('appMode')

  if (sessionId && agentType) {
    return <EmbeddedView sessionId={sessionId} agentType={agentType} />
  }
  if (appMode === 'compare') {
    return <CompareView />
  }
  return (
    <Routes>
      <Route path="/" element={<TrajectoryView />} />
      <Route path="/import" element={<ImportView />} />
      <Route path="/opencode" element={<OpencodeView />} />
      <Route path="/claude-code" element={<ClaudeCodeView key="claude_code" />} />
      <Route path="/codeagent" element={<ClaudeCodeView key="codeagent" agent="codeagent" />} />
      <Route path="/gemini" element={<GeminiView />} />
      <Route path="/trajectory" element={<TrajectoryView />} />
      <Route path="/compare" element={<CompareView />} />
      <Route path="*" element={<TrajectoryView />} />
    </Routes>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Suspense fallback={<p className="page" role="status">正在打开页面…</p>}><Root /></Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
