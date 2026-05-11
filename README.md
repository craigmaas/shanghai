# Shanghai

A React-based browser multiplayer card game using two full 54-card decks. Players sit as June, Jan, or Dorothy, draw from the deck, play cards to the table, and watch all moves update live across connected browsers.

## Features

- Built with React and Vite
- Multiplayer sync using Yjs + WebRTC
- Deck of 108 cards (two decks with jokers)
- Three seats: June (left), Jan (top), Dorothy (right)

<!-- Trigger build -->
- Click or drag cards to draw and play
- Recall / Shuffle and Deal buttons

## Run locally

1. Install dependencies: `npm install`
2. Start the dev server: `npm run dev`

## Deploy

This repository includes a GitHub Actions workflow to publish the Vite app on GitHub Pages from the `main` branch.

## Usage

1. Open the site in a browser.
2. Choose a player seat.
3. Draw cards from the deck or press `Deal 11 cards`.
4. Play cards to the table by clicking or dragging.
