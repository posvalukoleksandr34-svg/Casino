/**
 * The three Aurovane video slots: original themes, symbols and maths (no
 * third-party game, art or name). Reel strips and paytables are fixed data;
 * their exact RTP, free-spin frequency and maximum win are derived by
 * `analyseMachine` and pinned by tests (docs/math/slots.md).
 */
import type { SlotConfig } from './engine';

/** Lantern Hollow: RTP 96.449%, free spins about 1 in 159 spins, largest win 5,533.25×. */
export const LANTERN_HOLLOW: SlotConfig = {
  symbols: [
    { id: 'lantern', name: 'Lantern', kind: 'wild', pays: [0, 0, 0] },
    { id: 'moon', name: 'Full moon', kind: 'scatter', pays: [0, 0, 0] },
    { id: 'owl', name: 'Owl', kind: 'high', pays: [48, 191, 956] },
    { id: 'raven', name: 'Raven', kind: 'high', pays: [38, 115, 478] },
    { id: 'spellbook', name: 'Spellbook', kind: 'high', pays: [29, 77, 287] },
    { id: 'candle', name: 'Candle', kind: 'high', pays: [19, 57, 191] },
    { id: 'ace', name: 'A', kind: 'low', pays: [10, 24, 77] },
    { id: 'king', name: 'K', kind: 'low', pays: [10, 24, 77] },
    { id: 'queen', name: 'Q', kind: 'low', pays: [5, 19, 57] },
    { id: 'jack', name: 'J', kind: 'low', pays: [5, 19, 57] },
    { id: 'ten', name: '10', kind: 'low', pays: [5, 14, 48] },
  ],
  // prettier-ignore
  reels: [
    ['jack', 'jack', 'raven', 'owl', 'spellbook', 'ace', 'ace', 'queen', 'queen', 'ten', 'ten', 'king', 'king', 'jack', 'jack', 'candle', 'raven', 'queen', 'queen', 'candle', 'spellbook', 'ace', 'ace', 'ten', 'ten', 'owl', 'king', 'king', 'jack', 'jack', 'raven', 'queen', 'queen', 'candle', 'spellbook', 'ace', 'ace', 'ten', 'ten', 'candle', 'moon', 'king', 'king'],
    ['raven', 'owl', 'spellbook', 'queen', 'queen', 'ace', 'ace', 'jack', 'jack', 'ten', 'ten', 'king', 'king', 'jack', 'jack', 'candle', 'raven', 'queen', 'queen', 'spellbook', 'lantern', 'ace', 'ace', 'ten', 'ten', 'owl', 'king', 'king', 'jack', 'jack', 'candle', 'raven', 'queen', 'queen', 'spellbook', 'candle', 'ace', 'ace', 'ten', 'ten', 'candle', 'moon', 'lantern', 'king', 'king'],
    ['raven', 'owl', 'spellbook', 'queen', 'queen', 'ace', 'ace', 'jack', 'jack', 'ten', 'ten', 'king', 'king', 'jack', 'jack', 'candle', 'raven', 'queen', 'queen', 'spellbook', 'lantern', 'ace', 'ace', 'ten', 'ten', 'owl', 'king', 'king', 'jack', 'jack', 'candle', 'raven', 'queen', 'queen', 'spellbook', 'candle', 'ace', 'ace', 'ten', 'ten', 'candle', 'moon', 'lantern', 'king', 'king'],
    ['raven', 'owl', 'spellbook', 'queen', 'queen', 'ace', 'ace', 'jack', 'jack', 'ten', 'ten', 'king', 'king', 'jack', 'jack', 'candle', 'raven', 'queen', 'queen', 'spellbook', 'lantern', 'ace', 'ace', 'ten', 'ten', 'owl', 'king', 'king', 'jack', 'jack', 'candle', 'raven', 'queen', 'queen', 'spellbook', 'candle', 'ace', 'ace', 'ten', 'ten', 'candle', 'moon', 'lantern', 'king', 'king'],
    ['raven', 'owl', 'spellbook', 'queen', 'queen', 'ace', 'ace', 'jack', 'jack', 'ten', 'ten', 'king', 'king', 'jack', 'jack', 'candle', 'raven', 'queen', 'queen', 'spellbook', 'lantern', 'ace', 'ace', 'ten', 'ten', 'owl', 'king', 'king', 'jack', 'jack', 'candle', 'raven', 'queen', 'queen', 'spellbook', 'candle', 'ace', 'ace', 'ten', 'ten', 'candle', 'moon', 'lantern', 'king', 'king'],
  ],
  freeSpins: { awards: [8, 10, 15], multiplier: 2 },
};

