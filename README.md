# Shanghai

A browser-based multiplayer card game using two 54-card decks. Players can sit as June, Jan, or Dorothy, draw from the deck, play cards to the table, and watch all moves update live across connected browsers.

## Features

- Multiplayer sync using Yjs + WebRTC
- Deck of 108 cards (two full decks with jokers)
- Three seats: June (left), Jan (top), Dorothy (right)
- Drag cards from the deck into your hand
- Drag cards from your hand to the table
- Recall / Shuffle and Deal buttons

## Deploy

This repository includes a GitHub Actions workflow to publish the site on GitHub Pages from the `main` branch.

## Usage

1. Open `index.html` in the browser, or visit the Pages site once deployed.
2. Choose a player seat.
3. Draw cards from the deck or press `Deal 11 cards`.
4. Play cards to the table by dragging them.
