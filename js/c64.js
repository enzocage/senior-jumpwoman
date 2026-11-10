/**
 * SENIOR JUMPWOMAN — C64 VIC-II Graphics Engine, Palette, Font & Sprites
 * Native Playfield: 320x200 inside 384x272 C64 Overscan Border (32px X, 36px Y)
 */
(function (global) {
  'use strict';

  // Exact Pepto / Colodore VIC-II 16-Color Palette
  const PALETTE_HEX = [
    '#000000', // 0: Black
    '#FFFFFF', // 1: White
    '#813338', // 2: Red
    '#75CEC8', // 3: Cyan
    '#8E3C97', // 4: Purple
    '#56AC4D', // 5: Green
    '#2E2C9B', // 6: Blue
    '#EDF171', // 7: Yellow
    '#8E5029', // 8: Orange
    '#553800', // 9: Brown
    '#C46C71', // 10: Light Red (Skin / Coral)
    '#4A4A4A', // 11: Dark Grey
    '#7B7B7B', // 12: Medium Grey
    '#A9FF9F', // 13: Light Green
    '#706DEB', // 14: Light Blue
    '#B2B2B2'  // 15: Light Grey
  ];

  // Precomputed 32-bit ABGR (little-endian RGBA) colors for fast ImageData blitting
  const PALETTE_U32 = new Uint32Array(16);
  for (let i = 0; i < 16; i++) {
    const hex = PALETTE_HEX[i];
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    PALETTE_U32[i] = (255 << 24) | (b << 16) | (g << 8) | r;
  }

  const C = {
    BLACK: 0,
    WHITE: 1,
    RED: 2,
    CYAN: 3,
    PURPLE: 4,
    GREEN: 5,
    BLUE: 6,
    YELLOW: 7,
    ORANGE: 8,
    BROWN: 9,
    LIGHT_RED: 10,
    DARK_GREY: 11,
    GREY: 12,
    LIGHT_GREEN: 13,
    LIGHT_BLUE: 14,
    LIGHT_GREY: 15
  };

  // Authentic Commodore 64 8x8 ROM Character Set (Upper/Lower + Symbols)
  // Each glyph is 8 rows of 8-bit integers (MSB = leftmost pixel)
  const FONT_8X8 = {
    ' ': [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
    '!': [0x18, 0x18, 0x18, 0x18, 0x18, 0x00, 0x18, 0x00],
    '"': [0x66, 0x66, 0x24, 0x00, 0x00, 0x00, 0x00, 0x00],
    '#': [0x6C, 0xFE, 0x6C, 0x6C, 0xFE, 0x6C, 0x00, 0x00],
    '$': [0x18, 0x3E, 0x60, 0x3C, 0x06, 0x7C, 0x18, 0x00],
    '%': [0x62, 0x64, 0x08, 0x10, 0x26, 0x46, 0x00, 0x00],
    '&': [0x38, 0x6C, 0x38, 0x76, 0xDC, 0xCC, 0x76, 0x00],
    "'": [0x18, 0x18, 0x30, 0x00, 0x00, 0x00, 0x00, 0x00],
    '(': [0x0C, 0x18, 0x30, 0x30, 0x30, 0x18, 0x0C, 0x00],
    ')': [0x30, 0x18, 0x0C, 0x0C, 0x0C, 0x18, 0x30, 0x00],
    '*': [0x00, 0x66, 0x3C, 0xFF, 0x3C, 0x66, 0x00, 0x00],
    '+': [0x00, 0x18, 0x18, 0x7E, 0x18, 0x18, 0x00, 0x00],
    ',': [0x00, 0x00, 0x00, 0x00, 0x00, 0x18, 0x18, 0x30],
    '-': [0x00, 0x00, 0x00, 0x7E, 0x00, 0x00, 0x00, 0x00],
    '.': [0x00, 0x00, 0x00, 0x00, 0x00, 0x18, 0x18, 0x00],
    '/': [0x00, 0x03, 0x06, 0x0C, 0x18, 0x30, 0x60, 0x00],
    '0': [0x3C, 0x66, 0x6E, 0x76, 0x66, 0x66, 0x3C, 0x00],
    '1': [0x18, 0x38, 0x18, 0x18, 0x18, 0x18, 0x7E, 0x00],
    '2': [0x3C, 0x66, 0x06, 0x0C, 0x30, 0x60, 0x7E, 0x00],
    '3': [0x3C, 0x66, 0x06, 0x1C, 0x06, 0x66, 0x3C, 0x00],
    '4': [0x0C, 0x1C, 0x3C, 0x6C, 0x7E, 0x0C, 0x0C, 0x00],
    '5': [0x7E, 0x60, 0x7C, 0x06, 0x06, 0x66, 0x3C, 0x00],
    '6': [0x3C, 0x66, 0x60, 0x7C, 0x66, 0x66, 0x3C, 0x00],
    '7': [0x7E, 0x66, 0x0C, 0x18, 0x18, 0x18, 0x18, 0x00],
    '8': [0x3C, 0x66, 0x66, 0x3C, 0x66, 0x66, 0x3C, 0x00],
    '9': [0x3C, 0x66, 0x66, 0x3E, 0x06, 0x66, 0x3C, 0x00],
    ':': [0x00, 0x00, 0x18, 0x18, 0x00, 0x18, 0x18, 0x00],
    ';': [0x00, 0x00, 0x18, 0x00, 0x00, 0x18, 0x18, 0x30],
    '<': [0x0E, 0x18, 0x30, 0x60, 0x30, 0x18, 0x0E, 0x00],
    '=': [0x00, 0x00, 0x7E, 0x00, 0x7E, 0x00, 0x00, 0x00],
    '>': [0x70, 0x18, 0x0C, 0x06, 0x0C, 0x18, 0x70, 0x00],
    '?': [0x3C, 0x66, 0x06, 0x0C, 0x18, 0x00, 0x18, 0x00],
    '@': [0x3C, 0x66, 0x6E, 0x6E, 0x60, 0x62, 0x3C, 0x00],
    'A': [0x18, 0x3C, 0x66, 0x7E, 0x66, 0x66, 0x66, 0x00],
    'B': [0x7C, 0x66, 0x66, 0x7C, 0x66, 0x66, 0x7C, 0x00],
    'C': [0x3C, 0x66, 0x60, 0x60, 0x60, 0x66, 0x3C, 0x00],
    'D': [0x78, 0x6C, 0x66, 0x66, 0x66, 0x6C, 0x78, 0x00],
    'E': [0x7E, 0x60, 0x60, 0x78, 0x60, 0x60, 0x7E, 0x00],
    'F': [0x7E, 0x60, 0x60, 0x78, 0x60, 0x60, 0x60, 0x00],
    'G': [0x3C, 0x66, 0x60, 0x6E, 0x66, 0x66, 0x3C, 0x00],
    'H': [0x66, 0x66, 0x66, 0x7E, 0x66, 0x66, 0x66, 0x00],
    'I': [0x3C, 0x18, 0x18, 0x18, 0x18, 0x18, 0x3C, 0x00],
    'J': [0x1E, 0x0C, 0x0C, 0x0C, 0x0C, 0x6C, 0x38, 0x00],
    'K': [0x66, 0x6C, 0x78, 0x70, 0x78, 0x6C, 0x66, 0x00],
    'L': [0x60, 0x60, 0x60, 0x60, 0x60, 0x60, 0x7E, 0x00],
    'M': [0x63, 0x77, 0x7F, 0x6B, 0x63, 0x63, 0x63, 0x00],
    'N': [0x66, 0x76, 0x7E, 0x7E, 0x6E, 0x66, 0x66, 0x00],
    'O': [0x3C, 0x66, 0x66, 0x66, 0x66, 0x66, 0x3C, 0x00],
    'P': [0x7C, 0x66, 0x66, 0x7C, 0x60, 0x60, 0x60, 0x00],
    'Q': [0x3C, 0x66, 0x66, 0x66, 0x66, 0x3C, 0x0E, 0x00],
    'R': [0x7C, 0x66, 0x66, 0x7C, 0x78, 0x6C, 0x66, 0x00],
    'S': [0x3C, 0x66, 0x60, 0x3C, 0x06, 0x66, 0x3C, 0x00],
    'T': [0x7E, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x00],
    'U': [0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x3C, 0x00],
    'V': [0x66, 0x66, 0x66, 0x66, 0x66, 0x3C, 0x18, 0x00],
    'W': [0x63, 0x63, 0x63, 0x6B, 0x7F, 0x77, 0x63, 0x00],
    'X': [0x66, 0x66, 0x3C, 0x18, 0x3C, 0x66, 0x66, 0x00],
    'Y': [0x66, 0x66, 0x66, 0x3C, 0x18, 0x18, 0x18, 0x00],
    'Z': [0x7E, 0x06, 0x0C, 0x18, 0x30, 0x60, 0x7E, 0x00],
    '_': [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x7E, 0x00],
    // Lowercase C64 glyphs needed for authentic "sreddaL" & credits!
    'a': [0x00, 0x00, 0x3C, 0x06, 0x3E, 0x66, 0x3E, 0x00],
    'b': [0x60, 0x60, 0x7C, 0x66, 0x66, 0x66, 0x7C, 0x00],
    'c': [0x00, 0x00, 0x3C, 0x60, 0x60, 0x60, 0x3C, 0x00],
    'd': [0x06, 0x06, 0x3E, 0x66, 0x66, 0x66, 0x3E, 0x00],
    'e': [0x00, 0x00, 0x3C, 0x66, 0x7E, 0x60, 0x3C, 0x00],
    'f': [0x0E, 0x18, 0x3E, 0x18, 0x18, 0x18, 0x18, 0x00],
    'g': [0x00, 0x00, 0x3E, 0x66, 0x66, 0x3E, 0x06, 0x3C],
    'h': [0x60, 0x60, 0x7C, 0x66, 0x66, 0x66, 0x66, 0x00],
    'i': [0x18, 0x00, 0x38, 0x18, 0x18, 0x18, 0x3C, 0x00],
    'j': [0x06, 0x00, 0x0E, 0x06, 0x06, 0x06, 0x66, 0x3C],
    'k': [0x60, 0x60, 0x66, 0x6C, 0x78, 0x6C, 0x66, 0x00],
    'l': [0x38, 0x18, 0x18, 0x18, 0x18, 0x18, 0x3C, 0x00],
    'm': [0x00, 0x00, 0x66, 0x7F, 0x7F, 0x6B, 0x63, 0x00],
    'n': [0x00, 0x00, 0x7C, 0x66, 0x66, 0x66, 0x66, 0x00],
    'o': [0x00, 0x00, 0x3C, 0x66, 0x66, 0x66, 0x3C, 0x00],
    'p': [0x00, 0x00, 0x7C, 0x66, 0x66, 0x7C, 0x60, 0x60],
    'r': [0x00, 0x00, 0x7C, 0x66, 0x60, 0x60, 0x60, 0x00],
    's': [0x00, 0x00, 0x3E, 0x60, 0x3C, 0x06, 0x7C, 0x00],
    't': [0x18, 0x18, 0x7E, 0x18, 0x18, 0x18, 0x0E, 0x00],
    'u': [0x00, 0x00, 0x66, 0x66, 0x66, 0x66, 0x3E, 0x00],
    'v': [0x00, 0x00, 0x66, 0x66, 0x66, 0x3C, 0x18, 0x00],
    'w': [0x00, 0x00, 0x63, 0x6B, 0x7F, 0x3E, 0x36, 0x00],
    'x': [0x00, 0x00, 0x66, 0x3C, 0x18, 0x3C, 0x66, 0x00],
    'y': [0x00, 0x00, 0x66, 0x66, 0x66, 0x3E, 0x06, 0x3C],
    'z': [0x00, 0x00, 0x7E, 0x0C, 0x18, 0x30, 0x7E, 0x00],
    '©': [0x3C, 0x42, 0x99, 0xA1, 0xA1, 0x99, 0x42, 0x3C],
    '♥': [0x00, 0x6C, 0xFE, 0xFE, 0x7C, 0x38, 0x10, 0x00]
  };

  /**
   * Compiles ASCII art sprite arrays into compact { w, h, pixels: Int8Array }
   * '.' = transparent (-1), hex chars '0'..'F' = C64 color index 0..15
   */
  function compileSprite(rows) {
    const h = rows.length;
    const w = rows[0].length;
    const pixels = new Int8Array(w * h);
    for (let y = 0; y < h; y++) {
      const row = rows[y];
      for (let x = 0; x < w; x++) {
        const ch = row[x];
        if (ch === '.' || ch === ' ') {
          pixels[y * w + x] = -1;
        } else {
          pixels[y * w + x] = parseInt(ch, 16);
        }
      }
    }
    return { w, h, pixels };
  }

  function flipSpriteX(spr) {
    const { w, h, pixels } = spr;
    const out = new Int8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        out[y * w + x] = pixels[y * w + (w - 1 - x)];
      }
    }
    return { w, h, pixels: out };
  }

  function rotateSprite90(spr) {
    const { w, h, pixels } = spr;
    const nw = h;
    const nh = w;
    const out = new Int8Array(nw * nh);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        out[x * nw + (h - 1 - y)] = pixels[y * w + x];
      }
    }
    return { w: nw, h: nh, pixels: out };
  }

  // =========================================================================
  // SENIOR JUMPWOMAN SPRITES (12x14 VIC-II Pixel Proportions)
  // Colors:
  // 1 (White) / F (Light Grey): Silver Hair & Grandma Bun!
  // 3 (Cyan): Retro glasses glint
  // A (Light Red): Face & Hands
  // 2 (Red) / 4 (Purple): Classic Epyx Jumpsuit
  // 7 (Yellow): Utility Belt & Buckle
  // E (Light Blue): Space Boots
  // =========================================================================
  const SJW_IDLE = compileSprite([
    '....1111....',
    '...F1111F...',
    '...1A3A31...',
    '....AAAA....',
    '...227722...',
    '..A222222A..',
    '..A.2442.A..',
    '....7777....',
    '...444444...',
    '...44..44...',
    '...44..44...',
    '...44..44...',
    '..EEE..EEE..',
    '..EEE..EEE..'
  ]);

  // Facing RIGHT: Silver bun sits clearly on the back-left of her head!
  const SJW_RUN1_R = compileSprite([
    '..11.1111...',
    '.1FF11111...',
    '..11AA3A....',
    '....AAAAA...',
    '....2222A...',
    '..AA22222AA.',
    '....2442....',
    '....7777....',
    '...444444...',
    '..444..444..',
    '.44......44.',
    '.EE......44.',
    '.EE.......EE',
    '..........EE'
  ]);

  const SJW_RUN2_R = compileSprite([
    '..11.1111...',
    '.1FF11111...',
    '..11AA3A....',
    '....AAAAA...',
    '...A22222...',
    '....22222A..',
    '....2442....',
    '....7777....',
    '....4444....',
    '....4444....',
    '...44..44...',
    '...44..44...',
    '...EE..EEE..',
    '.......EEE..'
  ]);

  const SJW_RUN3_R = compileSprite([
    '..11.1111...',
    '.1FF11111...',
    '..11AA3A....',
    '....AAAAA...',
    '..A22222....',
    '...22222AA..',
    '....2442....',
    '....7777....',
    '...44444....',
    '...44.44....',
    '..44...44...',
    '..44....EE..',
    '..EEE...EE..',
    '..EEE.......'
  ]);

  const SJW_JUMP_R = compileSprite([
    '..11.1111.AA',
    '.1FF11111AA.',
    '..11AA3A.2..',
    '....AAAA22..',
    '..AA22222...',
    '.AA.2442....',
    '....7777....',
    '..44444444..',
    '.444....444.',
    '.EE......44.',
    '.EE......EEE',
    '.........EEE',
    '............',
    '............'
  ]);

  const SJW_JUMP_UP = compileSprite([
    '.AA.1111.AA.',
    '.AA1F11F1AA.',
    '..2.A33A.2..',
    '..22AAAA22..',
    '...222222...',
    '....2442....',
    '....7777....',
    '..44444444..',
    '.444....444.',
    '.44......44.',
    '.EEE....EEE.',
    '.EEE....EEE.',
    '............',
    '............'
  ]);

  const SJW_CLIMB1 = compileSprite([
    '..AA1111....',
    '..A.1FF1....',
    '...11FF11...',
    '...221122A..',
    '...222222A..',
    '....2442....',
    '....7777....',
    '...444444...',
    '..44....44..',
    '..EE....44..',
    '..EE....44..',
    '........EE..',
    '........EE..',
    '............'
  ]);

  const SJW_CLIMB2 = flipSpriteX(SJW_CLIMB1);

  const SJW_ROPE1_R = compileSprite([
    '..11.1111...',
    '.1FF1111A...',
    '..11AA3AA...',
    '....AAAA2A..',
    '....22222A..',
    '....2442....',
    '....7777....',
    '....44444...',
    '....44.44...',
    '.....4444...',
    '.....EEE....',
    '.....EEE....',
    '............',
    '............'
  ]);
  const SJW_ROPE2_R = compileSprite([
    '..11.1111A..',
    '.1FF1111AA..',
    '..11AA3A2...',
    '....AAAA2...',
    '....22222A..',
    '....2442....',
    '....7777....',
    '....44444...',
    '.....4444...',
    '....44.EE...',
    '....EE......',
    '............',
    '............',
    '............'
  ]);

  const SJW_DANCE1 = compileSprite([
    '.AA.1111....',
    '.AA.F11F....',
    '..2.A33A.AA.',
    '..22AAAA22..',
    '...227722...',
    '....2442....',
    '....7777....',
    '...444444...',
    '..44....44..',
    '.EE......44.',
    '.EE......EEE',
    '............',
    '............',
    '............'
  ]);
  const SJW_DANCE2 = flipSpriteX(SJW_DANCE1);

  // Tumbling frames (head over heels!)
  const SJW_TUMBLE0 = SJW_JUMP_UP;
  const SJW_TUMBLE1 = rotateSprite90(SJW_JUMP_UP);
  const SJW_TUMBLE2 = rotateSprite90(SJW_TUMBLE1);
  const SJW_TUMBLE3 = rotateSprite90(SJW_TUMBLE2);

  // Mini HUD Life Icon (7x8)
  const LIFE_ICON = compileSprite([
    '..111...',
    '.F111F..',
    '..AAA...',
    '.22722..',
    '..444...',
    '.44.44..',
    '.EE.EE..',
    '........'
  ]);

  // =========================================================================
  // BOMBS & HAZARDS SPRITES
  // =========================================================================
  const BOMB_F1 = compileSprite([
    '....7.1.',
    '...878..',
    '....F...',
    '..FF1FF.',
    '.FFFFFFF',
    '.F1FFFFF',
    '.FFFFFFF',
    '..FFFFF.'
  ]);
  const BOMB_F2 = compileSprite([
    '...1.7..',
    '....78..',
    '....F...',
    '..FF7FF.',
    '.FFFFFFF',
    '.F1FFFFF',
    '.FFFFFFF',
    '..FFFFF.'
  ]);
  // Flashing teleport bomb warning
  const BOMB_PHASE = compileSprite([
    '....3...',
    '...131..',
    '....3...',
    '..33133.',
    '.3.313.3',
    '.313.313',
    '.3.313.3',
    '..33.33.'
  ]);

  // Level 2: Reactive Flame Trap (10x12)
  const FLAME_F1 = compileSprite([
    '....7.....',
    '..7.7.8...',
    '..87788...',
    '.2871782..',
    '.2871782..',
    '228711782.',
    '2877117722',
    '2871111782',
    '2287117822',
    '.22877822.',
    '..228822..',
    '...2222...'
  ]);
  const FLAME_F2 = flipSpriteX(compileSprite([
    '.....7....',
    '...8.7.7..',
    '...88778..',
    '..2871782.',
    '.28711782.',
    '.287117822',
    '2277117782',
    '2871111782',
    '2287117822',
    '.22877822.',
    '..228822..',
    '...2222...'
  ]));

  // Alienator Bullet (8x8 C64 glowing energy orb / cross-dart)
  const BULLET_DRIFT1 = compileSprite([
    '...11...',
    '..3113..',
    '.317713.',
    '11711711',
    '11711711',
    '.317713.',
    '..3113..',
    '...11...'
  ]);
  const BULLET_DRIFT2 = compileSprite([
    '...77...',
    '..2772..',
    '.271172.',
    '77133177',
    '77133177',
    '.271172.',
    '..2772..',
    '...77...'
  ]);

  // Level 4: Hellstone (10x10 jagged meteor)
  const HELLSTONE_1 = compileSprite([
    '...2882...',
    '..287782..',
    '.28711782.',
    '2871177882',
    '8771778822',
    '877778822.',
    '.2878822..',
    '..28822...',
    '...222....',
    '..........'
  ]);
  const HELLSTONE_2 = rotateSprite90(HELLSTONE_1);

  // Level 7: Zig-Zagger (10x10 electric C64 sawtooth spark)
  const ZIGZAG_1 = compileSprite([
    '1...33...1',
    '.1..33..1.',
    '..317713..',
    '..371173..',
    '3371441733',
    '3371441733',
    '..371173..',
    '..317713..',
    '.1..33..1.',
    '1...33...1'
  ]);
  const ZIGZAG_2 = compileSprite([
    '....11....',
    '.4..11..4.',
    '..437734..',
    '..371173..',
    '1171331711',
    '1171331711',
    '..371173..',
    '..437734..',
    '.4..11..4.',
    '....11....'
  ]);

  // Level 11: Alien Egg & Hatchling
  const EGG_INTACT = compileSprite([
    '...1111...',
    '..117711..',
    '.11711111.',
    '.11111711.',
    '.11711111.',
    '.11117711.',
    '..111111..',
    '...FFFF...'
  ]);
  const EGG_CRACK = compileSprite([
    '..11..11..',
    '.11.7..11.',
    '.1.7D7..1.',
    '11.DDD.711',
    '.11.D.111.',
    '.111.1711.',
    '..111111..',
    '...FFFF...'
  ]);
  const HATCHLING_1 = compileSprite([
    '.DD....DD.',
    'DDD.DD.DDD',
    '..DD17DD..',
    '...DDDD...',
    '..DD33DD..',
    '.7..DD..7.',
    '..........',
    '..........'
  ]);
  const HATCHLING_2 = compileSprite([
    '..........',
    '...DDDD...',
    '..DD17DD..',
    'DDDDDDDDDD',
    'DD.D33D.DD',
    '..7....7..',
    '..........',
    '..........'
  ]);

  // Level 12: Hurricane Bird (12x8)
  const BIRD_R1 = compileSprite([
    '..77........',
    '...777......',
    '....777712..',
    '..7777777778',
    '....77777...',
    '.....2..2...',
    '............',
    '............'
  ]);
  const BIRD_R2 = compileSprite([
    '............',
    '............',
    '....777712..',
    '..7777777778',
    '...77777....',
    '..77.2..2...',
    '.77.........',
    '............'
  ]);

  const SPRITES = {
    sjw: {
      idle: SJW_IDLE,
      runR: [SJW_RUN1_R, SJW_RUN2_R, SJW_RUN3_R, SJW_RUN2_R],
      runL: [
        flipSpriteX(SJW_RUN1_R),
        flipSpriteX(SJW_RUN2_R),
        flipSpriteX(SJW_RUN3_R),
        flipSpriteX(SJW_RUN2_R)
      ],
      jumpR: SJW_JUMP_R,
      jumpL: flipSpriteX(SJW_JUMP_R),
      jumpUp: SJW_JUMP_UP,
      climb: [SJW_CLIMB1, SJW_CLIMB2],
      ropeR: [SJW_ROPE1_R, SJW_ROPE2_R],
      ropeL: [flipSpriteX(SJW_ROPE1_R), flipSpriteX(SJW_ROPE2_R)],
      tumble: [SJW_TUMBLE0, SJW_TUMBLE1, SJW_TUMBLE2, SJW_TUMBLE3],
      dance: [SJW_DANCE1, SJW_DANCE2],
      life: LIFE_ICON
    },
    bomb: [BOMB_F1, BOMB_F2],
    bombPhase: BOMB_PHASE,
    flame: [FLAME_F1, FLAME_F2],
    bullet: [BULLET_DRIFT1, BULLET_DRIFT2],
    hellstone: [HELLSTONE_1, HELLSTONE_2],
    zigzag: [ZIGZAG_1, ZIGZAG_2],
    egg: [EGG_INTACT, EGG_CRACK],
    hatchling: [HATCHLING_1, HATCHLING_2],
    birdR: [BIRD_R1, BIRD_R2],
    birdL: [flipSpriteX(BIRD_R1), flipSpriteX(BIRD_R2)]
  };

  // =========================================================================
  // C64 VIC-II FRAMEBUFFER RENDERER (384x272 total, 320x200 active screen)
  // =========================================================================
  class VICII {
    constructor(canvas) {
      this.canvas = canvas;
      this.totalW = 384;
      this.totalH = 272;
      this.borderX = 32;
      this.borderY = 36;
      this.width = 320;
      this.height = 200;

      this.canvas.width = this.totalW;
      this.canvas.height = this.totalH;
      this.ctx = this.canvas.getContext('2d', { alpha: false });
      this.ctx.imageSmoothingEnabled = false;

      this.imgData = this.ctx.createImageData(this.totalW, this.totalH);
      this.buf32 = new Uint32Array(this.imgData.data.buffer);

      this.borderColor = C.BLACK;
      this.bgColor = C.BLACK;
    }

    clear(bgColor = this.bgColor, borderColor = this.borderColor) {
      const bCol = PALETTE_U32[borderColor & 15];
      const pCol = PALETTE_U32[bgColor & 15];
      const buf = this.buf32;
      const tw = this.totalW;
      const th = this.totalH;
      const bx0 = this.borderX;
      const bx1 = bx0 + this.width;
      const by0 = this.borderY;
      const by1 = by0 + this.height;

      if (bCol === pCol) {
        buf.fill(bCol);
        return;
      }

      buf.fill(bCol);
      for (let y = by0; y < by1; y++) {
        buf.fill(pCol, y * tw + bx0, y * tw + bx1);
      }
    }

    // Set pixel in 320x200 playfield coordinates
    pset(x, y, col) {
      const ix = x | 0;
      const iy = y | 0;
      if (ix < 0 || ix >= 320 || iy < 0 || iy >= 200) return;
      this.buf32[(iy + this.borderY) * this.totalW + (ix + this.borderX)] =
        PALETTE_U32[col & 15];
    }

    // Fill rectangle in 320x200 playfield coordinates
    fillRect(x, y, w, h, col) {
      let x0 = Math.max(0, x | 0);
      let y0 = Math.max(0, y | 0);
      let x1 = Math.min(320, (x + w) | 0);
      let y1 = Math.min(200, (y + h) | 0);
      if (x1 <= x0 || y1 <= y0) return;

      const u32 = PALETTE_U32[col & 15];
      const tw = this.totalW;
      const bx = this.borderX;
      const by = this.borderY;
      for (let py = y0; py < y1; py++) {
        const rowOff = (py + by) * tw + bx;
        this.buf32.fill(u32, rowOff + x0, rowOff + x1);
      }
    }

    // Draw sprite with optional color override (for shimmer/flash effects)
    drawSprite(spr, x, y, colorOverride = -1, clipMaxY = 200) {
      if (!spr) return;
      const ix = Math.round(x);
      const iy = Math.round(y);
      const { w, h, pixels } = spr;
      const tw = this.totalW;
      const bx = this.borderX;
      const by = this.borderY;
      const maxY = Math.min(200, clipMaxY);

      for (let sy = 0; sy < h; sy++) {
        const py = iy + sy;
        if (py < 0 || py >= maxY) continue;
        const rowOff = (py + by) * tw + bx;
        const sOff = sy * w;
        for (let sx = 0; sx < w; sx++) {
          const c = pixels[sOff + sx];
          if (c < 0) continue;
          const px = ix + sx;
          if (px < 0 || px >= 320) continue;
          const finalCol = colorOverride >= 0 ? colorOverride : c;
          this.buf32[rowOff + px] = PALETTE_U32[finalCol & 15];
        }
      }
    }

    // Draw C64 8x8 text string at (x, y) with optional scale (1 or 2)
    drawText(str, x, y, col, scale = 1, shadowCol = -1) {
      const text = String(str);
      if (shadowCol >= 0) {
        this._drawTextRaw(text, x + scale, y + scale, shadowCol, scale);
      }
      this._drawTextRaw(text, x, y, col, scale);
    }

    _drawTextRaw(text, x, y, col, scale) {
      let cx = x | 0;
      const cy = y | 0;
      const step = 8 * scale;
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        const glyph = FONT_8X8[ch] || FONT_8X8[ch.toUpperCase()] || FONT_8X8['?'];
        if (ch !== ' ' && glyph) {
          for (let row = 0; row < 8; row++) {
            const bits = glyph[row];
            if (!bits) continue;
            for (let bit = 0; bit < 8; bit++) {
              if (bits & (0x80 >> bit)) {
                if (scale === 1) {
                  this.pset(cx + bit, cy + row, col);
                } else {
                  this.fillRect(
                    cx + bit * scale,
                    cy + row * scale,
                    scale,
                    scale,
                    col
                  );
                }
              }
            }
          }
        }
        cx += step;
      }
    }

    drawTextCentered(str, y, col, scale = 1, shadowCol = -1) {
      const w = String(str).length * 8 * scale;
      const x = Math.floor((320 - w) / 2);
      this.drawText(str, x, y, col, scale, shadowCol);
    }

    present() {
      this.ctx.putImageData(this.imgData, 0, 0);
    }
  }

  global.C64 = {
    C,
    PALETTE_HEX,
    PALETTE_U32,
    FONT_8X8,
    SPRITES,
    VICII,
    compileSprite,
    flipSpriteX
  };
})(window);
