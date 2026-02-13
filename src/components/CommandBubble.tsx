import { useRef, useState } from 'react';
import { gameMode } from '../state/gamemode';
import { carPosition, carRotationY } from '../state/car';
import { commandInputActive } from '../state/commandInput';

type CommandBubbleProps = {
  isMultiplayerRace?: boolean;
};

export default function CommandBubble({ isMultiplayerRace = false }: CommandBubbleProps) {
  const [input, setInput] = useState('');
  const [message, setMessage] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

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
    } else if (cmd === 'gamemode coor') {
      const yawRad = carRotationY.current;
      const yawDeg = (yawRad * 180) / Math.PI;
      console.log('[car][coor]', {
        x: Number(carPosition.x.toFixed(3)),
        y: Number(carPosition.y.toFixed(3)),
        z: Number(carPosition.z.toFixed(3)),
        yawRad: Number(yawRad.toFixed(3)),
        yawDeg: Number(yawDeg.toFixed(1)),
      });
      setMessage('Coordonnees affichees en console');
    } else if (cmd.length > 0) {
      setMessage('Commande inconnue');
    }
    commandInputActive.current = false;
    inputRef.current?.blur();
    setInput('');
    setTimeout(() => setMessage(''), 2000);
  };

  return (
    <div className="absolute top-4 left-4 z-50">
      <form onSubmit={submit} className="flex items-center gap-2">
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
          className="px-3 py-1 rounded bg-white/10 text-white text-sm focus:outline-none"
        />
        <button
          type="submit"
          className="px-3 py-1 bg-white/10 text-white text-sm rounded hover:bg-white/20"
        >
          OK
        </button>
        <div className="ml-2 text-sm text-white/80">{message}</div>
      </form>
    </div>
  );
}
