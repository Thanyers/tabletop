import { describe, expect, it } from 'vitest';
import { MAX_PRACTICE_FILE_BYTES, parsePracticeFile, PracticeFileError } from './sample-parser';
import { PRACTICE_SAMPLE_FILES } from './sample-files';

describe('practice sample parser', () => {
  it('turns all five bundled samples into bounded domain inputs', () => {
    const shipments = parsePracticeFile('october-shipments.csv', PRACTICE_SAMPLE_FILES[0].text, 'invoice');
    const invoices = parsePracticeFile('october-invoice.csv', PRACTICE_SAMPLE_FILES[1].text, 'invoice');
    const rateCard = parsePracticeFile('synthetic-rate-card.csv', PRACTICE_SAMPLE_FILES[2].text, 'invoice');
    const teaching = parsePracticeFile('shared-physics-lesson.json', PRACTICE_SAMPLE_FILES[3].text, 'teaching');
    const encounter = parsePracticeFile('shield-plan.json', PRACTICE_SAMPLE_FILES[4].text, 'encounter');

    expect(shipments.kind === 'shipments' ? shipments.shipments[0] : null).toMatchObject({ id: 'S-BKK-1100', zone: 'bangkok', weightGram: 1100 });
    expect(invoices.kind === 'invoice' ? invoices.invoiceLines[0] : null).toMatchObject({ id: 'S-BKK-1100', billedSatang: 5_000, currency: 'THB' });
    expect(rateCard.kind === 'rate-card' ? rateCard.rates.slice(0, 2) : null).toMatchObject([{ op: 'setZoneBase', amountSatang: 4_000 }, { op: 'setZoneBase', amountSatang: 3_500 }]);
    expect(teaching).toMatchObject({ caseKind: 'teaching', kind: 'teaching-lesson', parameters: { force: 10, mass: 5, time: 2 } });
    expect(encounter).toMatchObject({ caseKind: 'encounter', kind: 'encounter-plan', rule: { allyTarget: true, apCost: 1, oncePerTurn: true }, target: 'pip' });
  });

  it('rejects unsupported file shapes, malformed rows, and oversized input', () => {
    expect(() => parsePracticeFile('commands.json', '{"type":"invoice.import"}', 'invoice')).toThrow(PracticeFileError);
    expect(() => parsePracticeFile('shipments.csv', 'shipment_id,zone,service_date,weight_gram,remote\nS-1,bangkok,2026-02-30,1000,false', 'invoice')).toThrow(/calendar date/);
    expect(() => parsePracticeFile('shipments.csv', 'shipment_id,zone,service_date,weight_gram,remote\n\nS-1,bangkok,2026-02-28,1000,false', 'invoice')).toThrow(/blank lines/);
    expect(() => parsePracticeFile('shipments.csv', 'shipment_id,zone,service_date,weight_gram,remote\nS-1,bangkok,2026-02-28,1000,"false\nvalue"', 'invoice')).toThrow(/Multiline CSV cells/);
    expect(() => parsePracticeFile('lesson.json', '{"kind":"teaching-lesson","version":1,"parameters":{"force":10,"mass":0,"time":2}}', 'teaching')).toThrow(/supported values/);
    expect(() => parsePracticeFile('large.csv', 'x'.repeat(MAX_PRACTICE_FILE_BYTES + 1), 'invoice')).toThrow(/128 KB/);
  });
});
