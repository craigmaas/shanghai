import { useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';

const playerNames = ['June', 'Jan', 'Dorothy'];
const sessionIdKey = 'shanghai-session-id';
const playerStorageKey = 'shanghai-player-name';

function generateFullDeck() {
  const suits = ['♠', '♥', '♦', '♣'];
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const cards = [];

  for (let deckIndex = 0; deckIndex < 2; deckIndex += 1) {
    for (const suit of suits) {
      for (const rank of ranks) {
        cards.push({
          id: `${suit}${rank}-${deckIndex}`,
          suit,
          rank,
          type: 'normal'
        });
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

function App() {
  const sessionId = useMemo(() => {
    const existing = sessionStorage.getItem(sessionIdKey);
    const id = existing || crypto.randomUUID();
    sessionStorage.setItem(sessionIdKey, id);
    return id;
  }, []);

  const [currentPlayer, setCurrentPlayer] = useState(() => sessionStorage.getItem(playerStorageKey) ?? '');
  const [statusMessage, setStatusMessage] = useState('Connecting…');
  const [renderCounter, setRenderCounter] = useState(0);
  const docRef = useRef(new Y.Doc());
  const providerRef = useRef(null);

  const deck = useMemo(() => docRef.current.getArray('deck'), []);
  const discard = useMemo(() => docRef.current.getArray('discard'), []);
  const table = useMemo(() => docRef.current.getArray('table'), []);
  const hands = useMemo(() => docRef.current.getMap('hands'), []);
  const seats = useMemo(() => docRef.current.getMap('seats'), []);
  const meta = useMemo(() => docRef.current.getMap('meta'), []);

  const isSelected = Boolean(currentPlayer);
  const currentHand = currentPlayer ? hands.get(currentPlayer) ?? [] : [];
  const deckCount = deck.length;
  const discardTop = discard.length ? discard.get(0) : null;
  const tableCards = table.toArray();

  const seatStates = playerNames.map((name) => ({
    name,
    occupant: seats.get(name)
  }));

  const refresh = () => setRenderCounter((value) => value + 1);

  const initGameState = () => {
    if (meta.get('initialized')) return;
    const cards = shuffle(generateFullDeck());
    docRef.current.transact(() => {
      deck.delete(0, deck.length);
      deck.insert(0, cards);
      discard.delete(0, discard.length);
      table.delete(0, table.length);
      playerNames.forEach((name) => hands.set(name, []));
      seats.clear();
      meta.set('initialized', true);
    });
  };

  const setPlayerSeat = (name) => {
    const occupant = seats.get(name);
    if (occupant && occupant !== sessionId) {
      window.alert(`${name} is already taken.`);
      return;
    }
    docRef.current.transact(() => {
      seats.set(name, sessionId);
    });
    sessionStorage.setItem(playerStorageKey, name);
    setCurrentPlayer(name);
    refresh();
  };

  const removePlayerSeat = (name) => {
    if (!name) return;
    if (seats.get(name) !== sessionId) return;
    docRef.current.transact(() => {
      seats.delete(name);
    });
    sessionStorage.removeItem(playerStorageKey);
    setCurrentPlayer('');
  };

  const getPlayerHand = (name) => hands.get(name) ?? [];
  const setPlayerHand = (name, cards) => hands.set(name, cards);

  const drawCard = (name) => {
    if (!name || deck.length === 0) return;
    const card = deck.get(0);
    docRef.current.transact(() => {
      deck.delete(0, 1);
      setPlayerHand(name, [...getPlayerHand(name), card]);
    });
  };

  const playCard = (cardId, player) => {
    if (!player || player !== currentPlayer) return;
    const hand = getPlayerHand(player);
    const index = hand.findIndex((card) => card.id === cardId);
    if (index < 0) return;
    const [card] = hand.splice(index, 1);
    docRef.current.transact(() => {
      setPlayerHand(player, [...hand]);
      table.push([card]);
      discard.delete(0, discard.length);
      discard.insert(0, [card]);
    });
  };

  const recallAndShuffle = () => {
    const allCards = [];
    allCards.push(...deck.toArray());
    allCards.push(...discard.toArray());
    allCards.push(...table.toArray());
    playerNames.forEach((name) => allCards.push(...getPlayerHand(name)));
    shuffle(allCards);

    docRef.current.transact(() => {
      deck.delete(0, deck.length);
      deck.insert(0, allCards);
      discard.delete(0, discard.length);
      table.delete(0, table.length);
      playerNames.forEach((name) => setPlayerHand(name, []));
    });
  };

  const dealCards = () => {
    if (deck.length < 33) {
      window.alert('Not enough cards in the deck. Recall and shuffle first.');
      return;
    }
    docRef.current.transact(() => {
      table.delete(0, table.length);
      discard.delete(0, discard.length);
      playerNames.forEach((name) => setPlayerHand(name, []));
      for (let round = 0; round < 11; round += 1) {
        playerNames.forEach((name) => {
          if (deck.length === 0) return;
          const card = deck.get(0);
          deck.delete(0, 1);
          setPlayerHand(name, [...getPlayerHand(name), card]);
        });
      }
    });
  };

  const validateSelection = () => {
    if (!currentPlayer) return;
    const occupant = seats.get(currentPlayer);
    if (occupant && occupant !== sessionId) {
      sessionStorage.removeItem(playerStorageKey);
      setCurrentPlayer('');
      return;
    }
    if (!occupant) {
      setPlayerSeat(currentPlayer);
    }
  };

  useEffect(() => {
    const provider = new WebrtcProvider('shanghai-cardgame-room', docRef.current, {
      signaling: ['wss://signaling.yjs.dev']
    });
    providerRef.current = provider;

    const observer = () => refresh();
    deck.observe(observer);
    discard.observe(observer);
    table.observe(observer);
    hands.observe(observer);
    seats.observe(observer);
    meta.observe(observer);

    provider.on('status', ({ status }) => {
      setStatusMessage(status === 'connected' ? 'Connected' : 'Offline');
    });

    provider.on('synced', () => {
      initGameState();
      validateSelection();
      refresh();
    });

    const cleanup = () => {
      if (currentPlayer) removePlayerSeat(currentPlayer);
      provider.destroy();
      docRef.current.destroy();
    };

    window.addEventListener('beforeunload', cleanup);
    return () => {
      window.removeEventListener('beforeunload', cleanup);
      cleanup();
    };
  }, []);

  useEffect(() => {
    if (!currentPlayer) return;
    sessionStorage.setItem(playerStorageKey, currentPlayer);
  }, [currentPlayer]);

  return (
    <div className="app-shell">
      <div className={`player-modal ${isSelected ? 'hidden' : ''}`}>
        <div className="player-modal-card">
          <h1>Choose your player</h1>
          <p>Select June, Jan or Dorothy to take a seat.</p>
          <div className="player-grid">
            {playerNames.map((name) => (
              <button key={name} type="button" onClick={() => setPlayerSeat(name)}>
                {name}
              </button>
            ))}
          </div>
          <p className="modal-note">Sit down and join the shared table instantly.</p>
        </div>
      </div>

      <header className="top-bar">
        <div>
          <div className="room-name">Shanghai Card Room</div>
          <div className="status-text">{statusMessage}</div>
        </div>
        <div className="player-chip">
          {currentPlayer ? `You are ${currentPlayer}` : 'No player selected'}
        </div>
      </header>

      <main className="board-grid">
        <section className="seat-card left-seat">
          <div className="seat-title">June</div>
          <div className="seat-body">{seatStates[0].occupant ? (seatStates[0].occupant === sessionId ? 'You are here' : 'Occupied') : 'Empty'}</div>
        </section>

        <section className="seat-card top-seat">
          <div className="seat-title">Jan</div>
          <div className="seat-body">{seatStates[1].occupant ? (seatStates[1].occupant === sessionId ? 'You are here' : 'Occupied') : 'Empty'}</div>
        </section>

        <section className="seat-card right-seat">
          <div className="seat-title">Dorothy</div>
          <div className="seat-body">{seatStates[2].occupant ? (seatStates[2].occupant === sessionId ? 'You are here' : 'Occupied') : 'Empty'}</div>
        </section>

        <section className="table-panel">
          <div className="panel-header">
            <div className="panel-title">Table</div>
            <div className="panel-actions">
              <button type="button" onClick={recallAndShuffle}>Recall / Shuffle</button>
              <button type="button" onClick={dealCards}>Deal 11 cards</button>
            </div>
          </div>

          <div className="layout-grid">
            <div className="stack-card deck-stack" onClick={() => currentPlayer && drawCard(currentPlayer)}>
              <div className="stack-title">Deck</div>
              <div className="stack-count">{deckCount}</div>
              <div className="stack-label">Click to draw</div>
            </div>

            <div className="stack-card discard-stack">
              <div className="stack-title">Discard</div>
              <div className="discard-preview">{discardTop ? createCardLabel(discardTop) : 'Empty'}</div>
              <div className="stack-count">{discard.length}</div>
            </div>
          </div>

          <div className="table-area" onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
            event.preventDefault();
            if (!currentPlayer) return;
            const payload = JSON.parse(event.dataTransfer.getData('application/json'));
            if (payload?.type === 'play') playCard(payload.cardId, currentPlayer);
          }}>
            {tableCards.length === 0 ? (
              <div className="empty-table">Drag cards here to play them face up.</div>
            ) : (
              tableCards.map((card) => (
                <div key={card.id} className="card tile-card">{createCardLabel(card)}</div>
              ))
            )}
          </div>
        </section>
      </main>

      <section className="hand-panel">
        <div className="hand-header">
          <div className="hand-title">Your Hand</div>
          <div className="hand-help">Drag cards onto the table or click to play.</div>
        </div>
        <div className="hand-grid">
          {currentPlayer ? currentHand.map((card) => (
            <button key={card.id} type="button" className="card hand-card" draggable onDragStart={(event) => {
              event.dataTransfer.setData('application/json', JSON.stringify({ type: 'play', cardId: card.id }));
            }} onClick={() => playCard(card.id, currentPlayer)}>
              {createCardLabel(card)}
            </button>
          )) : <div className="empty-hand">Select a player to see your hand.</div>}
        </div>
      </section>
    </div>
  );
}

export default App;
