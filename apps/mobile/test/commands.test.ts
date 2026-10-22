import type { ModelInfo } from '@pocket/protocol';
import { describe, expect, it } from 'vitest';
import { modelLabel, parseSlash, resolveEffort, resolveModel, suggestionsFor } from '../src/commands';

const models: ModelInfo[] = [
  { value: 'opus', displayName: 'Opus', description: 'Most capable', efforts: ['low', 'high', 'max'] },
  { value: 'sonnet', displayName: 'Sonnet', description: 'Everyday' },
];

describe('parseSlash', () => {
  it('separates the command from its argument', () => {
    expect(parseSlash('hello')).toBeNull();
    expect(parseSlash('/mo')).toEqual({ name: 'mo', arg: '', hasArg: false });
    expect(parseSlash('/model ')).toEqual({ name: 'model', arg: '', hasArg: true });
    expect(parseSlash('/Effort  High')).toEqual({ name: 'effort', arg: 'high', hasArg: true });
  });
});

describe('suggestionsFor', () => {
  it('filters commands by prefix', () => {
    expect(suggestionsFor('/', models, undefined).map((s) => s.title)).toContain('/agents');
    expect(suggestionsFor('/e', models, undefined).map((s) => s.title)).toEqual(['/effort']);
    expect(suggestionsFor('just text', models, undefined)).toEqual([]);
  });

  it('lists models with a default entry and marks the current one', () => {
    const list = suggestionsFor('/model ', models, { model: 'sonnet' });
    expect(list.map((s) => s.title)).toEqual(['Default', 'Opus', 'Sonnet']);
    expect(list.filter((s) => s.kind === 'model' && s.current).map((s) => s.title)).toEqual(['Sonnet']);
    expect(suggestionsFor('/model op', models, undefined).map((s) => s.title)).toEqual(['Opus']);
  });

  it('offers only the efforts the current model supports', () => {
    const list = suggestionsFor('/effort ', models, { model: 'opus', effort: 'high' });
    expect(list.map((s) => s.title)).toEqual(['Auto', 'Low', 'High', 'Max']);
    expect(list.find((s) => s.kind === 'effort' && s.current)?.title).toBe('High');
    expect(suggestionsFor('/effort ', models, { model: 'sonnet' })).toHaveLength(6);
  });
});

describe('resolvers', () => {
  it('resolves typed model and effort names', () => {
    expect(resolveModel('son', models)).toBe('sonnet');
    expect(resolveModel('default', models)).toBe('default');
    expect(resolveModel('gpt', models)).toBeUndefined();
    expect(resolveEffort('extra high')).toBe('xhigh');
    expect(resolveEffort('auto')).toBeNull();
    expect(resolveEffort('huge')).toBeUndefined();
  });

  it('labels the session model', () => {
    expect(modelLabel(undefined, models)).toBe('Default');
    expect(modelLabel({ model: 'opus' }, models)).toBe('Opus');
    expect(modelLabel({ model: 'claude-x' }, models)).toBe('claude-x');
  });
});
