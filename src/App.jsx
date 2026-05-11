import { useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';

const playerNames = ['June', 'Jan', 'Dorothy'];
const sessionIdKey = 'shanghai-session-id';
const playerStorageKey = 'shanghai-player-name';

const suitCodes = {
  '♠': 'S',
  '♥': 'H',
  '♦': 'D',
  '♣': 'C'
};

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

function getCardImageUrl(card) {
  if (card.type === 'joker') {
    return 'https://upload.wikimedia.org/wikipedia/commons/6/6d/Joker_black.svg';
  }

  const rankCode = card.rank === '10' ? '0' : card.rank;
  const suitCode = suitCodes[card.suit];
  return `https://deckofcardsapi.com/static/img/${rankCode}${suitCode}.png`;
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

  const normalizeHand = (value) => {
    if (value instanceof Y.Array) {
      return value.toArray();
    }
    return Array.isArray(value) ? value : [];
  };

  const getPlayerHand = (name) => {
    const hands = docRef.current.getMap('hands');
    return normalizeHand(hands.get(name));
  };

  const setPlayerHand = (name, cards) => {
    const hands = docRef.current.getMap('hands');
    const hand = new Y.Array();
    hand.insert(0, cards);
    hands.set(name, hand);
  };

    const deck = useMemo(() => docRef.current.getArray('deck'), []);
  const discard = useMemo(() => docRef.current.getArray('discard'), []);
  const table = useMemo(() => docRef.current.getArray('table'), []);
  const hands = useMemo(() => docRef.current.getMap('hands'), []);
  const seats = useMemo(() => docRef.current.getMap('seats'), []);
  const meta = useMemo(() => docRef.current.getMap('meta'), []);

  const isSelected = Boolean(currentPlayer);
  const currentHand = currentPlayer ? getPlayerHand(currentPlayer) : [];
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
      playerNames.forEach((name) => setPlayerHand(name, []));
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

    const initializeState = () => {
      if (!meta.get('initialized')) {
        initGameState();
      }
      validateSelection();
      refresh();
    };

    initializeState();

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
          <h1>Choose a seat</h1>
          <p>Tap an open seat to join as June, Jan, or Dorothy.</p>
          <div className="player-grid">
            {seatStates.map(({ name, occupant }) => {
              const isMine = occupant === sessionId;
              const isTaken = occupant && occupant !== sessionId;
              return (
                <button
                  key={name}
                  type="button"
                  className={isTaken ? 'disabled-seat' : ''}
                  onClick={() => !isTaken && setPlayerSeat(name)}
                  disabled={isTaken}
                >
                  <span>{name}</span>
                  <small>{isMine ? 'Your seat' : isTaken ? 'Taken' : 'Available'}</small>
                </button>
              );
            })}
          </div>
          <p className="modal-note">The first browser to claim a seat gets control for that player.</p>
        </div>
      </div>

      <header className="top-bar">
        <div>
          <div className="room-name">Shanghai Card Room</div>
          <div className="status-text">{statusMessage}</div>
          <div className="player-list">
            <span className="player-list-label">Connected:</span>
            {seatStates.filter(({ occupant }) => occupant).map(({ name, occupant }) => (
              <span
                key={name}
                className={`player-badge ${occupant === sessionId ? 'current-player-badge' : ''}`}
              >
                {name}{occupant === sessionId ? ' (You)' : ''}
              </span>
            ))}
            {seatStates.every(({ occupant }) => !occupant) && (
              <span className="player-badge empty-player-badge">None</span>
            )}
          </div>
        </div>
        <div className="player-chip">
          {currentPlayer ? (
            <div className="player-chip-row">
              <span>{`You are ${currentPlayer}`}</span>
              <button type="button" className="leave-seat" onClick={() => removePlayerSeat(currentPlayer)}>
                Leave
              </button>
            </div>
          ) : 'No player selected'}
        </div>
      </header>

      <main className="board-grid">
        {seatStates.map(({ name, occupant }, index) => {
          const isMine = occupant === sessionId;
          const isTaken = occupant && !isMine;
          return (
            <section
              key={name}
              className={`seat-card ${isMine ? 'current-seat' : isTaken ? 'occupied-seat' : 'open-seat'}`}
            >
              <div className="seat-title">{name}</div>
              <div className="seat-body">
                {isMine ? 'You are here' : isTaken ? 'Occupied' : 'Empty'}
              </div>
              <div className="seat-actions">
                {!isTaken ? (
                  isMine ? (
                    <button type="button" onClick={() => removePlayerSeat(name)}>Leave</button>
                  ) : (
                    <button type="button" onClick={() => setPlayerSeat(name)}>Sit here</button>
                  )
                ) : (
                  <div className="seat-label-small">Locked</div>
                )}
              </div>
            </section>
          );
        })}

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
              <div className="discard-preview">
                {discardTop ? (
                  <img className="card-image-sm" src={getCardImageUrl(discardTop)} alt={createCardLabel(discardTop)} />
                ) : 'Empty'}
              </div>
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
                <div key={card.id} className="card tile-card">
                  <img className="card-image" src={getCardImageUrl(card)} alt={createCardLabel(card)} />
                </div>
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
              <img className="card-image" src={getCardImageUrl(card)} alt={createCardLabel(card)} />
            </button>
          )) : <div className="empty-hand">Select a player to see your hand.</div>}
        </div>
      </section>
    </div>
  );
}

export default App;
