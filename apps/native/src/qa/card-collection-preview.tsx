import { createRoot } from 'react-dom/client';
import {
  CardCollectionPage,
  type CardCollectionApi,
} from '../components/study-cards/CardCollectionPage';
import {
  STUDY_CARDS,
  rollStudyCard,
  type CardCollection,
  type CardDrawResponse,
} from '../../../../lib/study-cards/catalog';
import { setBrowserAccount } from '../data/browser-runtime';
import '../tailwind.css';
import '../styles.css';
if (!import.meta.env.DEV) throw new Error('Local fixture only.');
setBrowserAccount('card-collection-local-fixture');
const key = 'syntara.card-collection-qa.v2';
const empty = new URLSearchParams(window.location.search).has('empty');
const demo: CardCollection = {
  owned: Object.fromEntries(
    STUDY_CARDS.filter(
      (c, i) =>
        i < 8 ||
        [
          'mbti-01',
          'mbti-ssr-02',
          'mbti-sr-02',
          'zodiac-ssr-01',
          'dream-ssr-01',
          'dream-sr-01',
          'city-ssr-02',
          'city-sr-01',
        ].includes(c.id),
    ).map((c, i) => [c.id, i === 0 ? 4 : i === 1 ? 2 : 1]),
  ),
  favorites: ['mbti-ssr-02', 'dream-ssr-01'],
  totalDraws: 20,
  sinceSR: 2,
  sinceSSR: 8,
  passedQuestions: 118,
  availableDraws: 3,
  nextDrawProgress: 3,
};
let state: CardCollection = empty
  ? {
      owned: {},
      favorites: [],
      totalDraws: 0,
      sinceSR: 0,
      sinceSSR: 0,
      passedQuestions: 2,
      availableDraws: 0,
      nextDrawProgress: 2,
    }
  : JSON.parse(localStorage.getItem(key) || JSON.stringify(demo));
const receipts = new Map<string, CardDrawResponse>();
const api: CardCollectionApi = {
  load: async () => structuredClone(state),
  draw: async (id) => {
    if (receipts.has(id)) return structuredClone(receipts.get(id)!);
    if (!state.availableDraws) throw new Error('再通过几道新题，就能获得下一次抽卡。');
    // Deterministic SSR duplicate on first demo draw, then a new SR: actual UI, fixture data.
    const picked =
      state.availableDraws === 3
        ? STUDY_CARDS.find((c) => c.id === 'mbti-ssr-02')!
        : rollStudyCard(state.sinceSR, state.sinceSSR, 0.1, 0.36).card;
    const copies = (state.owned[picked.id] ?? 0) + 1;
    state = {
      ...state,
      owned: { ...state.owned, [picked.id]: copies },
      totalDraws: state.totalDraws + 1,
      availableDraws: state.availableDraws - 1,
      sinceSR: 0,
      sinceSSR: picked.rarity === 'SSR' ? 0 : state.sinceSSR + 1,
    };
    localStorage.setItem(key, JSON.stringify(state));
    const result = {
      collection: structuredClone(state),
      draw: { id, cardId: picked.id, copies, isNew: copies === 1, rarity: picked.rarity },
    };
    receipts.set(id, result);
    return result;
  },
  favorite: async (id, value) => {
    const favorites = state.favorites.filter((c) => c !== id);
    if (value) favorites.push(id);
    if (favorites.length > 6) throw new Error('展柜最多放 6 张。');
    state = { ...state, favorites };
    localStorage.setItem(key, JSON.stringify(state));
    return structuredClone(state);
  },
};
createRoot(document.getElementById('root')!).render(
  <>
    <CardCollectionPage onBack={() => window.location.reload()} api={api} />
    <button
      style={{
        position: 'fixed',
        bottom: 10,
        left: 12,
        zIndex: 25,
        border: '1px solid #665477',
        borderRadius: 8,
        background: '#21192d',
        color: '#d9c8ec',
        padding: '6px 10px',
        fontSize: 11,
      }}
      onClick={() => {
        localStorage.removeItem(key);
        window.location.reload();
      }}
    >
      重置本机样例
    </button>
    <div
      style={{
        position: 'fixed',
        bottom: 8,
        right: 12,
        zIndex: 25,
        color: '#b0a0c4',
        fontSize: 9,
        pointerEvents: 'none',
      }}
    >
      仅本机样例 · 不连接真实账户
    </div>
  </>,
);
