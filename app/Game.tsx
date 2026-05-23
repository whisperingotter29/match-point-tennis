"use client";
import React, { useRef, useEffect, useState, useCallback } from "react";

/* ══════════════════════════════════════════════
   CONSTANTS
   ══════════════════════════════════════════════ */
const CANVAS_W = 400;
const CANVAS_H = 600;
const COURT_PAD_X = 40;
const COURT_PAD_TOP = 80;
const COURT_PAD_BOT = 80;
const COURT_LEFT = COURT_PAD_X;
const COURT_RIGHT = CANVAS_W - COURT_PAD_X;
const COURT_TOP = COURT_PAD_TOP;
const COURT_BOTTOM = CANVAS_H - COURT_PAD_BOT;
const COURT_W = COURT_RIGHT - COURT_LEFT;
const COURT_H = COURT_BOTTOM - COURT_TOP;
const NET_Y = COURT_TOP + COURT_H / 2;
const SERVICE_LINE_DIST = COURT_H * 0.22;
const SERVICE_TOP = COURT_TOP + SERVICE_LINE_DIST;
const SERVICE_BOT = COURT_BOTTOM - SERVICE_LINE_DIST;
const CENTER_X = CANVAS_W / 2;

const RACKET_W = 40;
const RACKET_H = 8;
const RACKET_SPEED = 5;
const BALL_R = 4;
const BALL_BASE_SPEED = 4;
const BALL_SPEED_INC = 0.15;
const BALL_MAX_SPEED = 9;
const POWER_SHOT_MULT = 1.6;
const POWER_CHARGE_TIME = 500;
const MAX_POWER_PER_SET = 3;
const TRAIL_LENGTH = 4;
const SCREEN_SHAKE_DUR = 100;
const SCREEN_SHAKE_AMP = 2;
const BANNER_DUR = 1500;

const COL_GREEN = "#2D5016";
const COL_WHITE = "#F0EDE5";
const COL_YELLOW = "#E8C840";
const COL_NAVY = "#1A1A2E";
const COL_RED = "#C0392B";

type Difficulty = "EASY" | "MEDIUM" | "HARD";
type Screen = "MENU" | "PLAYING" | "SET_BREAK" | "MATCH_OVER";
type ServeSide = "DEUCE" | "AD";

interface Vec2 { x: number; y: number; }
interface BallState {
  x: number; y: number; vx: number; vy: number;
  trail: Vec2[]; spin: number; active: boolean;
  speed: number;
}
interface PlayerState { x: number; y: number; w: number; }
interface Stats {
  aces: number; doubleFaults: number; longestRally: number;
  pointsWon: number; cpuPointsWon: number; powerShotsUsed: number;
}

const POINTS_LABELS = ["0", "15", "30", "40"];

function pointsToStr(p: number, opp: number, isServer: boolean): string {
  if (p >= 3 && opp >= 3) {
    if (p === opp) return "40";
    if (p > opp) return isServer ? "AD" : "40";
    return isServer ? "40" : "AD";
  }
  return p <= 3 ? POINTS_LABELS[p] : "40";
}

function isDeuce(p1: number, p2: number): boolean {
  return p1 >= 3 && p2 >= 3 && p1 === p2;
}

function hasAdvantage(p1: number, p2: number): "P1" | "P2" | null {
  if (p1 >= 3 && p2 >= 3 && p1 !== p2) {
    return p1 > p2 ? "P1" : "P2";
  }
  return null;
}

function isGameWon(p1: number, p2: number): "P1" | "P2" | null {
  if (p1 >= 4 && p1 - p2 >= 2) return "P1";
  if (p2 >= 4 && p2 - p1 >= 2) return "P2";
  return null;
}

/* ══════════════════════════════════════════════
   SOUND SYSTEM
   ══════════════════════════════════════════════ */
class SoundSystem {
  private ctx: AudioContext | null = null;
  private init() {
    if (!this.ctx) this.ctx = new AudioContext();
  }
  private beep(freq: number, dur: number, type: OscillatorType = "square") {
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = 0.08;
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + dur);
  }
  hit() { this.beep(880, 0.05); }
  bounce() { this.beep(220, 0.08, "triangle"); }
  pointScored() {
    this.beep(660, 0.1);
    setTimeout(() => this.beep(660, 0.1), 120);
  }
  gameWon() {
    this.beep(523, 0.12);
    setTimeout(() => this.beep(659, 0.12), 140);
    setTimeout(() => this.beep(784, 0.18), 280);
  }
}

/* ══════════════════════════════════════════════
   AI LOGIC
   ══════════════════════════════════════════════ */
