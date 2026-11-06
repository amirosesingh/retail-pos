import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from 'react';
import type { StockArrival } from '@/core/api/pos-db';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { stockTimeChoices } from '@/lib/stock-history-selection';

type Capability = { ok: boolean; available?: boolean; reason?: string; code?: string; error?: string };
export type ReceivingArrivalHandle = {
  checkpoint: () => () => void;
  prepare: () => Promise<{ stockArrival: StockArrival | undefined; assertCurrent: () => void }>;
};
type Props = {
  scopeKey: string;
  currentScopeKey: () => string;
  timeZone: string;
  readCapability: () => Promise<Capability>;
  subscribeContext?: (changed: (kind: 'scope' | 'readiness') => void) => () => void;
  disabled?: boolean;
};

/** Presentation validation only. Main checks the original SQL save time,
 * current author/branch and actual capture capability again at the write. */
// eslint-disable-next-line react-refresh/only-export-components -- Colocated pure presentation validation has focused contract tests.
export function receivingArrivalValue(dateTime: string, reason: string, timeZone: string, occurrence = ''): StockArrival {
  const options = stockTimeChoices(dateTime, timeZone);
  if (!options.length) throw new Error('This arrival time does not exist in the selected time zone. Choose another time.');
  const effectiveAt = options.length === 1 ? options[0]!.instant : options.find(option => option.instant === occurrence)?.instant;
  if (!effectiveAt) throw new Error('This arrival time occurs twice. Choose its UTC offset.');
  const text = reason.trim();
  if (!text || text.length > 500 || [...text].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
    || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text))
    throw new Error('Enter an arrival-time reason using 1–500 characters on one line.');
  return Object.freeze({ effectiveAt, reason: text });
}

