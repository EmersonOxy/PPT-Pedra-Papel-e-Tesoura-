export function createGameAnimations({ render }) {
  const $ = (id) => document.getElementById(id);
  const translate = (x, y) => `translate3d(${x}px, ${y}px, 0)`;

  function motion(id, name, points, duration, fill = 'none') {
    const animation = $(id).animate(points.map(([offset, x, y]) => ({ offset, transform: translate(x, y) })), { duration, easing: 'linear', fill });
    animation.id = name;
    return animation;
  }

  async function resolveMotion(turn) {
    if (turn.result === 'draw') {
      await Promise.all([
        motion('player', 'draw-player', [[0, 0, 0], [.5, 0, -6], [1, 0, 0]], 220).finished,
        motion('enemy', 'draw-enemy', [[0, 0, 0], [.5, 0, 4], [1, 0, 0]], 220).finished,
      ]);
      return;
    }
    const win = turn.result === 'win';
    const attacker = win ? 'player' : 'enemy';
    const defender = win ? 'enemy' : 'player';
    const x = win ? 18 : -10;
    const y = win ? -52 : 34;
    const advance = motion(attacker, 'advance', [[0, 0, 0], [.25, 0, win ? 5 : -3], [1, x, y]], 190, 'forwards');
    await advance.finished;
    render();
    const critical = turn.buffs[attacker] === 'critical';
    const defended = turn.buffs[defender] === 'defense';
    $('message').textContent = `${win ? 'Você acertou' : 'Você recebeu'} ${turn.damage} de dano${critical ? ' (CRÍTICO!)' : ''}${defended ? ' (DEFESA!)' : ''}.`;
    $('message').className = turn.result;
    const direction = win ? -1 : 1;
    const recoil = motion(defender, 'recoil', [[0, 0, 0], [.22, 0, 14 * direction], [.46, 5, 8 * direction], [.68, -3, 4 * direction], [.84, 1.5, direction], [1, 0, 0]], 260);
    const recovery = motion(attacker, 'recover', [[0, x, y], [.55, x * .35, y * .35], [1, 0, 0]], 260);
    advance.cancel();
    await Promise.all([recoil.finished, recovery.finished]);
  }

  return { resolveMotion };
}
