import Link from 'next/link';
import { GAME_CONTENT } from '@/content/games';
import { Card, CardBody, CardHeader } from '../ui/card';
import { Table, Td, Th, Tr } from '../ui/table';

export function GameRules({ gameId, theoretical, full = false }: { gameId: string; theoretical: { rtp: number; houseEdge: number; method: string; notes: string; ci95?: [number, number] }; full?: boolean }) {
  const content = GAME_CONTENT[gameId];
  if (!content) return null;
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1fr]">
      <Card>
        <CardHeader title="How to play" subtitle={full ? undefined : <Link href={`/rules/${gameId}`} className="text-gold-400">Full rules and mathematics →</Link>} />
        <CardBody>
          <p className="text-sm leading-relaxed text-ink-300">{content.description}</p>
          <ol className="mt-4 space-y-2.5 text-sm text-ink-200">
            {content.rules.map((r, i) => (
              <li key={i} className="flex gap-3">
                <span className="num mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-gold-700 text-[10px] text-gold-300">{i + 1}</span>
                <span className="leading-relaxed">{r}</span>
              </li>
            ))}
          </ol>
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title="Payouts & return to player"
          subtitle={`${theoretical.method === 'exact' ? 'Exact (analytical)' : 'Estimated by simulation'} · RTP ${(theoretical.rtp * 100).toFixed(3)}%${
            theoretical.ci95 ? ` (95% CI ${(theoretical.ci95[0] * 100).toFixed(2)}–${(theoretical.ci95[1] * 100).toFixed(2)}%)` : ''
          }`}
        />
        <CardBody>
          {content.payoutTable && (
            <Table>
              <thead>
                <tr>
                  {content.payoutTable.columns.map((c) => (
                    <Th key={c}>{c}</Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {content.payoutTable.rows.map((row, i) => (
                  <Tr key={i}>
                    {row.map((cell, j) => (
                      <Td key={j} className={j === 0 ? 'font-medium text-ink-100' : 'num'}>
                        {cell}
                      </Td>
                    ))}
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
          <p className="mt-4 text-xs leading-relaxed text-ink-400">{theoretical.notes}</p>
          {full && (
            <ul className="mt-4 space-y-2 text-sm text-ink-300">
              {content.math.map((m, i) => (
                <li key={i} className="leading-relaxed">
                  {m}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