/** Ember Fruits: RTP 96.184%, free spins about 1 in 180 spins, largest win 5,863.44×. */
export const EMBER_FRUITS: SlotConfig = {
  symbols: [
    { id: 'blaze', name: 'Blaze', kind: 'wild', pays: [0, 0, 0] },
    { id: 'star', name: 'Star', kind: 'scatter', pays: [0, 0, 0] },
    { id: 'seven', name: 'Seven', kind: 'high', pays: [50, 198, 992] },
    { id: 'bell', name: 'Bell', kind: 'high', pays: [40, 119, 496] },
    { id: 'melon', name: 'Melon', kind: 'high', pays: [30, 79, 297] },
    { id: 'grapes', name: 'Grapes', kind: 'high', pays: [20, 59, 198] },
    { id: 'plum', name: 'Plum', kind: 'low', pays: [10, 25, 79] },
    { id: 'orange', name: 'Orange', kind: 'low', pays: [10, 25, 79] },
    { id: 'lemon', name: 'Lemon', kind: 'low', pays: [5, 20, 59] },
    { id: 'cherry', name: 'Cherry', kind: 'low', pays: [5, 20, 59] },
    { id: 'lime', name: 'Lime', kind: 'low', pays: [5, 15, 50] },
  ],
  // prettier-ignore
  reels: [
    ['seven', 'lemon', 'lemon', 'lime', 'lime', 'orange', 'orange', 'cherry', 'cherry', 'melon', 'grapes', 'bell', 'plum', 'plum', 'lime', 'lime', 'seven', 'lemon', 'lemon', 'melon', 'orange', 'orange', 'cherry', 'cherry', 'grapes', 'grapes', 'bell', 'plum', 'plum', 'lime', 'lime', 'seven', 'lemon', 'lemon', 'melon', 'orange', 'orange', 'cherry', 'cherry', 'grapes', 'melon', 'star', 'bell', 'plum', 'plum'],
    ['lemon', 'lemon', 'lime', 'lime', 'orange', 'orange', 'cherry', 'cherry', 'melon', 'grapes', 'bell', 'blaze', 'plum', 'plum', 'seven', 'lemon', 'lemon', 'lime', 'lime', 'orange', 'orange', 'cherry', 'cherry', 'melon', 'grapes', 'grapes', 'bell', 'plum', 'plum', 'lime', 'lime', 'seven', 'lemon', 'lemon', 'melon', 'blaze', 'orange', 'orange', 'cherry', 'cherry', 'grapes', 'melon', 'star', 'bell', 'plum', 'plum', 'seven'],
    ['lemon', 'lemon', 'lime', 'lime', 'orange', 'orange', 'cherry', 'cherry', 'melon', 'grapes', 'bell', 'blaze', 'plum', 'plum', 'seven', 'lemon', 'lemon', 'lime', 'lime', 'orange', 'orange', 'cherry', 'cherry', 'melon', 'grapes', 'grapes', 'bell', 'plum', 'plum', 'lime', 'lime', 'seven', 'lemon', 'lemon', 'melon', 'blaze', 'orange', 'orange', 'cherry', 'cherry', 'grapes', 'melon', 'star', 'bell', 'plum', 'plum', 'seven'],
    ['lemon', 'lemon', 'lime', 'lime', 'orange', 'orange', 'cherry', 'cherry', 'melon', 'grapes', 'bell', 'blaze', 'plum', 'plum', 'seven', 'lemon', 'lemon', 'lime', 'lime', 'orange', 'orange', 'cherry', 'cherry', 'melon', 'grapes', 'grapes', 'bell', 'plum', 'plum', 'lime', 'lime', 'seven', 'lemon', 'lemon', 'melon', 'blaze', 'orange', 'orange', 'cherry', 'cherry', 'grapes', 'melon', 'star', 'bell', 'plum', 'plum', 'seven'],
    ['lemon', 'lemon', 'lime', 'lime', 'orange', 'orange', 'cherry', 'cherry', 'melon', 'grapes', 'bell', 'blaze', 'plum', 'plum', 'seven', 'lemon', 'lemon', 'lime', 'lime', 'orange', 'orange', 'cherry', 'cherry', 'melon', 'grapes', 'grapes', 'bell', 'plum', 'plum', 'lime', 'lime', 'seven', 'lemon', 'lemon', 'melon', 'blaze', 'orange', 'orange', 'cherry', 'cherry', 'grapes', 'melon', 'star', 'bell', 'plum', 'plum', 'seven'],
  ],
  freeSpins: { awards: [6, 8, 10], multiplier: 2 },
};

