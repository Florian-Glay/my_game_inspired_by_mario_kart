import { useEffect, useRef, useState } from 'react';
import { gameMode } from '../state/gamemode';
import { carPosition, carRotationY } from '../state/car';
import { commandInputActive } from '../state/commandInput';
import { MULTIPLAYER_HOST_COMMAND_GMP_ADVANCE_DELAY_MS } from '../../shared/multiplayerProtocol';
import { sendServerRaceHostCommand } from '../state/multiplayerClient';

type CommandBubbleProps = {
  isMultiplayerRace?: boolean;
  isOnlineRace?: boolean;
  isOnlineRaceHost?: boolean;
  onlineRaceId?: string | null;
  onInfoOverlayChange?: (enabled: boolean) => void;
};

export default function CommandBubble({
  isMultiplayerRace = false,
  isOnlineRace = false,
  isOnlineRaceHost = false,
  onlineRaceId = null,
  onInfoOverlayChange,
}: CommandBubbleProps) {
  const [input, setInput] = useState('');
  const [message, setMessage] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const pendingGmpRaceIdRef = useRef<string | null>(null);
  const pendingGmpTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (pendingGmpTimeoutRef.current !== null) {
        window.clearTimeout(pendingGmpTimeoutRef.current);
        pendingGmpTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const pendingRaceId = pendingGmpRaceIdRef.current;
    if (!pendingRaceId || !onlineRaceId) return;
    if (onlineRaceId === pendingRaceId) return;

    pendingGmpRaceIdRef.current = null;
    if (pendingGmpTimeoutRef.current !== null) {
      window.clearTimeout(pendingGmpTimeoutRef.current);
      pendingGmpTimeoutRef.current = null;
    }
    setMessage('Course suivante lancee');
  }, [onlineRaceId]);

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const cmd = input.trim().toLowerCase();
    if (cmd === 'gamemode free') {
      if (isMultiplayerRace) {
        setMessage('Mode free indisponible en multijoueur');
      } else {
        gameMode.current = 'free';
        setMessage('Mode: free');
      }
    } else if (cmd === 'gamemode run') {
      gameMode.current = 'run';
      setMessage('Mode: run');
    } else if (cmd === 'gamemode win' || cmd === 'gm_win') {
      gameMode.current = 'win';
      setMessage(cmd === 'gm_win' ? 'Cheat active: victoire instantanee' : 'Mode: win');
    } else if (cmd === 'gamemode coor') {
      const yawRad = carRotationY.current;
      console.log(`{ position: [${Number(carPosition.x.toFixed(3))}, ${Number(carPosition.y.toFixed(3))}, ${Number(carPosition.z.toFixed(3))}], rotation: [0, ${Number(yawRad.toFixed(3))}, 0] },`);
      setMessage('Coordonnees affichees en console');
    } else if (cmd === 'gmp') {
      if (!isOnlineRace) {
        setMessage('Commande gmp disponible uniquement en course online');
      } else if (!isOnlineRaceHost) {
        setMessage('Seul le host peut utiliser gmp');
      } else if (!onlineRaceId) {
        setMessage('Course reseau introuvable');
      } else {
        pendingGmpRaceIdRef.current = onlineRaceId;
        if (pendingGmpTimeoutRef.current !== null) {
          window.clearTimeout(pendingGmpTimeoutRef.current);
        }
        pendingGmpTimeoutRef.current = window.setTimeout(() => {
          if (!pendingGmpRaceIdRef.current) return;
          pendingGmpRaceIdRef.current = null;
          pendingGmpTimeoutRef.current = null;
          setMessage('Aucun changement detecte. Redemarre/deploie le serveur multiplayer avec le support gmp.');
        }, MULTIPLAYER_HOST_COMMAND_GMP_ADVANCE_DELAY_MS + 2500);

        sendServerRaceHostCommand(onlineRaceId, 'gmp');
        setMessage(`Commande gmp envoyee. Passage a la suivante dans ${Math.floor(MULTIPLAYER_HOST_COMMAND_GMP_ADVANCE_DELAY_MS / 1000)}s...`);
      }
    } else if (cmd === 'info on') {
      onInfoOverlayChange?.(true);
      setMessage('Overlay info active');
    } else if (cmd === 'info off') {
      onInfoOverlayChange?.(false);
      setMessage('Overlay info desactive');
    } else if (cmd.length > 0) {
      setMessage('Commande inconnue');
    }
    commandInputActive.current = false;
    inputRef.current?.blur();
    setInput('');
    setTimeout(() => setMessage(''), 2000);
  };

  return (
    <div className="absolute left-[clamp(0.5rem,1.6cqw,1rem)] top-[clamp(0.5rem,1.6cqh,1rem)] z-50">
      <form
        onSubmit={submit}
        className="flex items-center gap-[clamp(0.25rem,0.8cqw,0.5rem)]"
      >
        <input
          ref={inputRef}
          aria-label="command"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => {
            commandInputActive.current = true;
          }}
          onBlur={() => {
            commandInputActive.current = false;
          }}
          placeholder="Entrez commande..."
          className="w-[clamp(9rem,18cqw,16rem)] rounded bg-white/10 px-[clamp(0.55rem,1.1cqw,0.75rem)] py-[clamp(0.2rem,0.7cqh,0.35rem)] text-[clamp(0.7rem,1.2cqh,0.875rem)] text-white focus:outline-none"
        />
        <button
          type="submit"
          className="rounded bg-white/10 px-[clamp(0.55rem,1.1cqw,0.75rem)] py-[clamp(0.2rem,0.7cqh,0.35rem)] text-[clamp(0.7rem,1.2cqh,0.875rem)] text-white hover:bg-white/20"
        >
          OK
        </button>
        <div className="ml-[clamp(0.2rem,0.8cqw,0.5rem)] text-[clamp(0.7rem,1.2cqh,0.875rem)] text-white/80">
          {message}
        </div>
      </form>
    </div>
  );
}
