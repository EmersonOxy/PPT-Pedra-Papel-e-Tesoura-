export function createGameView({ getGame, getBusy, getHasStarted, getImages, onReset, onStartNextBattle, clockUI, maxHp, maxMisses, pointsForPrize, pointsToWin, powers, powerNames, powerCount }) {
  const $ = (id) => document.getElementById(id);

  function powerProgress(side) {
    const game = getGame();
    const points = side === 'player' ? game.playerPoints : game.enemyPoints;
    const remaining = pointsForPrize - (points % pointsForPrize);
    const carried = game.inventory[side].length;
    return `${carried} efeito${carried === 1 ? '' : 's'} guardado${carried === 1 ? '' : 's'} · próximo bloco em ${remaining} vitória${remaining === 1 ? '' : 's'}`;
  }

  function controls() {
    const game = getGame();
    const busy = getBusy();
    const playable = getHasStarted() && game.phase === 'playing' && !busy;
    document.querySelectorAll('[data-sign]').forEach((button) => { button.disabled = !playable; });
    $('restart').disabled = busy;
    for (const kind of powers) {
      const button = $(`use-${kind}`);
      button.disabled = !playable || powerCount(game, 'player', kind) < 1 || (kind === 'heal' && game.hp >= maxHp) || (kind !== 'heal' && !!game.activeBuff.player);
    }
  }

  function render() {
    const game = getGame();
    $('player-points').textContent = game.playerPoints;
    $('enemy-points').textContent = game.enemyPoints;
    $('battle-number').textContent = game.battle;
    $('missed-count').textContent = `${game.misses} / ${maxMisses} faltas`;
    $('player-power-progress').textContent = powerProgress('player');
    $('enemy-power-progress').textContent = powerProgress('enemy');
    for (const kind of powers) {
      const count = powerCount(game, 'player', kind);
      const button = $(`use-${kind}`);
      button.innerHTML = `<span class="orb-name">${powerNames[kind]}</span><strong>${count}</strong><em>${{ heal: 'H', defense: 'D', critical: 'C' }[kind]}</em>`;
      button.classList.toggle('ready', count > 0);
      const enemyCount = powerCount(game, 'enemy', kind);
      $(`enemy-${kind}`).innerHTML = `<span class="orb-name">${powerNames[kind]}</span><strong>${enemyCount}</strong>`;
    }
    const playerBuff = game.activeBuff.player;
    $('active-buff').textContent = playerBuff ? `${powerNames[playerBuff]} ativad${playerBuff === 'defense' ? 'a' : 'o'} para esta jogada` : 'Efeitos não usados passam ao vencedor do combate.';
    for (const [prefix, hp] of [['player', game.hp], ['enemy', game.enemyHp]]) {
      $(`${prefix}-hp`).textContent = `${hp} / ${maxHp}`;
      $(`${prefix}-fill`).style.width = `${hp}%`;
      $(`${prefix}-health`).setAttribute('aria-valuenow', hp);
    }
    controls();
  }

  function prizeToast(kind, owner) {
    // Prêmio continua funcionando, mas sem barra fixa na interface.
    const item = owner === 'player' ? $(`use-${kind}`) : $(`enemy-${kind}`);
    item.classList.remove('prize-received');
    void item.offsetWidth;
    item.classList.add('prize-received');
  }

  function resetHands() {
    const images = getImages();
    $('player-hand').src = $('enemy-hand').src = images.rock;
    $('player-hand').alt = 'Sua mão: pedra';
    $('enemy-hand').alt = 'Mão do inimigo';
    document.querySelectorAll('[data-sign]').forEach((button) => button.classList.remove('selected'));
    $('message').className = '';
  }

  function showEnding(result) {
    const game = getGame();
    const finished = game.phase === 'finished';
    const playerWon = finished ? game.matchWinner === 'player' : game.phase === 'won';
    if (finished) {
      $('end-title').textContent = playerWon ? 'Você venceu a partida!' : 'O inimigo venceu a partida!';
      $('end-summary').textContent = game.finishReason === 'timeout'
        ? `Você deixou o tempo acabar 3 vezes e perdeu por inatividade. Placar final: ${game.playerPoints} × ${game.enemyPoints}.`
        : `${playerWon ? 'Você' : 'O inimigo'} chegou a ${pointsToWin} pontos! Placar final: ${game.playerPoints} × ${game.enemyPoints}.`;
      $('again').textContent = 'Jogar novamente';
      $('again').onclick = onReset;
    } else {
      $('end-title').textContent = playerWon ? 'Você venceu o combate!' : 'O inimigo venceu o combate!';
      const notices = [];
      if (result && result.transferred.length) notices.push(`${result.transferred.length} efeito(s) transferido(s) para o vencedor.`);
      if (result && result.unlocked) notices.push(`Luck Block: ${powerNames[result.unlocked]}!`);
      $('end-summary').textContent = `${playerWon ? 'Você' : 'O inimigo'} ganhou 1 ponto. Placar: ${game.playerPoints} × ${game.enemyPoints}. ${notices.join(' ')}`;
      $('again').textContent = 'Próximo combate';
      $('again').onclick = onStartNextBattle;
    }
    $('end-screen').hidden = false;
    $('again').focus();
    clockUI(0, false);
  }

  return { controls, render, prizeToast, resetHands, showEnding };
}
