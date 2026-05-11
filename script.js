import * as Y from 'https://esm.sh/yjs@13.7.0';
import { WebrtcProvider } from 'https://esm.sh/y-webrtc@10.0.8';

const playerNames = ['June', 'Jan', 'Dorothy'];
const seatMap = { June: 'seat-June', Jan: 'seat-Jan', Dorothy: 'seat-Dorothy' };
const sessionIdKey = 'shanghai-session-id';
const playerStorageKey = 'shanghai-player-name';

const doc = new Y.Doc();
const provider = new WebrtcProvider('shanghai-cardgame-room', doc, {
  signaling: ['wss://signaling.yjs.dev'],
});

const deck = doc.getArray('deck');
const discard = doc.getArray('discard');
const table = doc.getArray('table');
const hands = doc.getMap('hands');
const seats = doc.getMap('seats');
const meta = doc.getMap('meta');

const playerSelect = document.getElementById('player-select');
const playerButtons = document.querySelector('.player-buttons');
const statusLabel = document.getElementById('player-label');
const deckCount = document.getElementById('deck-count');
const discardCount = document.getElementById('discard-count');
const discardCardEl = document.getElementById('discard-card');
const tableCardsEl = document.getElementById('table-cards');
const handCardsEl = document.getElementById('hand-cards');
const deckZone = document.getElementById('deck-zone');
const tableZone = document.getElementById('table-zone');
const recallButton = document.getElementById('recall');
const dealButton = document.getElementById('deal');

const sessionId = sessionStorage.getItem(sessionIdKey) || crypto.randomUUID();
sessionStorage.setItem(sessionIdKey, sessionId);
let currentPlayer = sessionStorage.getItem(playerStorageKey);
let isReady = false;

