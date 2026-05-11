import { useEffect, useMemo, useRef, useState } from 'react';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, onValue, set, update, onDisconnect, off } from 'firebase/database';

const playerNames = ['June', 'Jan', 'Dorothy'];
const sessionIdKey = 'shanghai-session-id';
const playerStorageKey = 'shanghai-player-name';

// Firebase configuration - REPLACE WITH YOUR OWN FIREBASE CONFIG
const firebaseConfig = {
  apiKey: "your-api-key",
  authDomain: "your-project.firebaseapp.com",
  databaseURL: "https://your-project-default-rtdb.firebaseio.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "your-app-id"
};

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
  const firebaseRef = useRef(null);
  const gameStateRef = useRef({
    deck: [],
    discard: [],
    table: [],
    hands: { June: [], Jan: [], Dorothy: [] },
    seats: {},
    meta: { initialized: false }
  });

  const refresh = () => setRenderCounter((value) => value + 1);

  const isSelected = Boolean(currentPlayer);
  const currentHand = currentPlayer ? gameStateRef.current.hands[currentPlayer] || [] : [];
  const deckCount = gameStateRef.current.deck.length;
  const discardTop = gameStateRef.current.discard.length ? gameStateRef.current.discard[0] : null;
  const tableCards = gameStateRef.current.table;

  const seatStates = playerNames.map((name) => ({
    name,
    occupant: gameStateRef.current.seats[name]
  }));

  const updateGameState = (updates) => {
    const newState = { ...gameStateRef.current, ...updates };
    gameStateRef.current = newState;
    if (firebaseRef.current) {
      update(firebaseRef.current, newState);
    }
    refresh();
  };

  const initGameState = () => {
    if (gameStateRef.current.meta.initialized) return;
    const cards = shuffle(generateFullDeck());
    updateGameState({
      deck: cards,
      discard: [],
      table: [],
      hands: { June: [], Jan: [], Dorothy: [] },
      seats: {},
      meta: { initialized: true }
    });
  };

  const setPlayerSeat = (name) => {
    const occupant = gameStateRef.current.seats[name];
    if (occupant && occupant !== sessionId) {
      window.alert(`${name} is already taken.`);
      return;
    }
    const newSeats = { ...gameStateRef.current.seats, [name]: sessionId };
    updateGameState({ seats: newSeats });
    sessionStorage.setItem(playerStorageKey, name);
    setCurrentPlayer(name);
  };

  const removePlayerSeat = (name) => {
    if (!name) return;
    if (gameStateRef.current.seats[name] !== sessionId) return;
    const newSeats = { ...gameStateRef.current.seats };
    delete newSeats[name];
    updateGameState({ seats: newSeats });
    sessionStorage.removeItem(playerStorageKey);
    setCurrentPlayer('');
  };

  const drawCard = (name) => {
    if (!name || gameStateRef.current.deck.length === 0) return;
    const card = gameStateRef.current.deck[0];
    const newDeck = gameStateRef.current.deck.slice(1);
    const newHands = {
      ...gameStateRef.current.hands,
      [name]: [...gameStateRef.current.hands[name], card]
    };
    updateGameState({ deck: newDeck, hands: newHands });
  };

  const playCard = (cardId, player) => {
    if (!player || player !== currentPlayer) return;
    const hand = gameStateRef.current.hands[player] || [];
    const index = hand.findIndex((card) => card.id === cardId);
    if (index < 0) return;
    const [card] = hand.splice(index, 1);
    const newHands = { ...gameStateRef.current.hands, [player]: [...hand] };
    const newTable = [...gameStateRef.current.table, card];
    const newDiscard = [card];
    updateGameState({
      hands: newHands,
      table: newTable,
      discard: newDiscard
    });
  };

  const recallAndShuffle = () => {
    const allCards = [];
    allCards.push(...gameStateRef.current.deck);
    allCards.push(...gameStateRef.current.discard);
    allCards.push(...gameStateRef.current.table);
    playerNames.forEach((name) => allCards.push(...gameStateRef.current.hands[name]));
    shuffle(allCards);

    updateGameState({
      deck: allCards,
      discard: [],
      table: [],
      hands: { June: [], Jan: [], Dorothy: [] }
    });
  };

  const dealCards = () => {
    if (gameStateRef.current.deck.length < 33) {
      window.alert('Not enough cards in the deck. Recall and shuffle first.');
      return;
    }
    let newDeck = [...gameStateRef.current.deck];
    const newHands = { June: [], Jan: [], Dorothy: [] };
    const newTable = [];
    const newDiscard = [];

    for (let round = 0; round < 11; round += 1) {
      playerNames.forEach((name) => {
        if (newDeck.length === 0) return;
        const card = newDeck.shift();
        newHands[name].push(card);
      });
    }

    updateGameState({
      deck: newDeck,
      hands: newHands,
      table: newTable,
      discard: newDiscard
    });
  };

  const validateSelection = () => {
    if (!currentPlayer) return;
    const occupant = gameStateRef.current.seats[currentPlayer];
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
    // Initialize Firebase
    const app = initializeApp(firebaseConfig);
    const database = getDatabase(app);
    firebaseRef.current = ref(database, 'shanghai-game');

    // Listen for game state changes
    const unsubscribe = onValue(firebaseRef.current, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        gameStateRef.current = data;
        refresh();
      }
    });

    // Set up disconnect cleanup
    const connectedRef = ref(database, '.info/connected');
    onValue(connectedRef, (snap) => {
      if (snap.val() === true) {
        setStatusMessage('Connected');
        // Remove our seat when we disconnect
        onDisconnect(ref(database, `shanghai-game/seats/${currentPlayer}`)).set(null);
      } else {
        setStatusMessage('Offline');
      }
    });

    // Initialize game state if it doesn't exist
    set(firebaseRef.current, gameStateRef.current);

    // Validate current player selection
    validateSelection();

    const cleanup = () => {
      if (currentPlayer) {
        const newSeats = { ...gameStateRef.current.seats };
        delete newSeats[currentPlayer];
        update(firebaseRef.current, { seats: newSeats });
      }
      unsubscribe();
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
