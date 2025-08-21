"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

// This page has two tabs: "폭탄 해제" (defuse) and "점령전" (domination).
// - Defuse tab = bomb timer with audio/vibration/flash (boom2.mp3 in /public if present).
// - Domination tab = Red vs Blue tug-of-war bar with immediate visual updates, settable time-to-100%, pause, reset.
// TypeScript/ESLint friendly (no `any`, proper hooks deps, escaped quotes, null-safe audio refs).

// ---- AudioContext helpers (no `any`) ----
// Some browsers expose webkitAudioContext. This helper resolves a constructor safely.

type AudioContextCtor = new (
  contextOptions?: AudioContextOptions
) => AudioContext;
function getAudioContextCtor(): AudioContextCtor | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext;
}

export default function BombGamePage() {
  const [tab, setTab] = useState<"defuse" | "domination">("defuse");

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center p-4">
      <div className="w-full max-w-3xl rounded-2xl border border-neutral-800 bg-neutral-900/60 shadow-2xl backdrop-blur">
        {/* Header + Tabs */}
        <header className="p-6 pb-3 border-b border-neutral-800">
          <h1 className="text-2xl font-bold tracking-tight mb-4">
            ⚙️ 서바이벌 툴킷
          </h1>
          <div className="inline-flex rounded-xl p-1 bg-neutral-800/60 border border-neutral-700">
            <TabButton
              active={tab === "defuse"}
              onClick={() => setTab("defuse")}
            >
              폭탄 해제
            </TabButton>
            <TabButton
              active={tab === "domination"}
              onClick={() => setTab("domination")}
            >
              점령전
            </TabButton>
          </div>
        </header>

        <main className="p-6">
          {tab === "defuse" ? <DefuseTab /> : <DominationTab />}
        </main>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "px-4 py-2 rounded-lg text-sm font-medium transition " +
        (active
          ? "bg-neutral-100 text-neutral-900"
          : "text-neutral-200 hover:bg-neutral-700/60")
      }
    >
      {children}
    </button>
  );
}

