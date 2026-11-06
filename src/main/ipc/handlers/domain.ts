import { net, safeStorage } from 'electron';
import { getDatabase } from '../../db/connection';
import { localDate } from '@shared/domain/dates';
import { deleteClub, saveClub, setBagClubs, setModelInfo } from '../../db/repositories/clubs';
import { createCourse, getCourse, holeRecord, listCourses } from '../../db/repositories/courses';
import { createPlan, logPractice, practiceOverview, setPlanStatus } from '../../db/repositories/practice';
import { getProfile, updateProfile } from '../../db/repositories/profile';
import { createRound, deleteRound, getRound, listRounds } from '../../db/repositories/rounds';
import { listSessions, setExcluded, shotsForClub } from '../../db/repositories/shots';
import { DomainError } from '../../errors';
import { listClubSummaries } from '../../services/clubs';
import { dashboardOverview } from '../../services/dashboard';
import { listInsights, setDismissed } from '../../services/insights';
import { performance } from '../../services/performance';
import { detectCourseTrees, holeImagery, importCourse, previewCourse, searchCourses } from '../../services/courseImport';
import { createHttp, type Http } from '../../services/osm/client';
import { aiConnect, aiDisconnect, aiSetModel, aiStatus, analyzeBag, latestAnalysis, lookupClub, type AiDeps } from '../../services/ai';
import { fileKeyStore, memoryKeyStore } from '../../services/ai/keyStore';
import { createAiHttp } from '../../services/ai/openai';
import { dataDir } from '../../paths';
import { handle } from '../registry';

const aiDeps = (() => {
  let deps: AiDeps | null = null;
  return (): AiDeps =>
    (deps ??= {
      http: createAiHttp((url, init) => net.fetch(url, init)),
      // Headless test runs on machines without a keyring keep the key in memory only.
      keys: process.env['CLUBHOUSE_TEST_KEYSTORE'] === 'memory' ? memoryKeyStore() : fileKeyStore(dataDir(), safeStorage),
    });
})();

// Electron's net.fetch follows the computer's proxy settings, unlike plain fetch.
let http: Http | null = null;
const osmHttp = (): Http => (http ??= createHttp((url, init) => net.fetch(url, init)));

const OK = { ok: true as const };
const today = () => localDate();

export function registerDomainHandlers(): void {
  const db = getDatabase;

  handle('profile.get', () => getProfile(db()));
  handle('profile.update', (patch) => updateProfile(db(), patch));

  handle('dashboard.overview', () => dashboardOverview(db()));

  handle('clubs.list', () => listClubSummaries(db()));
  handle('clubs.save', ({ id, club, modelInfo }) => {
    const savedId = db().transaction(() => {
      const sid = saveClub(db(), id, club);
      setModelInfo(db(), sid, modelInfo);
      return sid;
    })();
    const found = listClubSummaries(db()).find((c) => c.id === savedId);
    if (!found) throw new DomainError('NOT_FOUND', 'Club could not be read back after saving');
    return found;
  });
  handle('clubs.delete', ({ id }) => {
    deleteClub(db(), id);
    return OK;
  });
  handle('bag.setClubs', ({ clubIds }) => {
    if (new Set(clubIds).size !== clubIds.length) throw new DomainError('VALIDATION', 'A club can only be in the bag once');
    setBagClubs(db(), clubIds);
    return listClubSummaries(db());
  });

  handle('shots.forClub', ({ clubId }) => shotsForClub(db(), clubId));
  handle('shots.setExcluded', ({ id, excluded }) => {
    setExcluded(db(), id, excluded);
    return OK;
  });
  handle('sessions.list', () => listSessions(db()));

  handle('rounds.list', () => listRounds(db()));
  handle('rounds.get', ({ id }) => getRound(db(), id));
  handle('rounds.create', (input) => getRound(db(), createRound(db(), input)));
  handle('rounds.delete', ({ id }) => {
    deleteRound(db(), id);
    return OK;
  });

  handle('courses.list', () => listCourses(db()));
  handle('courses.get', ({ id }) => getCourse(db(), id));
  handle('courses.create', (input) => {
    const id = createCourse(db(), input);
    const found = listCourses(db()).find((c) => c.id === id);
    if (!found) throw new DomainError('NOT_FOUND', 'Course could not be read back after saving');
    return found;
  });
  handle('courses.search', ({ query }) => searchCourses(db(), osmHttp(), query));
  handle('courses.preview', (target) => previewCourse(osmHttp(), target));
  handle('courses.import', (input) => {
    const id = importCourse(db(), input);
    const found = listCourses(db()).find((c) => c.id === id);
    if (!found) throw new DomainError('NOT_FOUND', 'Course could not be read back after importing');
    return found;
  });
  handle('courses.detectTrees', ({ courseId }) => detectCourseTrees(db(), courseId));
  handle('courses.holeImagery', ({ holeId }) => holeImagery(db(), holeId));
  handle('courses.holeRecord', ({ holeId }) => holeRecord(db(), holeId));

  handle('ai.status', () => aiStatus(db(), aiDeps()));
  handle('ai.connect', ({ apiKey }) => aiConnect(db(), aiDeps(), apiKey));
  handle('ai.disconnect', () => aiDisconnect(db(), aiDeps()));
  handle('ai.setModel', ({ model }) => aiSetModel(db(), aiDeps(), model));
  handle('ai.lookupClub', (q) => lookupClub(db(), aiDeps(), q));
  handle('ai.analysis', () => latestAnalysis(db()));
  handle('ai.analyzeBag', () => analyzeBag(db(), aiDeps()));

  handle('performance.get', () => performance(db()));

  handle('practice.overview', () => practiceOverview(db(), today()));
  handle('practice.log', (input) => {
    logPractice(db(), input);
    return OK;
  });
  handle('practice.createPlan', (input) => {
    createPlan(db(), input);
    return OK;
  });
  handle('practice.setPlanStatus', ({ id, status }) => {
    setPlanStatus(db(), id, status);
    return OK;
  });

  handle('insights.list', () => listInsights(db(), today()));
  handle('insights.setDismissed', ({ key, dismissed }) => {
    setDismissed(db(), key, dismissed);
    return OK;
  });
}
