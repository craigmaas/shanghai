import { useEffect, useMemo, useRef, useState } from 'react';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, onValue, set, update, onDisconnect, get } from 'firebase/database';

const playerNames = ['June', 'Jan', 'Dorothy'];
const sessionIdKey = 'shanghai-session-id';
const playerStorageKey = 'shanghai-player-name';
const CARD_BACK = 'https://deckofcardsapi.com/static/img/back.png';

const firebaseConfig = {
  apiKey: "AIzaSyCQCjrhAbqTzFm-ID8-iq4kTeTjO_eVGeg",
  authDomain: "shanghai-1b7ca.firebaseapp.com",
  databaseURL: "https://shanghai-1b7ca-default-rtdb.firebaseio.com",
  projectId: "shanghai-1b7ca",
  storageBucket: "shanghai-1b7ca.firebasestorage.app",
  messagingSenderId: "929849716526",
  appId: "1:929849716526:web:1f2b3fc6bbe108e638d4bf",
  measurementId: "G-NCF6VPKX7F"
};

const suitCodes = { '♠': 'S', '♥': 'H', '♦': 'D', '♣': 'C' };

function generateFullDeck() {
  const suits = ['♠', '♥', '♦', '♣'];
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const cards = [];
  for (let deckIndex = 0; deckIndex < 2; deckIndex += 1) {
    for (const suit of suits) {
      for (const rank of ranks) {
        cards.push({ id: `${suit}${rank}-${deckIndex}`, suit, rank, type: 'normal' });
      }
    }
    cards.push({ id: `JOKER-${deckIndex}-1`, rank: 'Joker', suit: '', type: 'joker' });
    cards.push({ id: `JOKER-${deckIndex}-2`, rank: 'Joker', suit: '', type: 'joker' });
  }
  return cards;
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function createCardLabel(card) {
  return card.type === 'joker' ? 'Joker' : `${card.rank}${card.suit}`;
}

function getCardImageUrl(card) {
  if (card.type === 'joker') {
    return 'https://deckofcardsapi.com/static/img/X1.png';
  }
  const rankCode = card.rank === '10' ? '0' : card.rank;
  const suitCode = suitCodes[card.suit];
  return `https://deckofcardsapi.com/static/img/${rankCode}${suitCode}.png`;
}

function emptyState() {
  return {
    deck: [],
    discard: [],
    table: {},
    hands: { June: [], Jan: [], Dorothy: [] },
    scores: { June: 0, Jan: 0, Dorothy: 0 },
    seats: {},
    roundResult: null,
    meta: { initialized: false }
  };
}

function normalizeState(data) {
  if (!data) return emptyState();
  let table = {};
  if (data.table) {
    if (Array.isArray(data.table)) {
      data.table.forEach((c) => { if (c?.id) table[c.id] = c; });
    } else if (typeof data.table === 'object') {
      table = data.table;
    }
  }
  return {
    deck: Array.isArray(data.deck) ? data.deck : [],
    discard: Array.isArray(data.discard) ? data.discard : [],
    table,
    hands: {
      June: Array.isArray(data.hands?.June) ? data.hands.June : [],
      Jan: Array.isArray(data.hands?.Jan) ? data.hands.Jan : [],
      Dorothy: Array.isArray(data.hands?.Dorothy) ? data.hands.Dorothy : []
    },
    scores: {
      June: Number.isFinite(data.scores?.June) ? data.scores.June : 0,
      Jan: Number.isFinite(data.scores?.Jan) ? data.scores.Jan : 0,
      Dorothy: Number.isFinite(data.scores?.Dorothy) ? data.scores.Dorothy : 0
    },
    seats: data.seats || {},
    roundResult: data.roundResult || null,
    meta: data.meta || { initialized: false }
  };
}

// Run-detection helpers. 2s and Jokers are wild. Non-wild cards have fixed
// rank values; A can be high (14) or low (1). We try both interpretations and
// keep the layout that fits with the wildcards available.
const RANK_LOW = { A: 1, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, J: 11, Q: 12, K: 13 };
const RANK_HIGH = { A: 14, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, J: 11, Q: 12, K: 13 };
const SUIT_ORDER = { '♠': 0, '♥': 1, '♦': 2, '♣': 3 };

function isWild(card) {
  return card.type === 'joker' || card.rank === '2';
}

function pointsForCard(card) {
  if (card.type === 'joker') return 50;
  if (card.rank === '2') return 20;
  if (card.rank === 'A') return 15;
  if (card.rank === '10' || card.rank === 'J' || card.rank === 'Q' || card.rank === 'K') return 10;
  return 5;
}

function tryLayoutRun(cards, useAHigh) {
  const nonWild = cards.filter((c) => !isWild(c));
  const wilds = cards.filter((c) => isWild(c));
  if (nonWild.length === 0) return null;
  const suit = nonWild[0].suit;
  if (!nonWild.every((c) => c.suit === suit)) return null;
  const rankMap = useAHigh ? RANK_HIGH : RANK_LOW;
  const ranked = nonWild
    .map((c) => ({ card: c, v: rankMap[c.rank] }))
    .sort((a, b) => a.v - b.v);
  for (let i = 1; i < ranked.length; i += 1) {
    if (ranked[i].v === ranked[i - 1].v) return null; // duplicate rank ⇒ not a run
  }
  const minR = ranked[0].v;
  const maxR = ranked[ranked.length - 1].v;
  const gaps = (maxR - minR + 1) - nonWild.length;
  if (gaps < 0 || gaps > wilds.length) return null;
  const minBound = useAHigh ? 2 : 1;
  const maxBound = useAHigh ? 14 : 13;

  // Partition wilds by player-chosen anchor.
  const lowAnchored = wilds.filter((w) => w.anchor === 'low');
  const highAnchored = wilds.filter((w) => w.anchor === 'high');
  const flex = wilds.filter((w) => w.anchor !== 'low' && w.anchor !== 'high');

  // Fill internal gaps using flex wilds first; if not enough, borrow from
  // anchored ones (high then low) so the run remains valid.
  let gapsLeft = gaps;
  let flexForGaps = Math.min(flex.length, gapsLeft);
  gapsLeft -= flexForGaps;
  let highForGaps = Math.min(highAnchored.length, gapsLeft);
  gapsLeft -= highForGaps;
  let lowForGaps = Math.min(lowAnchored.length, gapsLeft);
  gapsLeft -= lowForGaps;
  if (gapsLeft > 0) return null;

  const extLow = lowAnchored.length - lowForGaps;
  const extHigh = highAnchored.length - highForGaps;
  const extFlex = flex.length - flexForGaps;

  // Default: leftover flex wilds extend the high end. Redistribute on overflow.
  let bottom = minR - extLow;
  let top = maxR + extHigh + extFlex;
  if (top > maxBound) {
    const overflow = top - maxBound;
    bottom -= overflow;
    top = maxBound;
  }
  if (bottom < minBound) {
    const overflow = minBound - bottom;
    top += overflow;
    bottom = minBound;
    if (top > maxBound) return null;
  }

  const slots = new Array(top - bottom + 1).fill(null);
  for (const { card, v } of ranked) slots[v - bottom] = card;

  // Place anchored extensions at their ends.
  const lowExtPool = lowAnchored.slice(lowForGaps);
  for (let i = 0; i < extLow; i += 1) slots[i] = lowExtPool[i];
  const highExtPool = highAnchored.slice(highForGaps);
  for (let i = 0; i < extHigh; i += 1) slots[slots.length - 1 - i] = highExtPool[i];

  // Fill the rest (gaps + flex extensions, plus anchored wilds borrowed for gaps).
  const fillers = [
    ...flex,
    ...highAnchored.slice(0, highForGaps),
    ...lowAnchored.slice(0, lowForGaps)
  ];
  for (let i = 0; i < slots.length; i += 1) {
    if (slots[i] === null && fillers.length > 0) slots[i] = fillers.shift();
  }
  if (slots.some((s) => s === null) || fillers.length > 0) return null;
  return slots; // lowest-to-highest, left-to-right
}

function reorderGroup(cards) {
  if (cards.length <= 1) return cards;
  const nonWild = cards.filter((c) => !isWild(c));
  if (nonWild.length === 0) return cards;
  const allSameRank = nonWild.every((c) => c.rank === nonWild[0].rank);
  if (allSameRank) return cards; // set ⇒ leave order alone
  return tryLayoutRun(cards, true) || cards; // A always high
}

function seededState() {
  return {
    deck: shuffle(generateFullDeck()),
    discard: [],
    table: {},
    hands: { June: [], Jan: [], Dorothy: [] },
    scores: { June: 0, Jan: 0, Dorothy: 0 },
    seats: {},
    meta: { initialized: true }
  };
}

function App() {
  const sessionId = useMemo(() => {
    const existing = sessionStorage.getItem(sessionIdKey);
    const id = existing || crypto.randomUUID();
    sessionStorage.setItem(sessionIdKey, id);
    return id;
  }, []);

  const [currentPlayer, setCurrentPlayer] = useState(() => sessionStorage.getItem(playerStorageKey) ?? '');
  const [statusMessage, setStatusMessage] = useState('Connecting…');
  const [draggingId, setDraggingId] = useState(null);
  const [dismissedRoundId, setDismissedRoundId] = useState(null);
  const [, setRenderCounter] = useState(0);
  const firebaseRef = useRef(null);
  const databaseRef = useRef(null);
  const currentPlayerRef = useRef(currentPlayer);
  const gameStateRef = useRef(emptyState());
  const playAreaRef = useRef(null);
  const deckDragImageRef = useRef(null);
  // Paths we've written locally but haven't yet seen a Firebase ack for. While
  // a path is pending, any remote echo gets overlaid with our local value so
  // optimistic updates don't get clobbered by an in-flight cross-client write.
  const pendingPathsRef = useRef(new Map());
  const writeCounterRef = useRef(0);

  useEffect(() => { currentPlayerRef.current = currentPlayer; }, [currentPlayer]);

  const refresh = () => setRenderCounter((v) => v + 1);

  // Apply a local merge and a granular Firebase update. Caller supplies BOTH:
  //  - `localNext`: the full new gameState (already merged) to set locally
  //  - `paths`: a path-keyed object passed to RTDB `update(rootRef, paths)`
  // This avoids the full-tree overwrite that causes one client to clobber another.
  const apply = (localNext, paths) => {
    gameStateRef.current = localNext;
    if (firebaseRef.current && paths && Object.keys(paths).length > 0) {
      const writeId = ++writeCounterRef.current;
      Object.keys(paths).forEach((p) => pendingPathsRef.current.set(p, writeId));
      const clearPending = () => {
        Object.keys(paths).forEach((p) => {
          if (pendingPathsRef.current.get(p) === writeId) {
            pendingPathsRef.current.delete(p);
          }
        });
      };
      const safetyTimeout = setTimeout(clearPending, 4000);
      update(firebaseRef.current, paths)
        .then(() => { clearTimeout(safetyTimeout); clearPending(); })
        .catch(() => { clearTimeout(safetyTimeout); clearPending(); });
    }
    refresh();
  };

  // Overlay any in-flight local writes on top of a remote snapshot so a remote
  // echo that doesn't yet include our local change doesn't briefly wipe it out.
  // Two strategies:
  //  1. For table cards, compare per-card `t` timestamps — local wins if newer.
  //     This catches stale echoes even after pending-path tracking has cleared.
  //  2. For everything else (seats, hands, deck, etc.), the pending-path map
  //     tells us which roots we just wrote so we preserve those locally.
  const RECENT_LOCAL_MS = 6000;

  const applyPendingOverlay = (remote) => {
    const local = gameStateRef.current;
    const now = Date.now();
    const result = { ...remote };

    // Table merge by timestamp.
    const mergedTable = { ...remote.table };
    for (const [id, localCard] of Object.entries(local.table)) {
      const remoteCard = remote.table[id];
      const localT = localCard.t || 0;
      const remoteT = remoteCard?.t || 0;
      if (!remoteCard) {
        // Card exists locally but not in the remote snapshot. If it was
        // recently written locally, keep it; the write probably hasn't
        // round-tripped yet. Otherwise it was deleted elsewhere — drop it.
        if (now - localT < RECENT_LOCAL_MS) mergedTable[id] = localCard;
      } else if (localT > remoteT) {
        mergedTable[id] = localCard;
      }
    }
    result.table = mergedTable;

    // Pending overlay for non-table roots.
    if (pendingPathsRef.current.size > 0) {
      pendingPathsRef.current.forEach((_, path) => {
        const [root, p1] = path.split('/');
        if (root === 'seats' && p1) {
          result.seats = { ...result.seats };
          const lv = local.seats[p1];
          if (lv) result.seats[p1] = lv;
          else delete result.seats[p1];
        } else if (root === 'hands' && p1) {
          result.hands = { ...result.hands, [p1]: local.hands[p1] };
        } else if (root === 'scores' && p1) {
          result.scores = { ...result.scores, [p1]: local.scores[p1] };
        } else if (root === 'deck' && !p1) {
          result.deck = local.deck;
        } else if (root === 'discard' && !p1) {
          result.discard = local.discard;
        }
      });
    }

    return result;
  };

  const setPlayerSeat = (name) => {
    // Always allow taking a seat — boots whoever (if anyone) was sitting there.
    // validateSelection on the booted client will clear their selection on next echo.
    const next = {
      ...gameStateRef.current,
      seats: { ...gameStateRef.current.seats, [name]: sessionId }
    };
    apply(next, { [`seats/${name}`]: sessionId });
    sessionStorage.setItem(playerStorageKey, name);
    setCurrentPlayer(name);
  };

  const removePlayerSeat = (name) => {
    if (!name) return;
    if (gameStateRef.current.seats[name] !== sessionId) return;
    const newSeats = { ...gameStateRef.current.seats };
    delete newSeats[name];
    const next = { ...gameStateRef.current, seats: newSeats };
    apply(next, { [`seats/${name}`]: null });
    sessionStorage.removeItem(playerStorageKey);
    setCurrentPlayer('');
  };

  const drawFromDeck = (name) => {
    if (!name || gameStateRef.current.deck.length === 0) return;
    const [card, ...rest] = gameStateRef.current.deck;
    const newHand = [...gameStateRef.current.hands[name], card];
    const next = {
      ...gameStateRef.current,
      deck: rest,
      hands: { ...gameStateRef.current.hands, [name]: newHand }
    };
    apply(next, { deck: rest, [`hands/${name}`]: newHand });
  };

  const flipDeckToDiscard = () => {
    if (gameStateRef.current.deck.length === 0) return;
    const [card, ...rest] = gameStateRef.current.deck;
    const newDiscard = [card, ...gameStateRef.current.discard];
    const next = { ...gameStateRef.current, deck: rest, discard: newDiscard };
    apply(next, { deck: rest, discard: newDiscard });
  };

  const drawFromDiscard = (name) => {
    if (!name || gameStateRef.current.discard.length === 0) return;
    const [card, ...rest] = gameStateRef.current.discard;
    const newHand = [...gameStateRef.current.hands[name], card];
    const next = {
      ...gameStateRef.current,
      discard: rest,
      hands: { ...gameStateRef.current.hands, [name]: newHand }
    };
    apply(next, { discard: rest, [`hands/${name}`]: newHand });
  };

  const getNextZ = () =>
    Object.values(gameStateRef.current.table).reduce((m, c) => Math.max(m, c.z || 0), 0) + 1;

  // Reorganize the cards currently belonging to `groupId` inside `tableState`,
  // updating `groupIndex`, `z`, and `t` on each. Mutates `tableState` in place
  // and returns the changed cards as an object so callers can also stage
  // path-level writes for Firebase.
  const reorganizeGroupInPlace = (tableState, groupId, baseZ, t, anchor) => {
    const cards = Object.values(tableState).filter((c) => (c.groupId || c.id) === groupId);
    if (cards.length === 0) return {};
    const reordered = reorderGroup(cards);
    const ax = anchor?.x ?? cards[0].x;
    const ay = anchor?.y ?? cards[0].y;
    const updated = {};
    reordered.forEach((c, i) => {
      const next = { ...c, groupId, groupIndex: i, z: baseZ + i, t, x: ax, y: ay };
      tableState[c.id] = next;
      updated[c.id] = next;
    });
    return updated;
  };

  // Place a card on the table. If `targetCard` is provided, the card joins
  // that card's group and the whole group gets reorganized (runs → sorted
  // high-to-low with wilds slotted into gaps; sets → preserved order).
  // Otherwise the card lands at (dropX, dropY) as a singleton.
  const placeOnTable = ({ card, from, targetCard, dropX, dropY }) => {
    if (targetCard && targetCard.id === card.id) return;
    const baseZ = getNextZ();
    const t = Date.now();
    const working = { ...gameStateRef.current.table };
    const oldGroupId = working[card.id]?.groupId || card.id;
    if (from?.kind === 'table') delete working[card.id];

    const paths = {};
    let leftOldGroup = false;

    if (targetCard) {
      const newGroupId = targetCard.groupId || targetCard.id;
      working[card.id] = {
        ...card,
        faceUp: true,
        groupId: newGroupId,
        x: targetCard.x,
        y: targetCard.y,
        t
      };
      const updated = reorganizeGroupInPlace(working, newGroupId, baseZ, t, { x: targetCard.x, y: targetCard.y });
      Object.entries(updated).forEach(([id, c]) => { paths[`table/${id}`] = c; });
      leftOldGroup = from?.kind === 'table' && oldGroupId !== newGroupId;
    } else {
      const placed = {
        ...card,
        x: dropX, y: dropY,
        faceUp: true,
        groupId: card.id, groupIndex: 0, z: baseZ, t,
        anchor: null
      };
      working[card.id] = placed;
      paths[`table/${card.id}`] = placed;
      leftOldGroup = from?.kind === 'table' && oldGroupId !== card.id;
    }

    if (leftOldGroup) {
      const updated = reorganizeGroupInPlace(working, oldGroupId, getNextZForTable(working), t);
      Object.entries(updated).forEach(([id, c]) => { paths[`table/${id}`] = c; });
    }

    let localState = { ...gameStateRef.current, table: working };
    if (from?.kind === 'hand') {
      const player = currentPlayerRef.current;
      if (!player) return;
      localState = { ...localState, hands: { ...gameStateRef.current.hands, [player]: from.hand } };
      paths[`hands/${player}`] = from.hand;
    }

    apply(localState, paths);
  };

  const getNextZForTable = (table) =>
    Object.values(table).reduce((m, c) => Math.max(m, c.z || 0), 0) + 1;

  const moveGroupTo = (groupId, newAnchorX, newAnchorY) => {
    const groupCards = Object.values(gameStateRef.current.table)
      .filter((c) => (c.groupId || c.id) === groupId);
    if (groupCards.length === 0) return;
    const t = Date.now();
    const baseZ = getNextZ();
    const reordered = [...groupCards].sort((a, b) => (a.groupIndex || 0) - (b.groupIndex || 0));
    const newTable = { ...gameStateRef.current.table };
    const paths = {};
    reordered.forEach((c, i) => {
      const updated = { ...c, x: newAnchorX, y: newAnchorY, z: baseZ + i, t };
      newTable[c.id] = updated;
      paths[`table/${c.id}`] = updated;
    });
    apply({ ...gameStateRef.current, table: newTable }, paths);
  };

  // Live (pointer-driven) drag for group handles. We update gameStateRef
  // every pointermove so the cards visually follow the cursor, then commit
  // a single Firebase write on release. Stamping `t` on each tick keeps the
  // pending-overlay from clobbering us with stale remote echoes mid-drag.
  const groupDragRef = useRef(null);
  const [groupDragging, setGroupDragging] = useState(null);

  useEffect(() => {
    if (!groupDragging) return;
    const onMove = (e) => {
      const drag = groupDragRef.current;
      if (!drag) return;
      const nx = drag.startAnchorX + (e.clientX - drag.startClientX);
      const ny = drag.startAnchorY + (e.clientY - drag.startClientY);
      const t = Date.now();
      const newTable = { ...gameStateRef.current.table };
      for (const c of Object.values(newTable)) {
        if ((c.groupId || c.id) === drag.groupId) {
          newTable[c.id] = { ...c, x: nx, y: ny, t };
        }
      }
      gameStateRef.current = { ...gameStateRef.current, table: newTable };
      refresh();
    };
    const onUp = (e) => {
      const drag = groupDragRef.current;
      if (!drag) return;
      const nx = drag.startAnchorX + (e.clientX - drag.startClientX);
      const ny = drag.startAnchorY + (e.clientY - drag.startClientY);
      moveGroupTo(drag.groupId, nx, ny);
      groupDragRef.current = null;
      setGroupDragging(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [groupDragging]);

  const startGroupDrag = (e, groupId, anchorX, anchorY) => {
    e.preventDefault();
    groupDragRef.current = {
      groupId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startAnchorX: anchorX,
      startAnchorY: anchorY
    };
    setGroupDragging(groupId);
  };

  const tableCardToHand = (cardId) => {
    const player = currentPlayerRef.current;
    if (!player) return;
    const card = gameStateRef.current.table[cardId];
    if (!card) return;
    const { x, y, faceUp, groupId, groupIndex, z, t, ...clean } = card;
    const working = { ...gameStateRef.current.table };
    delete working[cardId];
    const oldGroupId = card.groupId || cardId;
    const now = Date.now();
    const groupUpdates = reorganizeGroupInPlace(working, oldGroupId, getNextZForTable(working), now);
    const newHand = [...(gameStateRef.current.hands[player] || []), clean];
    const next = {
      ...gameStateRef.current,
      table: working,
      hands: { ...gameStateRef.current.hands, [player]: newHand }
    };
    const paths = {
      [`table/${cardId}`]: null,
      [`hands/${player}`]: newHand
    };
    Object.entries(groupUpdates).forEach(([id, c]) => { paths[`table/${id}`] = c; });
    apply(next, paths);
  };

  const discardFromHand = (cardId) => {
    const player = currentPlayerRef.current;
    if (!player) return;
    const hand = [...(gameStateRef.current.hands[player] || [])];
    const idx = hand.findIndex((c) => c.id === cardId);
    if (idx < 0) return;
    const [card] = hand.splice(idx, 1);
    const newDiscard = [card, ...gameStateRef.current.discard];
    const next = {
      ...gameStateRef.current,
      hands: { ...gameStateRef.current.hands, [player]: hand },
      discard: newDiscard
    };
    apply(next, {
      [`hands/${player}`]: hand,
      discard: newDiscard
    });
  };

  const discardFromTable = (cardId) => {
    const card = gameStateRef.current.table[cardId];
    if (!card) return;
    const { x, y, faceUp, groupId, groupIndex, z, t, ...clean } = card;
    const working = { ...gameStateRef.current.table };
    delete working[cardId];
    const oldGroupId = card.groupId || cardId;
    const now = Date.now();
    const groupUpdates = reorganizeGroupInPlace(working, oldGroupId, getNextZForTable(working), now);
    const newDiscard = [clean, ...gameStateRef.current.discard];
    const next = {
      ...gameStateRef.current,
      table: working,
      discard: newDiscard
    };
    const paths = {
      [`table/${cardId}`]: null,
      discard: newDiscard
    };
    Object.entries(groupUpdates).forEach(([id, c]) => { paths[`table/${id}`] = c; });
    apply(next, paths);
  };

  const adjustScore = (name, delta) => {
    if (name !== currentPlayerRef.current) return;
    const current = gameStateRef.current.scores[name] || 0;
    const nextScore = Math.max(0, Math.min(999, current + delta));
    const next = {
      ...gameStateRef.current,
      scores: { ...gameStateRef.current.scores, [name]: nextScore }
    };
    apply(next, { [`scores/${name}`]: nextScore });
  };

  const recallAndShuffle = () => {
    if (!window.confirm('Recall every card to the deck and reshuffle? This affects all players.')) return;
    const all = [];
    all.push(...gameStateRef.current.deck);
    all.push(...gameStateRef.current.discard);
    Object.values(gameStateRef.current.table).forEach(({ x, y, faceUp, ...c }) => all.push(c));
    playerNames.forEach((p) => all.push(...(gameStateRef.current.hands[p] || [])));
    shuffle(all);
    const next = {
      ...gameStateRef.current,
      deck: all,
      discard: [],
      table: {},
      hands: { June: [], Jan: [], Dorothy: [] }
    };
    apply(next, {
      deck: all,
      discard: [],
      table: null,
      'hands/June': [],
      'hands/Jan': [],
      'hands/Dorothy': []
    });
  };

  const dealCards = () => {
    if (gameStateRef.current.deck.length < 34) {
      window.alert('Not enough cards in the deck. Recall and shuffle first.');
      return;
    }
    const newDeck = [...gameStateRef.current.deck];
    const newHands = { June: [], Jan: [], Dorothy: [] };
    for (let round = 0; round < 11; round += 1) {
      playerNames.forEach((p) => {
        if (newDeck.length === 0) return;
        newHands[p].push(newDeck.shift());
      });
    }
    // Flip the next card face up to start the discard pile.
    const newDiscard = newDeck.length > 0 ? [newDeck.shift()] : [];
    const next = {
      ...gameStateRef.current,
      deck: newDeck,
      hands: newHands,
      table: {},
      discard: newDiscard
    };
    apply(next, {
      deck: newDeck,
      'hands/June': newHands.June,
      'hands/Jan': newHands.Jan,
      'hands/Dorothy': newHands.Dorothy,
      table: null,
      discard: newDiscard
    });
  };

  const resetScores = () => {
    if (!window.confirm('Reset all scores to 0?')) return;
    const zeros = { June: 0, Jan: 0, Dorothy: 0 };
    const next = { ...gameStateRef.current, scores: zeros };
    apply(next, { scores: zeros });
  };

  const completeRound = () => {
    if (!window.confirm('Complete the round? Tallies each hand, adds to scores, and reshuffles all cards.')) return;
    const results = {};
    const newScores = {};
    for (const name of playerNames) {
      const hand = gameStateRef.current.hands[name] || [];
      const prev = gameStateRef.current.scores[name] || 0;
      const gained = hand.reduce((sum, c) => sum + pointsForCard(c), 0);
      const total = prev + gained;
      results[name] = { prev, gained, total };
      newScores[name] = total;
    }
    const all = [];
    all.push(...gameStateRef.current.deck);
    all.push(...gameStateRef.current.discard);
    Object.values(gameStateRef.current.table).forEach(({ x, y, faceUp, ...c }) => all.push(c));
    playerNames.forEach((p) => all.push(...(gameStateRef.current.hands[p] || [])));
    shuffle(all);
    const roundResult = { id: Date.now(), results };
    const next = {
      ...gameStateRef.current,
      deck: all,
      discard: [],
      table: {},
      hands: { June: [], Jan: [], Dorothy: [] },
      scores: newScores,
      roundResult
    };
    apply(next, {
      deck: all,
      discard: [],
      table: null,
      'hands/June': [],
      'hands/Jan': [],
      'hands/Dorothy': [],
      scores: newScores,
      roundResult
    });
  };

  const validateSelection = () => {
    const name = currentPlayerRef.current;
    if (!name) return;
    const occupant = gameStateRef.current.seats[name];
    if (occupant && occupant !== sessionId) {
      sessionStorage.removeItem(playerStorageKey);
      setCurrentPlayer('');
      return;
    }
    if (!occupant) setPlayerSeat(name);
  };

  useEffect(() => {
    const app = initializeApp(firebaseConfig);
    const database = getDatabase(app);
    databaseRef.current = database;
    firebaseRef.current = ref(database, 'shanghai-game');

    get(firebaseRef.current).then((snap) => {
      if (!snap.exists() || !snap.val()?.meta?.initialized) {
        set(firebaseRef.current, seededState());
      }
    });

    const unsubscribe = onValue(firebaseRef.current, (snapshot) => {
      const remote = normalizeState(snapshot.val());
      gameStateRef.current = applyPendingOverlay(remote);
      refresh();
      validateSelection();
    });

    const connectedRef = ref(database, '.info/connected');
    const unsubscribeConnected = onValue(connectedRef, (snap) => {
      setStatusMessage(snap.val() === true ? 'Connected' : 'Offline');
    });

    const beforeUnload = () => {
      const name = currentPlayerRef.current;
      if (name && gameStateRef.current.seats[name] === sessionId) {
        update(firebaseRef.current, { [`seats/${name}`]: null });
      }
    };

    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      unsubscribe();
      unsubscribeConnected();
      beforeUnload();
    };
  }, []);

  // Global dragend ensures draggingId clears even when the source element
  // unmounted during drop (e.g., a hand card moved to the table).
  useEffect(() => {
    const handler = () => setDraggingId(null);
    window.addEventListener('dragend', handler);
    window.addEventListener('drop', handler);
    return () => {
      window.removeEventListener('dragend', handler);
      window.removeEventListener('drop', handler);
    };
  }, []);

  useEffect(() => {
    if (!databaseRef.current || !currentPlayer) return;
    const seatRef = ref(databaseRef.current, `shanghai-game/seats/${currentPlayer}`);
    const disconnect = onDisconnect(seatRef);
    disconnect.set(null);
    return () => { disconnect.cancel(); };
  }, [currentPlayer]);

  const setDragPayload = (event, payload) => {
    event.dataTransfer.effectAllowed = 'move';
    if (payload.cardId && event.currentTarget) {
      const rect = event.currentTarget.getBoundingClientRect();
      payload.offsetX = event.clientX - rect.left;
      payload.offsetY = event.clientY - rect.top;
      try {
        event.dataTransfer.setDragImage(event.currentTarget, payload.offsetX, payload.offsetY);
      } catch { /* setDragImage not available — fall back to native preview */ }
    }
    event.dataTransfer.setData('application/json', JSON.stringify(payload));
    if (payload.cardId) setDraggingId(payload.cardId);
  };

  const readDragPayload = (event) => {
    try {
      const raw = event.dataTransfer.getData('application/json');
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  };

  const computeDropCenter = (event, payload, rect) => {
    // Card center lands so the grab point sits under the cursor.
    const offsetX = payload.offsetX ?? cardWidth / 2;
    const offsetY = payload.offsetY ?? cardHeight / 2;
    return {
      x: event.clientX - rect.left - offsetX + cardWidth / 2,
      y: event.clientY - rect.top - offsetY + cardHeight / 2
    };
  };

  const onTableDrop = (event) => {
    event.preventDefault();
    setDraggingId(null);
    const payload = readDragPayload(event);
    if (!payload) return;
    const rect = playAreaRef.current?.getBoundingClientRect();
    if (!rect) return;

    if (payload.source === 'group') {
      const newAnchorX = (event.clientX - rect.left) - (payload.anchorDx || 0);
      const newAnchorY = (event.clientY - rect.top) - (payload.anchorDy || 0);
      moveGroupTo(payload.groupId, newAnchorX, newAnchorY);
      return;
    }

    const { x, y } = computeDropCenter(event, payload, rect);

    if (payload.source === 'hand') {
      const player = currentPlayerRef.current;
      if (!player) return;
      const hand = [...(gameStateRef.current.hands[player] || [])];
      const idx = hand.findIndex((c) => c.id === payload.cardId);
      if (idx < 0) return;
      const [card] = hand.splice(idx, 1);
      placeOnTable({ card, from: { kind: 'hand', hand }, dropX: x, dropY: y });
    } else if (payload.source === 'table') {
      const card = gameStateRef.current.table[payload.cardId];
      if (!card) return;
      placeOnTable({ card, from: { kind: 'table' }, dropX: x, dropY: y });
    } else if (payload.source === 'deck' && currentPlayer) {
      drawFromDeck(currentPlayer);
    } else if (payload.source === 'discard' && currentPlayer) {
      drawFromDiscard(currentPlayer);
    }
  };

  const onCardDrop = (event, targetCard) => {
    event.preventDefault();
    event.stopPropagation();
    setDraggingId(null);
    const payload = readDragPayload(event);
    if (!payload) return;
    if (payload.cardId === targetCard.id) {
      onTableDrop(event);
      return;
    }

    if (payload.source === 'hand') {
      const player = currentPlayerRef.current;
      if (!player) return;
      const hand = [...(gameStateRef.current.hands[player] || [])];
      const idx = hand.findIndex((c) => c.id === payload.cardId);
      if (idx < 0) return;
      const [card] = hand.splice(idx, 1);
      placeOnTable({ card, from: { kind: 'hand', hand }, targetCard });
    } else if (payload.source === 'table') {
      const card = gameStateRef.current.table[payload.cardId];
      if (!card) return;

      // If dragging a wild within its own group, the drop X position decides
      // which end of the run the wild anchors to. Drop in the left half of the
      // group → 'low'; right half → 'high'. We don't require landing on the
      // leftmost card itself because it's mostly hidden under the next card.
      let toPlace = card;
      const srcGroupId = card.groupId || card.id;
      const tgtGroupId = targetCard.groupId || targetCard.id;
      if (isWild(card) && srcGroupId === tgtGroupId) {
        const groupCards = Object.values(gameStateRef.current.table)
          .filter((c) => (c.groupId || c.id) === tgtGroupId);
        const rect = playAreaRef.current?.getBoundingClientRect();
        if (rect && groupCards.length > 0) {
          const anchorX = groupCards[0].x ?? 0;
          const N = groupCards.length;
          const midX = anchorX + ((N - 1) * FAN_OFFSET_X) / 2;
          const dropX = event.clientX - rect.left;
          toPlace = { ...card, anchor: dropX < midX ? 'low' : 'high' };
        }
      } else if (isWild(card) && srcGroupId !== tgtGroupId) {
        toPlace = { ...card, anchor: null };
      }
      placeOnTable({ card: toPlace, from: { kind: 'table' }, targetCard });
    }
  };

  const sortHand = (mode) => {
    const player = currentPlayerRef.current;
    if (!player) return;
    const hand = gameStateRef.current.hands[player] || [];
    if (hand.length === 0) return;
    const wilds = hand.filter((c) => isWild(c));
    const nonWild = hand.filter((c) => !isWild(c));
    const rv = (c) => RANK_HIGH[c.rank] ?? 0;
    const sv = (c) => SUIT_ORDER[c.suit] ?? 9;
    if (mode === 'suit') {
      nonWild.sort((a, b) => sv(a) - sv(b) || rv(a) - rv(b));
    } else {
      nonWild.sort((a, b) => rv(a) - rv(b) || sv(a) - sv(b));
    }
    const sorted = [...nonWild, ...wilds];
    apply(
      { ...gameStateRef.current, hands: { ...gameStateRef.current.hands, [player]: sorted } },
      { [`hands/${player}`]: sorted }
    );
  };

  const reorderHand = (cardId, finalIndex) => {
    const player = currentPlayerRef.current;
    if (!player) return;
    const hand = [...(gameStateRef.current.hands[player] || [])];
    const fromIdx = hand.findIndex((c) => c.id === cardId);
    if (fromIdx < 0) return;
    if (fromIdx === finalIndex) return;
    const [card] = hand.splice(fromIdx, 1);
    hand.splice(Math.max(0, Math.min(finalIndex, hand.length)), 0, card);
    apply(
      { ...gameStateRef.current, hands: { ...gameStateRef.current.hands, [player]: hand } },
      { [`hands/${player}`]: hand }
    );
  };

  const onHandDrop = (event) => {
    event.preventDefault();
    setDraggingId(null);
    const payload = readDragPayload(event);
    if (!payload || !currentPlayer) return;
    if (payload.source === 'deck') drawFromDeck(currentPlayer);
    else if (payload.source === 'discard') drawFromDiscard(currentPlayer);
    else if (payload.source === 'table') tableCardToHand(payload.cardId);
  };

  // ============ Live hand drag (pointer-driven) ============
  // Replaces HTML5 drag on hand cards so the dragged card is visible at the
  // cursor and the other cards smoothly slide aside.
  const HAND_CARD_W = 112;
  const HAND_CARD_H = 159;
  const HAND_STEP = 62; // visual step between adjacent hand cards
  const handDragRef = useRef(null);
  const [handDrag, setHandDrag] = useState(null);
  const handFanRef = useRef(null);

  const startHandPointerDrag = (e, card, originalIndex) => {
    if (e.button !== 0) return; // left-click only
    e.preventDefault();
    // Center the card on the cursor as soon as the drag starts. This keeps
    // the card visual and the snap target in sync — cursor == card center.
    handDragRef.current = {
      cardId: card.id,
      originalIndex,
      offsetX: HAND_CARD_W / 2,
      offsetY: HAND_CARD_H / 2,
      startClientX: e.clientX,
      startClientY: e.clientY,
      currentClientX: e.clientX,
      currentClientY: e.clientY,
      currentIndex: originalIndex,
      active: false
    };
    setHandDrag({ ...handDragRef.current });
  };

  useEffect(() => {
    if (!handDrag) return;

    const onMove = (e) => {
      const drag = handDragRef.current;
      if (!drag) return;
      drag.currentClientX = e.clientX;
      drag.currentClientY = e.clientY;
      if (!drag.active) {
        const dx = e.clientX - drag.startClientX;
        const dy = e.clientY - drag.startClientY;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) drag.active = true;
      }
      if (drag.active && handFanRef.current) {
        const fanRect = handFanRef.current.getBoundingClientRect();
        const N = (gameStateRef.current.hands[currentPlayerRef.current] || []).length;
        // With the card centered on the cursor, cursor X = card center.
        const cardCenterInFan = e.clientX - fanRect.left;
        const slot0Center = HAND_CARD_W / 2;
        const idx = Math.round((cardCenterInFan - slot0Center) / HAND_STEP);
        drag.currentIndex = Math.max(0, Math.min(N - 1, idx));
      }
      setHandDrag({ ...drag });
    };

    const onUp = (e) => {
      const drag = handDragRef.current;
      if (!drag) {
        setHandDrag(null);
        return;
      }
      if (!drag.active) {
        handDragRef.current = null;
        setHandDrag(null);
        return;
      }
      // Determine the drop target by walking the elements under the cursor.
      const stack = document.elementsFromPoint(e.clientX, e.clientY);
      let action = null;
      for (const el of stack) {
        if (el.classList?.contains('discard-pile')) { action = { type: 'discard' }; break; }
        if (el.classList?.contains('table-card') && el.dataset?.cardId) {
          action = { type: 'joinGroup', cardId: el.dataset.cardId }; break;
        }
        if (el.classList?.contains('hand-fan') || el.classList?.contains('hand-strip') || el.classList?.contains('hand-card')) {
          action = { type: 'reorder' }; break;
        }
        if (el.classList?.contains('play-area')) {
          action = { type: 'placeOnTable' }; break;
        }
      }

      const player = currentPlayerRef.current;
      const hand = [...(gameStateRef.current.hands[player] || [])];
      const idx = hand.findIndex((c) => c.id === drag.cardId);

      if (action?.type === 'reorder' && idx >= 0) {
        // Map currentIndex (slot in N-grid) to final index in reordered hand.
        const finalIndex = drag.currentIndex > drag.originalIndex
          ? drag.currentIndex
          : drag.currentIndex;
        // Actually: visually, dragged card sits at currentIndex slot, so final = currentIndex.
        reorderHand(drag.cardId, drag.currentIndex);
      } else if (action?.type === 'placeOnTable' && idx >= 0) {
        const rect = playAreaRef.current?.getBoundingClientRect();
        if (rect) {
          const dropX = e.clientX - rect.left - drag.offsetX + HAND_CARD_W / 2;
          const dropY = e.clientY - rect.top - drag.offsetY + HAND_CARD_H / 2;
          const [card] = hand.splice(idx, 1);
          placeOnTable({ card, from: { kind: 'hand', hand }, dropX, dropY });
        }
      } else if (action?.type === 'joinGroup' && idx >= 0) {
        const targetCard = gameStateRef.current.table[action.cardId];
        if (targetCard) {
          const [card] = hand.splice(idx, 1);
          placeOnTable({ card, from: { kind: 'hand', hand }, targetCard });
        }
      } else if (action?.type === 'discard' && idx >= 0) {
        discardFromHand(drag.cardId);
      }
      // else: no-op (drop landed somewhere invalid; card snaps back).

      handDragRef.current = null;
      setHandDrag(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [handDrag !== null]);

  const onDiscardDrop = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setDraggingId(null);
    const payload = readDragPayload(event);
    if (!payload) return;
    if (payload.source === 'hand') discardFromHand(payload.cardId);
    else if (payload.source === 'table') discardFromTable(payload.cardId);
    else if (payload.source === 'deck') flipDeckToDiscard();
  };

  const state = gameStateRef.current;
  const isSeated = Boolean(currentPlayer);
  const myHand = currentPlayer ? state.hands[currentPlayer] || [] : [];
  const deckCount = state.deck.length;
  const discardTop = state.discard[0] || null;
  const opponents = playerNames.filter((n) => n !== currentPlayer);
  const tableCards = Object.values(state.table);

  const seatStates = playerNames.map((name) => ({
    name,
    occupant: state.seats[name],
    score: state.scores[name] || 0,
    handCount: (state.hands[name] || []).length
  }));

  const cardWidth = 100;
  const cardHeight = Math.round(cardWidth / 0.7);
  const FAN_OFFSET_X = 28;
  const FAN_OFFSET_Y = 0;

  const roundResult = state.roundResult;
  const showRoundModal = !!(roundResult && roundResult.id && dismissedRoundId !== roundResult.id);
  const dismissRoundModal = () => { if (roundResult) setDismissedRoundId(roundResult.id); };

  return (
    <div className="felt">
      {showRoundModal && (
        <div className="modal-overlay" onClick={dismissRoundModal}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Round complete</h2>
              <button className="modal-close" onClick={dismissRoundModal} aria-label="Close">×</button>
            </div>
            <table className="scorepad">
              <thead>
                <tr>
                  <th></th>
                  {playerNames.map((n) => <th key={n}>{n}</th>)}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th>Previous</th>
                  {playerNames.map((n) => <td key={n}>{roundResult.results?.[n]?.prev ?? 0}</td>)}
                </tr>
                <tr className="round-row">
                  <th>+ This round</th>
                  {playerNames.map((n) => <td key={n}>{roundResult.results?.[n]?.gained ?? 0}</td>)}
                </tr>
                <tr className="total-row">
                  <th>New total</th>
                  {playerNames.map((n) => <td key={n}>{roundResult.results?.[n]?.total ?? 0}</td>)}
                </tr>
              </tbody>
            </table>
            <button type="button" className="modal-ok" onClick={dismissRoundModal}>OK</button>
          </div>
        </div>
      )}

      <header className="top-strip">
        <div className="brand">
          <span className="brand-name">Shanghai</span>
          <span className={`status-dot ${statusMessage === 'Connected' ? 'on' : 'off'}`} />
          <span className="status-text">{statusMessage}</span>
        </div>
        <div className="opponents-row">
          {opponents.map((name) => {
            const s = seatStates.find((x) => x.name === name);
            return (
              <div key={name} className={`opponent ${s.occupant ? 'live' : 'empty'}`}>
                <div className="opp-name">{name}</div>
                <div className="opp-meta">
                  <span className="opp-score">{s.score}</span>
                  <span className="opp-hand">{s.handCount}🂠</span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="admin-actions">
          <button
            type="button"
            className="draw-btn"
            onClick={() => isSeated && drawFromDeck(currentPlayer)}
            disabled={!isSeated || deckCount === 0}
          >
            Draw
          </button>
          <button type="button" onClick={dealCards}>Deal 11</button>
          <button type="button" onClick={completeRound}>Complete round</button>
          <button type="button" onClick={recallAndShuffle}>Recall &amp; shuffle</button>
          <button type="button" className="ghost" onClick={resetScores}>Reset scores</button>
        </div>
      </header>

      <main
        className="play-area"
        ref={playAreaRef}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onTableDrop}
      >
        <div className="player-zones" aria-hidden="true">
          {playerNames.map((name) => (
            <div key={name} className={`player-zone player-zone-${name.toLowerCase()}`}>
              <div className="player-zone-label">{name}</div>
            </div>
          ))}
        </div>

        <div className="centerpiece">
          <div
            className={`deck-stack ${deckCount === 0 ? 'empty' : ''}`}
            draggable={deckCount > 0 && isSeated}
            onDragStart={(e) => {
              if (deckDragImageRef.current) {
                try { e.dataTransfer.setDragImage(deckDragImageRef.current, 50, 71); } catch {}
              }
              setDragPayload(e, { source: 'deck' });
            }}
            onClick={() => isSeated && drawFromDeck(currentPlayer)}
            title="Drag or click to draw"
          >
            <img
              ref={deckDragImageRef}
              src={CARD_BACK}
              alt=""
              aria-hidden="true"
              draggable={false}
              style={{ position: 'absolute', left: '-9999px', top: '-9999px', width: '100px', height: '143px', pointerEvents: 'none' }}
            />
            <div className="stack-layers" data-count={Math.min(5, Math.ceil(deckCount / 22))}>
              <div className="stack-layer" />
              <div className="stack-layer" />
              <div className="stack-layer" />
              <div className="stack-layer" />
              <div className="stack-face">
                {deckCount === 0
                  ? <span className="pile-empty">Empty</span>
                  : <img src={CARD_BACK} alt="Deck" draggable={false} />}
              </div>
            </div>
            <div className="pile-count">{deckCount}</div>
          </div>

          <div
            className={`discard-pile ${discardTop ? '' : 'empty'}`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDiscardDrop}
            draggable={Boolean(discardTop) && isSeated}
            onDragStart={(e) => discardTop && setDragPayload(e, { source: 'discard' })}
            onClick={() => isSeated && discardTop && drawFromDiscard(currentPlayer)}
            title="Drop a card to discard, or drag/click the top card to take it"
          >
            <div className="stack-face">
              {discardTop
                ? <img src={getCardImageUrl(discardTop)} alt={createCardLabel(discardTop)} draggable={false} />
                : <span className="pile-empty">Discard</span>}
            </div>
            <div className="pile-count">{state.discard.length}</div>
          </div>
        </div>

        {(() => {
          // Compute per-group anchors + sizes so we can render a drag handle
          // below each multi-card group.
          const groups = {};
          for (const c of tableCards) {
            const gid = c.groupId || c.id;
            if (!groups[gid]) groups[gid] = [];
            groups[gid].push(c);
          }
          const handleW = 56;
          const handleH = 18;
          return Object.entries(groups).map(([gid, cards]) => {
            if (cards.length < 2) return null;
            const anchorX = cards[0].x ?? 0;
            const anchorY = cards[0].y ?? 0;
            const N = cards.length;
            const handleCenterX = anchorX + ((N - 1) * FAN_OFFSET_X) / 2;
            const handleCenterY = anchorY + cardHeight / 2 + 14;
            const maxZ = cards.reduce((m, c) => Math.max(m, c.z || 0), 0);
            return (
              <div
                key={`grp-handle-${gid}`}
                className="group-handle"
                style={{
                  left: `${handleCenterX - handleW / 2}px`,
                  top: `${handleCenterY - handleH / 2}px`,
                  width: `${handleW}px`,
                  height: `${handleH}px`,
                  zIndex: maxZ + 1
                }}
                onPointerDown={(e) => startGroupDrag(e, gid, anchorX, anchorY)}
                title="Drag to move the whole group"
              >
                <span aria-hidden="true">⋮⋮</span>
              </div>
            );
          });
        })()}

        {tableCards.map((card) => {
          const groupIndex = card.groupIndex || 0;
          const left = (card.x ?? 0) - cardWidth / 2 + groupIndex * FAN_OFFSET_X;
          const top = (card.y ?? 0) - cardHeight / 2 + groupIndex * FAN_OFFSET_Y;
          const isBeingDragged = draggingId === card.id;
          return (
            <div
              key={card.id}
              className="table-card"
              data-card-id={card.id}
              style={{
                left: `${left}px`,
                top: `${top}px`,
                width: `${cardWidth}px`,
                height: `${cardHeight}px`,
                zIndex: card.z ?? 0,
                opacity: isBeingDragged ? 0 : 1
              }}
              draggable
              onDragStart={(e) => setDragPayload(e, { source: 'table', cardId: card.id })}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onDrop={(e) => onCardDrop(e, card)}
              onDoubleClick={() => tableCardToHand(card.id)}
              title="Drag to move · drop onto another card to fan · double-click to take"
            >
              <img src={getCardImageUrl(card)} alt={createCardLabel(card)} draggable={false} />
            </div>
          );
        })}
      </main>

      <section className="self-strip">
        {isSeated ? (
          <>
            <div className="me">
              <div className="me-name">You are <strong>{currentPlayer}</strong></div>
              <button type="button" className="leave" onClick={() => removePlayerSeat(currentPlayer)}>Leave seat</button>
            </div>
            <div className="score-control">
              <button type="button" onClick={() => adjustScore(currentPlayer, -10)}>−10</button>
              <button type="button" onClick={() => adjustScore(currentPlayer, -1)}>−1</button>
              <div className="score-display">{state.scores[currentPlayer] || 0}</div>
              <button type="button" onClick={() => adjustScore(currentPlayer, +1)}>+1</button>
              <button type="button" onClick={() => adjustScore(currentPlayer, +10)}>+10</button>
            </div>
          </>
        ) : (
          <div className="seat-picker">
            <span className="pick-label">Pick a seat:</span>
            {seatStates.map(({ name, occupant }) => (
              <button
                key={name}
                type="button"
                className={occupant ? 'occupied' : ''}
                onClick={() => setPlayerSeat(name)}
                title={occupant ? `Sitting here will boot the current occupant` : ''}
              >
                {name}{occupant ? ' (occupied)' : ''}
              </button>
            ))}
          </div>
        )}
      </section>

      <section
        className="hand-strip"
        onDragOver={(e) => e.preventDefault()}
        onDrop={onHandDrop}
      >
        {isSeated && (
          <div className="hand-controls">
            <button type="button" onClick={() => sortHand('suit')} disabled={myHand.length === 0}>Order by suit</button>
            <button type="button" onClick={() => sortHand('rank')} disabled={myHand.length === 0}>Order by number</button>
          </div>
        )}
        {isSeated && myHand.length === 0 && (
          <div className="hand-empty">Drag from the deck or discard to draw a card.</div>
        )}
        {!isSeated && (
          <div className="hand-empty">Take a seat above to get a hand.</div>
        )}
        <div
          className="hand-fan"
          ref={handFanRef}
          style={{ width: `${myHand.length > 0 ? HAND_CARD_W + (myHand.length - 1) * HAND_STEP : 0}px`, height: `${HAND_CARD_H}px` }}
        >
          {myHand.map((card, i) => {
            const isDragged = handDrag?.cardId === card.id && handDrag.active;
            // Compute the visual slot. While dragging, the dragged card visually
            // sits at handDrag.currentIndex; the other cards fill the remaining
            // slots in their relative order.
            let slot = i;
            if (handDrag && handDrag.active && handDrag.cardId !== card.id) {
              const otherIdx = i < handDrag.originalIndex ? i : i - 1;
              slot = otherIdx < handDrag.currentIndex ? otherIdx : otherIdx + 1;
            }
            const style = isDragged
              ? {
                  position: 'fixed',
                  left: `${handDrag.currentClientX - handDrag.offsetX}px`,
                  top: `${handDrag.currentClientY - handDrag.offsetY}px`,
                  width: `${HAND_CARD_W}px`,
                  height: `${HAND_CARD_H}px`,
                  zIndex: 1000,
                  pointerEvents: 'none',
                  margin: 0
                }
              : {
                  position: 'absolute',
                  left: `${slot * HAND_STEP}px`,
                  top: 0,
                  width: `${HAND_CARD_W}px`,
                  height: `${HAND_CARD_H}px`,
                  margin: 0
                };
            return (
              <div
                key={card.id}
                className={`hand-card ${isDragged ? 'hand-card-dragging' : ''}`}
                style={style}
                onPointerDown={(e) => startHandPointerDrag(e, card, i)}
                onDoubleClick={() => discardFromHand(card.id)}
                title="Drag to play or reorder · double-click to discard"
              >
                <img src={getCardImageUrl(card)} alt={createCardLabel(card)} draggable={false} />
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

export default App;