export const ReceivingArrivalFields = forwardRef<ReceivingArrivalHandle, Props>(function ReceivingArrivalFields(props, ref) {
  const id = useId(), latest = useRef(props); latest.current = props;
  const [custom, setCustom] = useState(false), [dateTime, setDateTime] = useState('');
  const [reason, setReason] = useState(''), [occurrence, setOccurrence] = useState('');
  const [capability, setCapability] = useState<'checking' | 'available' | 'unavailable'>('checking');
  const [error, setError] = useState('');
  const values = useRef({ custom, dateTime, reason, occurrence }); values.current = { custom, dateTime, reason, occurrence };
  const mounted = useRef(false), generation = useRef(0), request = useRef(0), selection = useRef(0);
  const readinessGeneration = useRef(0);
  const initialScope = useRef(props.scopeKey);

  function capture(checkReadiness = false) {
    const captured = generation.current, readiness = readinessGeneration.current, key = latest.current.currentScopeKey();
    return () => {
      if (!mounted.current || captured !== generation.current || key !== latest.current.currentScopeKey()
        || (checkReadiness && readiness !== readinessGeneration.current))
        throw new Error('The receiving context changed. Check the arrival option again before finalizing.');
    };
  }
  async function checkCapability() {
    const assertCurrent = capture(true), currentRequest = ++request.current;
    let publicMessage = 'Arrival-time readiness could not be checked. Try again.';
    setCapability('checking');
    try {
      const result = await latest.current.readCapability(); assertCurrent();
      if (currentRequest !== request.current) throw new Error('Arrival-time readiness changed. Check it again.');
      if (result?.ok !== true || result.available !== true) {
        setCapability('unavailable');
        publicMessage = result?.code === 'PERMISSION_DENIED'
          ? 'Your current receiving permission could not be confirmed.'
          : 'This device is not ready to record a custom arrival time. Use save time or check readiness again.';
        throw new Error(publicMessage);
      }
      setCapability('available'); return assertCurrent;
    } catch (failure) {
      try {
        assertCurrent();
        if (currentRequest === request.current) {
          setCapability('unavailable');
          setError(publicMessage);
        }
      } catch { /* A new scope owns the visible state. */ }
      throw new Error(publicMessage, { cause: failure });
    }
  }
  useImperativeHandle(ref, () => ({
    checkpoint() {
      const assertScope = capture(values.current.custom), version = selection.current;
      return () => {
        assertScope();
        if (version !== selection.current) throw new Error('The arrival selection changed. Check it before finalizing.');
      };
    },
    async prepare() {
      const assertScope = capture(values.current.custom), version = selection.current;
      const assertCurrent = () => {
        assertScope();
        if (version !== selection.current) throw new Error('The arrival selection changed. Check it before finalizing.');
      };
      if (!values.current.custom) return { stockArrival: undefined, assertCurrent };
      try {
        const stockArrival = receivingArrivalValue(values.current.dateTime, values.current.reason,
          latest.current.timeZone, values.current.occurrence);
        await checkCapability(); assertCurrent();
        return { stockArrival, assertCurrent };
      } catch (failure) {
        try { assertCurrent(); setError(failure instanceof Error ? failure.message : 'Check the arrival time before finalizing.'); } catch { /* Scope changed. */ }
        throw failure;
      }
    },
  }));
  useEffect(() => {
    mounted.current = true;
    const lifecycle = { mounted, generation, request };
    return () => { lifecycle.mounted.current = false; lifecycle.generation.current++; lifecycle.request.current++; };
  }, []);
  useEffect(() => {
    generation.current++; request.current++;
    if (initialScope.current !== props.scopeKey) {
      initialScope.current = props.scopeKey; selection.current++;
      setDateTime(''); setReason(''); setOccurrence('');
      setError('The receiving context changed. Choose the arrival time again or use save time.');
    }
    void checkCapability().catch(() => {});
    // The actual read always uses the latest Main bridge and scope checker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.scopeKey]);
  useEffect(() => props.subscribeContext?.(kind => {
    request.current++;
    if (kind === 'scope') {
      generation.current++;
      selection.current++; setDateTime(''); setReason(''); setOccurrence('');
      setError('The receiving connection changed. Choose the arrival time again or use save time.');
      void checkCapability().catch(() => {});
    } else {
      readinessGeneration.current++;
      setCapability('unavailable');
      setError('Arrival-time readiness was lost. Your selection is retained; check readiness before finalizing.');
    }
    // The subscription is stable; callbacks read the current scope/bridge via refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [props.subscribeContext]);
  let options: ReturnType<typeof stockTimeChoices> = [];
  try { if (dateTime) options = stockTimeChoices(dateTime, props.timeZone); } catch { /* Show validation on finalize. */ }
  return <section className="space-y-3 rounded-md border border-border p-3" aria-label="Goods arrival time">
    <div className="flex items-start gap-2">
      <Switch id={`${id}-custom`} className="mt-0.5"
        checked={custom} disabled={props.disabled || (!custom && capability !== 'available')}
        onCheckedChange={checked => { selection.current++; setCustom(checked); setError(''); }} />
      <div className="min-w-0 space-y-1">
        <Label htmlFor={`${id}-custom`}>Use the actual goods arrival time</Label>
        <p className="text-xs text-muted-foreground">Optional · otherwise stock uses its original save time. Invoice and entry dates stay separate.</p>
      </div>
    </div>
    <p className="text-xs text-muted-foreground" role="status" aria-live="polite">{capability === 'checking'
      ? 'Checking arrival-time readiness…' : capability === 'available' ? `Arrival time uses ${props.timeZone}.`
        : 'Custom arrival time is currently unavailable. Save time remains the default.'}</p>
    {custom && <div className="grid min-w-0 gap-3 sm:grid-cols-2">
      <div className="min-w-0 space-y-1"><Label htmlFor={`${id}-time`}>Actual arrival date and time · {props.timeZone}</Label>
        <Input id={`${id}-time`} type="datetime-local" step="1" required className="min-w-0" value={dateTime} disabled={props.disabled}
          onChange={event => { selection.current++; setDateTime(event.target.value); setOccurrence(''); setError(''); }} /></div>
      <div className="min-w-0 space-y-1"><Label htmlFor={`${id}-reason`}>Arrival-time reason</Label>
        <Textarea id={`${id}-reason`} value={reason} maxLength={500} rows={2} required disabled={props.disabled}
          placeholder="Why the arrival differs from save time" onChange={event => { selection.current++; setReason(event.target.value); setError(''); }} /></div>
      {options.length > 1 && <div className="min-w-0 space-y-1 sm:col-span-2"><Label htmlFor={`${id}-offset`}>Arrival UTC offset</Label>
        <select id={`${id}-offset`} className="h-11 w-full min-w-0 rounded-md border border-border bg-background px-2 text-sm text-foreground"
          value={occurrence} required disabled={props.disabled} onChange={event => { selection.current++; setOccurrence(event.target.value); setError(''); }}>
          <option value="">Choose the repeated time</option>{options.map(option => <option key={option.instant} value={option.instant}>{option.label} · {option.instant}</option>)}
        </select></div>}
    </div>}
    {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
    {capability !== 'available' && <Button type="button" variant="outline" size="sm" disabled={props.disabled || capability === 'checking'}
      onClick={() => { setError(''); void checkCapability().catch(() => {}); }}>Check arrival-time readiness</Button>}
  </section>;
});
