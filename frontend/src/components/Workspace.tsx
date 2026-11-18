import type { ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'

const paths = {
  sessions: 'M3 5h18v6H3z M3 15h18v4H3z M6 8h2 M6 17h2',
  compare: 'M5 19V9 M12 19V4 M19 19v-7',
  upload: 'M12 16V3 M7 8l5-5 5 5 M4 16v4h16v-4',
  activity: 'M2 12h5l3-7 4 14 3-7h5',
  terminal: 'M3 5h18v14H3z M6 9l3 3-3 3 M12 15h4',
  refresh: 'M20 7v5h-5 M19 11a7 7 0 1 0-2 6',
  folder: 'M3 6h6l2 2h10v11H3z',
  user: 'M16 7.5a4 4 0 1 1-8 0 4 4 0 0 1 8 0z M4 20v-1a7 7 0 0 1 7-7h2a7 7 0 0 1 7 7v1',
  thinking: 'M9 16c0-2-3-3.3-3-7a6 6 0 1 1 12 0c0 3.7-3 5-3 7z M9.5 19h5 M11 22h2',
  reply: 'M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 4V6a2 2 0 0 1 2-2z M7 9h10 M7 13h7',
} as const

export function Icon({ name }: { name: keyof typeof paths }) {
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>
}

export default function Workspace({ children }: { children: ReactNode }) {
  return (
    <div className="workspace">
      <aside className="workspace-rail">
        <Link className="product-name" to="/"><img src="/favicon.svg" alt="" width="30" height="30" />Trace Visualizer</Link>
        <nav aria-label="工作区" className="work-nav">
          <NavLink to="/" end><Icon name="sessions" />会话工作台</NavLink>
          <NavLink to="/import"><Icon name="upload" />导入日志</NavLink>
          <NavLink to="/compare"><Icon name="compare" />Token 对比</NavLink>
        </nav>
        <div className="source-links">
          <span>数据源</span>
          <Link to="/claude-code"><Icon name="terminal" />Claude Code</Link>
          <Link to="/codeagent"><Icon name="terminal" />CodeAgent</Link>
          <Link to="/opencode"><Icon name="terminal" />Opencode</Link>
          <Link to="/gemini"><Icon name="terminal" />Gemini CLI</Link>
        </div>
      </aside>
      <main className="workspace-main" id="main">{children}</main>
    </div>
  )
}
