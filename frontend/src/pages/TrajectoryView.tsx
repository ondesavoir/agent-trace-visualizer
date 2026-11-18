import { lazy } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import SessionTable from '../components/SessionTable'
import Workspace, { Icon } from '../components/Workspace'
import exampleLog from '../../../backend/tests/fixtures/sample_opencode.ndjson?raw'

const ClaudeBody = lazy(() => import('./claude/ClaudeBody'))
const OpencodeBody = lazy(() => import('./opencode/OpencodeBody'))

export default function TrajectoryView() {
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const openSession = (query: Record<string, string>) => setParams(query, { state: { fromList: true } })
  const returnToList = () => location.state?.fromList ? navigate(-1) : setParams({}, { replace: true })
  const sessions = useQuery({ queryKey: ['trajectory'], queryFn: api.trajectory })
  const entries = sessions.data ?? []
  const path = params.get('trace')
  const example = params.get('example') === 'opencode'
  const entry = entries.find((item) => item.path === path)
  const agent = entry?.agent ?? 'claude_code'
  const detail = useQuery({
    queryKey: example ? ['example', 'opencode'] : ['parse-from-path', agent, path],
    queryFn: () => example
      ? api.parse('opencode', new TextEncoder().encode(exampleLog))
      : api.parseFromPath(agent, path!),
    enabled: example || !!entry,
  })
  const inDetail = example || !!path
  const projectCount = new Set(entries.map((t) => t.directory).filter(Boolean)).size
  const recentCount = entries.filter((t) => Date.now() - t.mtimeMs <= 86400000).length

  return (
    <Workspace>
      <div hidden={inDetail}>
        <header className="work-heading">
          <h1>会话工作台</h1>
          <Link to="/import" className="work-action"><Icon name="upload" />导入日志</Link>
        </header>
        <div className="work-metrics">
          {([
            ['已发现会话', entries.length, 'sessions'],
            ['近 24 小时活跃', recentCount, 'activity'],
            ['已识别项目目录', projectCount, 'folder'],
          ] as const).map(([label, value, icon]) => (
            <div key={label}><span><Icon name={icon} />{label}</span><strong>{sessions.data ? value.toLocaleString() : '—'}</strong></div>
          ))}
        </div>
        <section className="session-index">
          <div className="index-heading"><h2>会话记录</h2>
            <button className="quiet-btn" disabled={sessions.isFetching} onClick={() => sessions.refetch()}><Icon name="refresh" />{sessions.isFetching ? '刷新中…' : '刷新'}</button>
          </div>
          {sessions.isError && <div className="banner banner-error" role="alert">读取本地会话失败 · {sessions.error.message}</div>}
          {sessions.isLoading ? <p className="workspace-empty" role="status">正在读取本地会话…</p> :
            entries.length > 0 ? <SessionTable agent="claude_code" traces={entries} selected={path} showAgentColumn onSelect={(trace) => openSession({ trace })} /> :
            !sessions.isError && <div className="workspace-empty">
              <Icon name="sessions" /><h3>还没有本地会话</h3>
              <p>Claude Code、CodeAgent 和 Opencode 的本地记录会出现在这里，也可以导入已有日志。</p>
              <button className="btn" onClick={() => openSession({ example: 'opencode' })}>查看示例会话</button>
            </div>}
        </section>
      </div>
      {inDetail && <>
        <button className="back-link" onClick={returnToList}>← 返回会话列表</button>
        {example && <p className="sample-note">示例会话 · Opencode</p>}
        {(detail.isLoading || (!example && sessions.isLoading)) && <p role="status">正在读取会话…</p>}
        {!example && !entry && !sessions.isLoading && <p role="alert">{sessions.isError ? '无法读取会话列表。' : '在本地会话列表中找不到这条记录。'}</p>}
        {detail.isError && <div role="alert">解析日志失败 · {detail.error.message} <button className="btn" onClick={() => detail.refetch()}>重试</button></div>}
        {detail.data && (example || agent === 'opencode'
          ? <OpencodeBody key={path ?? 'example'} result={detail.data} entry={entry} initialTab="timeline" />
          : <ClaudeBody key={path} result={detail.data} entry={entry} initialTab={detail.data.parse_debug.format === 'transcript' ? 'timeline' : 'replay'} />)}
      </>}
    </Workspace>
  )
}
