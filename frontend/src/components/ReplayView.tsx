import { useEffect, useId, useMemo, useState } from 'react'
import type { AgentType, ParseResult, WorkflowNode } from '../api/types'
import { replayRounds, type ReplayItem, type ReplayRound } from '../replay'
import { Info, Pagination } from './ui/primitives'
import WorkflowView from './WorkflowView'

const PAGE_SIZE = 10
const labels = { user: '用户输入', thinking: '模型思考', reply: '模型回复' }
const roundTitle = (round: ReplayRound) => round.number ? `第 ${round.number} 轮` : '未记录用户输入的片段'
const clock = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })

function ToolDisclosure({ item }: { item: Extract<ReplayItem, { kind: 'tool' }> }) {
  const [expanded, setExpanded] = useState(false)
  return <details className="replay-tool" onToggle={(e) => setExpanded(e.currentTarget.open)}>
    <summary>
      <span className="replay-chevron" aria-hidden="true">›</span>
      <span className="replay-tool-label">工具调用</span><strong>{item.name}</strong>
      <span className={item.status === '失败' ? 'replay-status failed' : 'replay-status'}>{item.status}</span>
      {item.duration !== undefined && <small>{item.duration >= 1000 ? (item.duration / 1000).toFixed(1) + ' s' : item.duration + ' ms'}</small>}
    </summary>
    {expanded && <div className="replay-payload">
      <h4>输入参数</h4><pre>{item.input == null ? '未记录输入参数' : typeof item.input === 'string' ? item.input : JSON.stringify(item.input, null, 2)}</pre>
      <h4>返回结果</h4><pre>{item.output == null ? '未记录返回结果' : item.output || '（空输出）'}</pre>
    </div>}
  </details>
}

function Round({ round, id }: { round: ReplayRound; id: string }) {
  const [showTools, setShowTools] = useState(false)
  const callCount = round.items.reduce((count, item) => count + Number(item.kind === 'tool'), 0)
  return <article className="replay-round" id={id} tabIndex={-1}>
    <header className="replay-round-head">
      <h3>{roundTitle(round)}</h3>
      {callCount > 0 && (
        <button type="button" className="replay-tools-toggle" aria-expanded={showTools} aria-controls={`${id}-entries`} onClick={() => setShowTools(!showTools)}>
          <span className="replay-chevron" aria-hidden="true">›</span>
          {showTools ? '收起工具调用' : '查看全部工具调用'}（{callCount}）
        </button>
      )}
      {round.time != null && <time>{clock.format(round.time)}</time>}
    </header>
    <div className="replay-entries" id={`${id}-entries`}>
      {round.items.map((item, i) => item.kind === 'tool'
        ? showTools && <ToolDisclosure key={i} item={item} />
        : <section key={i} className={`replay-message replay-${item.kind}`}>
          <h4>{labels[item.kind]}</h4><div className="replay-prose" dir="auto">{item.text}</div>
        </section>)}
    </div>
  </article>
}

export default function ReplayView({ agent, rawEvents, workflowRoot, result }: {
  agent: AgentType
  rawEvents: unknown[]
  workflowRoot?: WorkflowNode | null
  result?: ParseResult | null
}) {
  const [workflow, setWorkflow] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [jump, setJump] = useState<number | null>(null)
  const prefix = useId()
  const rounds = useMemo(() => replayRounds(agent, rawEvents), [agent, rawEvents])
  const filtered = useMemo(() => {
    const query = keyword.trim().toLowerCase()
    return query ? rounds.filter((r) => r.items.some((item) =>
      (item.kind === 'tool' ? item.name : item.text).toLowerCase().includes(query))) : rounds
  }, [rounds, keyword])
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const start = (safePage - 1) * PAGE_SIZE
  useEffect(() => {
    if (jump === null) return
    const target = document.getElementById(`${prefix}-${jump}`)
    target?.focus({ preventScroll: true })
    target?.scrollIntoView({ block: 'start' })
    setJump(null)
  }, [jump, prefix])
  return <div className="session-replay">
    <div className="replay-toolbar">
      <strong>{rounds.filter((r) => r.number > 0).length} 轮对话</strong>
      {!workflow && rounds.length > 0 && <>
        <input type="search" className="pill-input" aria-label="搜索回放" placeholder="搜索对话或工具名" value={keyword}
          onChange={(e) => { setKeyword(e.target.value); setPage(1) }} />
        {filtered.length > 1 && <select className="pill-input" aria-label="跳转到轮次" value="" onChange={(e) => {
          const i = Number(e.target.value)
          setPage(Math.floor(i / PAGE_SIZE) + 1)
          setJump(filtered[i].number)
        }}>
          <option value="" disabled>跳转到轮次</option>
          {filtered.map((r, i) => <option key={r.number} value={i}>{roundTitle(r)}{r.items[0]?.kind === 'user' && ' · ' + r.items[0].text.slice(0, 38)}</option>)}
        </select>}
      </>}
      {agent !== 'gemini' && <button className="btn replay-workflow" onClick={() => setWorkflow(!workflow)}>{workflow ? '返回会话回放' : '工作流视图'}</button>}
    </div>
    {workflow ? <WorkflowView root={workflowRoot ?? null} result={result ?? null} /> : <>
      {filtered.length === 0 && <Info>{rounds.length ? '没有匹配的轮次。' : '日志中没有可回放的对话或工具记录。'}</Info>}
      {filtered.slice(start, start + PAGE_SIZE).map((round) => <Round key={round.number} round={round} id={`${prefix}-${round.number}`} />)}
      <Pagination page={safePage} totalPages={totalPages} total={filtered.length} start={start + 1} end={Math.min(start + PAGE_SIZE, filtered.length)} onPage={setPage} />
    </>}
  </div>
}