function cpuUpdate(
  cpu: PlayerState, ball: BallState, diff: Difficulty, dt: number
): number {
  if (!ball.active) return cpu.x;
  const speeds: Record<Difficulty, number> = { EASY: 2.2, MEDIUM: 3.5, HARD: 4.5 };
  const jitter: Record<Difficulty, number> = { EASY: 30, MEDIUM: 12, HARD: 3 };
  const missChance: Record<Difficulty, number> = { EASY: 0.008, MEDIUM: 0.002, HARD: 0.0004 };

  if (ball.vy > 0) return cpu.x; // ball going away

  let targetX = ball.x + (ball.vx / Math.abs(ball.vy || 1)) * (cpu.y - ball.y);
  targetX += (Math.random() - 0.5) * jitter[diff];

  if (Math.random() < missChance[diff]) return cpu.x;

  const spd = speeds[diff];
  const dx = targetX - cpu.x;
  if (Math.abs(dx) < spd) return targetX;
  return cpu.x + Math.sign(dx) * spd;
}

/* ══════════════════════════════════════════════
   RENDERING
   ══════════════════════════════════════════════ */
function drawCourt(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = COL_GREEN;
  ctx.fillRect(COURT_LEFT, COURT_TOP, COURT_W, COURT_H);

  ctx.strokeStyle = COL_WHITE;
  ctx.lineWidth = 2;
  // outer boundary
  ctx.strokeRect(COURT_LEFT, COURT_TOP, COURT_W, COURT_H);
  // net
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(COURT_LEFT, NET_Y);
  ctx.lineTo(COURT_RIGHT, NET_Y);
  ctx.stroke();
  ctx.setLineDash([]);
  // service lines
  ctx.beginPath();
  ctx.moveTo(COURT_LEFT, SERVICE_TOP);
  ctx.lineTo(COURT_RIGHT, SERVICE_TOP);
  ctx.moveTo(COURT_LEFT, SERVICE_BOT);
  ctx.lineTo(COURT_RIGHT, SERVICE_BOT);
  ctx.stroke();
  // center service line
  ctx.beginPath();
  ctx.moveTo(CENTER_X, COURT_TOP);
  ctx.lineTo(CENTER_X, SERVICE_TOP);
  ctx.moveTo(CENTER_X, SERVICE_BOT);
  ctx.lineTo(CENTER_X, COURT_BOTTOM);
  ctx.stroke();
  // center marks
  ctx.beginPath();
  ctx.moveTo(CENTER_X, COURT_TOP);
  ctx.lineTo(CENTER_X, COURT_TOP + 8);
  ctx.moveTo(CENTER_X, COURT_BOTTOM - 8);
  ctx.lineTo(CENTER_X, COURT_BOTTOM);
  ctx.stroke();
}

