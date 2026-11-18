import type { Data } from 'plotly.js-basic-dist-min'
import type { ParseResult } from '../api/types'
import { grouped } from '../derive'
import Plot from './Plot'
import { Info } from './ui/primitives'

type Metric = 'input' | 'output' | 'reasoning' | 'cache_read' | 'cache_write'

export default function TokenTrend({ result }: { result: ParseResult }) {
  const points = result.token_usage ?? []
  const isStep = result.source === 'opencode'
  const unit = isStep ? '步骤' : '回复'
  const axis = isStep ? '已完成步骤序号' : '模型回复序号'
  const x = points.map((_, i) => i + 1)
  const records = points.reduce((sum, p) => sum + p.records, 0)
  const withoutId = isStep ? 0 : points.filter((p) => !p.message_id).length
  const layout = {
    height: 310, margin: { t: 18, r: 18, b: 58, l: 62 },
    xaxis: { title: axis, ...(points.length <= 16 ? { tickmode: 'array', tickvals: x } : { tickformat: 'd', nticks: 10 }) },
    yaxis: { title: 'Tokens', rangemode: 'tozero', automargin: true },
    hovermode: 'x unified', legend: { orientation: 'h', y: 1.12 },
  }
  const series = (key: Metric, name: string, color: string): Data[] => {
    const y = points.map((p) => p[key])
    if (y.every((n) => n === null)) return []
    return [{ type: 'scatter', mode: 'lines+markers', x, y, name,
      line: { color, width: 2 }, marker: { size: 5 }, connectgaps: false,
      hovertemplate: '%{y:,d}<extra></extra>',
    }]
  }
  const main = [...series('input', '输入', '#1a73e8'), ...series('output', '输出', '#0a8561'),
    ...series('reasoning', '推理', '#8b6fbf')]
  const cache = [...series('cache_read', '缓存读取', '#167d89'), ...series('cache_write', '缓存写入', '#9258a6')]
  if (!main.length && !cache.length) {
    return <Info>{isStep ? '日志中没有逐步 Token 用量。需要 step.finish 记录中的 tokens 字段。' : '日志中没有模型回复的 Token 用量。'}</Info>
  }

  const summary = (key: 'input' | 'output') => {
    const known = points.flatMap((p) => p[key] ?? [])
    return <div className="metric-card"><div className="m-title">已记录{key === 'input' ? '输入' : '输出'} Tokens</div>
      <div className="m-value">{known.length ? grouped(known.reduce((a, b) => a + b, 0)) : '—'}</div>
      {known.length < points.length && <small>覆盖 {known.length} / {points.length} 个{unit}</small>}
    </div>
  }
  const deltas = points.map((p, i) => {
    const prev = points[i - 1]?.input
    return prev != null && p.input != null ? p.input - prev : null
  })
  const hitRate = points.map((p) => {
    const model = p.model ?? (result.parse_debug.format === 'stream-json' ? result.session_info.model : '')
    if (isStep || !/^(?:anthropic\/)?claude-/i.test(model) || p.input == null || p.cache_read == null || p.cache_write == null) return null
    const prompt = p.input + p.cache_read + p.cache_write
    return prompt > 0 ? p.cache_read / prompt * 100 : null
  })
  return <section className="token-trend">
    <div className="metric-row">
      <div className="metric-card"><div className="m-title">{isStep ? '已完成步骤' : '模型回复'}</div><div className="m-value">{grouped(points.length)}</div></div>
      {summary('input')}{summary('output')}
    </div>
    <p className="muted">{isStep ? '每个点取自一个已完成步骤的 tokens 字段，按日志顺序排列。' :
      `共 ${records} 条助手记录。相同消息 ID 的分片按首次出现顺序归为一条回复，每项用量取最后一次上报值。`}
      {withoutId > 0 && ` 其中 ${withoutId} 条记录缺少消息 ID，分别计数。`} 缺失值留空。
      {result.parse_debug.format === 'stream-json' && ' 会话摘要优先采用日志末尾 result 的汇总值，这里仅合计可见回复。'}</p>
    {main.length > 0 && <><h3>每次{unit}的 Token 用量</h3>
      <p className="muted">输入和输出采用日志原值。{isStep && '推理用量按日志单列。'}</p>
      <Plot data={main} layout={layout} /></>}
    {cache.length > 0 && <><h3>每次{unit}的缓存用量</h3><Plot data={cache} layout={layout} /></>}
    {hitRate.some((n) => n != null) && <><h3>缓存命中率</h3>
      <p className="muted">Claude 模型按缓存读取 ÷（输入 + 缓存读取 + 缓存写入）计算。仅展示字段齐全且分母大于零的回复。</p>
      <Plot data={[{ type: 'bar', x, y: hitRate, name: '缓存命中率', marker: { color: '#167d89' }, hovertemplate: '%{y:.1f}%<extra></extra>' }]}
        layout={{ ...layout, yaxis: { title: '命中率', range: [0, 100], ticksuffix: '%' } }} /></>}
    {deltas.some((n) => n != null) && <><h3>相邻{unit}的输入变化</h3>
      <p className="muted">当前{unit}的输入减去上一{unit}的输入。负值表示本次记录的输入较少。</p>
      <Plot data={[{ type: 'bar', x, y: deltas, name: '输入变化', marker: { color: '#5578a7' }, hovertemplate: '%{y:+,d}<extra></extra>' }]} layout={layout} /></>}
  </section>
}
