/**
 * SENIOR JUMPWOMAN — All 12 Original C64 Jumpman Junior Levels + Reactive Engine
 * Playfield area: 320 x 176 (y = 0..175), HUD occupies y = 176..199
 */
(function (global) {
  'use strict';

  const { C } = global.C64;

  const SPELL_TARGET = 'SR.JUMPWOMAN'; // 12 visible chars for 12 bombs!

  /**
   * Helper builder to construct girders, sloped ramps, ladders, ropes, bombs, and flames
   */
  class StageBuilder {
    constructor(def) {
      this.levelNumber = def.number;
      this.name = def.name;
      this.girderColor = def.girderColor ?? C.RED;
      this.girderCapColor = def.girderCapColor ?? C.LIGHT_RED;
      this.ladderColor = def.ladderColor ?? C.GREEN;
      this.spawn = { x: def.spawn.x, feetY: def.spawn.feetY };
      this.hazards = Object.assign(
        {
          bullets: 0,
          hellstones: 0,
          walls: [],
          zigzaggers: 0,
          hatchlings: 0,
          hurricane: false,
          blackout: false,
          teleportBombs: false,
          spellbound: false,
          scrollingLadders: false
        },
        def.hazards || {}
      );

      this.girders = [];
      this.ladders = [];
      this.ropes = [];
      this.bombs = [];
      this.bombSockets = [];
      this.flames = [];

      // Spatial column lookup rebuilt whenever girders toggle
      this.columns = new Array(320);
      for (let x = 0; x < 320; x++) this.columns[x] = [];
    }

    // Horizontal girder (4px thick I-beam, top surface at y)
    addGirder(x, y, w, opts = {}) {
      const seg = {
        id: opts.id || null,
        x: Math.round(x),
        y: Math.round(y),
        w: Math.round(w),
        color: opts.color ?? this.girderColor,
        capColor: opts.capColor ?? this.girderCapColor,
        active: opts.active !== undefined ? opts.active : true
      };
      this.girders.push(seg);
      return this;
    }

    // Sloped ramp decomposed into 4px-wide micro-girders for smooth C64 slope walking
    addRamp(x1, y1, x2, y2, opts = {}) {
      const startX = Math.min(x1, x2);
      const endX = Math.max(x1, x2);
      const startY = x1 <= x2 ? y1 : y2;
      const endY = x1 <= x2 ? y2 : y1;
      const span = Math.max(4, endX - startX);
      const steps = Math.max(1, Math.round(span / 4));
      const stepW = span / steps;

      for (let i = 0; i < steps; i++) {
        const sx = Math.round(startX + i * stepW);
        const nx = Math.round(startX + (i + 1) * stepW);
        const t = i / Math.max(1, steps - 1);
        const sy = Math.round(startY + (endY - startY) * t);
        this.addGirder(sx, sy, Math.max(4, nx - sx), opts);
      }
      return this;
    }

    // Ladder (8px wide, from y to y+h)
    addLadder(x, y, h, opts = {}) {
      this.ladders.push({
        id: opts.id || null,
        x: Math.round(x),
        y: Math.round(y),
        h: Math.round(h),
        color: opts.color ?? this.ladderColor,
        active: opts.active !== undefined ? opts.active : true,
        scrollSpeed: opts.scrollSpeed || 0,
        wrapMinY: opts.wrapMinY ?? 14,
        wrapMaxY: opts.wrapMaxY ?? 172
      });
      return this;
    }

    // Rope ('up' = Green automatic climb up, 'down' = Blue automatic slide down)
    addRope(x, y, h, type = 'up', opts = {}) {
      this.ropes.push({
        id: opts.id || null,
        x: Math.round(x),
        y: Math.round(y),
        h: Math.round(h),
        type,
        active: opts.active !== undefined ? opts.active : true
      });
      return this;
    }

    // Bomb (8x8 sprite; placed so bottom rests at feetY - 1 or floating at (x, y))
    addBomb(x, y, opts = {}) {
      const idx = this.bombs.length;
      this.bombs.push({
        index: idx,
        x: Math.round(x),
        y: Math.round(y),
        defused: false,
        phasing: false,
        letterIndex: opts.letterIndex ?? idx,
        toggleIds: opts.toggleIds || null,
        enableIds: opts.enableIds || null,
        disableIds: opts.disableIds || null,
        toggleFlames: !!opts.toggleFlames,
        reverseScroll: !!opts.reverseScroll
      });
      return this;
    }

    addBombSocket(x, y) {
      this.bombSockets.push({ x: Math.round(x), y: Math.round(y) });
      return this;
    }

    addFlame(x, feetY, group = 0) {
      this.flames.push({
        x: Math.round(x),
        y: Math.round(feetY - 12),
        group,
        active: group === 0
      });
      return this;
    }

    rebuildColumns() {
      for (let x = 0; x < 320; x++) {
        this.columns[x].length = 0;
      }
      for (let i = 0; i < this.girders.length; i++) {
        const g = this.girders[i];
        if (!g.active) continue;
        const x0 = Math.max(0, g.x);
        const x1 = Math.min(320, g.x + g.w);
        for (let x = x0; x < x1; x++) {
          this.columns[x].push(g.y);
        }
      }
      for (let x = 0; x < 320; x++) {
        if (this.columns[x].length > 1) {
          this.columns[x].sort((a, b) => a - b);
        }
      }
      return this;
    }

    // Query girder surface Y near feetY across foot span [centerX - 3, centerX + 3]
    findGirderSurface(centerX, minY, maxY) {
      const x0 = Math.max(0, Math.round(centerX - 3));
      const x1 = Math.min(319, Math.round(centerX + 3));
      let bestY = null;
      for (let x = x0; x <= x1; x++) {
        const col = this.columns[x];
        for (let i = 0; i < col.length; i++) {
          const gy = col[i];
          if (gy >= minY && gy <= maxY) {
            if (bestY === null || gy < bestY) {
              bestY = gy;
            }
          }
        }
      }
      return bestY;
    }

    toggleById(id, mode = 'toggle') {
      const apply = (arr) => {
        for (const item of arr) {
          if (item.id === id) {
            if (mode === 'toggle') item.active = !item.active;
            else if (mode === 'enable') item.active = true;
            else if (mode === 'disable') item.active = false;
          }
        }
      };
      apply(this.girders);
      apply(this.ladders);
      apply(this.ropes);
      this.rebuildColumns();
    }
  }

  // ===========================================================================
  // ALL 12 AUTHENTIC C64 JUMPMAN JUNIOR LEVELS (IN EXACT ORDER)
  // ===========================================================================
  const LEVEL_BUILDERS = [
    // -------------------------------------------------------------------------
    // LEVEL 1: NOTHING TO IT
    // Intro stage: 4 girder tiers, gentle slopes, jump gap, Green Up-Rope,
    // Blue Down-Rope, 12 bombs, minor shortcut bridge trigger, 1 Alienator Bullet
    // -------------------------------------------------------------------------
    function level01() {
      const s = new StageBuilder({
        number: 1,
        name: 'NOTHING TO IT',
        girderColor: C.RED,
        girderCapColor: C.LIGHT_RED,
        ladderColor: C.GREEN,
        spawn: { x: 28, feetY: 160 },
        hazards: { bullets: 1 }
      });

      // Tier 1 (Top: y=38)
      s.addGirder(12, 38, 296);

      // Tier 2 (Upper-Mid: y=78 with gentle center dip to y=84)
      s.addGirder(12, 78, 92);
      s.addRamp(104, 78, 136, 84);
      s.addGirder(136, 84, 48);
      s.addRamp(184, 84, 216, 78);
      s.addGirder(216, 78, 92);

      // Tier 3 (Lower-Mid: y=120 with classic jump gap at center)
      s.addGirder(12, 120, 128);
      s.addGirder(140, 120, 40, { id: 'bridge1', active: false }); // Reactive bridge!
      s.addGirder(180, 120, 128);

      // Tier 4 (Bottom: y=160 with signature trip-gap at x=148..172)
      s.addGirder(8, 160, 140);
      s.addGirder(172, 160, 140);

      // Ladders
      s.addLadder(48, 38, 42);
      s.addLadder(264, 38, 42);
      s.addLadder(92, 78, 44);
      s.addLadder(220, 78, 44);
      s.addLadder(64, 120, 42);
      s.addLadder(248, 120, 42);
      s.addLadder(156, 84, 38, { id: 'centerLad', active: false }); // Reactive shortcut!

      // Green Up-Rope (left) & Blue Down-Rope (right)
      s.addRope(20, 38, 122, 'up');
      s.addRope(300, 38, 122, 'down');

      // 12 Bombs
      s.addBomb(28, 28);
      s.addBomb(112, 28);
      s.addBomb(200, 28);
      s.addBomb(284, 28);

      s.addBomb(32, 68);
      s.addBomb(156, 74, { enableIds: ['bridge1', 'centerLad'] });
      s.addBomb(276, 68);

      s.addBomb(32, 110);
      s.addBomb(122, 110);
      s.addBomb(190, 110);
      s.addBomb(280, 110);

      s.addBomb(208, 150);

      return s.rebuildColumns();
    },

    // -------------------------------------------------------------------------
    // LEVEL 2: FIRE! FIRE! (C64 Exclusive!)
    // Reactive Flame Traps toggle groups whenever bombs are defused + 2 Bullets
    // -------------------------------------------------------------------------
    function level02() {
      const s = new StageBuilder({
        number: 2,
        name: 'FIRE! FIRE!',
        girderColor: C.ORANGE,
        girderCapColor: C.YELLOW,
        ladderColor: C.CYAN,
        spawn: { x: 154, feetY: 160 },
        hazards: { bullets: 2 }
      });

      s.addGirder(10, 38, 300);
      s.addGirder(10, 78, 300);
      s.addGirder(10, 118, 300);
      s.addGirder(10, 160, 300);

      // 5 Ladders + 2 outer safety ropes
      s.addLadder(32, 38, 124);
      s.addLadder(94, 38, 82);
      s.addLadder(156, 78, 84);
      s.addLadder(218, 38, 82);
      s.addLadder(280, 38, 124);

      s.addRope(16, 38, 122, 'up');
      s.addRope(304, 38, 122, 'down');

      // Alternating Flame Traps (Group 0 & Group 1 — never blocking outer ladders/ropes)
      s.addFlame(62, 38, 0);
      s.addFlame(248, 38, 1);
      s.addFlame(124, 78, 1);
      s.addFlame(186, 78, 0);
      s.addFlame(62, 118, 1);
      s.addFlame(248, 118, 0);
      s.addFlame(92, 160, 0);
      s.addFlame(218, 160, 1);

      // 12 Bombs — each bomb toggles Flame Group 0 <-> Group 1!
      const coords = [
        [46, 28], [126, 28], [186, 28], [266, 28],
        [46, 68], [156, 68], [266, 68],
        [46, 108], [126, 108], [186, 108], [266, 108],
        [46, 150]
      ];
      for (const [bx, by] of coords) {
        s.addBomb(bx, by, { toggleFlames: true });
      }

      return s.rebuildColumns();
    },

    // -------------------------------------------------------------------------
    // LEVEL 3: sreddaL ("Ladders" backwards — C64 Exclusive!)
    // 3 columns of continuously scrolling elevator ladders that REVERSE on bomb pickup!
    // -------------------------------------------------------------------------
    function level03() {
      const s = new StageBuilder({
        number: 3,
        name: 'sreddaL',
        girderColor: C.PURPLE,
        girderCapColor: C.LIGHT_BLUE,
        ladderColor: C.YELLOW,
        spawn: { x: 42, feetY: 160 },
        hazards: { bullets: 1, scrollingLadders: true }
      });

      // Left & Right side towers
      for (const y of [38, 78, 118, 160]) {
        s.addGirder(10, y, 78);
        s.addGirder(232, y, 78);
      }
      // Small central stepping islands
      s.addGirder(136, 58, 48);
      s.addGirder(136, 138, 48);
      // Bottom safety pads under outer towers
      s.addLadder(24, 38, 124);
      s.addLadder(288, 38, 124);

      // 3 Central Columns of Scrolling Elevator Ladders (x = 104, 156, 208)
      const cols = [
        { x: 104, speed: -0.55 },
        { x: 156, speed: 0.55 },
        { x: 208, speed: -0.55 }
      ];
      for (const col of cols) {
        for (const startY of [-18, 52, 122]) {
          s.addLadder(col.x, startY, 44, {
            scrollSpeed: col.speed,
            wrapMinY: -38,
            wrapMaxY: 172
          });
        }
      }

      // 12 Bombs (all reverse ladder scroll direction!)
      const bombs = [
        [68, 28], [68, 68], [68, 108], [68, 150],
        [142, 48], [170, 48], [142, 128], [170, 128],
        [244, 28], [244, 68], [244, 108], [244, 150]
      ];
      for (const [bx, by] of bombs) {
        s.addBomb(bx, by, { reverseScroll: true });
      }

      return s.rebuildColumns();
    },

    // -------------------------------------------------------------------------
    // LEVEL 4: HELLSTONES
    // Bouncing meteors fall down sloped tiers while homing horizontally toward player!
    // -------------------------------------------------------------------------
    function level04() {
      const s = new StageBuilder({
        number: 4,
        name: 'HELLSTONES',
        girderColor: C.GREY,
        girderCapColor: C.LIGHT_GREY,
        ladderColor: C.GREEN,
        spawn: { x: 28, feetY: 162 },
        hazards: { hellstones: 3 }
      });

      // Tier 1 (Crown platform)
      s.addGirder(96, 36, 128);
      s.addRamp(36, 46, 96, 36);
      s.addRamp(224, 36, 284, 46);

      // Tier 2
      s.addRamp(20, 82, 140, 72);
      s.addRamp(180, 72, 300, 82);

      // Tier 3
      s.addGirder(16, 118, 116);
      s.addRamp(132, 118, 188, 124);
      s.addGirder(188, 124, 116);

      // Tier 4 (Bottom)
      s.addGirder(10, 162, 134);
      s.addGirder(176, 162, 134);

      // Ladders & fast outer Green Up-Ropes
      s.addLadder(108, 36, 38);
      s.addLadder(204, 36, 38);
      s.addLadder(68, 78, 42);
      s.addLadder(244, 78, 48);
      s.addLadder(116, 118, 46);
      s.addLadder(196, 124, 40);

      s.addRope(16, 46, 116, 'up');
      s.addRope(304, 46, 116, 'up');

      // 12 Bombs
      const bombs = [
        [52, 34], [132, 26], [180, 26], [260, 34],
        [44, 70], [124, 62], [190, 62], [270, 70],
        [36, 108], [156, 110], [276, 114],
        [244, 152]
      ];
      for (const [bx, by] of bombs) s.addBomb(bx, by);

      return s.rebuildColumns();
    },

    // -------------------------------------------------------------------------
    // LEVEL 5: FIGURITS REVENGE
    // Dynamic puzzle masterpiece: bombs toggle girder bridges & ladders in real time!
    // -------------------------------------------------------------------------
    function level05() {
      const s = new StageBuilder({
        number: 5,
        name: 'FIGURITS REVENGE',
        girderColor: C.CYAN,
        girderCapColor: C.WHITE,
        ladderColor: C.PURPLE,
        spawn: { x: 154, feetY: 162 },
        hazards: { bullets: 2 }
      });

      // Permanent Island Girders + Reactive Bridges
      // Top Tier (y=38)
      s.addGirder(12, 38, 76);
      s.addGirder(88, 38, 48, { id: 'fg_b1', active: true });
      s.addGirder(136, 38, 48);
      s.addGirder(184, 38, 48, { id: 'fg_b2', active: false });
      s.addGirder(232, 38, 76);

      // Tier 2 (y=78)
      s.addGirder(12, 78, 84);
      s.addGirder(96, 78, 52, { id: 'fg_b3', active: false });
      s.addGirder(148, 78, 24);
      s.addGirder(172, 78, 52, { id: 'fg_b4', active: true });
      s.addGirder(224, 78, 84);

      // Tier 3 (y=120)
      s.addGirder(12, 120, 92);
      s.addGirder(104, 120, 112, { id: 'fg_b5', active: true });
      s.addGirder(216, 120, 92);

      // Tier 4 (Bottom y=162)
      s.addGirder(12, 162, 296);

      // Ladders (permanent + reactive)
      s.addLadder(48, 38, 42);
      s.addLadder(264, 38, 42);
      s.addLadder(156, 38, 42, { id: 'fg_l1', active: true });
      s.addLadder(80, 78, 44);
      s.addLadder(232, 78, 44);
      s.addLadder(156, 78, 44, { id: 'fg_l2', active: false });
      s.addLadder(48, 120, 44);
      s.addLadder(264, 120, 44);

      // Backup Ropes (guarantee zero softlocks regardless of bomb order!)
      s.addRope(18, 38, 124, 'up');
      s.addRope(302, 38, 124, 'up');
      s.addRope(116, 38, 82, 'down');
      s.addRope(204, 38, 82, 'down');

      // 12 Bombs with reactive bridge & ladder switches
      s.addBomb(32, 28, { toggleIds: ['fg_b2'] });
      s.addBomb(108, 28, { toggleIds: ['fg_l2'] });
      s.addBomb(156, 28, { toggleIds: ['fg_b1', 'fg_b2'] });
      s.addBomb(204, 28, { toggleIds: ['fg_b3'] });
      s.addBomb(280, 28, { toggleIds: ['fg_b4'] });

      s.addBomb(32, 68, { toggleIds: ['fg_b3', 'fg_l2'] });
      s.addBomb(156, 68, { toggleIds: ['fg_b5'] });
      s.addBomb(280, 68, { toggleIds: ['fg_b1', 'fg_b4'] });

      s.addBomb(32, 110, { toggleIds: ['fg_l1'] });
      s.addBomb(156, 110, { toggleIds: ['fg_b2', 'fg_b3'] });
      s.addBomb(280, 110, { toggleIds: ['fg_l2'] });

      s.addBomb(96, 152, { toggleIds: ['fg_b5'] });

      return s.rebuildColumns();
    },

    // -------------------------------------------------------------------------
    // LEVEL 6: WALLS
    // Sliding Brick Walls patrol horizontal girder corridors + 1 Alienator Bullet
    // -------------------------------------------------------------------------
    function level06() {
      const s = new StageBuilder({
        number: 6,
        name: 'WALLS',
        girderColor: C.LIGHT_BLUE,
        girderCapColor: C.WHITE,
        ladderColor: C.LIGHT_GREY,
        spawn: { x: 18, feetY: 160 },
        hazards: {
          bullets: 1,
          walls: [
            { x: 70, feetY: 40, minX: 40, maxX: 268, vx: 0.95 },
            { x: 220, feetY: 80, minX: 40, maxX: 268, vx: -1.05 },
            { x: 110, feetY: 120, minX: 40, maxX: 268, vx: 1.0 },
            { x: 240, feetY: 160, minX: 44, maxX: 268, vx: -0.9 }
          ]
        }
      });

      s.addGirder(10, 40, 300);
      s.addGirder(10, 80, 300);
      s.addGirder(10, 120, 300);
      s.addGirder(10, 160, 300);

      // Safe outer ladders + 3 mid-corridor refuge ladders
      s.addLadder(20, 40, 122);
      s.addLadder(92, 40, 122);
      s.addLadder(156, 40, 122);
      s.addLadder(220, 40, 122);
      s.addLadder(292, 40, 122);

      // 12 Bombs along corridors
      const bombs = [
        [56, 30], [124, 30], [188, 30], [256, 30],
        [56, 70], [188, 70], [256, 70],
        [56, 110], [124, 110], [256, 110],
        [124, 150], [188, 150]
      ];
      for (const [bx, by] of bombs) s.addBomb(bx, by);

      return s.rebuildColumns();
    },

    // -------------------------------------------------------------------------
    // LEVEL 7: ZIG-ZAG
    // Chevron catwalks patrolled by 3 diagonal sawtooth Zig-Zaggers!
    // -------------------------------------------------------------------------
    function level07() {
      const s = new StageBuilder({
        number: 7,
        name: 'ZIG-ZAG',
        girderColor: C.GREEN,
        girderCapColor: C.LIGHT_GREEN,
        ladderColor: C.YELLOW,
        spawn: { x: 154, feetY: 162 },
        hazards: { zigzaggers: 3 }
      });

      // V-shaped & chevron sloped girders
      s.addRamp(16, 44, 100, 34);
      s.addRamp(100, 34, 160, 46);
      s.addRamp(160, 46, 220, 34);
      s.addRamp(220, 34, 304, 44);

      s.addRamp(16, 80, 96, 90);
      s.addGirder(96, 90, 128);
      s.addRamp(224, 90, 304, 80);

      s.addGirder(16, 124, 116);
      s.addGirder(188, 124, 116);

      s.addGirder(12, 162, 296);

      // Ladders & Ropes
      s.addLadder(96, 34, 58);
      s.addLadder(216, 34, 58);
      s.addLadder(60, 86, 40);
      s.addLadder(252, 86, 40);
      s.addLadder(116, 124, 40);
      s.addLadder(196, 124, 40);

      s.addRope(20, 44, 118, 'up');
      s.addRope(300, 44, 118, 'up');
      s.addRope(160, 46, 116, 'down');

      const bombs = [
        [36, 32], [96, 24], [216, 24], [276, 32],
        [36, 70], [136, 80], [176, 80], [276, 70],
        [36, 114], [92, 114], [220, 114], [276, 114]
      ];
      for (const [bx, by] of bombs) s.addBomb(bx, by);

      return s.rebuildColumns();
    },

    // -------------------------------------------------------------------------
    // LEVEL 8: SPELLBOUND
    // 12 Bombs reveal "SR.JUMPWOMAN" in the center banner (+250 bonus in order!)
    // -------------------------------------------------------------------------
    function level08() {
      const s = new StageBuilder({
        number: 8,
        name: 'SPELLBOUND',
        girderColor: C.YELLOW,
        girderCapColor: C.WHITE,
        ladderColor: C.LIGHT_BLUE,
        spawn: { x: 154, feetY: 162 },
        hazards: { bullets: 2, spellbound: true }
      });

      // Upper & Lower Galleries framing the center "SR.JUMPWOMAN" display box (y=84..104)
      s.addGirder(12, 36, 296);
      s.addGirder(12, 68, 296);

      // Center banner frame girders
      s.addGirder(56, 104, 208);

      s.addGirder(12, 132, 296);
      s.addGirder(12, 162, 296);

      // Ladders (outer ladders bypass center banner; inner ladders connect galleries)
      s.addLadder(28, 36, 128);
      s.addLadder(284, 36, 128);
      s.addLadder(96, 36, 34);
      s.addLadder(216, 36, 34);
      s.addLadder(96, 132, 32);
      s.addLadder(216, 132, 32);
      s.addLadder(156, 104, 30);

      s.addRope(14, 36, 126, 'up');
      s.addRope(306, 36, 126, 'down');

      // 12 Bombs ordered left-to-right across the 3 bomb rows -> S R . J U M P W O M A N
      const orderedBombs = [
        [52, 26], [124, 26], [188, 26], [260, 26],   // S R . J
        [52, 58], [124, 58], [188, 58], [260, 58],   // U M P W
        [52, 122], [124, 122], [188, 122], [260, 122] // O M A N
      ];
      orderedBombs.forEach(([bx, by], idx) => {
        s.addBomb(bx, by, { letterIndex: idx });
      });

      return s.rebuildColumns();
    },

    // -------------------------------------------------------------------------
    // LEVEL 9: BLACKOUT
    // Girders & ladders turn pitch black after spawn, flashing briefly on bomb pickup!
    // -------------------------------------------------------------------------
    function level09() {
      const s = new StageBuilder({
        number: 9,
        name: 'BLACKOUT',
        girderColor: C.WHITE,
        girderCapColor: C.CYAN,
        ladderColor: C.YELLOW,
        spawn: { x: 32, feetY: 160 },
        hazards: { bullets: 1, blackout: true }
      });

      s.addGirder(12, 40, 296);
      s.addGirder(12, 80, 132);
      s.addGirder(176, 80, 132);
      s.addGirder(12, 120, 296);
      s.addGirder(12, 160, 136);
      s.addGirder(172, 160, 136);

      s.addLadder(44, 40, 122);
      s.addLadder(120, 40, 82);
      s.addLadder(192, 40, 82);
      s.addLadder(268, 40, 122);
      s.addLadder(120, 120, 42);
      s.addLadder(192, 120, 42);

      // Ropes stay visible in the dark just like C64 Jumpman Junior!
      s.addRope(18, 40, 120, 'up');
      s.addRope(302, 40, 120, 'down');

      const bombs = [
        [28, 30], [96, 30], [216, 30], [284, 30],
        [68, 70], [132, 70], [180, 70], [244, 70],
        [28, 110], [156, 110], [284, 110],
        [244, 150]
      ];
      for (const [bx, by] of bombs) s.addBomb(bx, by);

      return s.rebuildColumns();
    },

    // -------------------------------------------------------------------------
    // LEVEL 10: HERETHEREEVERYWHERE
    // Phasing / Teleporting Bombs blink & warp between 20 platform sockets!
    // -------------------------------------------------------------------------
    function level10() {
      const s = new StageBuilder({
        number: 10,
        name: 'HERETHEREEVERYWHERE',
        girderColor: C.LIGHT_RED,
        girderCapColor: C.WHITE,
        ladderColor: C.CYAN,
        spawn: { x: 154, feetY: 160 },
        hazards: { bullets: 2, teleportBombs: true }
      });

      s.addGirder(12, 38, 124);
      s.addGirder(184, 38, 124);
      s.addRamp(136, 38, 184, 46);

      s.addGirder(12, 78, 296);

      s.addGirder(12, 118, 124);
      s.addRamp(136, 118, 184, 112);
      s.addGirder(184, 112, 124);

      s.addGirder(12, 160, 296);

      s.addLadder(44, 38, 124);
      s.addLadder(116, 38, 82);
      s.addLadder(196, 38, 76);
      s.addLadder(268, 38, 124);
      s.addLadder(156, 78, 84);

      s.addRope(18, 38, 122, 'up');
      s.addRope(302, 38, 122, 'up');

      const sockets = [
        [28, 28], [76, 28], [120, 28], [204, 28], [244, 28], [288, 28],
        [28, 68], [76, 68], [136, 68], [176, 68], [236, 68], [288, 68],
        [28, 108], [76, 108], [120, 108], [204, 102], [248, 102], [288, 102],
        [84, 150], [228, 150]
      ];
      sockets.forEach(([sx, sy], i) => {
        s.addBombSocket(sx, sy);
        if (i < 12) s.addBomb(sx, sy);
      });

      return s.rebuildColumns();
    },

    // -------------------------------------------------------------------------
    // LEVEL 11: HATCHLINGS
    // Alien Eggs crack open on roosts to release darting, swooping Hatchlings!
    // -------------------------------------------------------------------------
    function level11() {
      const s = new StageBuilder({
        number: 11,
        name: 'HATCHLINGS',
        girderColor: C.ORANGE,
        girderCapColor: C.YELLOW,
        ladderColor: C.GREEN,
        spawn: { x: 154, feetY: 162 },
        hazards: { hatchlings: 4 }
      });

      // Upper Roosts
      s.addGirder(16, 36, 112);
      s.addGirder(192, 36, 112);
      s.addGirder(116, 52, 88);

      // Mid Branches
      s.addRamp(16, 82, 116, 76);
      s.addGirder(116, 76, 88);
      s.addRamp(204, 76, 304, 82);

      // Lower Roosts
      s.addGirder(16, 120, 120);
      s.addGirder(184, 120, 120);

      // Floor
      s.addGirder(10, 162, 300);

      // Ladders & Ropes
      s.addLadder(56, 36, 46);
      s.addLadder(256, 36, 46);
      s.addLadder(120, 52, 70);
      s.addLadder(192, 52, 70);
      s.addLadder(48, 82, 82);
      s.addLadder(264, 82, 82);

      s.addRope(20, 36, 126, 'up');
      s.addRope(300, 36, 126, 'up');
      s.addRope(160, 52, 110, 'down');

      const bombs = [
        [32, 26], [100, 26], [212, 26], [280, 26],
        [156, 42],
        [32, 70], [156, 66], [280, 70],
        [32, 110], [100, 110], [212, 110], [280, 110]
      ];
      for (const [bx, by] of bombs) s.addBomb(bx, by);

      return s.rebuildColumns();
    },

    // -------------------------------------------------------------------------
    // LEVEL 12: HURRICANE
    // Jupiter Gale blows Senior Jumpwoman mid-jump + Storm Birds soar across sky!
    // -------------------------------------------------------------------------
    function level12() {
      const s = new StageBuilder({
        number: 12,
        name: 'HURRICANE',
        girderColor: C.BLUE,
        girderCapColor: C.CYAN,
        ladderColor: C.WHITE,
        spawn: { x: 28, feetY: 162 },
        hazards: { hurricane: true }
      });

      // Storm Towers & Bridges (generous landing pads for wind-assisted jumps!)
      s.addGirder(12, 38, 128);
      s.addGirder(180, 38, 128);

      s.addGirder(12, 78, 96);
      s.addGirder(124, 78, 72);
      s.addGirder(212, 78, 96);

      s.addGirder(12, 120, 132);
      s.addGirder(176, 120, 132);

      s.addGirder(10, 162, 300);

      // Ladders & Storm Ropes
      s.addLadder(44, 38, 126);
      s.addLadder(128, 38, 42);
      s.addLadder(184, 38, 42);
      s.addLadder(268, 38, 126);
      s.addLadder(92, 78, 44);
      s.addLadder(220, 78, 44);
      s.addLadder(132, 120, 44);
      s.addLadder(180, 120, 44);

      s.addRope(18, 38, 124, 'up');
      s.addRope(302, 38, 124, 'up');
      s.addRope(160, 78, 84, 'down');

      const bombs = [
        [28, 28], [96, 28], [216, 28], [284, 28],
        [28, 68], [156, 68], [284, 68],
        [28, 110], [112, 110], [200, 110], [284, 110],
        [220, 152]
      ];
      for (const [bx, by] of bombs) s.addBomb(bx, by);

      return s.rebuildColumns();
    }
  ];

  // ===========================================================================
  // POST-LEVEL-12 "WELL DONE" CELEBRATION STAGE
  // Builds giant C64 girders spelling "WELL" and "DONE" while Senior Jumpwoman dances!
  // ===========================================================================
  function buildWellDoneStage() {
    const s = new StageBuilder({
      number: 12,
      name: 'WELL DONE!',
      girderColor: C.RED,
      girderCapColor: C.YELLOW,
      ladderColor: C.CYAN,
      spawn: { x: 154, feetY: 42 },
      hazards: {}
    });

    // Top Dance Stage Girder
    s.addGirder(48, 42, 224);

    // Helper to build blocky girder letters
    const vBar = (x, y, h, col) => {
      for (let py = y; py < y + h; py += 4) {
        s.addGirder(x, py, 8, { color: col, capColor: C.WHITE });
      }
    };
    const hBar = (x, y, w, col) => {
      s.addGirder(x, y, w, { color: col, capColor: C.WHITE });
    };

    // "WELL" at y = 66..98
    // W
    vBar(56, 66, 32, C.CYAN);
    vBar(76, 78, 20, C.CYAN);
    vBar(96, 66, 32, C.CYAN);
    hBar(56, 94, 48, C.CYAN);
    // E
    vBar(116, 66, 32, C.YELLOW);
    hBar(116, 66, 32, C.YELLOW);
    hBar(116, 80, 24, C.YELLOW);
    hBar(116, 94, 32, C.YELLOW);
    // L
    vBar(160, 66, 32, C.LIGHT_GREEN);
    hBar(160, 94, 32, C.LIGHT_GREEN);
    // L
    vBar(204, 66, 32, C.LIGHT_RED);
    hBar(204, 94, 32, C.LIGHT_RED);

    // "DONE" at y = 116..148
    // D
    vBar(56, 116, 32, C.PURPLE);
    hBar(56, 116, 28, C.PURPLE);
    hBar(56, 144, 28, C.PURPLE);
    vBar(84, 120, 24, C.PURPLE);
    // O
    vBar(108, 116, 32, C.YELLOW);
    vBar(136, 116, 32, C.YELLOW);
    hBar(108, 116, 36, C.YELLOW);
    hBar(108, 144, 36, C.YELLOW);
    // N
    vBar(158, 116, 32, C.CYAN);
    vBar(172, 124, 16, C.CYAN);
    vBar(186, 116, 32, C.CYAN);
    hBar(158, 116, 20, C.CYAN);
    hBar(174, 144, 20, C.CYAN);
    // E
    vBar(208, 116, 32, C.GREEN);
    hBar(208, 116, 32, C.GREEN);
    hBar(208, 130, 24, C.GREEN);
    hBar(208, 144, 32, C.GREEN);

    return s.rebuildColumns();
  }

  /**
   * Build level by 1-based stage number:
   * - 1..12: Exact 12 original C64 levels in sequence
   * - 13+: Endless randomized stages from 1..12 with escalated hazard intensity!
   */
  function createStage(stageNumber) {
    let idx;
    if (stageNumber <= 12) {
      idx = Math.max(0, stageNumber - 1);
    } else {
      idx = Math.floor(Math.random() * LEVEL_BUILDERS.length);
    }
    const stage = LEVEL_BUILDERS[idx]();
    stage.campaignStage = stageNumber;

    // Escalate hazard count slightly on endless post-Level-12 loop!
    if (stageNumber > 12) {
      if (stage.hazards.bullets > 0) {
        stage.hazards.bullets = Math.min(3, stage.hazards.bullets + 1);
      }
      if (stage.hazards.hellstones > 0) {
        stage.hazards.hellstones = 4;
      }
      if (stage.hazards.zigzaggers > 0) {
        stage.hazards.zigzaggers = 4;
      }
    }
    return stage;
  }

  global.Levels = {
    SPELL_TARGET,
    LEVEL_COUNT: LEVEL_BUILDERS.length,
    LEVEL_NAMES: [
      'NOTHING TO IT',
      'FIRE! FIRE!',
      'sreddaL',
      'HELLSTONES',
      'FIGURITS REVENGE',
      'WALLS',
      'ZIG-ZAG',
      'SPELLBOUND',
      'BLACKOUT',
      'HERETHEREEVERYWHERE',
      'HATCHLINGS',
      'HURRICANE'
    ],
    createStage,
    buildWellDoneStage
  };
})(window);