function generateFullDeck() {
  const suits = ['♠', '♥', '♦', '♣'];
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const cards = [];

  for (let deckIndex = 0; deckIndex < 2; deckIndex += 1) {
    for (const suit of suits) {
      for (const rank of ranks) {
        cards.push({
          id: `${suit}${rank}-${deckIndex}`,
          rank,
          suit,
          type: 'normal',
        });
      }
    }
    cards.push({ id: `JOKER-${deckIndex}-1`, rank: 'Joker', suit: '', type: 'joker' });
    cards.push({ id: `JOKER-${deckIndex}-2`, rank: 'Joker', suit: '', type: 'joker' });
  }
  return cards;
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

function initGameState() {
  if (meta.get('initialized')) {
    return;
  }

  const cards = generateFullDeck();
  shuffleArray(cards);

  doc.transact(() => {
    deck.delete(0, deck.length);
    deck.insert(0, cards);
    discard.delete(0, discard.length);
    table.delete(0, table.length);
    for (const name of playerNames) {
      hands.set(name, []);
    }
    seats.clear();
    meta.set('initialized', true);
  });
}

function setCurrentPlayer(name) {
  if (!playerNames.includes(name)) return;
  const occupant = seats.get(name);
  if (occupant && occupant !== sessionId) {
    alert(`${name} is already sitting in that seat.`);
    return;
  }
  doc.transact(() => {
    seats.set(name, sessionId);
  });
  currentPlayer = name;
  sessionStorage.setItem(playerStorageKey, name);
  render();
  hidePlayerSelect();
}

function removeCurrentPlayerSeat() {
  if (!currentPlayer) return;
  const occupant = seats.get(currentPlayer);
  if (occupant === sessionId) {
    doc.transact(() => {
      seats.delete(currentPlayer);
    });
  }
  sessionStorage.removeItem(playerStorageKey);
  currentPlayer = null;
}

function getPlayerHand(name) {
  return hands.get(name) || [];
}

function setPlayerHand(name, cards) {
  hands.set(name, cards);
}

function drawCardForPlayer(name) {
  if (deck.length === 0) return;
  const card = deck.get(0);
  doc.transact(() => {
    deck.delete(0, 1);
    const hand = getPlayerHand(name);
    setPlayerHand(name, [...hand, card]);
  });
}

function playCard(cardId, player) {
  if (!player || player !== currentPlayer) return;
  const hand = getPlayerHand(player);
  const cardIndex = hand.findIndex((card) => card.id === cardId);
  if (cardIndex === -1) return;
  const [card] = hand.splice(cardIndex, 1);
  doc.transact(() => {
    setPlayerHand(player, hand);
    table.push([card]);
    discard.delete(0, discard.length);
    discard.insert(0, [card]);
  });
}

function dealCards() {
  if (deck.length < 33) {
    alert('Not enough cards in the deck. Use Recall / Shuffle first.');
    return;
  }
  doc.transact(() => {
    table.delete(0, table.length);
    discard.delete(0, discard.length);
    for (const name of playerNames) {
      setPlayerHand(name, []);
    }

    for (let round = 0; round < 11; round += 1) {
      for (const name of playerNames) {
        if (deck.length === 0) break;
        const card = deck.get(0);
        deck.delete(0, 1);
        const hand = getPlayerHand(name);
        setPlayerHand(name, [...hand, card]);
      }
    }
  });
}

function recallAndShuffle() {
  const allCards = [];
  allCards.push(...deck.toArray());
  allCards.push(...discard.toArray());
  allCards.push(...table.toArray());
  for (const name of playerNames) {
    allCards.push(...getPlayerHand(name));
  }
  shuffleArray(allCards);

  doc.transact(() => {
    deck.delete(0, deck.length);
    deck.insert(0, allCards);
    discard.delete(0, discard.length);
    table.delete(0, table.length);
    for (const name of playerNames) {
      setPlayerHand(name, []);
    }
  });
}

function renderDeck() {
  deckCount.textContent = deck.length.toString();
  discardCount.textContent = discard.length.toString();
  if (discard.length === 0) {
    discardCardEl.textContent = 'Empty';
    discardCardEl.className = 'discard-card';
  } else {
    const card = discard.get(0);
    discardCardEl.textContent = card.type === 'joker' ? 'Joker' : `${card.rank}${card.suit}`;
    discardCardEl.className = 'discard-card face-up';
  }
}

function createCardElement(card, options = {}) {
  const el = document.createElement('div');
  el.className = `card ${options.faceUp ? 'face-up' : 'face-down'}`;
  el.draggable = options.draggable ?? false;
  if (options.faceUp) {
    el.textContent = card.type === 'joker' ? 'Joker' : `${card.rank}${card.suit}`;
    if (options.draggable) {
      el.addEventListener('dragstart', (event) => {
        event.dataTransfer.setData('application/json', JSON.stringify({ type: 'play', cardId: card.id }));
      });
    }
  } else {
    el.textContent = 'Deck';
  }
  return el;
}

function renderSeats() {
  for (const name of playerNames) {
    const seatEl = document.getElementById(seatMap[name]);
    const occupant = seats.get(name);
    if (occupant) {
      seatEl.textContent = occupant === sessionId ? `${name} (You)` : `${name} occupied`;
      seatEl.classList.add('occupied');
    } else {
      seatEl.textContent = 'Empty';
      seatEl.classList.remove('occupied');
    }
  }
}

function renderTable() {
  tableCardsEl.innerHTML = '';
  const cards = table.toArray();
  if (cards.length === 0) {
    tableCardsEl.textContent = 'No cards on the table yet.';
    tableCardsEl.style.color = '#94a3b8';
    return;
  }
  tableCardsEl.style.color = '';
  for (const card of cards) {
    const cardEl = createCardElement(card, { faceUp: true });
    tableCardsEl.appendChild(cardEl);
  }
}

function renderHand() {
  handCardsEl.innerHTML = '';
  if (!currentPlayer) {
    handCardsEl.textContent = 'Choose a player to sit in a seat and join the game.';
    return;
  }
  const hand = getPlayerHand(currentPlayer);
  if (hand.length === 0) {
    handCardsEl.textContent = 'Your hand is empty. Draw from the deck or wait for a deal.';
    handCardsEl.style.color = '#94a3b8';
    return;
  }
  handCardsEl.style.color = '';
  for (const card of hand) {
    const cardEl = createCardElement(card, { faceUp: true, draggable: true });
    cardEl.addEventListener('dragend', () => {
      cardEl.classList.remove('dragging');
    });
    cardEl.addEventListener('dragstart', () => {
      cardEl.classList.add('dragging');
    });
    cardEl.addEventListener('click', () => {
      playCard(card.id, currentPlayer);
    });
    handCardsEl.appendChild(cardEl);
  }
}

function renderStatus() {
  if (currentPlayer) {
    statusLabel.textContent = `You are ${currentPlayer}.`;
  } else {
    statusLabel.textContent = 'Select a seat to join the game.';
  }
}

function render() {
  renderStatus();
  renderDeck();
  renderSeats();
  renderTable();
  renderHand();
}

function showPlayerSelect() {
  playerSelect.style.display = 'grid';
}

function hidePlayerSelect() {
  playerSelect.style.display = 'none';
}

function setupPlayerButtons() {
  playerButtons.innerHTML = '';
  for (const name of playerNames) {
    const button = document.createElement('button');
    button.textContent = name;
    button.addEventListener('click', () => setCurrentPlayer(name));
    playerButtons.appendChild(button);
  }
}

function validateCurrentSelection() {
  if (!currentPlayer) return;
  const occupant = seats.get(currentPlayer);
  if (occupant && occupant !== sessionId) {
    currentPlayer = null;
    sessionStorage.removeItem(playerStorageKey);
    showPlayerSelect();
  } else if (!occupant) {
    setCurrentPlayer(currentPlayer);
  }
}

function setupDragAndDrop() {
  deckZone.addEventListener('dragstart', (event) => {
    event.dataTransfer.setData('application/json', JSON.stringify({ type: 'draw' }));
  });
  deckZone.addEventListener('click', () => {
    if (!currentPlayer) return;
    drawCardForPlayer(currentPlayer);
  });

  handCardsEl.addEventListener('dragover', (event) => {
    event.preventDefault();
  });
  handCardsEl.addEventListener('drop', (event) => {
    event.preventDefault();
    if (!currentPlayer) return;
    const payload = JSON.parse(event.dataTransfer.getData('application/json'));
    if (payload.type === 'draw') {
      drawCardForPlayer(currentPlayer);
    }
  });

  tableZone.addEventListener('dragover', (event) => {
    event.preventDefault();
  });
  tableZone.addEventListener('drop', (event) => {
    event.preventDefault();
    if (!currentPlayer) return;
    const payload = JSON.parse(event.dataTransfer.getData('application/json'));
    if (payload.type === 'play') {
      playCard(payload.cardId, currentPlayer);
    }
  });
}

provider.on('status', ({ status }) => {
  if (status === 'connected') {
    isReady = true;
  }
});

function setupObservers() {
  deck.observe(render);
  discard.observe(render);
  table.observe(render);
  hands.observe(render);
  seats.observe(render);
  meta.observe(render);
}

function initialize() {
  setupPlayerButtons();
  setupDragAndDrop();
  setupObservers();
  recallButton.addEventListener('click', recallAndShuffle);
  dealButton.addEventListener('click', dealCards);

  provider.on('synced', () => {
    initGameState();
    validateCurrentSelection();
    render();
  });

  window.addEventListener('beforeunload', () => {
    if (currentPlayer) {
      removeCurrentPlayerSeat();
    }
  });

  if (!currentPlayer) {
    showPlayerSelect();
  }
  render();
}

initialize();
