import { describe, expect, it } from 'vitest';
import { findAppCommand, matchAppCommands, missingRequired, parseOptions, type AppCommand } from '../features/chat/appCommands';

const app = { id: 'a', name: 'Helper', iconUrl: null, botUserId: 'b' };
const echo: AppCommand = { id: '1', appId: 'a', name: 'echo', description: 'Say it back', options: [{ type: 'string', name: 'text', description: 'What', required: true }], app };
const remind: AppCommand = {
  id: '2',
  appId: 'a',
  name: 'remind',
  description: 'Remind someone',
  options: [
    { type: 'user', name: 'who', description: 'Who', required: true },
    { type: 'integer', name: 'minutes', description: 'When' },
    { type: 'string', name: 'note', description: 'What' },
  ],
  app,
};

describe('app slash commands', () => {
  it('finds the command a message names', () => {
    expect(findAppCommand('/echo hello there', [echo, remind])).toEqual({ command: echo, rest: 'hello there' });
    expect(findAppCommand('/nope hi', [echo])).toBeNull();
    expect(findAppCommand('echo hi', [echo])).toBeNull();
  });

  it('suggests commands while the name is typed', () => {
    expect(matchAppCommands('/re', [echo, remind]).map((c) => c.name)).toEqual(['remind']);
    expect(matchAppCommands('/', [echo, remind])).toHaveLength(2);
    expect(matchAppCommands('/echo x', [echo])).toEqual([]);
  });

  it('gives the whole text to a single option', () => {
    expect(parseOptions(echo, '  hello: world  ')).toEqual({ text: 'hello: world' });
  });

  it('reads name:value pairs, values running to the next option', () => {
    expect(parseOptions(remind, 'who:<@u1> minutes:5 note:buy milk: two litres')).toEqual({ who: '<@u1>', minutes: '5', note: 'buy milk: two litres' });
    expect(missingRequired(remind, parseOptions(remind, 'minutes:5'))).toEqual([remind.options[0]]);
  });
});
