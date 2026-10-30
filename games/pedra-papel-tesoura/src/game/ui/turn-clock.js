export function createTurnClock({ getGame, getBusy, getHasStarted, onTimeout, turnSeconds }) {
  let turnInterval = null;
  let turnDeadline = 0;
  const $ = (id) => document.getElementById(id);

  function stopClock() {
    if (turnInterval !== null) clearInterval(turnInterval);
    turnInterval = null;
    turnDeadline = 0;
  }

  function clockUI(remaining, active) {
    const game = getGame();
    const seconds = Math.max(0, Math.min(turnSeconds, remaining));
    $('time-left').textContent = String(Math.ceil(seconds || 0));
    $('timer-dial').style.setProperty('--ratio', String(seconds / turnSeconds));
    $('timer-dial').setAttribute('aria-valuenow', seconds.toFixed(1));
    const wrapper = document.querySelector('.turn-timer');
    wrapper.classList.toggle('urgent', active && seconds <= 1);
    wrapper.classList.toggle('paused', !active);
    $('turn-status').textContent = game.phase === 'finished' ? 'Fim'
      : game.phase !== 'playing' ? 'Combate'
      : getBusy() ? 'Resolvendo'
      : active ? 'Sua vez' : 'Preparando';
  }

  function startClock() {
    stopClock();
    if (!getHasStarted() || getBusy() || getGame().phase !== 'playing') return;
    turnDeadline = performance.now() + turnSeconds * 1000;
    clockUI(turnSeconds, true);
    turnInterval = setInterval(() => {
      const remaining = (turnDeadline - performance.now()) / 1000;
      if (remaining <= 0) {
        onTimeout();
        return;
      }
      clockUI(remaining, true);
    }, 45);
  }

  function expiredNow() {
    if (turnDeadline > 0 && performance.now() >= turnDeadline) {
      onTimeout();
      return true;
    }
    return false;
  }

  return { stopClock, startClock, expiredNow, clockUI };
}
