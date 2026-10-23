import { describe, expect, it } from 'vitest';
import { chosenFollowUps, parseChatFollowUps } from './table-chat-state';
import { followUpConnections, followUpPosition } from './canvas-flow';

describe('F070 choice trail', () => {
  it('keeps only well-formed follow-up links and the newest ones', () => {
    const parsed = parseChatFollowUps({
      'answer-b': { parentCardId: 'answer-a', option: 'Explain the split first' },
      'answer-self': { parentCardId: 'answer-self', option: 'loop' },
      'answer-c': { parentCardId: 'answer-a', option: '' },
      'answer-d': { parentCardId: 7, option: 'x' },
      'answer-e': 'not a link',
      'answer-f': { parentCardId: 'answer-a', option: 'x'.repeat(121) },
      'answer-g': { parentCardId: 'answer-b', option: 'Go deeper' },
    }, 80);
    expect(parsed).toEqual({
      'answer-b': { parentCardId: 'answer-a', option: 'Explain the split first' },
      'answer-g': { parentCardId: 'answer-b', option: 'Go deeper' },
    });
    expect(Object.keys(parseChatFollowUps(parsed, 1))).toEqual(['answer-g']);
    expect(parseChatFollowUps(['answer-b'], 80)).toEqual({});
    expect(parseChatFollowUps(null, 80)).toEqual({});
  });

  it('marks an option chosen only while the card it opened is still on the table', () => {
    const links = {
      'answer-b': { parentCardId: 'answer-a', option: 'Option one' },
      'answer-c': { parentCardId: 'answer-a', option: 'Option two' },
      'answer-d': { parentCardId: 'answer-x', option: 'Option one' },
    };
    const chosen = chosenFollowUps('answer-a', [{ id: 'answer-a' }, { id: 'answer-b' }], links);
    expect([...chosen]).toEqual([['Option one', 'answer-b']]);
    expect(chosenFollowUps('answer-b', [{ id: 'answer-b' }], links).size).toBe(0);
  });

  it('draws one labelled line per visible follow-up and seats it beside its source', () => {
    const objects = [
      { id: 'chat.a' },
      { id: 'chat.b', linkedFrom: { id: 'chat.a', label: 'Option one', order: 0 } },
      { id: 'chat.c', linkedFrom: { id: 'chat.a', label: 'Option two', order: 1 } },
      { id: 'chat.d', linkedFrom: { id: 'chat.hidden', label: 'Gone', order: 0 } },
      { id: 'chat.e', linkedFrom: { id: 'chat.e', label: 'Self', order: 0 } },
    ];
    const visible = new Set(['chat.a', 'chat.b', 'chat.c', 'chat.d', 'chat.e']);
    expect(followUpConnections(objects, visible)).toEqual([
      { id: 'follow-up.chat.a->chat.b', source: 'chat.a', target: 'chat.b', label: 'Option one' },
      { id: 'follow-up.chat.a->chat.c', source: 'chat.a', target: 'chat.c', label: 'Option two' },
    ]);
    const parent = { x: 760, y: 40, width: 400, height: 640 };
    expect(followUpPosition(parent, [])).toEqual({ x: 1304, y: 40 });
    // A second branch goes under the first one, whatever size the first one grew to.
    expect(followUpPosition(parent, [{ x: 1304, y: 40, width: 600, height: 700 }])).toEqual({ x: 1304, y: 780 });
    expect(followUpPosition(undefined, [])).toBeUndefined();
  });
});
