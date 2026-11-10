/**
 * SENIOR JUMPWOMAN — Core C64 Game Engine, Physics, Hazards & State Machine
 * 100% Faithful Tribute to Epyx's Commodore 64 "Jumpman Junior" (1983, Randy Glover)
 */
(function (global) {
  'use strict';

  const { C, SPRITES, VICII } = global.C64;
  const SID = global.SID;
  const Levels = global.Levels;

  // Speed 1 (fastest) .. Speed 8 (slowest) — scales master simulation rate so jump
  // pixel trajectories remain 100% invariant across all 8 speeds!
  const SPEED_FACTORS = {
    1: 1.42,
    2: 1.26,
    3: 1.12,
    4: 1.00,
    5: 0.88,
    6: 0.77,
    7: 0.66,
    8: 0.55
  };

  const STORAGE_KEY_SCORES = 'senior_jumpwoman_hiscores_v1';

  const DEFAULT_HIGH_SCORES = [
    { name: 'SJW', score: 14800, level: 12 },
    { name: 'EPX', score: 11200, level: 10 },
    { name: 'RGL', score: 9400, level: 8 },
    { name: 'C64', score: 7600, level: 7 },
    { name: 'SID', score: 6100, level: 6 },
    { name: 'VIC', score: 4800, level: 5 },
    { name: 'OMA', score: 3200, level: 3 },
    { name: 'JUP', score: 1800, level: 2 }
  ];

  class SeniorJumpwomanGame {
    constructor(canvas, uiCallbacks = {}) {
      this.vic = new VICII(canvas);
      this.ui = uiCallbacks;

      // Input state
      this.keys = {
        left: false,
        right: false,
        up: false,
        down: false,
        jump: false
      };
      this.touchKeys = {
        left: false,
        right: false,
        up: false,
        down: false,
        jump: false
      };
      this.jumpPressedEdge = false;
      this._prevJumpDown = false;

      // Master state machine
      // TITLE | ATTRACT_PREVIEW | HIGH_SCORES | SELECT_PLAYERS | SELECT_SPEED |
      // PLAYER_READY | SPAWNING | PLAYING | DYING | LEVEL_CLEAR | WELL_DONE |
      // GAME_OVER | ENTER_INITIALS
      this.state = 'TITLE';
      this.stateTimer = 0;
      this.frameCount = 0;
      this.paused = false;

      // Attract loop state
      this.attractIndex = 0;
      this.attractStage = null;

      // Setup menu state
      this.pendingNumPlayers = 1;
      this.speedSelectPlayerIdx = 0;
      this.pendingSpeed = 4;

      // Multi-player roster (1..4 players)
      this.players = [];
      this.currentPlayerIdx = 0;
      this.practiceMode = false;

      // Active stage & hazards
      this.stage = null;
      this.ladderScrollSign = 1;
      this.activeFlameGroup = 0;
      this.blackoutLitTimer = 0;
      this.teleportTimer = 0;

      // Spellbound ("SR.JUMPWOMAN") state
      this.revealedLetters = new Array(12).fill(false);
      this.nextSpellIndex = 0;
      this.floatingPopups = [];

      // Hazards arrays
      this.bullets = [];
      this.hellstones = [];
      this.walls = [];
      this.zigzaggers = [];
      this.eggs = [];
      this.hatchlings = [];
      this.birds = [];
      this.windDir = 1;
      this.windTimer = 0;
      this.windParticles = [];
      this.particles = [];
      this.crumbleBlocks = [];

      // Senior Jumpwoman actor state
      this.sjw = {
        x: 154,
        y: 146,
        vx: 0,
        vy: 0,
        facing: 1, // 1 = Right, -1 = Left
        mode: 'GROUND', // GROUND | JUMP | LADDER | ROPE
        ladder: null,
        rope: null,
        ropeIgnoreTimer: 0,
        jumpStartFeetY: 160,
        animTick: 0,
        stepSoundAccum: 0,
        stepToggle: false,
        deathPhase: 'tumble', // 'tumble' | 'kabam'
        deathTimer: 0
      };

      // Level Clear tally state
      this.clearPhase = 0;
      this.lifeBonusRemaining = 0;
      this.lifeBonusAwarded = 0;
      this.bonusTickStep = 0;

      // High scores & initials entry
      this.highScores = this._loadHighScores();
      this.initialsQueue = [];
      this.currentInitials = ['S', 'J', 'W'];
      this.initialSlot = 0;

      // Fixed-step accumulator
      this.lastTimestamp = 0;
      this.simAccumulator = 0;

      this._bindInputs();
      this.enterTitle(false);
    }

    _loadHighScores() {
      try {
        const raw = global.localStorage.getItem(STORAGE_KEY_SCORES);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
      } catch (e) {}
      return DEFAULT_HIGH_SCORES.map((e) => Object.assign({}, e));
    }

    _saveHighScores() {
      try {
        global.localStorage.setItem(
          STORAGE_KEY_SCORES,
          JSON.stringify(this.highScores)
        );
      } catch (e) {}
    }

    // =========================================================================
    // INPUT HANDLING (Keyboard + HTML5 Gamepad + Virtual Joystick)
    // =========================================================================
    _bindInputs() {
      global.addEventListener('keydown', (e) => {
        SID.unlock();

        if (e.code === 'F1') {
          e.preventDefault();
          this.enterTitle(true);
          return;
        }
        if (e.code === 'F3') {
          e.preventDefault();
          this.quickStart(1, 4, 1);
          return;
        }
        if (e.code === 'KeyM' && this.state !== 'ENTER_INITIALS') {
          const muted = SID.toggleMute();
          if (this.ui.onMuteChange) this.ui.onMuteChange(muted);
          return;
        }
        if (e.code === 'KeyP' && this.state === 'PLAYING') {
          this.paused = !this.paused;
          if (this.paused) SID.setWindActive(false);
          else if (this.stage && this.stage.hazards.hurricane) {
            SID.setWindActive(true);
          }
          return;
        }

        // State-specific menu shortcuts
        if (this._handleMenuKeyDown(e)) {
          e.preventDefault();
          return;
        }

        switch (e.code) {
          case 'ArrowLeft':
          case 'KeyA':
            this.keys.left = true;
            e.preventDefault();
            break;
          case 'ArrowRight':
          case 'KeyD':
            this.keys.right = true;
            e.preventDefault();
            break;
          case 'ArrowUp':
          case 'KeyW':
            this.keys.up = true;
            e.preventDefault();
            break;
          case 'ArrowDown':
          case 'KeyS':
            this.keys.down = true;
            e.preventDefault();
            break;
          case 'Space':
          case 'KeyZ':
          case 'KeyX':
          case 'ShiftLeft':
          case 'ShiftRight':
          case 'ControlLeft':
          case 'ControlRight':
          case 'Enter':
            this.keys.jump = true;
            e.preventDefault();
            break;
        }
      });

      global.addEventListener('keyup', (e) => {
        switch (e.code) {
          case 'ArrowLeft':
          case 'KeyA':
            this.keys.left = false;
            break;
          case 'ArrowRight':
          case 'KeyD':
            this.keys.right = false;
            break;
          case 'ArrowUp':
          case 'KeyW':
            this.keys.up = false;
            break;
          case 'ArrowDown':
          case 'KeyS':
            this.keys.down = false;
            break;
          case 'Space':
          case 'KeyZ':
          case 'KeyX':
          case 'ShiftLeft':
          case 'ShiftRight':
          case 'ControlLeft':
          case 'ControlRight':
          case 'Enter':
            this.keys.jump = false;
            break;
        }
      });

      global.addEventListener('pointerdown', () => {
        SID.unlock();
      }, { once: true });
    }

    _handleMenuKeyDown(e) {
      const code = e.code;
      const key = e.key;

      if (
        this.state === 'TITLE' ||
        this.state === 'ATTRACT_PREVIEW' ||
        this.state === 'HIGH_SCORES'
      ) {
        if (
          code === 'Space' ||
          code === 'Enter' ||
          code === 'KeyZ' ||
          code === 'Digit1'
        ) {
          this.enterSelectPlayers();
          return true;
        }
        return false;
      }

      if (this.state === 'SELECT_PLAYERS') {
        if (key >= '1' && key <= '4') {
          this.pendingNumPlayers = parseInt(key, 10);
          this._confirmPlayersCount();
          return true;
        }
        if (code === 'ArrowLeft' || code === 'KeyA' || code === 'ArrowDown') {
          this.pendingNumPlayers =
            this.pendingNumPlayers > 1 ? this.pendingNumPlayers - 1 : 4;
          SID.sfxStep(false);
          return true;
        }
        if (code === 'ArrowRight' || code === 'KeyD' || code === 'ArrowUp') {
          this.pendingNumPlayers =
            this.pendingNumPlayers < 4 ? this.pendingNumPlayers + 1 : 1;
          SID.sfxStep(true);
          return true;
        }
        if (code === 'Space' || code === 'Enter' || code === 'KeyZ') {
          this._confirmPlayersCount();
          return true;
        }
        return true;
      }

      if (this.state === 'SELECT_SPEED') {
        if (key >= '1' && key <= '8') {
          this.pendingSpeed = parseInt(key, 10);
          this._confirmPlayerSpeed();
          return true;
        }
        if (code === 'ArrowLeft' || code === 'KeyA' || code === 'ArrowDown') {
          this.pendingSpeed =
            this.pendingSpeed > 1 ? this.pendingSpeed - 1 : 8;
          SID.sfxStep(false);
          return true;
        }
        if (code === 'ArrowRight' || code === 'KeyD' || code === 'ArrowUp') {
          this.pendingSpeed =
            this.pendingSpeed < 8 ? this.pendingSpeed + 1 : 1;
          SID.sfxStep(true);
          return true;
        }
        if (code === 'Space' || code === 'Enter' || code === 'KeyZ') {
          this._confirmPlayerSpeed();
          return true;
        }
        return true;
      }

      if (this.state === 'ENTER_INITIALS') {
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.- ';
        if (key && key.length === 1 && /^[a-zA-Z0-9.\- ]$/.test(key)) {
          this.currentInitials[this.initialSlot] = key.toUpperCase();
          SID.sfxClimb(true);
          if (this.initialSlot < 2) {
            this.initialSlot++;
          } else {
            this._commitInitials();
          }
          return true;
        }
        if (code === 'Backspace' || code === 'ArrowLeft') {
          this.initialSlot = Math.max(0, this.initialSlot - 1);
          SID.sfxStep(false);
          return true;
        }
        if (code === 'ArrowRight') {
          this.initialSlot = Math.min(2, this.initialSlot + 1);
          SID.sfxStep(true);
          return true;
        }
        if (code === 'ArrowUp') {
          const cur = alphabet.indexOf(this.currentInitials[this.initialSlot]);
          this.currentInitials[this.initialSlot] =
            alphabet[(cur + 1) % alphabet.length];
          SID.sfxClimb(false);
          return true;
        }
        if (code === 'ArrowDown') {
          const cur = alphabet.indexOf(this.currentInitials[this.initialSlot]);
          this.currentInitials[this.initialSlot] =
            alphabet[(cur - 1 + alphabet.length) % alphabet.length];
          SID.sfxClimb(true);
          return true;
        }
        if (code === 'Enter' || code === 'Space') {
          this._commitInitials();
          return true;
        }
        return true;
      }

      return false;
    }

    _pollInput() {
      let gpLeft = false;
      let gpRight = false;
      let gpUp = false;
      let gpDown = false;
      let gpJump = false;

      if (navigator.getGamepads) {
        const pads = navigator.getGamepads();
        for (let i = 0; i < pads.length; i++) {
          const gp = pads[i];
          if (!gp) continue;
          if (gp.axes[0] < -0.4 || (gp.buttons[14] && gp.buttons[14].pressed)) {
            gpLeft = true;
          }
          if (gp.axes[0] > 0.4 || (gp.buttons[15] && gp.buttons[15].pressed)) {
            gpRight = true;
          }
          if (gp.axes[1] < -0.4 || (gp.buttons[12] && gp.buttons[12].pressed)) {
            gpUp = true;
          }
          if (gp.axes[1] > 0.4 || (gp.buttons[13] && gp.buttons[13].pressed)) {
            gpDown = true;
          }
          if (
            (gp.buttons[0] && gp.buttons[0].pressed) ||
            (gp.buttons[1] && gp.buttons[1].pressed) ||
            (gp.buttons[2] && gp.buttons[2].pressed)
          ) {
            gpJump = true;
          }
        }
      }

      const jumpNow = this.keys.jump || this.touchKeys.jump || gpJump;
      if (jumpNow && !this._prevJumpDown) {
        this.jumpPressedEdge = true;
        // Allow gamepad/touch Fire button to advance Title/Menus too!
        if (
          this.state === 'TITLE' ||
          this.state === 'ATTRACT_PREVIEW' ||
          this.state === 'HIGH_SCORES'
        ) {
          this.enterSelectPlayers();
          this.jumpPressedEdge = false;
        } else if (this.state === 'SELECT_PLAYERS') {
          this._confirmPlayersCount();
          this.jumpPressedEdge = false;
        } else if (this.state === 'SELECT_SPEED') {
          this._confirmPlayerSpeed();
          this.jumpPressedEdge = false;
        }
      }
      this._prevJumpDown = jumpNow;

      return {
        left: this.keys.left || this.touchKeys.left || gpLeft,
        right: this.keys.right || this.touchKeys.right || gpRight,
        up: this.keys.up || this.touchKeys.up || gpUp,
        down: this.keys.down || this.touchKeys.down || gpDown,
        jump: jumpNow
      };
    }

    setTouchInput(dir, pressed) {
      SID.unlock();
      if (dir in this.touchKeys) {
        this.touchKeys[dir] = pressed;
      }
    }

    // =========================================================================
    // STATE TRANSITIONS & MULTI-PLAYER CAMPAIGN MANAGEMENT
    // =========================================================================
    enterTitle(playMusic = true) {
      this.paused = false;
      this.state = 'TITLE';
      this.stateTimer = 0;
      SID.setWindActive(false);
      if (playMusic) {
        SID.playTitleTheme();
      }
      if (this.ui.onStateChange) this.ui.onStateChange('TITLE');
    }

    enterSelectPlayers() {
      SID.stopMusic();
      SID.sfxDefuse(false);
      this.pendingNumPlayers = 1;
      this.state = 'SELECT_PLAYERS';
      this.stateTimer = 0;
    }

    _confirmPlayersCount() {
      SID.sfxDefuse(false);
      this.players = [];
      for (let i = 0; i < this.pendingNumPlayers; i++) {
        this.players.push({
          id: i + 1,
          score: 0,
          lives: 4,
          speed: 4,
          levelNum: 1,
          nextExtraLife: 7500,
          bonus: 2000,
          stage: null,
          revealedLetters: new Array(12).fill(false),
          nextSpellIndex: 0
        });
      }
      this.speedSelectPlayerIdx = 0;
      this.pendingSpeed = 4;
      this.state = 'SELECT_SPEED';
      this.stateTimer = 0;
    }

    _confirmPlayerSpeed() {
      this.players[this.speedSelectPlayerIdx].speed = this.pendingSpeed;
      SID.sfxDefuse(true);
      this.speedSelectPlayerIdx++;
      if (this.speedSelectPlayerIdx < this.players.length) {
        this.pendingSpeed = 4;
      } else {
        this.practiceMode = false;
        this.currentPlayerIdx = 0;
        SID.playStartJingle(() => {});
        this._beginPlayerTurn(true);
      }
    }

    /**
     * Direct start helper (used by F3 or hardware Level Selector bar)
     */
    quickStart(numPlayers = 1, speed = 4, startLevel = 1) {
      SID.unlock();
      SID.stopMusic();
      if (startLevel === 'WELL_DONE') {
        this.players = [
          {
            id: 1,
            score: 12000,
            lives: 4,
            speed: speed,
            levelNum: 12,
            nextExtraLife: 15000,
            bonus: 0,
            stage: null,
            revealedLetters: new Array(12).fill(false),
            nextSpellIndex: 0
          }
        ];
        this.currentPlayerIdx = 0;
        this._enterWellDone();
        return;
      }

      this.players = [];
      for (let i = 0; i < numPlayers; i++) {
        this.players.push({
          id: i + 1,
          score: 0,
          lives: 4,
          speed: speed,
          levelNum: startLevel,
          nextExtraLife: 7500,
          bonus: 2000,
          stage: null,
          revealedLetters: new Array(12).fill(false),
          nextSpellIndex: 0
        });
      }
      this.currentPlayerIdx = 0;
      this.paused = false;
      this._beginPlayerTurn(true);
    }

    get currentPlayer() {
      return this.players[this.currentPlayerIdx] || null;
    }

    _beginPlayerTurn(showReadyBanner = false) {
      const p = this.currentPlayer;
      if (!p.stage) {
        p.stage = Levels.createStage(p.levelNum);
        p.bonus = 2000 + Math.min(12, p.levelNum) * 100;
        p.revealedLetters = new Array(12).fill(false);
        p.nextSpellIndex = 0;
      }

      this.stage = p.stage;
      this.revealedLetters = p.revealedLetters;
      this.nextSpellIndex = p.nextSpellIndex;

      if (this.players.length > 1 || showReadyBanner) {
        this.state = 'PLAYER_READY';
        this.stateTimer = 0;
        SID.setWindActive(false);
      } else {
        this._spawnSeniorJumpwoman();
      }

      if (this.ui.onLevelChange) {
        this.ui.onLevelChange(p.levelNum, this.stage.name);
      }
    }

    _spawnSeniorJumpwoman() {
      const st = this.stage;
      this.paused = false;
      this.state = 'SPAWNING';
      this.stateTimer = 0;

      this.sjw.x = st.spawn.x;
      this.sjw.y = st.spawn.feetY - 14;
      this.sjw.vx = 0;
      this.sjw.vy = 0;
      this.sjw.facing = 1;
      this.sjw.mode = 'GROUND';
      this.sjw.ladder = null;
      this.sjw.rope = null;
      this.sjw.ropeIgnoreTimer = 0;
      this.sjw.jumpStartFeetY = st.spawn.feetY;
      this.sjw.animTick = 0;

      // Reset transient hazards so spawn is always 100% fair
      this._initStageHazards();
      SID.setWindActive(false);
      SID.playMaterialize();
    }

    _initStageHazards() {
      const st = this.stage;
      const hz = st.hazards;

      this.bullets = [];
      this.hellstones = [];
      this.walls = [];
      this.zigzaggers = [];
      this.eggs = [];
      this.hatchlings = [];
      this.birds = [];
      this.particles = [];
      this.floatingPopups = [];
      this.teleportTimer = 0;

      // Level 9 Blackout: illuminate structure during spawn + initial memorize window
      this.blackoutLitTimer = hz.blackout ? 195 : 0;

      // Alienator Bullets
      for (let i = 0; i < (hz.bullets || 0); i++) {
        this.bullets.push(this._spawnBullet(i * 45 + 35));
      }

      // Level 6 Moving Walls
      if (hz.walls && hz.walls.length) {
        this.walls = hz.walls.map((w) => ({
          x: w.x,
          y: w.feetY - 16,
          w: 10,
          h: 16,
          minX: w.minX,
          maxX: w.maxX,
          vx: w.vx
        }));
      }

      // Level 7 Zig-Zaggers
      for (let i = 0; i < (hz.zigzaggers || 0); i++) {
        this.zigzaggers.push({
          x: 36 + i * 108,
          y: 26 + (i % 2) * 56,
          vx: i % 2 === 0 ? 1.15 : -1.15,
          vy: 1.15,
          zigTimer: 26
        });
      }

      // Level 12 Hurricane Wind + Storm Birds
      if (hz.hurricane) {
        this.windDir = 1;
        this.windTimer = 0;
        this.windParticles = [];
        for (let i = 0; i < 26; i++) {
          this.windParticles.push({
            x: Math.random() * 320,
            y: 12 + Math.random() * 158,
            speed: 2.2 + Math.random() * 1.8
          });
        }
        for (let i = 0; i < 3; i++) {
          this.birds.push({
            x: i * 110,
            y: 28 + i * 44,
            baseY: 28 + i * 44,
            vx: 1.25 + i * 0.15,
            phase: i * 2.1
          });
        }
      }
    }

    _spawnBullet(delayTicks = 25) {
      const fromLeft = Math.random() < 0.5;
      return {
        x: fromLeft ? 2 : 310,
        y: 18 + Math.random() * 136,
        vx: fromLeft ? 0.65 : -0.65,
        vy: (Math.random() < 0.5 ? 1 : -1) * 0.55,
        locked: false,
        cooldown: delayTicks
      };
    }

    // =========================================================================
    // MAIN UPDATE LOOP (60Hz base clock, scaled by Player Speed 1..8 in PLAYING)
    // =========================================================================
    tick(dtSec) {
      this.frameCount++;
      const input = this._pollInput();

      if (this.state === 'TITLE') {
        this.stateTimer++;
        if (this.stateTimer > 450) {
          this.state = 'ATTRACT_PREVIEW';
          this.stateTimer = 0;
          this.attractIndex = 0;
          this.attractStage = Levels.createStage(1);
        }
        return;
      }

      if (this.state === 'ATTRACT_PREVIEW') {
        this.stateTimer++;
        if (this.attractStage && this.attractStage.hazards.scrollingLadders) {
          this._updateScrollingLadders(this.attractStage, 1);
        }
        if (this.stateTimer > 210) {
          this.stateTimer = 0;
          this.attractIndex++;
          if (this.attractIndex < Levels.LEVEL_COUNT) {
            this.attractStage = Levels.createStage(this.attractIndex + 1);
          } else {
            this.state = 'HIGH_SCORES';
            this.stateTimer = 0;
          }
        }
        return;
      }

      if (this.state === 'HIGH_SCORES') {
        this.stateTimer++;
        if (this.stateTimer > 300) {
          this.enterTitle(false);
        }
        return;
      }

      if (
        this.state === 'SELECT_PLAYERS' ||
        this.state === 'SELECT_SPEED' ||
        this.state === 'ENTER_INITIALS'
      ) {
        this.stateTimer++;
        return;
      }

      if (this.state === 'PLAYER_READY') {
        this.stateTimer++;
        if (this.stateTimer > 85) {
          this._spawnSeniorJumpwoman();
        }
        return;
      }

      if (this.state === 'SPAWNING') {
        this.stateTimer++;
        if (this.stateTimer > 72) {
          this.state = 'PLAYING';
          this.stateTimer = 0;
          this.jumpPressedEdge = false;
          if (this.stage.hazards.hurricane) {
            SID.setWindActive(true);
          }
        }
        return;
      }

      if (this.state === 'PLAYING') {
        if (this.paused) return;

        const speedFactor = SPEED_FACTORS[this.currentPlayer.speed] || 1.0;
        this.simAccumulator += speedFactor;
        while (this.simAccumulator >= 1.0) {
          this.simAccumulator -= 1.0;
          this._stepPlayingSimulation(input);
          this.jumpPressedEdge = false;
          if (this.state !== 'PLAYING') break;
        }
        return;
      }

      if (this.state === 'DYING') {
        this._stepDying();
        return;
      }

      if (this.state === 'LEVEL_CLEAR') {
        this._stepLevelClear();
        return;
      }

      if (this.state === 'WELL_DONE') {
        this._stepWellDone();
        return;
      }

      if (this.state === 'GAME_OVER') {
        this._stepGameOver();
        return;
      }
    }

    // =========================================================================
    // ACTIVE GAMEPLAY SIMULATION STEP
    // =========================================================================
    _stepPlayingSimulation(input) {
      this.stateTimer++;
      const p = this.currentPlayer;
      const st = this.stage;

      // Countdown BONUS clock (by 10 every 22 ticks down to 0)
      if (this.stateTimer % 22 === 0 && p.bonus > 0) {
        p.bonus = Math.max(0, p.bonus - 10);
      }

      // Blackout illumination countdown
      if (this.blackoutLitTimer > 0) {
        this.blackoutLitTimer--;
      }

      // Level 3: Scrolling Elevator Ladders
      if (st.hazards.scrollingLadders) {
        this._updateScrollingLadders(st, this.ladderScrollSign);
      }

      // Level 10: Teleporting / Phasing Bombs
      if (st.hazards.teleportBombs) {
        this._updateTeleportingBombs(st);
      }

      // Update Senior Jumpwoman movement & physics
      if (this.jumpPressedEdge) {
        this.sjw.jumpBuffer = 6;
      } else if (this.sjw.jumpBuffer > 0) {
        this.sjw.jumpBuffer--;
      }
      this._updateSeniorJumpwoman(input);
      if (this.state !== 'PLAYING') return;

      // Check Bomb Defusal!
      this._checkBombPickup();
      if (this.state !== 'PLAYING') return;

      // Update Hazards & Check Fatal Collisions
      this._updateAndCheckHazards();

      // Update floating score popups
      for (let i = this.floatingPopups.length - 1; i >= 0; i--) {
        const fp = this.floatingPopups[i];
        fp.y -= 0.35;
        fp.life--;
        if (fp.life <= 0) this.floatingPopups.splice(i, 1);
      }
    }

    _updateScrollingLadders(stage, sign) {
      for (let i = 0; i < stage.ladders.length; i++) {
        const lad = stage.ladders[i];
        if (!lad.active || !lad.scrollSpeed) continue;
        const dy = lad.scrollSpeed * sign;
        lad.y += dy;
        const span = lad.wrapMaxY - lad.wrapMinY;
        if (lad.y < lad.wrapMinY) {
          lad.y += span;
          if (this.sjw.mode === 'LADDER' && this.sjw.ladder === lad) {
            this._startDeathTumble();
          }
        } else if (lad.y > lad.wrapMaxY) {
          lad.y -= span;
          if (this.sjw.mode === 'LADDER' && this.sjw.ladder === lad) {
            this._startDeathTumble();
          }
        } else if (
          this.state === 'PLAYING' &&
          this.sjw.mode === 'LADDER' &&
          this.sjw.ladder === lad
        ) {
          this.sjw.y += dy;
          if (this.sjw.y < 2 || this.sjw.y + 14 >= 174) {
            this._startDeathTumble();
          }
        }
      }
    }

    _updateTeleportingBombs(stage) {
      this.teleportTimer++;
      const remaining = stage.bombs.filter((b) => !b.defused);
      if (remaining.length === 0) return;

      if (this.teleportTimer === 135) {
        // Warn before teleporting
        for (const b of remaining) b.phasing = false;
        const count = Math.min(2, remaining.length);
        for (let i = 0; i < count; i++) {
          const pick = remaining[Math.floor(Math.random() * remaining.length)];
          pick.phasing = true;
        }
      } else if (this.teleportTimer >= 168) {
        this.teleportTimer = 0;
        let moved = false;
        for (const b of remaining) {
          if (!b.phasing) continue;
          b.phasing = false;
          const freeSockets = stage.bombSockets.filter(
            (sock) =>
              !remaining.some(
                (other) =>
                  Math.abs(other.x - sock.x) < 6 &&
                  Math.abs(other.y - sock.y) < 6
              )
          );
          if (freeSockets.length > 0) {
            const dest =
              freeSockets[Math.floor(Math.random() * freeSockets.length)];
            b.x = dest.x;
            b.y = dest.y;
            moved = true;
          }
        }
        if (moved) SID.sfxTeleport();
      }
    }

    // =========================================================================
    // SENIOR JUMPWOMAN PHYSICS (Walk, Slopes, Trip-and-Fall, Ladders, Ropes, Jump)
    // =========================================================================
    _updateSeniorJumpwoman(input) {
      const sjw = this.sjw;
      const st = this.stage;

      if (sjw.ropeIgnoreTimer > 0) sjw.ropeIgnoreTimer--;

      const centerX = sjw.x + 6;
      const feetY = sjw.y + 14;

      // --------------------- GROUND MODE ---------------------
      if (sjw.mode === 'GROUND') {
        // Verify girder still exists beneath feet (in case reactive trigger removed floor!)
        const curSurface = st.findGirderSurface(centerX, feetY - 4, feetY + 4);
        if (curSurface === null) {
          this._startDeathTumble();
          return;
        }
        sjw.y = curSurface - 14;

        // Jump initiation!
        if (sjw.jumpBuffer > 0 || this.jumpPressedEdge) {
          this._initiateJump(input);
          return;
        }

        // Climb Up / Down onto Ladder
        if (input.up || input.down) {
          const lad = this._findOverlappingLadder(
            centerX,
            input.up ? feetY - 8 : feetY + 2,
            input.up ? feetY + 2 : feetY + 10
          );
          if (lad) {
            sjw.mode = 'LADDER';
            sjw.ladder = lad;
            sjw.x = lad.x - 2;
            sjw.y += input.up ? -1.5 : 2.0;
            return;
          }
        }

        // Walk Left / Right
        let moveDir = 0;
        if (input.left && !input.right) moveDir = -1;
        else if (input.right && !input.left) moveDir = 1;

        if (moveDir !== 0) {
          sjw.facing = moveDir;
          sjw.animTick += 0.22;
          sjw.stepSoundAccum += 1;
          if (sjw.stepSoundAccum >= 10) {
            sjw.stepSoundAccum = 0;
            sjw.stepToggle = !sjw.stepToggle;
            SID.sfxStep(sjw.stepToggle);
          }

          const nx = Math.max(2, Math.min(306, sjw.x + moveDir * 1.25));
          const nCenterX = nx + 6;

          // Check rope grab while walking
          const rope = this._findOverlappingRope(nCenterX, sjw.y + 2, feetY);
          if (rope && sjw.ropeIgnoreTimer <= 0) {
            this._attachRope(rope);
            return;
          }

          // Check girder surface (supports slopes up/down ±4px!)
          const nextGy = st.findGirderSurface(nCenterX, feetY - 4, feetY + 4);
          if (nextGy !== null) {
            sjw.x = nx;
            sjw.y = nextGy - 14;
          } else {
            // Walked off a girder edge/hole without jumping -> Classic Jumpman Trip & Tumble!
            sjw.x = nx;
            this._startDeathTumble();
          }
        } else {
          sjw.animTick = 0;
        }
        return;
      }

      // --------------------- LADDER MODE ---------------------
      if (sjw.mode === 'LADDER') {
        const lad = sjw.ladder;
        if (!lad || !lad.active) {
          this._startDeathTumble();
          return;
        }

        // Jump off ladder
        if (sjw.jumpBuffer > 0 || this.jumpPressedEdge) {
          this._initiateJump(input);
          return;
        }

        // Step horizontally onto an aligned girder if pressing Left or Right
        if (input.left || input.right) {
          const dir = input.left ? -1 : 1;
          sjw.facing = dir;
          const probeX = centerX + dir * 7;
          const gy = st.findGirderSurface(probeX, feetY - 5, feetY + 5);
          if (gy !== null) {
            sjw.mode = 'GROUND';
            sjw.ladder = null;
            sjw.x = Math.max(2, Math.min(306, sjw.x + dir * 5));
            sjw.y = gy - 14;
            return;
          }
        }

        // Climb vertically
        let climbDir = 0;
        if (input.up && !input.down) climbDir = -1;
        else if (input.down && !input.up) climbDir = 1;

        if (climbDir !== 0) {
          const ny = sjw.y + climbDir * 1.08;
          const nFeetY = ny + 14;

          sjw.animTick += 0.18;
          sjw.stepSoundAccum += 1;
          if (sjw.stepSoundAccum >= 11) {
            sjw.stepSoundAccum = 0;
            sjw.stepToggle = !sjw.stepToggle;
            SID.sfxClimb(sjw.stepToggle);
          }

          if (climbDir < 0) {
            // Climbing UP: check if reaching top of ladder
            const topFeetLimit = lad.y;
            if (nFeetY <= topFeetLimit) {
              const topGy = st.findGirderSurface(
                centerX,
                topFeetLimit - 4,
                topFeetLimit + 5
              );
              if (topGy !== null) {
                sjw.mode = 'GROUND';
                sjw.ladder = null;
                sjw.y = topGy - 14;
              } else {
                sjw.y = topFeetLimit - 14;
              }
            } else {
              sjw.y = ny;
            }
          } else {
            // Climbing DOWN: check if reaching bottom of ladder
            const botFeetLimit = lad.y + lad.h;
            if (nFeetY >= botFeetLimit) {
              const botGy = st.findGirderSurface(
                centerX,
                botFeetLimit - 5,
                botFeetLimit + 5
              );
              if (botGy !== null) {
                sjw.mode = 'GROUND';
                sjw.ladder = null;
                sjw.y = botGy - 14;
              } else {
                sjw.y = botFeetLimit - 14;
              }
            } else {
              sjw.y = ny;
            }
          }
        }
        return;
      }

      // --------------------- ROPE MODE ---------------------
      if (sjw.mode === 'ROPE') {
        const rope = sjw.rope;
        if (!rope || !rope.active) {
          this._startDeathTumble();
          return;
        }

        // Jump off rope!
        if (
          (sjw.jumpBuffer > 0 || this.jumpPressedEdge) &&
          (input.left || input.right || input.jump)
        ) {
          sjw.ropeIgnoreTimer = 14;
          this._initiateJump(input);
          return;
        }

        // Step off onto an adjacent girder if Left/Right pressed at girder height
        if (input.left || input.right) {
          const dir = input.left ? -1 : 1;
          const gy = st.findGirderSurface(
            centerX + dir * 7,
            feetY - 5,
            feetY + 5
          );
          if (gy !== null) {
            sjw.mode = 'GROUND';
            sjw.rope = null;
            sjw.ropeIgnoreTimer = 12;
            sjw.x = Math.max(2, Math.min(306, sjw.x + dir * 6));
            sjw.y = gy - 14;
            return;
          }
        }

        sjw.animTick += 0.25;
        sjw.stepSoundAccum++;
        if (sjw.stepSoundAccum >= 9) {
          sjw.stepSoundAccum = 0;
          SID.sfxRope(rope.type === 'up', Math.floor(sjw.animTick * 4));
        }

        if (rope.type === 'up') {
          // Green Up-Rope: pulls Senior Jumpwoman automatically UP!
          const ny = sjw.y - 1.45;
          const nFeetY = ny + 14;
          if (nFeetY <= rope.y + 2) {
            sjw.y = rope.y + 2 - 14;
            // Auto-step onto top girder if present
            const gy = st.findGirderSurface(centerX, rope.y - 4, rope.y + 6);
            if (gy !== null) {
              sjw.mode = 'GROUND';
              sjw.rope = null;
              sjw.ropeIgnoreTimer = 14;
              sjw.y = gy - 14;
            }
          } else {
            sjw.y = ny;
          }
        } else {
          // Blue Down-Rope: slides Senior Jumpwoman automatically DOWN!
          const ny = sjw.y + 1.5;
          const nFeetY = ny + 14;
          const ropeBot = rope.y + rope.h;
          if (nFeetY >= ropeBot) {
            const gy = st.findGirderSurface(centerX, ropeBot - 5, ropeBot + 5);
            if (gy !== null) {
              sjw.mode = 'GROUND';
              sjw.rope = null;
              sjw.ropeIgnoreTimer = 12;
              sjw.y = gy - 14;
            } else {
              // Slid off bottom of a hanging Blue Rope with no floor -> Tumble!
              this._startDeathTumble();
            }
          } else {
            sjw.y = ny;
          }
        }
        return;
      }

      // --------------------- AIRBORNE JUMP MODE ---------------------
      if (sjw.mode === 'JUMP') {
        const prevFeetY = sjw.y + 14;

        // Level 12 Hurricane Wind pushes horizontal jump trajectory!
        const windPush = st.hazards.hurricane ? this.windDir * 0.52 : 0;
        const nx = Math.max(2, Math.min(306, sjw.x + sjw.vx + windPush));
        const ny = Math.max(2, sjw.y + sjw.vy);
        sjw.vy += 0.135;

        sjw.x = nx;
        sjw.y = ny;

        const nCenterX = sjw.x + 6;
        const nFeetY = sjw.y + 14;

        // 1. Grab Rope mid-air
        if (sjw.ropeIgnoreTimer <= 0) {
          const rope = this._findOverlappingRope(nCenterX, sjw.y + 2, nFeetY);
          if (rope) {
            this._attachRope(rope);
            return;
          }
        }

        // 2. Grab Ladder mid-air (when holding Up/Down OR descending onto an isolated/scrolling ladder)
        const lad = this._findOverlappingLadder(nCenterX, sjw.y + 4, nFeetY);
        if (
          lad &&
          (input.up ||
            input.down ||
            (sjw.vy > 0.1 &&
              (lad.scrollSpeed !== 0 ||
                st.findGirderSurface(nCenterX, nFeetY - 2, nFeetY + 18) ===
                  null)))
        ) {
          sjw.mode = 'LADDER';
          sjw.ladder = lad;
          sjw.x = lad.x - 2;
          sjw.vx = 0;
          sjw.vy = 0;
          return;
        }

        // 3. Land on Girder when descending
        if (sjw.vy >= 0) {
          const gy = st.findGirderSurface(
            nCenterX,
            Math.min(prevFeetY - 2, nFeetY - 3),
            nFeetY + 3
          );
          if (gy !== null) {
            if (gy <= sjw.jumpStartFeetY + 46) {
              sjw.mode = 'GROUND';
              sjw.y = gy - 14;
              sjw.vx = 0;
              sjw.vy = 0;
              SID.sfxStep(true);
            } else {
              // Fell farther than max safe drop onto girder -> KABAM!
              sjw.y = gy - 14;
              this._startKabam();
            }
            return;
          }
        }

        // 4. Exceeded safe drop distance mid-air -> transition to head-over-heels tumble!
        if (sjw.vy > 0 && nFeetY > sjw.jumpStartFeetY + 48) {
          this._startDeathTumble();
          return;
        }

        // 5. Hit bottom void
        if (nFeetY >= 175) {
          this._startKabam();
        }
      }
    }

    _initiateJump(input) {
      const sjw = this.sjw;
      let dir = 0;
      if (input.left && !input.right) dir = -1;
      else if (input.right && !input.left) dir = 1;

      if (dir !== 0) sjw.facing = dir;
      sjw.mode = 'JUMP';
      sjw.ladder = null;
      sjw.rope = null;
      sjw.vx = dir * 1.55;
      sjw.vy = dir === 0 ? -2.55 : -2.45;
      sjw.jumpStartFeetY = sjw.y + 14;
      sjw.jumpBuffer = 0;
      this.jumpPressedEdge = false;
      SID.sfxJump();
    }

    _attachRope(rope) {
      const sjw = this.sjw;
      sjw.mode = 'ROPE';
      sjw.rope = rope;
      sjw.ladder = null;
      sjw.vx = 0;
      sjw.vy = 0;
      sjw.x = rope.x - 6;
    }

    _findOverlappingLadder(centerX, minY, maxY) {
      const ladders = this.stage.ladders;
      for (let i = 0; i < ladders.length; i++) {
        const lad = ladders[i];
        if (!lad.active) continue;
        if (centerX >= lad.x - 2 && centerX <= lad.x + 10) {
          if (maxY >= lad.y && minY <= lad.y + lad.h) {
            return lad;
          }
        }
      }
      return null;
    }

    _findOverlappingRope(centerX, minY, maxY) {
      const ropes = this.stage.ropes;
      for (let i = 0; i < ropes.length; i++) {
        const r = ropes[i];
        if (!r.active) continue;
        if (Math.abs(centerX - r.x) <= 5) {
          if (maxY >= r.y + 2 && minY <= r.y + r.h - 2) {
            return r;
          }
        }
      }
      return null;
    }

    // =========================================================================
    // BOMB PICKUP, REACTIVE TRIGGERS & KAIZO LAST-BOMB SAVE
    // =========================================================================
    _checkBombPickup() {
      const sjw = this.sjw;
      const st = this.stage;
      const p = this.currentPlayer;

      const px0 = sjw.x + 1;
      const px1 = sjw.x + 11;
      const py0 = sjw.y + 1;
      const py1 = sjw.y + 14;

      let touchedAny = false;
      for (let i = 0; i < st.bombs.length; i++) {
        const b = st.bombs[i];
        if (b.defused) continue;

        if (px1 >= b.x && px0 <= b.x + 8 && py1 >= b.y && py0 <= b.y + 8) {
          b.defused = true;
          touchedAny = true;
          this._awardScore(100);

          let spellBonus = false;
          // Level 8 SPELLBOUND ("SR.JUMPWOMAN") sequential bonus!
          if (st.hazards.spellbound) {
            const li = b.letterIndex % 12;
            this.revealedLetters[li] = true;
            if (li === this.nextSpellIndex) {
              spellBonus = true;
              this.nextSpellIndex++;
              p.nextSpellIndex = this.nextSpellIndex;
              this._awardScore(250);
              this.floatingPopups.push({
                x: b.x - 4,
                y: b.y - 4,
                text: '+250',
                col: C.YELLOW,
                life: 45
              });
            } else {
              this.nextSpellIndex = -1; // Out of strict sequence
              p.nextSpellIndex = -1;
            }
          }

          SID.sfxDefuse(spellBonus);

          // Execute Reactive Architecture Triggers!
          let mutated = false;
          if (b.toggleIds) {
            for (const id of b.toggleIds) st.toggleById(id, 'toggle');
            mutated = true;
          }
          if (b.enableIds) {
            for (const id of b.enableIds) st.toggleById(id, 'enable');
            mutated = true;
          }
          if (b.disableIds) {
            for (const id of b.disableIds) st.toggleById(id, 'disable');
            mutated = true;
          }
          if (b.toggleFlames) {
            this.activeFlameGroup = 1 - this.activeFlameGroup;
            for (const fl of st.flames) {
              fl.active = fl.group === this.activeFlameGroup;
            }
            mutated = true;
          }
          if (b.reverseScroll) {
            this.ladderScrollSign *= -1;
            mutated = true;
          }
          if (st.hazards.blackout) {
            // Brief flash of illumination on bomb pickup!
            this.blackoutLitTimer = 38;
          }
          if (mutated) {
            SID.sfxReactive();
          }
        }
      }

      if (touchedAny) {
        const remaining = st.bombs.some((b) => !b.defused);
        if (!remaining) {
          // KAIZO SAVE INCLUDED: Even if tumbling, defusing the final bomb immediately clears the level!
          this._enterLevelClear();
        }
      }
    }

    _awardScore(pts) {
      const p = this.currentPlayer;
      p.score += pts;
      while (p.score >= p.nextExtraLife) {
        p.lives = Math.min(9, p.lives + 1);
        p.nextExtraLife += 7500;
        SID.playExtraLife();
        this.floatingPopups.push({
          x: Math.max(16, Math.min(264, this.sjw.x - 8)),
          y: Math.max(16, this.sjw.y - 10),
          text: '1-UP!',
          col: C.LIGHT_GREEN,
          life: 65
        });
      }
    }

    // =========================================================================
    // ALL ENEMY & ENVIRONMENTAL HAZARDS AI + COLLISION
    // =========================================================================
    _updateAndCheckHazards() {
      const sjw = this.sjw;
      const st = this.stage;
      const hz = st.hazards;

      // Player vulnerable hitbox (slightly forgiving inner 6x10 C64 core)
      const hx0 = sjw.x + 3;
      const hx1 = sjw.x + 9;
      const hy0 = sjw.y + 2;
      const hy1 = sjw.y + 13;

      const overlaps = (x, y, w, h) =>
        hx1 >= x && hx0 <= x + w && hy1 >= y && hy0 <= y + h;

      // 1. Reactive Flame Traps (Level 2: FIRE! FIRE!)
      for (let i = 0; i < st.flames.length; i++) {
        const fl = st.flames[i];
        if (!fl.active) continue;
        if (overlaps(fl.x + 2, fl.y + 3, 6, 9)) {
          this._startKabam();
          return;
        }
      }

      // 2. Alienator Bullets (Drift -> Align X or Y -> Lock-On High-Speed Streak!)
      for (let i = 0; i < this.bullets.length; i++) {
        const bul = this.bullets[i];
        if (bul.cooldown > 0) {
          bul.cooldown--;
          continue;
        }

        if (!bul.locked) {
          bul.x += bul.vx;
          bul.y += bul.vy;
          if (bul.y < 10 || bul.y > 162) bul.vy *= -1;
          if (bul.x < 2 || bul.x > 310) bul.vx *= -1;

          // Lock-on check along horizontal or vertical axis!
          if (Math.abs(bul.y - (sjw.y + 5)) < 4) {
            bul.locked = true;
            bul.vy = 0;
            bul.vx = sjw.x > bul.x ? 2.85 : -2.85;
            SID.sfxBulletLock();
          } else if (Math.abs(bul.x - (sjw.x + 4)) < 4) {
            bul.locked = true;
            bul.vx = 0;
            bul.vy = sjw.y > bul.y ? 2.65 : -2.65;
            SID.sfxBulletLock();
          }
        } else {
          bul.x += bul.vx;
          bul.y += bul.vy;
          if (bul.x < -12 || bul.x > 328 || bul.y < -12 || bul.y > 180) {
            this.bullets[i] = this._spawnBullet(30);
            continue;
          }
        }

        if (overlaps(bul.x + 1, bul.y + 1, 6, 6)) {
          this._startDeathTumble();
          return;
        }
      }

      // 3. Level 4: Hellstones (Bounce down girders while homing horizontally!)
      if (hz.hellstones > 0) {
        if (
          this.hellstones.length < hz.hellstones &&
          this.stateTimer % 52 === 10
        ) {
          this.hellstones.push({
            x: 40 + Math.random() * 240,
            y: -8,
            vx: 0,
            vy: 0.8
          });
        }
        for (let i = this.hellstones.length - 1; i >= 0; i--) {
          const hs = this.hellstones[i];
          hs.x += hs.vx;
          hs.y += hs.vy;
          hs.vy = Math.min(2.8, hs.vy + 0.11);

          if (hs.vy > 0) {
            const gy = st.findGirderSurface(hs.x + 5, hs.y + 7, hs.y + 12);
            if (gy !== null) {
              hs.y = gy - 10;
              hs.vy = -2.15;
              // Actively steer toward Senior Jumpwoman!
              const targetDir = sjw.x + 6 >= hs.x + 5 ? 1 : -1;
              hs.vx = targetDir * (0.85 + Math.random() * 0.45);
              SID.sfxHellstoneBounce();
            }
          }

          if (overlaps(hs.x + 2, hs.y + 2, 6, 6)) {
            this._startDeathTumble();
            return;
          }
          if (hs.y > 178) {
            this.hellstones.splice(i, 1);
          }
        }
      }

      // 4. Level 6: Moving Brick Walls
      for (let i = 0; i < this.walls.length; i++) {
        const w = this.walls[i];
        w.x += w.vx;
        if (w.x <= w.minX) {
          w.x = w.minX;
          w.vx = Math.abs(w.vx);
        } else if (w.x >= w.maxX) {
          w.x = w.maxX;
          w.vx = -Math.abs(w.vx);
        }
        if (overlaps(w.x + 1, w.y + 2, w.w - 2, w.h - 2)) {
          this._startDeathTumble();
          return;
        }
      }

      // 5. Level 7: Zig-Zaggers (45-degree sawtooth diagonal trajectories)
      for (let i = 0; i < this.zigzaggers.length; i++) {
        const zz = this.zigzaggers[i];
        zz.x += zz.vx;
        zz.y += zz.vy;
        zz.zigTimer--;
        if (zz.zigTimer <= 0) {
          zz.zigTimer = 26;
          zz.vy = -zz.vy;
        }
        if (zz.x < 6 || zz.x > 304) zz.vx = -zz.vx;
        if (zz.y < 8 || zz.y > 160) zz.vy = -zz.vy;

        if (overlaps(zz.x + 2, zz.y + 2, 6, 6)) {
          this._startDeathTumble();
          return;
        }
      }

      // 6. Level 11: Alien Eggs & Hatchlings
      if (hz.hatchlings > 0) {
        const activeTotal = this.eggs.length + this.hatchlings.length;
        if (activeTotal < hz.hatchlings && this.stateTimer % 65 === 15) {
          const perches = [
            { x: 64, y: 28 },
            { x: 244, y: 28 },
            { x: 156, y: 44 },
            { x: 76, y: 112 },
            { x: 232, y: 112 }
          ];
          const spot = perches[Math.floor(Math.random() * perches.length)];
          // Avoid spawning right on top of Senior Jumpwoman
          if (Math.hypot(spot.x - sjw.x, spot.y - sjw.y) > 36) {
            this.eggs.push({ x: spot.x, y: spot.y, timer: 95 });
          }
        }

        for (let i = this.eggs.length - 1; i >= 0; i--) {
          const egg = this.eggs[i];
          egg.timer--;
          if (egg.timer <= 0) {
            SID.sfxHatch();
            const dir = sjw.x >= egg.x ? 1 : -1;
            this.hatchlings.push({
              x: egg.x,
              y: egg.y,
              vx: dir * 1.35,
              vy: 0.65,
              life: 240
            });
            this.eggs.splice(i, 1);
          }
        }

        for (let i = this.hatchlings.length - 1; i >= 0; i--) {
          const h = this.hatchlings[i];
          h.life--;
          h.x += h.vx;
          h.y += h.vy;

          const gy = st.findGirderSurface(h.x + 5, h.y + 5, h.y + 10);
          if (gy !== null && h.vy > 0) {
            h.y = gy - 8;
            // Occasionally hop/swoop toward Senior Jumpwoman
            if (Math.random() < 0.04) {
              h.vy = -1.6;
              h.vx = (sjw.x >= h.x ? 1 : -1) * 1.4;
            } else {
              h.vy = 0.4;
            }
          } else {
            h.vy = Math.min(1.8, h.vy + 0.08);
          }

          if (h.x < 6 || h.x > 304) h.vx = -h.vx;

          if (overlaps(h.x + 1, h.y + 1, 8, 6)) {
            this._startDeathTumble();
            return;
          }
          if (h.y > 176 || h.life <= 0) {
            this.hatchlings.splice(i, 1);
          }
        }
      }

      // 7. Level 12: Hurricane Wind & Storm Birds
      if (hz.hurricane) {
        this.windTimer++;
        if (this.windTimer >= 720) {
          this.windTimer = 0;
          this.windDir *= -1;
          SID.sfxReactive();
        }
        for (let i = 0; i < this.windParticles.length; i++) {
          const wp = this.windParticles[i];
          wp.x += wp.speed * this.windDir;
          if (wp.x > 319) wp.x -= 320;
          if (wp.x < 0) wp.x += 320;
        }
        for (let i = 0; i < this.birds.length; i++) {
          const b = this.birds[i];
          b.phase += 0.09;
          b.x += b.vx * this.windDir;
          b.y = b.baseY + Math.sin(b.phase) * 9;
          if (b.x > 324) b.x = -12;
          if (b.x < -14) b.x = 322;

          if (overlaps(b.x + 2, b.y + 2, 8, 5)) {
            this._startDeathTumble();
            return;
          }
        }
      }
    }

    // =========================================================================
    // TUMBLING DEATH ("KABAM!"), LEVEL CLEAR, WELL DONE & GAME OVER
    // =========================================================================
    _startDeathTumble() {
      if (this.state !== 'PLAYING') return;
      this.state = 'DYING';
      this.sjw.deathPhase = 'tumble';
      this.sjw.deathTimer = 0;
      this.sjw.vy = 1.2;
      SID.setWindActive(false);
      SID.sfxTumbleStart();
    }

    _startKabam() {
      this.state = 'DYING';
      this.sjw.deathPhase = 'kabam';
      this.sjw.deathTimer = 0;
      SID.setWindActive(false);
      SID.sfxKabam();

      this.particles = [];
      const cx = this.sjw.x + 6;
      const cy = Math.min(168, this.sjw.y + 8);
      const cols = [C.WHITE, C.YELLOW, C.RED, C.ORANGE, C.CYAN, C.PURPLE];
      for (let i = 0; i < 28; i++) {
        const ang = (Math.PI * 2 * i) / 28 + Math.random() * 0.2;
        const spd = 0.8 + Math.random() * 2.4;
        this.particles.push({
          x: cx,
          y: cy,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd - 0.5,
          col: cols[i % cols.length],
          life: 32 + Math.floor(Math.random() * 20)
        });
      }
    }

    _stepDying() {
      const sjw = this.sjw;
      if (sjw.deathPhase === 'tumble') {
        sjw.deathTimer++;
        sjw.y += sjw.vy;
        sjw.vy = Math.min(3.4, sjw.vy + 0.12);

        // Kaizo Save: touching the FINAL bomb while tumbling still clears the stage!
        this._checkBombPickup();
        if (this.state !== 'DYING') return;

        // Crash on bottom or lower girder after tumbling at least 18 ticks
        const feetY = sjw.y + 14;
        if (feetY >= 174) {
          sjw.y = 160;
          this._startKabam();
        } else if (sjw.deathTimer > 18) {
          const gy = this.stage.findGirderSurface(sjw.x + 6, feetY - 2, feetY + 3);
          if (gy !== null) {
            sjw.y = gy - 14;
            this._startKabam();
          }
        }
      } else {
        sjw.deathTimer++;
        for (const pt of this.particles) {
          pt.x += pt.vx;
          pt.y += pt.vy;
          pt.vy += 0.06;
          pt.life--;
        }
        if (sjw.deathTimer === 34) {
          SID.playLifeLost();
        }
        if (sjw.deathTimer > 95) {
          this._afterLifeLost();
        }
      }
    }

    _afterLifeLost() {
      const p = this.currentPlayer;
      p.lives--;

      // Reset Level 2 flame state on death so respawn is always clean
      if (this.stage && this.stage.flames.length > 0) {
        this.activeFlameGroup = 0;
        for (const fl of this.stage.flames) {
          fl.active = fl.group === 0;
        }
      }

      // Advance to next surviving player (or Game Over if all out of lives!)
      const totalPlayers = this.players.length;
      for (let step = 1; step <= totalPlayers; step++) {
        const idx = (this.currentPlayerIdx + step) % totalPlayers;
        if (this.players[idx].lives > 0) {
          const switched = idx !== this.currentPlayerIdx;
          this.currentPlayerIdx = idx;
          this._beginPlayerTurn(switched);
          return;
        }
      }

      this._enterGameOver();
    }

    _enterLevelClear() {
      this.state = 'LEVEL_CLEAR';
      this.stateTimer = 0;
      this.clearPhase = 0;
      this.bonusTickStep = 0;
      SID.setWindActive(false);

      const p = this.currentPlayer;
      const effLv = Math.min(12, p.levelNum);
      this.lifeBonusAwarded = 25 * effLv * p.lives;
      this.lifeBonusRemaining = this.lifeBonusAwarded;

      SID.playLevelClear(() => {
        this.clearPhase = 1;
      });
    }

    _stepLevelClear() {
      this.stateTimer++;
      const p = this.currentPlayer;

      if (this.clearPhase === 0 && this.stateTimer > 55) {
        this.clearPhase = 1;
      }

      if (this.clearPhase === 1) {
        if (p.bonus > 0) {
          const chunk = Math.min(p.bonus, 20);
          p.bonus -= chunk;
          this._awardScore(chunk);
          if (this.stateTimer % 2 === 0) {
            SID.sfxBonusTick(this.bonusTickStep++);
          }
        } else if (this.lifeBonusRemaining > 0) {
          const chunk = Math.min(this.lifeBonusRemaining, 25);
          this.lifeBonusRemaining -= chunk;
          this._awardScore(chunk);
          if (this.stateTimer % 3 === 0) {
            SID.sfxBonusTick(this.bonusTickStep++);
          }
        } else {
          this.clearPhase = 2;
          this.stateTimer = 0;
        }
      } else if (this.clearPhase === 2 && this.stateTimer > 50) {
        const finishedLevel = p.levelNum;
        p.levelNum++;
        p.stage = null;

        if (finishedLevel === 12) {
          this._enterWellDone();
        } else {
          this._beginPlayerTurn(false);
        }
      }
    }

    _enterWellDone() {
      this.state = 'WELL_DONE';
      this.stateTimer = 0;
      this.stage = Levels.buildWellDoneStage();
      this.sjw.x = 154;
      this.sjw.y = 42 - 14;
      this.sjw.facing = 1;
      this.particles = [];
      SID.playWellDone();
    }

    _stepWellDone() {
      this.stateTimer++;
      const sjw = this.sjw;
      sjw.animTick += 0.2;

      // Senior Jumpwoman dances back and forth atop the "WELL DONE" girder!
      sjw.x = 154 + Math.sin(this.stateTimer * 0.055) * 68;
      sjw.facing = Math.cos(this.stateTimer * 0.055) >= 0 ? 1 : -1;
      const hop = Math.abs(Math.sin(this.stateTimer * 0.18)) * 8;
      sjw.y = 42 - 14 - hop;

      if (this.stateTimer % 12 === 0) {
        const cols = [C.YELLOW, C.CYAN, C.LIGHT_GREEN, C.LIGHT_RED, C.WHITE];
        this.particles.push({
          x: 40 + Math.random() * 240,
          y: 12 + Math.random() * 40,
          vx: (Math.random() - 0.5) * 1.2,
          vy: (Math.random() - 0.5) * 1.2,
          col: cols[Math.floor(Math.random() * cols.length)],
          life: 30
        });
      }
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const pt = this.particles[i];
        pt.x += pt.vx;
        pt.y += pt.vy;
        pt.life--;
        if (pt.life <= 0) this.particles.splice(i, 1);
      }

      if (this.stateTimer > 340) {
        // Proceed into Endless Random Stages (Level 13+)!
        this._beginPlayerTurn(true);
      }
    }

    _enterGameOver() {
      this.state = 'GAME_OVER';
      this.stateTimer = 0;
      SID.setWindActive(false);
      SID.playGameOver();

      // Decompose remaining stage girders into crumbling Jupiter Substation blocks!
      this.crumbleBlocks = [];
      if (this.stage) {
        for (const g of this.stage.girders) {
          if (!g.active) continue;
          for (let bx = g.x; bx < g.x + g.w; bx += 8) {
            this.crumbleBlocks.push({
              x: bx,
              y: g.y,
              w: Math.min(8, g.x + g.w - bx),
              col: g.color,
              capCol: g.capColor,
              delay: Math.floor(Math.random() * 95),
              vy: 0,
              falling: false
            });
          }
        }
      }
    }

    _stepGameOver() {
      this.stateTimer++;
      let crumbleSound = false;
      for (let i = this.crumbleBlocks.length - 1; i >= 0; i--) {
        const cb = this.crumbleBlocks[i];
        if (!cb.falling) {
          if (this.stateTimer >= cb.delay) {
            cb.falling = true;
            cb.vy = 0.6 + Math.random() * 0.8;
            crumbleSound = true;
          }
        } else {
          cb.y += cb.vy;
          cb.vy += 0.14;
          if (cb.y > 176) {
            this.crumbleBlocks.splice(i, 1);
          }
        }
      }
      if (crumbleSound && this.stateTimer % 5 === 0) {
        SID.sfxCrumbleTick();
      }

      if (this.stateTimer > 210) {
        // Check if any player achieved a Top-8 High Score!
        this.initialsQueue = [];
        const minTop =
          this.highScores.length < 8
            ? 0
            : this.highScores[this.highScores.length - 1].score;
        for (const pl of this.players) {
          if (pl.score > minTop && pl.score > 0) {
            this.initialsQueue.push(pl);
          }
        }
        if (this.initialsQueue.length > 0) {
          this.currentInitials = ['S', 'J', 'W'];
          this.initialSlot = 0;
          this.state = 'ENTER_INITIALS';
          this.stateTimer = 0;
        } else {
          this.state = 'HIGH_SCORES';
          this.stateTimer = 0;
        }
      }
    }

    _commitInitials() {
      const pl = this.initialsQueue.shift();
      if (pl) {
        this.highScores.push({
          name: this.currentInitials.join(''),
          score: pl.score,
          level: pl.levelNum
        });
        this.highScores.sort((a, b) => b.score - a.score);
        this.highScores = this.highScores.slice(0, 8);
        this._saveHighScores();
        SID.sfxDefuse(true);
      }

      if (this.initialsQueue.length > 0) {
        this.currentInitials = ['S', 'J', 'W'];
        this.initialSlot = 0;
      } else {
        this.state = 'HIGH_SCORES';
        this.stateTimer = 0;
      }
    }

    // =========================================================================
    // C64 VIC-II FRAME RENDERING
    // =========================================================================
    render() {
      const vic = this.vic;

      // Subtle C64 border flash during KABAM explosion!
      let borderCol = C.BLACK;
      if (
        this.state === 'DYING' &&
        this.sjw.deathPhase === 'kabam' &&
        this.sjw.deathTimer < 16
      ) {
        const flash = [C.RED, C.YELLOW, C.WHITE, C.ORANGE];
        borderCol = flash[(this.sjw.deathTimer >> 1) % flash.length];
      }
      vic.clear(C.BLACK, borderCol);

      switch (this.state) {
        case 'TITLE':
          this._renderTitleScreen();
          break;
        case 'ATTRACT_PREVIEW':
          this._renderAttractPreview();
          break;
        case 'HIGH_SCORES':
          this._renderHighScores();
          break;
        case 'SELECT_PLAYERS':
          this._renderSelectPlayers();
          break;
        case 'SELECT_SPEED':
          this._renderSelectSpeed();
          break;
        case 'PLAYER_READY':
          this._renderPlayerReady();
          break;
        case 'ENTER_INITIALS':
          this._renderEnterInitials();
          break;
        case 'GAME_OVER':
          this._renderGameOver();
          break;
        default:
          this._renderStagePlayfield(this.stage, false);
          this._renderHUD();
          break;
      }

      vic.present();
    }

    _renderTitleScreen() {
      const vic = this.vic;
      const t = this.frameCount;

      // Decorative Epyx-style C64 double frame
      vic.fillRect(16, 10, 288, 2, C.BLUE);
      vic.fillRect(16, 14, 288, 2, C.CYAN);

      // Multicolor 2x C64 Title Logo: "SENIOR" / "JUMPWOMAN"
      const cycleCols = [C.YELLOW, C.CYAN, C.LIGHT_RED, C.LIGHT_GREEN, C.WHITE];
      const c1 = cycleCols[Math.floor(t / 18) % cycleCols.length];
      const c2 = cycleCols[(Math.floor(t / 18) + 2) % cycleCols.length];

      vic.drawTextCentered('SENIOR', 24, c1, 2, C.RED);
      vic.drawTextCentered('JUMPWOMAN', 44, c2, 2, C.PURPLE);

      vic.drawTextCentered('C64 JUMPMAN JUNIOR EDITION', 68, C.LIGHT_GREY, 1);
      vic.drawTextCentered('ORIGINAL DESIGN: RANDY GLOVER 1983', 80, C.GREY, 1);

      // Live mini showcase girder in the center of the Title Screen!
      this._drawGirderSegment(44, 122, 232, C.RED, C.LIGHT_RED);
      // Two bombs on the title girder
      const bFrame = SPRITES.bomb[(t >> 3) & 1];
      vic.drawSprite(bFrame, 56, 112);
      vic.drawSprite(bFrame, 256, 112);

      // Animated Senior Jumpwoman running & leaping across the title girder!
      const demoPhase = t % 240;
      let dx, dy, spr;
      if (demoPhase < 120) {
        dx = 76 + (demoPhase / 120) * 156;
        const jumpArc =
          demoPhase > 45 && demoPhase < 75
            ? Math.sin(((demoPhase - 45) / 30) * Math.PI) * 18
            : 0;
        dy = 122 - 14 - jumpArc;
        spr =
          jumpArc > 1
            ? SPRITES.sjw.jumpR
            : SPRITES.sjw.runR[(t >> 2) & 3];
      } else {
        const p2 = demoPhase - 120;
        dx = 232 - (p2 / 120) * 156;
        const jumpArc =
          p2 > 45 && p2 < 75 ? Math.sin(((p2 - 45) / 30) * Math.PI) * 18 : 0;
        dy = 122 - 14 - jumpArc;
        spr =
          jumpArc > 1
            ? SPRITES.sjw.jumpL
            : SPRITES.sjw.runL[(t >> 2) & 3];
      }
      vic.drawSprite(spr, dx, dy);

      // Blinking C64 prompt (visible immediately on frame 0)
      if (!((t >> 4) & 1)) {
        vic.drawTextCentered('PRESS FIRE OR SPACE TO PLAY', 140, C.YELLOW, 1);
      }

      vic.drawTextCentered('ARROWS / WASD : MOVE & CLIMB', 158, C.CYAN, 1);
      vic.drawTextCentered('SPACE / Z : JUMP   P : PAUSE', 170, C.LIGHT_BLUE, 1);
      vic.drawTextCentered('12 ORIGINAL LEVELS + SID 6581', 184, C.GREEN, 1);
    }

    _renderAttractPreview() {
      const vic = this.vic;
      const st = this.attractStage;
      if (!st) return;

      this._renderStagePlayfield(st, true);

      // Top attract banner
      vic.fillRect(44, 2, 232, 11, C.BLUE);
      if ((this.frameCount >> 4) & 1) {
        vic.drawTextCentered('LEVEL PREVIEW - PRESS SPACE', 4, C.WHITE, 1);
      } else {
        vic.drawTextCentered('SENIOR JUMPWOMAN - 12 LEVELS', 4, C.YELLOW, 1);
      }

      // Bottom HUD bar with exact C64 Level Name
      vic.fillRect(0, 176, 320, 2, C.CYAN);
      vic.fillRect(0, 178, 320, 22, C.BLUE);
      const numStr = String(st.levelNumber).padStart(2, '0');
      vic.drawTextCentered(`LEVEL ${numStr}: ${st.name}`, 185, C.YELLOW, 1);
    }

    _renderHighScores() {
      const vic = this.vic;
      vic.drawTextCentered('SENIOR JUMPWOMAN', 14, C.YELLOW, 1);
      vic.drawTextCentered('JUPITER SUBSTATION HALL OF FAME', 28, C.CYAN, 1);
      vic.fillRect(24, 40, 272, 2, C.PURPLE);

      vic.drawText('RNK  NAME    SCORE     STAGE', 44, 50, C.LIGHT_GREY, 1);

      const rowCols = [
        C.WHITE, C.YELLOW, C.LIGHT_GREEN, C.CYAN,
        C.LIGHT_BLUE, C.LIGHT_RED, C.ORANGE, C.GREY
      ];
      for (let i = 0; i < this.highScores.length; i++) {
        const hs = this.highScores[i];
        const y = 66 + i * 12;
        const rnk = String(i + 1).padStart(2, ' ');
        const sc = String(hs.score).padStart(6, '0');
        const lv = String(hs.level).padStart(2, '0');
        vic.drawText(
          `${rnk}.  ${hs.name.padEnd(4, ' ')}   ${sc}      ${lv}`,
          44,
          y,
          rowCols[i % rowCols.length],
          1
        );
      }

      if ((this.frameCount >> 4) & 1) {
        vic.drawTextCentered('PRESS FIRE OR SPACE TO START', 176, C.YELLOW, 1);
      }
    }

    _renderSelectPlayers() {
      const vic = this.vic;
      vic.drawTextCentered('SENIOR JUMPWOMAN', 24, C.YELLOW, 2, C.RED);
      vic.fillRect(32, 50, 256, 2, C.CYAN);

      vic.drawTextCentered('NUMBER OF PLAYERS? (1 - 4)', 78, C.WHITE, 1);

      for (let n = 1; n <= 4; n++) {
        const bx = 76 + (n - 1) * 48;
        const selected = n === this.pendingNumPlayers;
        if (selected) {
          vic.fillRect(bx - 6, 102, 28, 24, C.BLUE);
          vic.fillRect(bx - 6, 102, 28, 2, C.YELLOW);
          vic.fillRect(bx - 6, 124, 28, 2, C.YELLOW);
        }
        vic.drawText(
          String(n),
          bx,
          106,
          selected ? C.YELLOW : C.GREY,
          2
        );
      }

      vic.drawTextCentered('PRESS 1-4 OR LEFT/RIGHT + SPACE', 152, C.CYAN, 1);
    }

    _renderSelectSpeed() {
      const vic = this.vic;
      const pNum = this.speedSelectPlayerIdx + 1;

      vic.drawTextCentered(`PLAYER ${pNum}`, 26, C.CYAN, 2, C.BLUE);
      vic.drawTextCentered('WHAT SPEED? (1 - 8)', 60, C.WHITE, 1);
      vic.drawTextCentered('1 = FASTEST   4 = NORMAL   8 = SLOWEST', 76, C.LIGHT_GREY, 1);

      for (let s = 1; s <= 8; s++) {
        const bx = 34 + (s - 1) * 34;
        const sel = s === this.pendingSpeed;
        if (sel) {
          vic.fillRect(bx - 4, 102, 24, 24, C.PURPLE);
          vic.fillRect(bx - 4, 102, 24, 2, C.YELLOW);
          vic.fillRect(bx - 4, 124, 24, 2, C.YELLOW);
        }
        vic.drawText(String(s), bx, 106, sel ? C.YELLOW : C.GREY, 2);
      }

      vic.drawTextCentered('PRESS 1-8 OR LEFT/RIGHT + SPACE', 154, C.LIGHT_GREEN, 1);
    }

    _renderPlayerReady() {
      const vic = this.vic;
      const p = this.currentPlayer;
      vic.drawTextCentered(`PLAYER ${p.id}`, 58, C.YELLOW, 2, C.RED);
      vic.drawTextCentered('GET READY!', 88, C.WHITE, 1);
      const lv = String(p.levelNum).padStart(2, '0');
      vic.drawTextCentered(
        `LEVEL ${lv}: ${this.stage.name}`,
        114,
        C.CYAN,
        1
      );
      vic.drawTextCentered(`LIVES: ${p.lives}   SPEED: ${p.speed}`, 136, C.LIGHT_GREEN, 1);
    }

    _renderEnterInitials() {
      const vic = this.vic;
      const pl = this.initialsQueue[0];
      vic.drawTextCentered('GREAT SCORE!', 26, C.YELLOW, 2, C.RED);
      if (pl) {
        vic.drawTextCentered(
          `PLAYER ${pl.id} - SCORE ${String(pl.score).padStart(6, '0')}`,
          56,
          C.CYAN,
          1
        );
      }
      vic.drawTextCentered('ENTER YOUR INITIALS:', 80, C.WHITE, 1);

      for (let i = 0; i < 3; i++) {
        const x = 116 + i * 32;
        const active = i === this.initialSlot;
        vic.drawText(
          this.currentInitials[i],
          x,
          104,
          active ? C.YELLOW : C.LIGHT_GREY,
          2
        );
        if (active && ((this.frameCount >> 3) & 1)) {
          vic.fillRect(x, 124, 16, 3, C.CYAN);
        }
      }

      vic.drawTextCentered('TYPE LETTERS OR UP/DOWN + ENTER', 152, C.LIGHT_GREEN, 1);
    }

    _renderGameOver() {
      const vic = this.vic;
      // Draw crumbling Jupiter Substation blocks!
      for (const cb of this.crumbleBlocks) {
        this._drawGirderSegment(cb.x, cb.y, cb.w, cb.col, cb.capCol);
      }

      vic.fillRect(72, 68, 176, 36, C.BLACK);
      vic.fillRect(72, 68, 176, 2, C.RED);
      vic.fillRect(72, 102, 176, 2, C.RED);
      vic.drawTextCentered('GAME OVER', 79, C.YELLOW, 2, C.RED);

      this._renderHUD();
    }

    // =========================================================================
    // STAGE PLAYFIELD, GIRDERS, LADDERS, ROPES, BOMBS, ENEMIES & SJW RENDERER
    // =========================================================================
    _renderStagePlayfield(stage, isPreview = false) {
      if (!stage) return;
      const vic = this.vic;
      const t = this.frameCount;

      const structureVisible =
        isPreview ||
        !stage.hazards.blackout ||
        this.state === 'SPAWNING' ||
        this.state === 'LEVEL_CLEAR' ||
        this.blackoutLitTimer > 0;

      // 1. Level 12 Hurricane Wind Particles (behind girders)
      if (!isPreview && stage.hazards.hurricane) {
        for (const wp of this.windParticles) {
          vic.fillRect(wp.x, wp.y, 4, 1, C.DARK_GREY);
          vic.pset(wp.x + (this.windDir > 0 ? 3 : 0), wp.y, C.CYAN);
        }
      }

      // 2. Ladders (drawn behind/integrated with girders)
      if (structureVisible) {
        for (let i = 0; i < stage.ladders.length; i++) {
          const lad = stage.ladders[i];
          if (!lad.active) continue;
          this._drawLadder(lad.x, lad.y, lad.h, lad.color);
        }
      }

      // 3. Girders (4px riveted C64 I-beam style)
      if (structureVisible) {
        for (let i = 0; i < stage.girders.length; i++) {
          const g = stage.girders[i];
          if (!g.active) continue;
          this._drawGirderSegment(g.x, g.y, g.w, g.color, g.capColor);
        }
      }

      // 4. Ropes (ALWAYS visible even in Level 9 BLACKOUT, just like C64 Jumpman Jr!)
      for (let i = 0; i < stage.ropes.length; i++) {
        const r = stage.ropes[i];
        if (!r.active) continue;
        this._drawRope(r.x, r.y, r.h, r.type, t);
      }

      // 5. Level 8 SPELLBOUND Center Banner ("SR.JUMPWOMAN")
      if (stage.hazards.spellbound) {
        this._renderSpellboundBanner(isPreview);
      }

      // 6. Bombs (animated sparkling fuse!)
      const bombFrame = SPRITES.bomb[(t >> 2) & 1];
      for (let i = 0; i < stage.bombs.length; i++) {
        const b = stage.bombs[i];
        if (b.defused) continue;
        const spr =
          b.phasing && ((t >> 1) & 1) ? SPRITES.bombPhase : bombFrame;
        vic.drawSprite(spr, b.x, b.y, -1, 176);
      }

      // 7. Reactive Flame Traps (Level 2: FIRE! FIRE!)
      const flameFrame = SPRITES.flame[(t >> 2) & 1];
      for (let i = 0; i < stage.flames.length; i++) {
        const fl = stage.flames[i];
        if (!fl.active) continue;
        vic.drawSprite(flameFrame, fl.x, fl.y, -1, 176);
      }

      if (isPreview) return;

      // 8. Active Enemies & Hazards
      // Alienator Bullets
      for (const bul of this.bullets) {
        if (bul.cooldown > 0) continue;
        if (bul.locked) {
          // High-speed laser streak!
          if (bul.vx !== 0) {
            vic.fillRect(bul.x - 4, bul.y + 3, 14, 2, C.WHITE);
            vic.fillRect(bul.x - 6, bul.y + 2, 4, 4, C.CYAN);
          } else {
            vic.fillRect(bul.x + 3, bul.y - 4, 2, 14, C.WHITE);
            vic.fillRect(bul.x + 2, bul.y - 6, 4, 4, C.CYAN);
          }
        } else {
          vic.drawSprite(SPRITES.bullet[(t >> 2) & 1], bul.x, bul.y, -1, 176);
        }
      }

      // Level 4 Hellstones
      for (const hs of this.hellstones) {
        vic.drawSprite(SPRITES.hellstone[(t >> 2) & 1], hs.x, hs.y, -1, 176);
      }

      // Level 6 Moving Brick Walls
      for (const w of this.walls) {
        this._drawBrickWall(w.x, w.y, w.w, w.h);
      }

      // Level 7 Zig-Zaggers
      for (const zz of this.zigzaggers) {
        vic.drawSprite(SPRITES.zigzag[(t >> 1) & 1], zz.x, zz.y, -1, 176);
      }

      // Level 11 Eggs & Hatchlings
      for (const egg of this.eggs) {
        const cracking = egg.timer < 30;
        const wob = cracking ? ((t >> 1) & 1) - 0.5 : 0;
        vic.drawSprite(
          SPRITES.egg[cracking ? 1 : 0],
          egg.x + wob,
          egg.y,
          -1,
          176
        );
      }
      for (const h of this.hatchlings) {
        vic.drawSprite(SPRITES.hatchling[(t >> 2) & 1], h.x, h.y, -1, 176);
      }

      // Level 12 Storm Birds
      for (const b of this.birds) {
        const arr = this.windDir >= 0 ? SPRITES.birdR : SPRITES.birdL;
        vic.drawSprite(arr[(t >> 2) & 1], b.x, b.y, -1, 176);
      }

      // 9. Senior Jumpwoman!
      this._renderSeniorJumpwoman();

      // 10. Particles & Popups
      for (const pt of this.particles) {
        if (pt.life > 0 && pt.y < 175) {
          vic.fillRect(pt.x, pt.y, 2, 2, pt.col);
        }
      }
      for (const fp of this.floatingPopups) {
        vic.drawText(fp.text, fp.x, fp.y, fp.col, 1, C.BLACK);
      }

      // 11. Overlay status banners (PAUSED / LEVEL CLEAR / WELL DONE)
      if (this.paused && ((t >> 4) & 1)) {
        vic.fillRect(116, 78, 88, 16, C.BLUE);
        vic.drawTextCentered('PAUSED', 82, C.YELLOW, 1);
      }
      if (this.state === 'LEVEL_CLEAR' && this.lifeBonusAwarded > 0) {
        vic.fillRect(52, 74, 216, 26, C.BLUE);
        vic.fillRect(52, 74, 216, 2, C.YELLOW);
        vic.fillRect(52, 98, 216, 2, C.YELLOW);
        vic.drawTextCentered('STAGE CLEAR!', 79, C.WHITE, 1);
        vic.drawTextCentered(
          `LIFE BONUS: +${this.lifeBonusAwarded}`,
          89,
          C.YELLOW,
          1
        );
      }
      if (this.state === 'WELL_DONE') {
        vic.drawTextCentered(
          'CONGRATULATIONS SENIOR JUMPWOMAN!',
          8,
          (t >> 3) & 1 ? C.YELLOW : C.CYAN,
          1
        );
      }
    }

    _renderSeniorJumpwoman() {
      const vic = this.vic;
      const sjw = this.sjw;
      const t = this.frameCount;

      if (this.state === 'SPAWNING') {
        // Authentic C64 vertical raster beam-in materialization!
        const prog = this.stateTimer / 72;
        const beamCols = [C.WHITE, C.CYAN, C.YELLOW, C.PURPLE, C.LIGHT_BLUE];
        const bCol = beamCols[this.stateTimer % beamCols.length];
        const beamW = Math.max(2, Math.round((1 - prog) * 12));
        vic.fillRect(
          sjw.x + 6 - Math.floor(beamW / 2),
          0,
          beamW,
          sjw.y + 14,
          bCol
        );
        if (this.stateTimer % 2 === 0 || prog > 0.55) {
          vic.drawSprite(
            SPRITES.sjw.idle,
            sjw.x,
            sjw.y,
            prog < 0.65 ? bCol : -1,
            176
          );
        }
        return;
      }

      if (this.state === 'DYING') {
        if (sjw.deathPhase === 'tumble') {
          const rotFrame = SPRITES.sjw.tumble[(sjw.deathTimer >> 2) & 3];
          vic.drawSprite(rotFrame, sjw.x, sjw.y, -1, 176);
        } else if (sjw.deathTimer < 56) {
          const col = (sjw.deathTimer >> 2) & 1 ? C.YELLOW : C.WHITE;
          vic.drawText(
            'KABAM!',
            Math.max(8, Math.min(264, sjw.x - 16)),
            Math.max(12, Math.min(162, sjw.y + 2)),
            col,
            1,
            C.RED
          );
        }
        return;
      }

      if (this.state === 'WELL_DONE') {
        const spr =
          (t >> 4) & 1
            ? SPRITES.sjw.dance[(t >> 2) & 1]
            : sjw.facing > 0
              ? SPRITES.sjw.runR[(t >> 2) & 3]
              : SPRITES.sjw.runL[(t >> 2) & 3];
        vic.drawSprite(spr, sjw.x, sjw.y, -1, 176);
        return;
      }

      let spr = SPRITES.sjw.idle;
      if (sjw.mode === 'JUMP') {
        if (Math.abs(sjw.vx) < 0.1) spr = SPRITES.sjw.jumpUp;
        else spr = sjw.facing >= 0 ? SPRITES.sjw.jumpR : SPRITES.sjw.jumpL;
      } else if (sjw.mode === 'LADDER') {
        spr = SPRITES.sjw.climb[Math.floor(sjw.animTick) & 1];
      } else if (sjw.mode === 'ROPE') {
        const arr = sjw.facing >= 0 ? SPRITES.sjw.ropeR : SPRITES.sjw.ropeL;
        spr = arr[Math.floor(sjw.animTick) & 1];
      } else if (sjw.animTick > 0) {
        const arr = sjw.facing >= 0 ? SPRITES.sjw.runR : SPRITES.sjw.runL;
        spr = arr[Math.floor(sjw.animTick) & 3];
      }

      vic.drawSprite(spr, sjw.x, sjw.y, -1, 176);
    }

    _drawGirderSegment(x, y, w, col, capCol) {
      if (y < 0 || y >= 176) return;
      const vic = this.vic;
      vic.fillRect(x, y, w, 1, capCol);
      vic.fillRect(x, y + 1, w, 2, col);
      vic.fillRect(x, y + 3, w, 1, capCol);
      // C64 girder web rivets every 4px
      for (let rx = x + 1; rx < x + w - 1; rx += 4) {
        vic.pset(rx, y + 1, C.BLACK);
      }
    }

    _drawLadder(x, y, h, col) {
      const vic = this.vic;
      const y0 = Math.max(0, Math.round(y));
      const y1 = Math.min(176, Math.round(y + h));
      if (y1 <= y0) return;

      // Left & Right vertical rails (2px wide for bold C64 multicolor look)
      vic.fillRect(x, y0, 2, y1 - y0, col);
      vic.fillRect(x + 6, y0, 2, y1 - y0, col);

      // Horizontal rungs every 6px
      const firstRung = Math.round(y) + 3;
      for (let ry = firstRung; ry < y1 - 1; ry += 6) {
        if (ry >= 0 && ry < 176) {
          vic.fillRect(x + 2, ry, 4, 1, col);
        }
      }
    }

    _drawRope(x, y, h, type, t) {
      const vic = this.vic;
      const mainCol = type === 'up' ? C.GREEN : C.BLUE;
      const hiCol = type === 'up' ? C.LIGHT_GREEN : C.CYAN;
      const animDir = type === 'up' ? 1 : -1;
      const shift = Math.floor(t / 3) * animDir;

      const y0 = Math.max(0, y);
      const y1 = Math.min(176, y + h);
      for (let py = y0; py < y1; py++) {
        const braid = ((py + shift) & 3) === 0;
        vic.pset(x - 1, py, braid ? hiCol : mainCol);
        vic.pset(x, py, braid ? mainCol : hiCol);
      }
    }

    _drawBrickWall(x, y, w, h) {
      const vic = this.vic;
      vic.fillRect(x, y, w, h, C.RED);
      for (let row = 0; row < h; row += 4) {
        vic.fillRect(x, y + row, w, 1, C.YELLOW);
        const mortarX = (row & 4) ? x + 3 : x + 6;
        vic.fillRect(mortarX, y + row, 1, Math.min(4, h - row), C.YELLOW);
      }
    }

    _renderSpellboundBanner(isPreview) {
      const vic = this.vic;
      const startX = 64;
      const y = 86;
      const colors = [
        C.YELLOW, C.CYAN, C.WHITE, C.LIGHT_RED, C.LIGHT_GREEN, C.LIGHT_BLUE
      ];

      for (let i = 0; i < 12; i++) {
        const cx = startX + i * 16;
        const ch = Levels.SPELL_TARGET[i];
        if (isPreview || this.revealedLetters[i]) {
          const col = colors[(i + Math.floor(this.frameCount / 10)) % colors.length];
          vic.drawText(ch, cx, y, col, 1, C.BLUE);
        } else {
          vic.fillRect(cx, y + 7, 8, 1, C.DARK_GREY);
        }
      }
    }

    _renderHUD() {
      const vic = this.vic;
      const p = this.currentPlayer;
      if (!p) return;

      // Top HUD divider bar at y = 176..178
      vic.fillRect(0, 176, 320, 1, C.CYAN);
      vic.fillRect(0, 177, 320, 2, C.BLUE);

      // Row 1 (y = 181): Player #, Life Icons, Score (6 digits), Bonus (4 digits)
      vic.drawText(`P${p.id}`, 4, 181, C.CYAN, 1);

      const iconsToShow = Math.min(5, Math.max(0, p.lives));
      for (let i = 0; i < iconsToShow; i++) {
        vic.drawSprite(SPRITES.sjw.life, 24 + i * 8, 181);
      }
      if (p.lives > 5) {
        vic.drawText(`+${p.lives - 5}`, 64, 181, C.WHITE, 1);
      }

      const scoreStr = String(p.score).padStart(6, '0');
      vic.drawText(`SC:${scoreStr}`, 92, 181, C.WHITE, 1);

      const bonusStr = String(p.bonus).padStart(4, '0');
      const bonusCol =
        p.bonus > 0 && p.bonus <= 300 && ((this.frameCount >> 3) & 1)
          ? C.LIGHT_RED
          : C.YELLOW;
      vic.drawText(`BONUS:${bonusStr}`, 228, 181, bonusCol, 1);

      // Row 2 (y = 191): Level Number & Original Level Name (or Hurricane Wind Indicator!)
      const st = this.stage;
      if (st) {
        const lvNum = String(p.levelNum).padStart(2, '0');
        let label = `LV ${lvNum} - ${st.name}`;
        if (st.hazards.hurricane && this.state === 'PLAYING') {
          const arrow = this.windDir > 0 ? '>>>' : '<<<';
          label = `LV ${lvNum} - HURRICANE ${arrow}`;
        }
        vic.drawTextCentered(label, 191, C.LIGHT_GREEN, 1);
      }
    }

    startLoop() {
      const step = (ts) => {
        if (!this.lastTimestamp) this.lastTimestamp = ts;
        const dt = Math.min(0.05, (ts - this.lastTimestamp) / 1000);
        this.lastTimestamp = ts;

        // Run fixed 60Hz ticks
        this._frameAccum = (this._frameAccum || 0) + dt * 60;
        while (this._frameAccum >= 1.0) {
          this._frameAccum -= 1.0;
          this.tick(1 / 60);
        }

        this.render();
        global.requestAnimationFrame(step);
      };
      global.requestAnimationFrame(step);
    }
  }

  global.SeniorJumpwomanGame = SeniorJumpwomanGame;
})(window);
