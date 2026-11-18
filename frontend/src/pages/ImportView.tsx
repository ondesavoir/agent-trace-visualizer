import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import Workspace from '../components/Workspace'
import { FileUpload } from '../components/ui/primitives'
import { api } from '../api/client'
import type { AgentType } from '../api/types'
import ClaudeBody from './claude/ClaudeBody'
import OpencodeBody from './opencode/OpencodeBody'
import { GeminiBody } from './gemini/GeminiView'

const formats = { claude_code: 'Claude Code', codeagent: 'CodeAgent', opencode: 'Opencode', gemini: 'Gemini CLI' }
const hints = { claude_code: 'transcript JSONL 或 stream-json', codeagent: 'transcript JSONL 或 stream-json', opencode: 'trace-logger NDJSON', gemini: 'telemetry.log' }

export default function ImportView() {
  const [agent, setAgent] = useState<AgentType>('claude_code')
  const parsed = useMutation({
    mutationFn: async (file: { content: ArrayBuffer; name: string; agent: AgentType }) => {
      const result = await api.parse(file.agent, file.content)
      if (!result.raw_events.length) throw new Error('未找到可解析的事件，请检查日志来源和文件内容。')
      return { result, name: file.name, agent: file.agent }
    },
  })
  const data = parsed.data
  return <Workspace>
    {data ? <>
      <button className="back-link" onClick={() => parsed.reset()}>← 重新导入</button>
      {data.agent === 'gemini' ? <GeminiBody result={data.result} fileName={data.name} /> : data.agent === 'opencode'
        ? <OpencodeBody result={data.result} fileName={data.name} initialTab="timeline" />
        : <ClaudeBody result={data.result} fileName={data.name} initialTab={data.result.parse_debug.format === 'transcript' ? 'timeline' : 'replay'} />}
    </> : <>
      <header className="work-heading"><h1>导入日志</h1></header>
      <section className="import-form">
        <label className="text-input">日志来源<select value={agent} onChange={(e) => { setAgent(e.target.value as AgentType); parsed.reset() }}>
          {Object.entries(formats).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>
        <FileUpload key={agent} label={hints[agent]} onFile={(content, name) => parsed.mutate({ content, name, agent })} />
        {parsed.isPending && <p role="status">正在解析日志…</p>}
        {parsed.isError && <p role="alert">解析失败 · {parsed.error.message}</p>}
      </section>
    </>}
  </Workspace>
}