// ========================= Defuse (폭탄 해제) =========================
function DefuseTab() {
  const [totalSeconds, setTotalSeconds] = useState<number>(0);
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [isRunning, setIsRunning] = useState(false);

  const [showSetup, setShowSetup] = useState(true);
  const [showExploded, setShowExploded] = useState(false);
  const [showDisarmed, setShowDisarmed] = useState(false);

  const [disarmMode, setDisarmMode] = useState(false);
  const [pressed, setPressed] = useState<boolean[]>(Array(9).fill(false));

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // --- Audio Core ---
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sampleBufferRef = useRef<AudioBuffer | null>(null);

  const ensureAudio = useCallback(() => {
    const Ctx = getAudioContextCtor();
    if (!Ctx) return;
    if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
    const ctx = audioCtxRef.current;
    if (ctx.state === "suspended") {
      void ctx.resume();
    }
  }, []);

  const tone = useCallback(
    (
      freq: number,
      duration = 0.08,
      type: OscillatorType = "sine",
      volume = 0.06,
      when = 0
    ) => {
      const ctx = audioCtxRef.current;
      if (!ctx) return;
      const t0 = ctx.currentTime + when;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(volume, t0);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + duration);
    },
    []
  );

  const playTick = useCallback(
    (secondLeft: number) => {
      const urgent = secondLeft <= 10;
      const freq = urgent ? 1100 : 880;
      const dur = urgent ? 0.1 : 0.06;
      tone(freq, dur, "square", urgent ? 0.08 : 0.05);
    },
    [tone]
  );

  const playFailBeep = useCallback(() => {
    tone(220, 0.12, "square", 0.08);
  }, [tone]);

  const playSuccess = useCallback(() => {
    ensureAudio();
    tone(523.25, 0.09, "sine", 0.07, 0);
    tone(659.25, 0.09, "sine", 0.07, 0.1);
    tone(783.99, 0.12, "sine", 0.07, 0.2);
  }, [ensureAudio, tone]);

  const playExplosionSynth = useCallback(() => {
    ensureAudio();
    const ctx = audioCtxRef.current;
    if (!ctx) return;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -22;
    comp.knee.value = 30;
    comp.ratio.value = 6;
    comp.attack.value = 0.002;
    comp.release.value = 0.3;

    const master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(comp).connect(ctx.destination);

    const convolver = ctx.createConvolver();
    convolver.buffer = makeImpulse(ctx, 2.2, 3.5);
    const revGain = ctx.createGain();
    revGain.gain.value = 0.35;
    master.connect(convolver).connect(revGain).connect(comp);

    burstNoise(ctx, master, {
      duration: 0.07,
      highpass: 1200,
      bandpass: 3200,
      q: 0.9,
      gain: 1.2,
      timeOffset: 0,
    });
    burstNoise(ctx, master, {
      duration: 0.06,
      highpass: 800,
      bandpass: 2500,
      q: 0.8,
      gain: 0.8,
      timeOffset: 0.03,
    });
    airyWhoosh(ctx, master, {
      duration: 0.6,
      center: 1200,
      q: 0.7,
      startGain: 0.35,
      timeOffset: 0,
    });
    bassDrop(ctx, master, {
      start: 100,
      end: 28,
      duration: 1.0,
      startGain: 0.7,
      timeOffset: 0.02,
    });
    rumble(ctx, master, {
      duration: 2.6,
      lowpass: 140,
      startGain: 0.8,
      tremoloHz: 7,
      timeOffset: 0.03,
    });
    for (let i = 0; i < 5; i++) {
      burstNoise(ctx, master, {
        duration: 0.02 + Math.random() * 0.03,
        highpass: 2500,
        bandpass: 5000,
        q: 1.2,
        gain: 0.35,
        timeOffset: 0.05 + i * 0.05 + Math.random() * 0.02,
      });
    }
  }, [ensureAudio]);

  const playExplosion = useCallback(async () => {
    ensureAudio();
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    if (!sampleBufferRef.current) {
      try {
        const res = await fetch("/boom2.mp3", { cache: "force-cache" });
        if (res.ok) {
          const arr = await res.arrayBuffer();
          sampleBufferRef.current = await ctx.decodeAudioData(arr);
        }
      } catch {
        // ignore and fallback to synth
      }
    }
    if (sampleBufferRef.current) {
      const src = ctx.createBufferSource();
      src.buffer = sampleBufferRef.current;
      const gain = ctx.createGain();
      gain.gain.value = 0.85;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.knee.value = 20;
      comp.ratio.value = 4;
      comp.attack.value = 0.003;
      comp.release.value = 0.25;
      src.connect(gain).connect(comp).connect(ctx.destination);
      src.start();
      return;
    }
    playExplosionSynth();
  }, [ensureAudio, playExplosionSynth]);

  const vibrate = useCallback((pattern: number | number[]) => {
    if (typeof navigator !== "undefined") {
      navigator.vibrate?.(pattern);
    }
  }, []);

  const formatted = useMemo(() => formatTime(timeLeft), [timeLeft]);
  const isLow = isRunning && timeLeft > 0 && timeLeft <= 10;

  useEffect(() => {
    if (!isRunning) {
      clearTick();
      return;
    }

    intervalRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearTick();
          setIsRunning(false);
          setDisarmMode(false);
          setShowExploded(true);
          void playExplosion();
          vibrate([200, 120, 200]);
          return 0;
        }
        const next = prev - 1;
        playTick(next);
        if (next <= 5) vibrate(30);
        return next;
      });
    }, 1000);

    return clearTick;
  }, [isRunning, playExplosion, playTick, vibrate]);

  function clearTick() {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }

  function openSetup() {
    setShowSetup(true);
  }

  function applySetup(seconds: number) {
    setTotalSeconds(seconds);
    setTimeLeft(seconds);
    setShowSetup(false);
    setShowExploded(false);
    setShowDisarmed(false);
    setIsRunning(false);
    setDisarmMode(false);
    setPressed(Array(9).fill(false));
  }

  function startTimer() {
    if (timeLeft <= 0) return;
    ensureAudio();
    setIsRunning(true);
  }

  function toggleDisarm() {
    ensureAudio();
    if (!disarmMode) {
      setPressed(Array(9).fill(false));
      setDisarmMode(true);
    } else {
      const allPressed = pressed.every(Boolean);
      if (allPressed) {
        setIsRunning(false);
        setDisarmMode(false);
        setShowDisarmed(true);
        playSuccess();
        vibrate(120);
      } else {
        const el = document.getElementById("disarm-panel");
        if (el) {
          el.classList.remove("animate-[shake_0.3s_ease-in-out]");
          void el.offsetWidth;
          el.classList.add("animate-[shake_0.3s_ease-in-out]");
        }
        vibrate(60);
        playFailBeep();
      }
    }
  }

  function pressPad(i: number) {
    ensureAudio();
    setPressed((prev) => {
      if (prev[i]) return prev;
      const next = [...prev];
      next[i] = true;
      return next;
    });
    tone(600 + i * 20, 0.05, "sine", 0.04);
  }

  const pressedCount = pressed.filter(Boolean).length;

  return (
    <>
      {/* Flash layer on explosion */}
      {showExploded && (
        <div className="fixed inset-0 z-40 pointer-events-none animate-[flashscreen_600ms_ease-out] bg-white/80" />
      )}

      {/* Top controls for Defuse */}
      <div className="flex items-center justify-between mb-6">
        <div className="text-lg font-semibold">💣 폭탄 해제</div>
        <button
          onClick={openSetup}
          className="px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-sm"
        >
          시간 설정
        </button>
      </div>

      {/* Timer Display */}
      <div
        className={
          "rounded-2xl border p-6 mb-6 " +
          (isLow ? "border-red-600 low-glow" : "border-neutral-800")
        }
      >
        <div className="flex items-center justify-center py-4">
          <div
            className={
              "font-mono text-7xl md:text-8xl tabular-nums select-none tracking-widest " +
              (isLow ? "animate-[blink_1s_steps(2,_end)_infinite]" : "")
            }
          >
            {formatted}
          </div>
        </div>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={startTimer}
            disabled={
              isRunning || timeLeft <= 0 || showExploded || showDisarmed
            }
            className="px-6 py-3 rounded-xl bg-emerald-600 enabled:hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed font-semibold shadow"
          >
            시작
          </button>
          <button
            onClick={toggleDisarm}
            disabled={showExploded || showDisarmed || totalSeconds === 0}
            className={`px-6 py-3 rounded-xl font-semibold shadow border ${
              disarmMode
                ? "bg-red-700 hover:bg-red-600 border-red-700"
                : "bg-neutral-800 hover:bg-neutral-700 border-neutral-700"
            }`}
          >
            해제
          </button>
        </div>

        {disarmMode && (
          <div id="disarm-panel" className="mt-6">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm text-neutral-300">
                버튼을 모두 누른 뒤 다시 &quot;해제&quot;를 누르세요.
              </div>
              <div className="text-sm">진행도: {pressedCount}/9</div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {Array.from({ length: 9 }).map((_, i) => (
                <button
                  key={i}
                  onClick={() => pressPad(i)}
                  className={
                    "aspect-square rounded-2xl border font-bold text-xl flex items-center justify-center select-none " +
                    (pressed[i]
                      ? "bg-emerald-600/90 border-emerald-500"
                      : "bg-neutral-800 hover:bg-neutral-700 border-neutral-700")
                  }
                >
                  {i + 1}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      {showSetup && (
        <TimeSetupModal
          open={showSetup}
          onClose={() => setShowSetup(false)}
          onApply={(m, s) => applySetup(m * 60 + s)}
        />
      )}

      {showExploded && (
        <Modal
          title="💥 폭탄이 터졌습니다"
          open={showExploded}
          onClose={() => setShowExploded(false)}
        >
          <div className="space-y-4">
            <p className="text-neutral-300">
              시간이 모두 경과했어요. 다시 시도하려면 시간을 재설정하세요.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                className="px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 border border-neutral-700"
                onClick={() => setShowExploded(false)}
              >
                닫기
              </button>
              <button
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-semibold"
                onClick={() => {
                  setShowExploded(false);
                  setShowSetup(true);
                }}
              >
                시간 재설정
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showDisarmed && (
        <Modal
          title="🟢 폭탄이 해제되었습니다"
          open={showDisarmed}
          onClose={() => setShowDisarmed(false)}
        >
          <div className="space-y-4">
            <p className="text-neutral-300">
              성공적으로 해제했습니다. 계속 사용하려면 시간을 재설정하세요.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                className="px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 border border-neutral-700"
                onClick={() => setShowDisarmed(false)}
              >
                닫기
              </button>
              <button
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-semibold"
                onClick={() => {
                  setShowDisarmed(false);
                  setShowSetup(true);
                }}
              >
                시간 재설정
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Keyframes for Defuse */}
      <style jsx global>{`
        @keyframes shake {
          0% {
            transform: translateX(0);
          }
          20% {
            transform: translateX(-6px);
          }
          40% {
            transform: translateX(6px);
          }
          60% {
            transform: translateX(-4px);
          }
          80% {
            transform: translateX(4px);
          }
          100% {
            transform: translateX(0);
          }
        }
        @keyframes redGlow {
          0%,
          100% {
            box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.5),
              0 0 0 rgba(239, 68, 68, 0);
          }
          50% {
            box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.55),
              0 0 30px rgba(239, 68, 68, 0.35);
          }
        }
        .low-glow {
          animation: redGlow 1s linear infinite;
        }
        @keyframes blink {
          from {
            opacity: 1;
          }
          50% {
            opacity: 0.35;
          }
          to {
            opacity: 1;
          }
        }
        @keyframes flashscreen {
          0% {
            opacity: 0;
          }
          15% {
            opacity: 1;
          }
          100% {
            opacity: 0;
          }
        }
      `}</style>
    </>
  );
}

// ========================= Domination (점령전) =========================
function DominationTab() {
  // value in range [-100, 100] (positive = RED %, negative = BLUE %)
  const [value, setValue] = useState<number>(0);
  const [active, setActive] = useState<"red" | "blue" | null>(null);
  const [fillTimeSec, setFillTimeSec] = useState<number>(60); // time to go from 0 -> 100%

  // Refs to avoid stale state in timers and to survive StrictMode double effects
  const valueRef = useRef<number>(0);
  const activeRef = useRef<"red" | "blue" | null>(null);
  const fillTimeRef = useRef<number>(60);
  const lastTickRef = useRef<number | null>(null);

  // keep refs synced with state
  useEffect(() => {
    valueRef.current = value;
  }, [value]);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);
  useEffect(() => {
    fillTimeRef.current = fillTimeSec;
  }, [fillTimeSec]);

  // Always-on interval ticker
  useEffect(() => {
    const intervalMs = 50; // 20 FPS
    const id = setInterval(() => {
      const now = performance.now();
      if (!activeRef.current) {
        lastTickRef.current = now;
        return;
      }

      if (lastTickRef.current == null) lastTickRef.current = now;
      const dt = Math.max(0, (now - lastTickRef.current) / 1000); // seconds
      lastTickRef.current = now;

      const stepPerSec = 100 / Math.max(1, fillTimeRef.current);
      const dir = activeRef.current === "red" ? 1 : -1;

      let next = valueRef.current + dir * stepPerSec * dt;
      if (next > 100) next = 100;
      if (next < -100) next = -100;

      if (next !== valueRef.current) {
        valueRef.current = next;
        setValue(next);
      }

      // Auto-pause on full capture
      if (
        (activeRef.current === "red" && next >= 100) ||
        (activeRef.current === "blue" && next <= -100)
      ) {
        setActive(null);
      }
    }, intervalMs);
    return () => clearInterval(id);
  }, []);

  // Helper: set active and kick immediate visual progress
  const setActiveAndKick = (side: "red" | "blue" | null) => {
    setActive(side);
    if (side) {
      const kickDt = 0.06; // 60ms worth of progress instantly
      const stepPerSec = 100 / Math.max(1, fillTimeRef.current);
      const dir = side === "red" ? 1 : -1;
      let next = valueRef.current + dir * stepPerSec * kickDt;
      if (next > 100) next = 100;
      if (next < -100) next = -100;
      valueRef.current = next;
      setValue(next);
      lastTickRef.current = performance.now();
    }
  };

  const redPct = Math.max(0, value);
  const bluePct = Math.max(0, -value);
  const statusLabel =
    value === 100
      ? "레드 점령!"
      : value === -100
      ? "블루 점령!"
      : active === "red"
      ? "레드 점령 중…"
      : active === "blue"
      ? "블루 점령 중…"
      : "대기 중";

  const handleRed = () => setActiveAndKick("red");
  const handleBlue = () => setActiveAndKick("blue");
  const handlePause = () => setActiveAndKick(null);
  const handleReset = () => {
    setActiveAndKick(null);
    valueRef.current = 0;
    setValue(0);
    lastTickRef.current = performance.now();
  };

  return (
    <div>
      <div className="text-lg font-semibold mb-4">🚩 점령전</div>

      {/* Config */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-neutral-300">100% 차는 시간</span>
          <input
            type="number"
            min={1}
            max={3600}
            value={fillTimeSec}
            onChange={(e) =>
              setFillTimeSec(
                Math.max(1, Math.min(3600, Number(e.target.value || 60)))
              )
            }
            className="w-24 text-center px-3 py-2 rounded-xl bg-neutral-800 border border-neutral-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono text-sm"
          />
          <span className="text-neutral-400">초</span>
        </label>
        <span className="text-sm opacity-80">상태: {statusLabel}</span>
      </div>

      {/* Bar */}
      <div className="relative h-14 rounded-xl overflow-hidden border border-neutral-800 bg-neutral-800">
        {/* Red fill from left */}
        <div
          className="absolute inset-y-0 left-0 bg-red-600"
          style={{ width: `${redPct}%`, transition: "width 120ms linear" }}
        />
        {/* Blue fill from right */}
        <div
          className="absolute inset-y-0 right-0 bg-blue-600"
          style={{ width: `${bluePct}%`, transition: "width 120ms linear" }}
        />
        {/* Labels */}
        <div className="absolute inset-0 flex items-center justify-between px-4 text-sm font-semibold">
          <span className="text-red-200">RED {redPct.toFixed(0)}%</span>
          <span className="text-blue-200">BLUE {bluePct.toFixed(0)}%</span>
        </div>
      </div>

      {/* Controls */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={handleRed}
          className="px-4 py-2 rounded-xl font-semibold bg-red-600 hover:bg-red-500"
        >
          레드
        </button>
        <button
          onClick={handleBlue}
          className="px-4 py-2 rounded-xl font-semibold bg-blue-600 hover:bg-blue-500"
        >
          블루
        </button>
        <button
          onClick={handlePause}
          className="px-4 py-2 rounded-xl font-semibold bg-neutral-800 hover:bg-neutral-700 border border-neutral-700"
        >
          중단
        </button>
        <button
          onClick={handleReset}
          className="px-4 py-2 rounded-xl font-semibold bg-neutral-800 hover:bg-neutral-700 border border-neutral-700"
        >
          리셋
        </button>
      </div>
    </div>
  );
}

// ========================= Shared: Modal, Inputs, Audio helpers =========================
function formatTime(total: number) {
  const m = Math.floor(total / 60)
    .toString()
    .padStart(2, "0");
  const s = Math.floor(total % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}

function Modal({
  title,
  open,
  onClose,
  children,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-[92vw] max-w-lg rounded-2xl bg-neutral-900 border border-neutral-800 shadow-2xl p-6">
        <div className="flex items-center mb-4">
          <h2 className="text-lg font-semibold">{title}</h2>
        </div>
        {children}
      </div>
    </div>
  );
}

function TimeSetupModal({
  open,
  onClose,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  onApply: (minutes: number, seconds: number) => void;
}) {
  const [m, setM] = useState<string>("01");
  const [s, setS] = useState<string>("00");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    if (open) setError("");
  }, [open]);

  const submit = () => {
    const minutes = clampInt(parseInt(m || "0", 10), 0, 999);
    const seconds = clampInt(parseInt(s || "0", 10), 0, 59);
    const total = minutes * 60 + seconds;
    if (total <= 0) {
      setError("1초 이상으로 설정해 주세요.");
      return;
    }
    onApply(minutes, seconds);
  };

  if (!open) return null;
  return (
    <Modal title="시간 설정" open={open} onClose={onClose}>
      <div className="space-y-5">
        <div className="flex items-center justify-center gap-3">
          <NumberField label="분" value={m} onChange={setM} max={999} />
          <span className="opacity-60">:</span>
          <NumberField label="초" value={s} onChange={setS} max={59} />
        </div>
        {error && <p className="text-red-400 text-sm text-center">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            className="px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 border border-neutral-700"
            onClick={onClose}
          >
            취소
          </button>
          <button
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-semibold"
            onClick={submit}
          >
            적용
          </button>
        </div>
      </div>
    </Modal>
  );
}

function NumberField({
  label,
  value,
  onChange,
  max,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  max: number;
}) {
  return (
    <label className="inline-flex flex-col items-center gap-2">
      <span className="text-sm text-neutral-300">{label}</span>
      <input
        inputMode="numeric"
        pattern="\d*"
        value={value}
        onChange={(e) => {
          const digitsOnly = e.target.value.replace(/[^0-9]/g, "");
          if (digitsOnly.length > String(max).length) return;
          onChange(digitsOnly);
        }}
        onBlur={(e) => {
          const v = e.target.value || "0";
          if (label === "분") {
            onChange(String(parseInt(v, 10) || 0).padStart(2, "0"));
          } else {
            const n = clampInt(parseInt(v, 10) || 0, 0, max);
            onChange(String(n).padStart(2, "0"));
          }
        }}
        className="w-24 text-center px-3 py-2 rounded-xl bg-neutral-800 border border-neutral-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono text-xl"
        placeholder="00"
      />
    </label>
  );
}

// ---------- Synth Helpers for Defuse ----------
function makeImpulse(ctx: AudioContext, duration = 2.0, decay = 3.0) {
  const len = Math.floor(duration * ctx.sampleRate);
  const impulse = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return impulse;
}
function whiteNoiseBuffer(ctx: AudioContext, duration: number) {
  const len = Math.floor(duration * ctx.sampleRate);
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}
function burstNoise(
  ctx: AudioContext,
  dest: AudioNode,
  opts: {
    duration: number;
    highpass: number;
    bandpass: number;
    q: number;
    gain: number;
    timeOffset: number;
  }
) {
  const src = ctx.createBufferSource();
  src.buffer = whiteNoiseBuffer(ctx, opts.duration);
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = opts.highpass;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = opts.bandpass;
  bp.Q.value = opts.q;
  const g = ctx.createGain();
  g.gain.value = opts.gain;
  src.connect(hp).connect(bp).connect(g).connect(dest);
  const t = ctx.currentTime + opts.timeOffset;
  g.gain.setValueAtTime(opts.gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + opts.duration);
  src.start(t);
  src.stop(t + opts.duration + 0.02);
}
function airyWhoosh(
  ctx: AudioContext,
  dest: AudioNode,
  opts: {
    duration: number;
    center: number;
    q: number;
    startGain: number;
    timeOffset: number;
  }
) {
  const src = ctx.createBufferSource();
  src.buffer = whiteNoiseBuffer(ctx, opts.duration);
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = opts.center;
  bp.Q.value = opts.q;
  const g = ctx.createGain();
  g.gain.value = opts.startGain;
  src.connect(bp).connect(g).connect(dest);
  const t = ctx.currentTime + opts.timeOffset;
  g.gain.setValueAtTime(opts.startGain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + opts.duration);
  src.start(t);
  src.stop(t + opts.duration + 0.05);
}
function bassDrop(
  ctx: AudioContext,
  dest: AudioNode,
  opts: {
    start: number;
    end: number;
    duration: number;
    startGain: number;
    timeOffset: number;
  }
) {
  const osc = ctx.createOscillator();
  osc.type = "triangle";
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 160;
  const g = ctx.createGain();
  g.gain.value = opts.startGain;
  osc.connect(lp).connect(g).connect(dest);
  const t = ctx.currentTime + opts.timeOffset;
  osc.frequency.setValueAtTime(opts.start, t);
  osc.frequency.exponentialRampToValueAtTime(
    Math.max(1, opts.end),
    t + opts.duration
  );
  g.gain.setValueAtTime(opts.startGain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + opts.duration + 0.1);
  osc.start(t);
  osc.stop(t + opts.duration + 0.2);
}
function rumble(
  ctx: AudioContext,
  dest: AudioNode,
  opts: {
    duration: number;
    lowpass: number;
    startGain: number;
    tremoloHz: number;
    timeOffset: number;
  }
) {
  const src = ctx.createBufferSource();
  src.buffer = whiteNoiseBuffer(ctx, opts.duration);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = opts.lowpass;
  const g = ctx.createGain();
  g.gain.value = opts.startGain;
  const trem = ctx.createOscillator();
  trem.frequency.value = opts.tremoloHz;
  const tremGain = ctx.createGain();
  tremGain.gain.value = 0.25 * opts.startGain;
  trem.connect(tremGain).connect(g.gain);
  src.connect(lp).connect(g).connect(dest);
  const t = ctx.currentTime + opts.timeOffset;
  g.gain.setValueAtTime(opts.startGain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + opts.duration);
  src.start(t);
  src.stop(t + opts.duration + 0.1);
  trem.start(t);
  trem.stop(t + opts.duration);
}

function clampInt(n: number, min: number, max: number) {
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}