function drawBall(ctx: CanvasRenderingContext2D, ball: BallState) {
  // trail
  for (let i = 0; i < ball.trail.length; i++) {
    const t = ball.trail[i];
    const alpha = (i + 1) / (ball.trail.length + 1) * 0.4;
    const r = BALL_R * (i + 1) / (ball.trail.length + 1);
    ctx.fillStyle = `rgba(232, 200, 64, ${alpha})`;
    ctx.beginPath();
    ctx.arc(t.x, t.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // main ball
  ctx.fillStyle = COL_YELLOW;
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
  ctx.fill();
}

function drawRacket(ctx: CanvasRenderingContext2D, p: PlayerState, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(p.x - p.w / 2, p.y - RACKET_H / 2, p.w, RACKET_H);
}

/* ══════════════════════════════════════════════
   MAIN COMPONENT
   ══════════════════════════════════════════════ */
export default function Game() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const soundRef = useRef<SoundSystem>(new SoundSystem());
  const keysRef = useRef<Set<string>>(new Set());
  const rafRef = useRef<number>(0);

  const [screen, setScreen] = useState<Screen>("MENU");
  const [difficulty, setDifficulty] = useState<Difficulty>("MEDIUM");
  const [showStats, setShowStats] = useState(false);

  // Score state (React for UI)
  const [p1Points, setP1Points] = useState(0);
  const [p2Points, setP2Points] = useState(0);
  const [p1Games, setP1Games] = useState<number[]>([0]);
  const [p2Games, setP2Games] = useState<number[]>([0]);
  const [currentSet, setCurrentSet] = useState(0);
  const [serveSide, setServeSide] = useState<ServeSide>("DEUCE");
  const [isPlayerServing, setIsPlayerServing] = useState(true);
  const [rallyCount, setRallyCount] = useState(0);
  const [powerCharges, setPowerCharges] = useState(MAX_POWER_PER_SET);
  const [stats, setStats] = useState<Stats>({
    aces: 0, doubleFaults: 0, longestRally: 0,
    pointsWon: 0, cpuPointsWon: 0, powerShotsUsed: 0,
  });
  const [banner, setBanner] = useState<string | null>(null);
  const [matchWinner, setMatchWinner] = useState<string | null>(null);
  const [finalScore, setFinalScore] = useState<{ p1: number[]; p2: number[] }>({ p1: [], p2: [] });

  // Game state refs (per-frame, no re-render)
  const gameRef = useRef({
    player: { x: CENTER_X, y: COURT_BOTTOM - 15, w: RACKET_W } as PlayerState,
    cpu: { x: CENTER_X, y: COURT_TOP + 15, w: RACKET_W } as PlayerState,
    ball: {
      x: CENTER_X, y: 0, vx: 0, vy: 0,
      trail: [] as Vec2[], spin: 0, active: false, speed: BALL_BASE_SPEED,
    } as BallState,
    serving: true,
    serveFault: false,
    waitingForServe: true,
    pointOver: false,
    rallyHits: 0,
    shakeUntil: 0,
    chargeStart: 0,
    charging: false,
    playerMovingDir: 0,
    p1Pts: 0,
    p2Pts: 0,
    p1Gms: [0] as number[],
    p2Gms: [0] as number[],
    curSet: 0,
    serveSide: "DEUCE" as ServeSide,
    isPlayerServing: true,
    powerLeft: MAX_POWER_PER_SET,
    stats: { aces: 0, doubleFaults: 0, longestRally: 0, pointsWon: 0, cpuPointsWon: 0, powerShotsUsed: 0 } as Stats,
    pointPause: 0,
    tossPhase: false,
    tossY: 0,
  });

  const syncScoreToReact = useCallback(() => {
    const g = gameRef.current;
    setP1Points(g.p1Pts);
    setP2Points(g.p2Pts);
    setP1Games([...g.p1Gms]);
    setP2Games([...g.p2Gms]);
    setCurrentSet(g.curSet);
    setServeSide(g.serveSide);
    setIsPlayerServing(g.isPlayerServing);
    setRallyCount(g.rallyHits);
    setPowerCharges(g.powerLeft);
    setStats({ ...g.stats });
  }, []);

  const showBanner = useCallback((text: string) => {
    setBanner(text);
    setTimeout(() => setBanner(null), BANNER_DUR);
  }, []);

  const resetBall = useCallback(() => {
    const g = gameRef.current;
    g.ball.active = false;
    g.ball.trail = [];
    g.ball.spin = 0;
    g.ball.speed = BALL_BASE_SPEED;
    g.waitingForServe = true;
    g.serving = true;
    g.tossPhase = false;
    g.rallyHits = 0;
    g.serveFault = false;
    // position ball near server
    if (g.isPlayerServing) {
      const sx = g.serveSide === "DEUCE" ? CENTER_X + COURT_W / 4 : CENTER_X - COURT_W / 4;
      g.ball.x = sx;
      g.ball.y = g.player.y - 10;
      g.player.x = sx;
    } else {
      const sx = g.serveSide === "DEUCE" ? CENTER_X - COURT_W / 4 : CENTER_X + COURT_W / 4;
      g.ball.x = sx;
      g.ball.y = g.cpu.y + 10;
      g.cpu.x = sx;
    }
  }, []);

  const awardPoint = useCallback((winner: "P1" | "P2") => {
    const g = gameRef.current;
    if (g.pointOver) return;
    g.pointOver = true;
    soundRef.current.pointScored();

    if (winner === "P1") {
      g.stats.pointsWon++;
      if (g.rallyHits <= 1 && g.isPlayerServing) g.stats.aces++;
      g.p1Pts++;
    } else {
      g.stats.cpuPointsWon++;
      if (g.rallyHits <= 1 && !g.isPlayerServing) g.stats.aces++;
      g.p2Pts++;
    }
    if (g.rallyHits > g.stats.longestRally) g.stats.longestRally = g.rallyHits;

    const gameWinner = isGameWon(g.p1Pts, g.p2Pts);
    if (gameWinner) {
      soundRef.current.gameWon();
      const winLabel = gameWinner === "P1" ? "PLAYER" : "CPU";
      // award game
      if (gameWinner === "P1") {
        g.p1Gms[g.curSet]++;
      } else {
        g.p2Gms[g.curSet]++;
      }
      g.p1Pts = 0;
      g.p2Pts = 0;
      g.isPlayerServing = !g.isPlayerServing;

      // check set
      const p1g = g.p1Gms[g.curSet];
      const p2g = g.p2Gms[g.curSet];
      const setWon = (p1g >= 6 && p1g - p2g >= 2) || (p2g >= 6 && p2g - p1g >= 2)
        || (p1g === 7 && p2g === 6) || (p2g === 7 && p1g === 6);

      if (setWon) {
        const setWinner = p1g > p2g ? "P1" : "P2";
        const setLabel = setWinner === "P1" ? "PLAYER" : "CPU";

        // check match
        const p1Sets = g.p1Gms.filter((_, i) => {
          const a = g.p1Gms[i]; const b = g.p2Gms[i];
          return i < g.curSet && a > b;
        }).length + (setWinner === "P1" ? 1 : 0);
        const p2Sets = g.p2Gms.filter((_, i) => {
          const a = g.p1Gms[i]; const b = g.p2Gms[i];
          return i < g.curSet && b > a;
        }).length + (setWinner === "P2" ? 1 : 0);

        if (p1Sets >= 2 || p2Sets >= 2) {
          showBanner(`MATCH - ${p1Sets >= 2 ? "PLAYER" : "CPU"}`);
          syncScoreToReact();
          setFinalScore({ p1: [...g.p1Gms], p2: [...g.p2Gms] });
          setMatchWinner(p1Sets >= 2 ? "PLAYER" : "CPU");
          g.pointPause = Date.now() + 2000;
          setTimeout(() => setScreen("MATCH_OVER"), 2000);
          return;
        } else {
          showBanner(`SET - ${setLabel}`);
          g.curSet++;
          g.p1Gms.push(0);
          g.p2Gms.push(0);
          g.powerLeft = MAX_POWER_PER_SET;
          syncScoreToReact();
          g.pointPause = Date.now() + 2000;
          setTimeout(() => {
            syncScoreToReact();
            setScreen("SET_BREAK");
          }, 2000);
          return;
        }
      } else {
        showBanner(`GAME - ${winLabel}`);
      }
    }

    // alternate serve side each point
    g.serveSide = g.serveSide === "DEUCE" ? "AD" : "DEUCE";

    syncScoreToReact();
    g.pointPause = Date.now() + 800;
    setTimeout(() => {
      g.pointOver = false;
      resetBall();
      syncScoreToReact();
    }, 800);
  }, [syncScoreToReact, showBanner, resetBall]);

  /* serve */
  const doServe = useCallback(() => {
    const g = gameRef.current;
    if (!g.waitingForServe) return;
    g.tossPhase = true;
    g.tossY = 0;
  }, []);

  const doCPUServe = useCallback(() => {
    const g = gameRef.current;
    g.waitingForServe = false;
    g.serving = false;
    g.ball.active = true;
    const angle = (Math.random() - 0.5) * 0.6;
    g.ball.speed = BALL_BASE_SPEED;
    g.ball.vx = Math.sin(angle) * g.ball.speed;
    g.ball.vy = Math.cos(angle) * g.ball.speed;
    soundRef.current.hit();
  }, []);

  /* game loop */
  const startGame = useCallback((diff: Difficulty) => {
    setDifficulty(diff);
    setScreen("PLAYING");
    const g = gameRef.current;
    g.p1Pts = 0; g.p2Pts = 0;
    g.p1Gms = [0]; g.p2Gms = [0];
    g.curSet = 0;
    g.isPlayerServing = true;
    g.serveSide = "DEUCE";
    g.powerLeft = MAX_POWER_PER_SET;
    g.stats = { aces: 0, doubleFaults: 0, longestRally: 0, pointsWon: 0, cpuPointsWon: 0, powerShotsUsed: 0 };
    g.player.x = CENTER_X;
    g.cpu.x = CENTER_X;
    g.pointOver = false;
    g.pointPause = 0;
    resetBall();
    syncScoreToReact();
  }, [resetBall, syncScoreToReact]);

  const continueAfterSet = useCallback(() => {
    const g = gameRef.current;
    setScreen("PLAYING");
    g.pointOver = false;
    g.pointPause = 0;
    resetBall();
    syncScoreToReact();
  }, [resetBall, syncScoreToReact]);

  useEffect(() => {
    if (screen !== "PLAYING") return;
    const diff = difficulty;

    const onKeyDown = (e: KeyboardEvent) => {
      keysRef.current.add(e.key);
      if (e.key === " ") {
        e.preventDefault();
        const g = gameRef.current;
        if (g.waitingForServe && !g.tossPhase) {
          doServe();
        } else if (!g.waitingForServe && !g.charging && g.powerLeft > 0) {
          g.charging = true;
          g.chargeStart = Date.now();
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keysRef.current.delete(e.key);
      if (e.key === " ") {
        const g = gameRef.current;
        if (g.charging) {
          g.charging = false;
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    let cpuServeTimer = 0;

    const loop = () => {
      const g = gameRef.current;
      const canvas = canvasRef.current;
      if (!canvas) { rafRef.current = requestAnimationFrame(loop); return; }
      const ctx = canvas.getContext("2d");
      if (!ctx) { rafRef.current = requestAnimationFrame(loop); return; }

      if (g.pointPause && Date.now() < g.pointPause) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      const keys = keysRef.current;

      /* ── Player movement ── */
      g.playerMovingDir = 0;
      if ((keys.has("ArrowLeft") || keys.has("a") || keys.has("A")) && g.player.x - g.player.w / 2 > COURT_LEFT) {
        g.player.x -= RACKET_SPEED;
        g.playerMovingDir = -1;
      }
      if ((keys.has("ArrowRight") || keys.has("d") || keys.has("D")) && g.player.x + g.player.w / 2 < COURT_RIGHT) {
        g.player.x += RACKET_SPEED;
        g.playerMovingDir = 1;
      }

      /* ── Toss phase ── */
      if (g.tossPhase && g.isPlayerServing) {
        g.tossY += 1.5;
        g.ball.y = g.player.y - 10 - g.tossY;
        g.ball.x = g.player.x;
        if (g.tossY >= 20) {
          g.tossPhase = false;
          g.waitingForServe = false;
          g.serving = false;
          g.ball.active = true;
          const targetX = g.serveSide === "DEUCE"
            ? CENTER_X - COURT_W / 6 + Math.random() * COURT_W / 6
            : CENTER_X + Math.random() * COURT_W / 6;
          const dx = targetX - g.ball.x;
          const dy = -(COURT_H * 0.55);
          const dist = Math.sqrt(dx * dx + dy * dy);
          g.ball.speed = BALL_BASE_SPEED + 0.5;
          g.ball.vx = (dx / dist) * g.ball.speed;
          g.ball.vy = (dy / dist) * g.ball.speed;
          soundRef.current.hit();
        }
      }

      /* ── CPU serve ── */
      if (g.waitingForServe && !g.isPlayerServing && !g.tossPhase) {
        cpuServeTimer++;
        if (cpuServeTimer > 60) {
          cpuServeTimer = 0;
          doCPUServe();
        }
      } else {
        cpuServeTimer = 0;
      }

      /* ── CPU AI ── */
      if (g.ball.active) {
        g.cpu.x = cpuUpdate(g.cpu, g.ball, diff, 1);
        g.cpu.x = Math.max(COURT_LEFT + g.cpu.w / 2, Math.min(COURT_RIGHT - g.cpu.w / 2, g.cpu.x));
      }

      /* ── Ball physics ── */
      if (g.ball.active && !g.pointOver) {
        g.ball.trail.push({ x: g.ball.x, y: g.ball.y });
        if (g.ball.trail.length > TRAIL_LENGTH) g.ball.trail.shift();

        g.ball.x += g.ball.vx + g.ball.spin * 0.3;
        g.ball.y += g.ball.vy;
        g.ball.spin *= 0.98;

        // wall bounce
        if (g.ball.x <= COURT_LEFT + BALL_R || g.ball.x >= COURT_RIGHT - BALL_R) {
          g.ball.vx = -g.ball.vx;
          g.ball.x = Math.max(COURT_LEFT + BALL_R, Math.min(COURT_RIGHT - BALL_R, g.ball.x));
          soundRef.current.bounce();
        }

        // player racket hit
        const py = g.player.y;
        if (
          g.ball.vy > 0 &&
          g.ball.y + BALL_R >= py - RACKET_H / 2 &&
          g.ball.y - BALL_R <= py + RACKET_H / 2 &&
          g.ball.x >= g.player.x - g.player.w / 2 - BALL_R &&
          g.ball.x <= g.player.x + g.player.w / 2 + BALL_R
        ) {
          const offset = (g.ball.x - g.player.x) / (g.player.w / 2);
          g.ball.speed = Math.min(g.ball.speed + BALL_SPEED_INC, BALL_MAX_SPEED);

          // power shot
          let speedMult = 1;
          if (g.charging && Date.now() - g.chargeStart >= POWER_CHARGE_TIME && g.powerLeft > 0) {
            speedMult = POWER_SHOT_MULT;
            g.powerLeft--;
            g.stats.powerShotsUsed++;
            g.shakeUntil = Date.now() + SCREEN_SHAKE_DUR;
            g.charging = false;
          }

          g.ball.vx = offset * g.ball.speed * 0.8;
          g.ball.vy = -g.ball.speed * speedMult;
          g.ball.spin = g.playerMovingDir * 0.5;
          g.rallyHits++;
          soundRef.current.hit();
          syncScoreToReact();
        }

        // CPU racket hit
        const cy = g.cpu.y;
        if (
          g.ball.vy < 0 &&
          g.ball.y - BALL_R <= cy + RACKET_H / 2 &&
          g.ball.y + BALL_R >= cy - RACKET_H / 2 &&
          g.ball.x >= g.cpu.x - g.cpu.w / 2 - BALL_R &&
          g.ball.x <= g.cpu.x + g.cpu.w / 2 + BALL_R
        ) {
          const offset = (g.ball.x - g.cpu.x) / (g.cpu.w / 2);
          g.ball.speed = Math.min(g.ball.speed + BALL_SPEED_INC, BALL_MAX_SPEED);
          g.ball.vx = offset * g.ball.speed * 0.8;
          g.ball.vy = g.ball.speed;
          if (diff === "HARD") g.ball.spin = (Math.random() - 0.5) * 0.8;
          g.rallyHits++;
          soundRef.current.hit();
          syncScoreToReact();
        }

        // out of bounds (top/bottom)
        if (g.ball.y < COURT_TOP - 20) {
          awardPoint("P1");
        } else if (g.ball.y > COURT_BOTTOM + 20) {
          awardPoint("P2");
        }
      }

      /* ── Render ── */
      const shaking = Date.now() < g.shakeUntil;
      ctx.save();
      if (shaking) {
        ctx.translate(
          (Math.random() - 0.5) * SCREEN_SHAKE_AMP * 2,
          (Math.random() - 0.5) * SCREEN_SHAKE_AMP * 2
        );
      }

      ctx.fillStyle = COL_NAVY;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

      drawCourt(ctx);
      if (g.ball.active || g.tossPhase || g.waitingForServe) {
        drawBall(ctx, g.ball);
      }
      drawRacket(ctx, g.player, COL_WHITE);
      drawRacket(ctx, g.cpu, COL_RED);

      // charge indicator
      if (g.charging && g.powerLeft > 0) {
        const elapsed = Date.now() - g.chargeStart;
        const pct = Math.min(elapsed / POWER_CHARGE_TIME, 1);
        ctx.fillStyle = COL_YELLOW;
        ctx.fillRect(g.player.x - 15, g.player.y + 8, 30 * pct, 3);
      }

      ctx.restore();
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [screen, difficulty, doServe, doCPUServe, awardPoint, syncScoreToReact, resetBall]);

  /* ══════════════════════════════════════════════
     SCOREBOARD HELPERS
     ══════════════════════════════════════════════ */
  const p1PointsStr = isDeuce(p1Points, p2Points)
    ? "40" : hasAdvantage(p1Points, p2Points) === "P1"
    ? "AD" : hasAdvantage(p1Points, p2Points) === "P2"
    ? "40" : p1Points <= 3 ? POINTS_LABELS[p1Points] : "40";

  const p2PointsStr = isDeuce(p1Points, p2Points)
    ? "40" : hasAdvantage(p1Points, p2Points) === "P2"
    ? "AD" : hasAdvantage(p1Points, p2Points) === "P1"
    ? "40" : p2Points <= 3 ? POINTS_LABELS[p2Points] : "40";

  const deuceLabel = isDeuce(p1Points, p2Points) ? "DEUCE" : null;

  const btnStyle: React.CSSProperties = {
    background: "transparent", color: COL_WHITE, border: `2px solid ${COL_WHITE}`,
    padding: "10px 32px", fontFamily: "'Courier New', monospace", fontSize: "16px",
    fontWeight: "bold", textTransform: "uppercase" as const, cursor: "pointer",
    letterSpacing: "2px",
  };
  const btnHover = (e: React.MouseEvent<HTMLButtonElement>) => {
    (e.target as HTMLButtonElement).style.background = COL_WHITE;
    (e.target as HTMLButtonElement).style.color = COL_NAVY;
  };
  const btnLeave = (e: React.MouseEvent<HTMLButtonElement>) => {
    (e.target as HTMLButtonElement).style.background = "transparent";
    (e.target as HTMLButtonElement).style.color = COL_WHITE;
  };

  /* ══════════════════════════════════════════════
     JSX
     ══════════════════════════════════════════════ */
  return (
    <div style={{
      width: "100vw", height: "100vh", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", background: COL_NAVY, position: "relative",
      overflow: "hidden",
    }}>
      {/* ── MENU ── */}
      {screen === "MENU" && (
        <div style={{ textAlign: "center" }}>
          <h1 style={{
            fontFamily: "'Courier New', monospace", fontSize: "48px", fontWeight: "bold",
            color: COL_YELLOW, letterSpacing: "6px", marginBottom: "40px",
          }}>MATCH POINT</h1>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px", alignItems: "center" }}>
            {(["EASY", "MEDIUM", "HARD"] as Difficulty[]).map(d => (
              <button key={d} style={btnStyle}
                onMouseEnter={btnHover} onMouseLeave={btnLeave}
                onClick={() => startGame(d)}>{d}</button>
            ))}
          </div>
          <p style={{
            marginTop: "32px", fontSize: "12px", color: COL_WHITE, opacity: 0.6,
            fontFamily: "'Courier New', monospace", letterSpacing: "1px",
          }}>
            Arrows to move &middot; Space to serve &middot; Hold space for power shot
          </p>
        </div>
      )}

      {/* ── PLAYING ── */}
      {screen === "PLAYING" && (
        <div style={{ position: "relative" }}>
          {/* Scoreboard */}
          <div style={{
            background: "rgba(0,0,0,0.85)", padding: "6px 12px", marginBottom: "4px",
            fontFamily: "'Courier New', monospace", fontSize: "13px",
            display: "grid", gridTemplateColumns: "80px repeat(10, 28px) 36px",
            gap: "0", alignItems: "center", border: `1px solid ${COL_WHITE}33`,
          }}>
            {/* Header */}
            <div style={{ color: COL_WHITE, opacity: 0.5 }}></div>
            {p1Games.map((_, i) => (
              <div key={i} style={{ color: COL_WHITE, opacity: 0.5, textAlign: "center" }}>S{i + 1}</div>
            ))}
            {Array.from({ length: 10 - p1Games.length }).map((_, i) => (
              <div key={`e${i}`}></div>
            ))}
            <div style={{ color: COL_WHITE, opacity: 0.5, textAlign: "center" }}>PTS</div>

            {/* Player row */}
            <div style={{ color: isPlayerServing ? COL_YELLOW : COL_WHITE, fontWeight: "bold" }}>
              {isPlayerServing ? "\u25B8 " : "  "}PLR
            </div>
            {p1Games.map((g, i) => (
              <div key={i} style={{ color: COL_WHITE, textAlign: "center", fontWeight: i === currentSet ? "bold" : "normal" }}>{g}</div>
            ))}
            {Array.from({ length: 10 - p1Games.length }).map((_, i) => (
              <div key={`e${i}`}></div>
            ))}
            <div style={{ color: COL_YELLOW, textAlign: "center", fontWeight: "bold" }}>
              {deuceLabel ? "40" : p1PointsStr}
            </div>

            {/* CPU row */}
            <div style={{ color: !isPlayerServing ? COL_YELLOW : COL_WHITE, fontWeight: "bold" }}>
              {!isPlayerServing ? "\u25B8 " : "  "}CPU
            </div>
            {p2Games.map((g, i) => (
              <div key={i} style={{ color: COL_WHITE, textAlign: "center", fontWeight: i === currentSet ? "bold" : "normal" }}>{g}</div>
            ))}
            {Array.from({ length: 10 - p2Games.length }).map((_, i) => (
              <div key={`e${i}`}></div>
            ))}
            <div style={{ color: COL_YELLOW, textAlign: "center", fontWeight: "bold" }}>
              {deuceLabel ? "40" : p2PointsStr}
            </div>
          </div>

          {deuceLabel && (
            <div style={{
              textAlign: "center", fontFamily: "'Courier New', monospace",
              fontSize: "11px", color: COL_YELLOW, letterSpacing: "2px", marginBottom: "2px",
            }}>DEUCE</div>
          )}
          {hasAdvantage(p1Points, p2Points) && (
            <div style={{
              textAlign: "center", fontFamily: "'Courier New', monospace",
              fontSize: "11px", color: COL_YELLOW, letterSpacing: "2px", marginBottom: "2px",
            }}>AD {hasAdvantage(p1Points, p2Points) === "P1" ? "PLAYER" : "CPU"}</div>
          )}

          {/* Canvas */}
          <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H}
            style={{ display: "block", border: `2px solid ${COL_WHITE}22` }} />

          {/* HUD overlays */}
          <div style={{
            position: "absolute", bottom: 8, left: 8,
            fontFamily: "'Courier New', monospace", fontSize: "10px", color: COL_WHITE, opacity: 0.5,
          }}>RALLY: {rallyCount}</div>
          <div style={{
            position: "absolute", bottom: 8, right: 8,
            fontFamily: "'Courier New', monospace", fontSize: "10px", color: COL_YELLOW,
          }}>PWR: {"||".repeat(powerCharges)}{"..".repeat(MAX_POWER_PER_SET - powerCharges)}</div>

          {/* Banner */}
          {banner && (
            <div style={{
              position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
              background: "rgba(0,0,0,0.85)", padding: "12px 32px",
              fontFamily: "'Courier New', monospace", fontSize: "20px", fontWeight: "bold",
              color: COL_YELLOW, letterSpacing: "4px", border: `2px solid ${COL_YELLOW}`,
              whiteSpace: "nowrap",
            }}>{banner}</div>
          )}

          {/* Stats toggle */}
          <div style={{ marginTop: "4px", display: "flex", justifyContent: "center" }}>
            <button style={{ ...btnStyle, padding: "4px 16px", fontSize: "11px" }}
              onMouseEnter={btnHover} onMouseLeave={btnLeave}
              onClick={() => setShowStats(!showStats)}>
              {showStats ? "HIDE STATS" : "STATS"}
            </button>
          </div>
          {showStats && (
            <div style={{
              marginTop: "4px", background: "rgba(0,0,0,0.85)", padding: "8px 16px",
              fontFamily: "'Courier New', monospace", fontSize: "11px", color: COL_WHITE,
              border: `1px solid ${COL_WHITE}33`,
            }}>
              <div>ACES: {stats.aces}</div>
              <div>LONGEST RALLY: {stats.longestRally}</div>
              <div>POINTS WON: {stats.pointsWon} - {stats.cpuPointsWon}</div>
              <div>POWER SHOTS USED: {stats.powerShotsUsed}</div>
            </div>
          )}
        </div>
      )}

      {/* ── SET BREAK ── */}
      {screen === "SET_BREAK" && (
        <div style={{ textAlign: "center" }}>
          <h2 style={{
            fontFamily: "'Courier New', monospace", fontSize: "28px", fontWeight: "bold",
            color: COL_YELLOW, letterSpacing: "4px", marginBottom: "24px",
          }}>SET COMPLETE</h2>
          <div style={{
            fontFamily: "'Courier New', monospace", fontSize: "14px", color: COL_WHITE,
            marginBottom: "24px",
          }}>
            {p1Games.slice(0, currentSet).map((g, i) => (
              <div key={i}>SET {i + 1}: PLAYER {g} - {p2Games[i]} CPU</div>
            ))}
          </div>
          <button style={btnStyle} onMouseEnter={btnHover} onMouseLeave={btnLeave}
            onClick={continueAfterSet}>CONTINUE</button>
        </div>
      )}

      {/* ── MATCH OVER ── */}
      {screen === "MATCH_OVER" && (
        <div style={{ textAlign: "center" }}>
          <h2 style={{
            fontFamily: "'Courier New', monospace", fontSize: "32px", fontWeight: "bold",
            color: COL_YELLOW, letterSpacing: "4px", marginBottom: "16px",
          }}>{matchWinner} WINS</h2>
          <div style={{
            fontFamily: "'Courier New', monospace", fontSize: "14px", color: COL_WHITE,
            marginBottom: "20px",
          }}>
            {finalScore.p1.map((g, i) => (
              <div key={i}>SET {i + 1}: PLAYER {g} - {finalScore.p2[i]} CPU</div>
            ))}
          </div>
          <div style={{
            fontFamily: "'Courier New', monospace", fontSize: "12px", color: COL_WHITE,
            opacity: 0.7, marginBottom: "24px", lineHeight: "1.8",
          }}>
            <div>ACES: {stats.aces}</div>
            <div>LONGEST RALLY: {stats.longestRally}</div>
            <div>POINTS WON: {stats.pointsWon} - {stats.cpuPointsWon}</div>
            <div>POWER SHOTS USED: {stats.powerShotsUsed}</div>
          </div>
          <button style={btnStyle} onMouseEnter={btnHover} onMouseLeave={btnLeave}
            onClick={() => setScreen("MENU")}>REMATCH</button>
        </div>
      )}
    </div>
  );
}
