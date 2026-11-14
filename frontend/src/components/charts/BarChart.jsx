import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'

export default function BarChartWidget({ data, xKey, yKey, color = '#7C5CFC', height = 260 }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#EEF0F5" />
        <XAxis type="number" tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
        <YAxis
          type="category"
          dataKey={xKey}
          tick={{ fontSize: 12, fill: '#4B5563' }}
          axisLine={false}
          tickLine={false}
          width={110}
        />
        <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #F1F1F5', fontSize: 12 }} cursor={{ fill: '#F7F7FB' }} />
        <Bar dataKey={yKey} radius={[0, 6, 6, 0]} barSize={16}>
          {data.map((_, i) => (
            <Cell key={i} fill={color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
