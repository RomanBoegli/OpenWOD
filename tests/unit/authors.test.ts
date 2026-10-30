import { describe, expect, it } from 'vitest';
import { bundledWorkout, bundledWorkouts } from '../../packages/domain/src/bundled';
import { authorKey, authorOptions, matchesFilter, searchFields, summariseWorkout } from '../../packages/domain/src/library';
import { rankBySearch } from '../../packages/domain/src/search';
import { compileSchema } from '../../packages/domain/src/validate';
import { isEmptyMasterData, MasterDataSchema, mergeMasterData, type MasterData } from '../../packages/domain/src/master-data';
import { addAuthor, authorRepertoire, authorSpelling, canonicalAuthor, emptyMasterData, mergeAuthors, removeAuthor, restoreAuthor, sanitiseMasterData, unmergeAuthor } from '../../apps/web/src/master-data';

const validate = compileSchema<MasterData>(MasterDataSchema);
const summaries = (data: MasterData) => bundledWorkouts.map(workout => summariseWorkout(workout, { canonicalAuthor: canonicalAuthor(data) }));
const crossfit = bundledWorkouts.filter(workout => workout.attribution?.author === 'CrossFit').length;

describe('authors as master data (LIB-06)', () => {
  it('reads documents from before authors existed, and sanitises, validates and merges the author fields', () => {
    const { authorAliases: _aliases, authors: _authors, hiddenAuthors: _hidden, ...older } = emptyMasterData();
    expect(validate(older)).toBe(true);
    expect(sanitiseMasterData(older)).toEqual(emptyMasterData());
    const data = sanitiseMasterData({ ...emptyMasterData(), authorAliases: { 'Cross-Fit': 'CrossFit', '': 'x', bad: 4 }, authors: ['Coach Ann', '', 7], hiddenAuthors: ['Open WOD'] });
    expect(data.authorAliases).toEqual({ 'cross fit': 'CrossFit' });
    expect(data.authors).toEqual(['Coach Ann']);
    expect(data.hiddenAuthors).toEqual(['open wod']);
    expect(validate(data)).toBe(true);
    expect(isEmptyMasterData(data)).toBe(false);
    const merged = mergeMasterData({ ...emptyMasterData(), authorAliases: { crossfit: 'CrossFit' }, authors: ['Coach Ann'] }, { ...emptyMasterData(), authorAliases: { crossfit: 'Crossfit', hyrox: 'HYROX' }, authors: ['coach ann', 'Bob'], hiddenAuthors: ['openwod'] });
    expect(merged.authorAliases).toEqual({ crossfit: 'CrossFit', hyrox: 'HYROX' });
    expect(merged.authors).toEqual(['Coach Ann', 'Bob']);
    expect(merged.hiddenAuthors).toEqual(['openwod']);
  });

  it('merges, renames, undoes, deletes and restores authors without touching a workout file', () => {
    expect(authorKey(' Cross-Fit ')).toBe('cross fit');
    let data = mergeAuthors(emptyMasterData(), ['Crossfit', 'CF'], 'CrossFit');
    expect(authorSpelling(data)('crossfit')).toBe('CrossFit');
    expect(authorSpelling(data)('C.F.')).toBe('C.F.'); // "c f" is another key than "cf"
    data = mergeAuthors(data, ['CrossFit'], 'CrossFit Inc.'); // earlier merges into it follow along
    expect(data.authorAliases).toEqual({ crossfit: 'CrossFit Inc.', cf: 'CrossFit Inc.' });
    expect(authorSpelling(unmergeAuthor(data, 'cf'))('CF')).toBe('CF');
    data = addAuthor(data, 'Coach Ann');
    expect(mergeAuthors(data, ['coach ann'], 'Ann').authors).toEqual(['Ann']);
    expect(authorRepertoire(data, ['OpenWOD', 'CrossFit Inc.'])).toEqual(['Coach Ann', 'CrossFit Inc.', 'OpenWOD']);
    const deleted = removeAuthor(data, 'OpenWOD', true);
    expect(canonicalAuthor(deleted)('OpenWOD')).toBeUndefined();
    expect(authorRepertoire(deleted, ['CrossFit Inc.'])).toEqual(['Coach Ann', 'CrossFit Inc.']);
    expect(restoreAuthor(deleted, 'openwod').hiddenAuthors).toEqual([]);
    expect(removeAuthor(data, 'Coach Ann', false)).toEqual({ ...data, authors: [] }); // added by hand and unused: simply forgotten
    expect(bundledWorkout('fran').attribution?.author).toBe('CrossFit');
  });

  it('summaries carry the kept spelling, the search finds it with a typo, and the filter keeps any of the chosen authors', () => {
    const plain = summaries(emptyMasterData());
    expect(authorOptions(plain)).toEqual(['Coach programming', 'CrossFit', 'OpenWOD']);
    expect(plain.filter(summary => matchesFilter(summary, { query: 'crossfit' }))).toHaveLength(crossfit);
    expect(plain.filter(summary => matchesFilter(summary, { query: 'crosfit' }))).toHaveLength(crossfit);
    expect(rankBySearch(plain, 'crossfit', searchFields)[0]?.author).toBe('CrossFit');
    expect(plain.filter(summary => matchesFilter(summary, { authors: ['crossfit', 'OpenWOD'] })).length).toBe(plain.filter(summary => summary.author === 'CrossFit' || summary.author === 'OpenWOD').length);
    const merged = summaries(mergeAuthors(emptyMasterData(), ['CrossFit'], 'CrossFit HQ'));
    expect(merged.filter(summary => matchesFilter(summary, { query: 'hq' }))).toHaveLength(crossfit);
    expect(merged.filter(summary => matchesFilter(summary, { authors: ['CrossFit HQ'] }))).toHaveLength(crossfit);
    const hidden = summaries(removeAuthor(emptyMasterData(), 'Coach programming', true));
    expect(hidden.filter(summary => matchesFilter(summary, { query: 'coach programming' }))).toHaveLength(0);
    expect(authorOptions(hidden)).toEqual(['CrossFit', 'OpenWOD']);
  });
});
