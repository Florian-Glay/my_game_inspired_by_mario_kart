import { useEffect, useRef } from 'react';

type ParticleLayer = 'near' | 'far';

type Particle = {
  x: number;
  y: number;
  radius: number;
  speed: number;
  alpha: number;
  layer: ParticleLayer;
};

const MAX_DPR = 1.5;
const MAX_DT = 0.05;
const OFFSCREEN_MARGIN_FACTOR = 0.15;

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function spawnParticle(width: number, height: number, layer: ParticleLayer, fromLeft = false): Particle {
  const margin = Math.max(12, width * OFFSCREEN_MARGIN_FACTOR);
  if (layer === 'near') {
    return {
      x: fromLeft ? -margin - randomBetween(0, margin * 0.8) : randomBetween(-margin, width),
      y: randomBetween(0, height),
      radius: randomBetween(1, 2.2),
      speed: randomBetween(38, 76),
      alpha: randomBetween(0.35, 0.9),
      layer,
    };
  }

  return {
    x: fromLeft ? -margin - randomBetween(0, margin * 0.8) : randomBetween(-margin, width),
    y: randomBetween(0, height),
    radius: randomBetween(0.8, 1.6),
    speed: randomBetween(16, 38),
    alpha: randomBetween(0.18, 0.55),
    layer,
  };
}

function rebuildParticles(width: number, height: number) {
  const nearCount = Math.max(42, Math.floor(width / 14));
  const farCount = Math.max(28, Math.floor(width / 22));
  const particles: Particle[] = [];

  for (let i = 0; i < nearCount; i += 1) {
    particles.push(spawnParticle(width, height, 'near', false));
  }
  for (let i = 0; i < farCount; i += 1) {
    particles.push(spawnParticle(width, height, 'far', false));
  }

  return particles;
}

export function MenuParticleField() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;

    const context = canvas.getContext('2d', { alpha: true, desynchronized: true });
    if (!context) return;

    let width = 1;
    let height = 1;
    let dpr = 1;
    let animationFrameId = 0;
    let lastTimestamp = performance.now();
    let destroyed = false;
    let reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let particles: Particle[] = [];

    const resizeCanvas = () => {
      if (destroyed) return;

      const bounds = host.getBoundingClientRect();
      width = Math.max(1, Math.floor(bounds.width));
      height = Math.max(1, Math.floor(bounds.height));
      dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);

      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      particles = rebuildParticles(width, height);
    };

    const draw = () => {
      context.clearRect(0, 0, width, height);
      for (const particle of particles) {
        context.beginPath();
        context.fillStyle =
          particle.layer === 'near'
            ? `rgba(255, 255, 255, ${particle.alpha})`
            : `rgba(214, 235, 255, ${particle.alpha})`;
        context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
        context.fill();
      }
    };

    const tick = (timestamp: number) => {
      if (destroyed) return;

      const dt = Math.min(MAX_DT, Math.max(0.001, (timestamp - lastTimestamp) / 1000));
      lastTimestamp = timestamp;

      if (!reducedMotion) {
        for (let i = 0; i < particles.length; i += 1) {
          const particle = particles[i];
          particle.x += particle.speed * dt;

          // Recycle particles once they leave the right side.
          if (particle.x - particle.radius > width) {
            particles[i] = spawnParticle(width, height, particle.layer, true);
          }
        }
      }

      draw();
      animationFrameId = window.requestAnimationFrame(tick);
    };

    const resizeObserver = new ResizeObserver(resizeCanvas);
    resizeObserver.observe(host);
    resizeCanvas();
    draw();
    animationFrameId = window.requestAnimationFrame(tick);

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onMotionChange = (event: MediaQueryListEvent) => {
      reducedMotion = event.matches;
      if (reducedMotion) {
        draw();
      }
    };
    motionQuery.addEventListener('change', onMotionChange);

    return () => {
      destroyed = true;
      resizeObserver.disconnect();
      motionQuery.removeEventListener('change', onMotionChange);
      window.cancelAnimationFrame(animationFrameId);
      context.clearRect(0, 0, width, height);
    };
  }, []);

  return (
    <div ref={hostRef} className="mk-menu-particle-canvas" aria-hidden>
      <canvas ref={canvasRef} />
    </div>
  );
}