/** Sands of Aurum: RTP 96.137%, free spins about 1 in 140 spins, largest win 4,813.52×. */
export const SANDS_OF_AURUM: SlotConfig = {
  symbols: [
    { id: 'sun', name: 'Sun disc', kind: 'wild', pays: [0, 0, 0] },
    { id: 'pyramid', name: 'Pyramid', kind: 'scatter', pays: [0, 0, 0] },
    { id: 'mask', name: 'Gold mask', kind: 'high', pays: [43, 170, 852] },
    { id: 'scarab', name: 'Scarab', kind: 'high', pays: [34, 102, 426] },
    { id: 'ankh', name: 'Ankh', kind: 'high', pays: [26, 68, 256] },
    { id: 'lotus', name: 'Lotus', kind: 'high', pays: [17, 51, 170] },
    { id: 'ace', name: 'A', kind: 'low', pays: [9, 21, 68] },
    { id: 'king', name: 'K', kind: 'low', pays: [9, 21, 68] },
    { id: 'queen', name: 'Q', kind: 'low', pays: [4, 17, 51] },
    { id: 'jack', name: 'J', kind: 'low', pays: [4, 17, 51] },
    { id: 'ten', name: '10', kind: 'low', pays: [4, 13, 43] },
  ],
  // prettier-ignore
  reels: [
    ['king', 'king', 'jack', 'jack', 'lotus', 'queen', 'queen', 'ace', 'ace', 'mask', 'ten', 'ten', 'ankh', 'pyramid', 'king', 'king', 'lotus', 'scarab', 'queen', 'queen', 'ace', 'ace', 'jack', 'jack', 'ten', 'ten', 'ankh', 'king', 'king', 'mask', 'lotus', 'queen', 'queen', 'jack', 'jack', 'ace', 'ace', 'ten', 'ten', 'scarab', 'ankh'],
    ['jack', 'jack', 'lotus', 'sun', 'queen', 'queen', 'ace', 'ace', 'mask', 'ten', 'ten', 'pyramid', 'ankh', 'king', 'king', 'lotus', 'scarab', 'queen', 'queen', 'ace', 'ace', 'jack', 'jack', 'ten', 'ten', 'sun', 'ankh', 'king', 'king', 'mask', 'lotus', 'queen', 'queen', 'jack', 'jack', 'ace', 'ace', 'ten', 'ten', 'scarab', 'ankh', 'king', 'king'],
    ['jack', 'jack', 'lotus', 'sun', 'queen', 'queen', 'ace', 'ace', 'mask', 'ten', 'ten', 'pyramid', 'ankh', 'king', 'king', 'lotus', 'scarab', 'queen', 'queen', 'ace', 'ace', 'jack', 'jack', 'ten', 'ten', 'sun', 'ankh', 'king', 'king', 'mask', 'lotus', 'queen', 'queen', 'jack', 'jack', 'ace', 'ace', 'ten', 'ten', 'scarab', 'ankh', 'king', 'king'],
    ['jack', 'jack', 'lotus', 'sun', 'queen', 'queen', 'ace', 'ace', 'mask', 'ten', 'ten', 'pyramid', 'ankh', 'king', 'king', 'lotus', 'scarab', 'queen', 'queen', 'ace', 'ace', 'jack', 'jack', 'ten', 'ten', 'sun', 'ankh', 'king', 'king', 'mask', 'lotus', 'queen', 'queen', 'jack', 'jack', 'ace', 'ace', 'ten', 'ten', 'scarab', 'ankh', 'king', 'king'],
    ['jack', 'jack', 'lotus', 'sun', 'queen', 'queen', 'ace', 'ace', 'mask', 'ten', 'ten', 'pyramid', 'ankh', 'king', 'king', 'lotus', 'scarab', 'queen', 'queen', 'ace', 'ace', 'jack', 'jack', 'ten', 'ten', 'sun', 'ankh', 'king', 'king', 'mask', 'lotus', 'queen', 'queen', 'jack', 'jack', 'ace', 'ace', 'ten', 'ten', 'scarab', 'ankh', 'king', 'king'],
  ],
  freeSpins: { awards: [10, 12, 15], multiplier: 2 },
};
