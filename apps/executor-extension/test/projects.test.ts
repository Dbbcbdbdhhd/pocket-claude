import { describe, expect, it } from 'vitest';
import { listProjects, resolveRoot, updateHistory } from '../src/projects.js';

describe('projects', () => {
  it('lists open folders first, then history, then VS Code recents, without duplicates', () => {
    const list = listProjects(['/w/app'], { '/w/old': 5, '/w/app': 9 }, ['/w/recent', '/w/old']);
    expect(list.map((p) => [p.name, p.open])).toEqual([
      ['app', true],
      ['old', false],
      ['recent', false],
    ]);
  });

  it('keeps history most-recent-first', () => {
    const h = updateHistory({ '/a': 1, '/b': 2 }, ['/a'], 10);
    expect(Object.keys(h)).toEqual(['/a', '/b']);
  });

  it('only resolves roots from the offered list', () => {
    const list = listProjects(['/w/app'], {}, []);
    expect(resolveRoot('/w/app', list)).toBe('/w/app');
    expect(resolveRoot('/etc', list)).toBeUndefined();
  });
});
