/**
 * The printable Z-report document. Rendered through a portal onto `document.body` (a sibling of
 * `#root`) so the print stylesheet can hide the whole app and print only this — a clean single-page
 * document with no till chrome. Hidden on screen; it exists to be sent to the browser print dialog,
 * which on an iPad is also the "Save to Files as PDF" path (AirPrint or PDF, one gesture).
 *
 * No hex: black-on-white is intrinsic to a printed cash record, not a theme, so named CSS colours are
 * used (see ZReceipt.css). Money is `bigint` minor units, formatted only for display.
 */

import { createPortal } from 'react-dom'
import { formatEuroMinor } from '../../format'
import type { ZReceiptData } from './z-receipt'
import './ZReceipt.css'

function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('en-IE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function Row({ label, minor, strong }: { label: string; minor: bigint; strong?: boolean }): JSX.Element {
  return (
    <div className={strong ? 'zr-row zr-row--strong' : 'zr-row'}>
      <span className="zr-row-label">{label}</span>
      <span className="zr-row-amount tnum">{formatEuroMinor(minor)}</span>
    </div>
  )
}

export function ZReceipt({ data }: { data: ZReceiptData }): JSX.Element {
  const glyph = data.direction === 'EXACT' ? '✓' : data.direction === 'OVER' ? '▲' : '▼'
  const varianceText =
    data.direction === 'EXACT'
      ? `Exact — ${formatEuroMinor(data.countedMinor)}`
      : data.direction === 'OVER'
        ? `Over ${formatEuroMinor(data.varianceMinor)}`
        : `Short ${formatEuroMinor(-data.varianceMinor)}`

  return createPortal(
    <div className="z-receipt-print" role="document" aria-label={`Z report ${data.zNumber}`}>
      <article className="zr">
        <header className="zr-head">
          <div>
            <h1 className="zr-title">Z Report</h1>
            <p className="zr-shop">{data.shopName}</p>
          </div>
          <p className="zr-znum tnum">Z #{data.zNumber}</p>
        </header>

        <dl className="zr-meta">
          <div>
            <dt>Till</dt>
            <dd className="zr-mono">{data.deviceId}</dd>
          </div>
          <div>
            <dt>Opened</dt>
            <dd>
              {fmtDateTime(data.openedAtISO)} · {data.openedByName}
            </dd>
          </div>
          <div>
            <dt>Closed</dt>
            <dd>
              {fmtDateTime(data.closedAtISO)} · {data.closedByName}
            </dd>
          </div>
        </dl>

        <section className="zr-section">
          <h2>Drawer</h2>
          <Row label="Opening float" minor={data.openingFloatMinor} />
          <Row label="Cash sales" minor={data.cashSalesMinor} />
          <Row label="Paid in" minor={data.paidInMinor} />
          <Row label="Paid out" minor={-data.paidOutMinor} />
          <Row label="Skim" minor={-data.skimMinor} />
          <Row label="Safe drop" minor={-data.safeDropMinor} />
          <Row label="Expected in drawer" minor={data.expectedDrawerMinor} strong />
          <p className="zr-note">{data.movementCount} movement{data.movementCount === 1 ? '' : 's'} this shift.</p>
        </section>

        <section className="zr-section">
          <h2>Count</h2>
          <Row label={`Counted (count #${data.finalCountSeq})`} minor={data.countedMinor} />
          <Row label="Expected" minor={data.expectedDrawerMinor} />
          <div className={`zr-variance zr-variance--${data.direction.toLowerCase()}`}>
            <span className="zr-variance-glyph" aria-hidden="true">
              {glyph}
            </span>
            <span className="zr-variance-text tnum">{varianceText}</span>
          </div>
          {data.reasonCodes.length > 0 && <p className="zr-reasons">Reasons: {data.reasonCodes.join(' · ')}</p>}
          {data.direction !== 'EXACT' && (
            <p className="zr-auth">
              {data.authorised ? 'Authorised by manager PIN.' : 'Closed and flagged — unauthorised variance, for back-office review.'}
            </p>
          )}
        </section>

        <footer className="zr-foot">
          <p>Sequentially numbered · issued once · cannot be undone.</p>
          <p>Batch · generated {fmtDateTime(data.closedAtISO)}</p>
        </footer>
      </article>
    </div>,
    document.body,
  )
}
