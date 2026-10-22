import { cardDefinitions, getCardDefinition } from '../game/cards.ts';
import { beginPreparation, castSpell, drawCard, moveTroop, placeCard, placeSigil, returnTroop, revealSigil } from '../game/engine.ts';
import { advanceTime } from '../game/simulation.ts';
import { frontRow } from '../game/targeting.ts';
import { balance, boardSlotCount, topology } from '../game/config.ts';
import type { CardInstance, GameEvent, GameState, Side, SpellTarget, Transition } from '../game/types.ts';
import { advanceMatchFlow, beginDemoMatchSearch, cancelDemoMatchSearch, createMatchFlow, isPreparationActionAllowed, sessionConfig, setMatchFlowPhase } from '../game/session-flow.ts';
import type { MatchFlowState } from '../game/session-flow.ts';
import { renderCardBack, renderCardFace, renderDeckCardBack } from './card-presentation.ts';

type ActiveDrag = {
  id: string;
  side: Side;
  origin: HTMLElement;
  parent: Node;
  nextSibling: Node | null;
  originalStyle: string | null;
  originalClassName: string;
  pointerId: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  started: boolean;
  previewOpened: boolean;
};

const sigil = '<svg viewBox="0 0 60 60" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path d="M30 4L53 45H7L30 4Z" stroke="#ddc58e" stroke-width="2"/><circle cx="30" cy="32" r="15" stroke="#78c9bc" stroke-width="2"/><path d="M30 16V47M15 32H45" stroke="#dbc58d" stroke-width="1.7"/><circle cx="30" cy="32" r="4" fill="#edcf92"/></svg>';

export class GameApp {
  private root: HTMLElement;
  private state: GameState;
  private selectedId: string | null = null;
  private theme = 'mineral';
  private drag: ActiveDrag | null = null;
  private pressTimer: number | undefined;
  private toastTimer: number | undefined;
  private lastFrame = 0;
  private suppressClickUntil = 0;
  private matchFlow: MatchFlowState = createMatchFlow();
  private activeHomeTab: 'home' | 'deck' | 'missions' = 'home';
  private matchHasStarted = false;
  private matchResultRecorded = false;
  private matchesCompleted = 0;
  private playerWins = 0;
  private cardsPlaced = 0;
  private deckPreviewCards: CardInstance[] = [];

  constructor(root: HTMLElement) {
    this.root = root;
    const seed = new Uint32Array(1);
    crypto.getRandomValues(seed);
    this.state = createGameImported(seed[0]);
    this.deckPreviewCards = cardDefinitions.flatMap((definition) => Array.from({ length: balance.copiesPerDefinition }, (_, index) => ({
      instanceId: `catalog-${definition.id}-${index + 1}`,
      definitionId: definition.id,
      owner: 'player' as const,
      health: definition.maxHealth,
      nextAttackAtMs: 0,
      revealed: false,
    })));
    this.mount();
    this.render();
    this.bindEvents();
    requestAnimationFrame(this.tick);
  }

  private mount(): void {
    this.root.innerHTML = `
      <div class="app-frame">
      <main class="home-shell" id="home" aria-label="Menu principal do Trindade">
        <header class="home-header"><div class="home-brand"><span class="home-brand-mark" aria-hidden="true">${sigil}</span><span><strong>TRINDADE</strong><small>CARD BATTLES · EXPERIMENTO</small></span></div><div class="home-profile"><span class="home-avatar" aria-hidden="true">T</span><span><strong>JOGADOR</strong><small>LOCAL</small></span></div></header>
        <div class="home-scroll" id="home-scroll">
          <section class="home-page home-page--start" data-home-page="home">
            <div class="home-hero"><div class="hero-kicker"><i></i> ARENA EXPERIMENTAL · IA LOCAL</div><div class="hero-emblem" aria-hidden="true">${sigil}</div><h1>As três forças<br>se encontram.</h1><p>Monte sua formação e enfrente a Casa Carmesim em uma partida local de demonstração.</p><div class="hero-facts"><span><b>3 × 2</b> arena</span><span><b>24</b> cartas</span><span><b>IA</b> local</span></div><button class="battle-cta" id="start-battle" type="button"><span class="battle-cta-icon" aria-hidden="true">⚔</span><span><strong>BATALHA</strong><small>Encontrar adversário</small></span><span class="battle-cta-arrow" aria-hidden="true">→</span></button>
              <div class="match-panel" id="match-panel" hidden aria-live="polite"><div class="match-orbit" aria-hidden="true"><span>${sigil}</span></div><div class="match-copy"><strong id="match-title">Buscando adversário</strong><small id="match-detail">Partida experimental contra IA local</small></div><strong class="match-countdown" id="match-countdown" hidden></strong><button class="cancel-search" id="cancel-search" type="button">Cancelar busca</button></div>
              <div class="hero-disclaimer">Esta versão usa IA local. Ainda não existe PvP online.</div>
            </div>
            <div class="home-section-heading"><span>CAMINHO DE TREINO</span><span>SESSÃO LOCAL</span></div>
            <button class="home-shortcut" data-home-tab="missions" type="button"><span class="shortcut-glyph">✧</span><span><strong>Missões demonstrativas</strong><small>Acompanhe seu progresso nesta sessão</small></span><span class="shortcut-arrow">→</span></button>
          </section>
          <section class="home-page" data-home-page="deck" hidden>
            <div class="page-heading"><span class="page-overline">PREPARAÇÃO</span><h1>Seu deck</h1><p>Catálogo atual conectado ao jogo.</p></div>
            <div class="deck-summary"><div><strong>${balance.deckSize}</strong><span>cartas no deck experimental</span></div><div><strong>${cardDefinitions.length}</strong><span>modelos disponíveis</span></div></div>
            <div class="experimental-note"><b>Deck experimental</b><span>Visualização e inspeção disponíveis. Edição e salvamento do deck ainda não estão implementados.</span></div>
            <div class="deck-grid" id="deck-grid" aria-label="As ${balance.deckSize} cartas do deck"></div>
          </section>
          <section class="home-page" data-home-page="missions" hidden>
            <div class="page-heading"><span class="page-overline">OBJETIVOS DE TREINO</span><h1>Missões</h1><p>Progresso demonstrativo desta sessão local.</p></div>
            <div class="mission-list" id="mission-list"></div>
            <p class="mission-footnote">Sem moedas ou recompensas econômicas. O progresso não é salvo entre sessões.</p>
          </section>
        </div>
        <nav class="home-nav" aria-label="Navegação principal">
          <button class="home-nav-item" data-home-tab="deck" type="button"><span aria-hidden="true">▤</span><small>Deck</small></button>
          <button class="home-nav-item active" data-home-tab="home" type="button" aria-current="page"><span aria-hidden="true">⌂</span><small>Início</small></button>
          <button class="home-nav-item" data-home-tab="missions" type="button"><span aria-hidden="true">✧</span><small>Missões</small></button>
        </nav>
      </main>
      <main class="game-shell" id="game" data-theme="${this.theme}" aria-label="Arena tática Trindade" hidden>
        <section class="top-zone" aria-label="Informações do adversário">
          <div class="top-status">
            <div class="logo-mark" aria-hidden="true">${sigil}</div>
            <div class="status-stack"><div class="status-title">Casa Carmesim</div><div class="status-sub">Adversário experimental</div></div>
            <div class="enemy-cycle" role="status" aria-label="Ciclo do deck adversário"><span class="enemy-cycle-icon" id="enemy-cycle">1</span><span class="enemy-cycle-label">CICLO</span></div>
            <div class="top-actions"><button class="top-btn" id="themes" type="button" aria-label="Escolher tema">◒</button><button class="top-btn" id="help" type="button" aria-label="Como jogar">?</button><button class="top-btn" id="restart" type="button" aria-label="Voltar ao menu" title="Voltar ao menu">⌂</button></div>
          </div>
        </section>
        <section class="field-band enemy" data-zone="enemy-field" aria-label="Campo adversário">
            <div class="battle-grid enemy-grid" id="enemy-grid" aria-label="${boardSlotCount} espaços do adversário"></div>
          <aside class="sigil-side enemy"><span class="sigil-label">SIGILOS</span><div class="secret-slots" id="enemy-secrets" aria-label="${balance.fieldTopology.specialSpaces[0]?.count ?? 0} sigilos adversários"></div></aside>
          <button class="side-life enemy-life is-targetable" id="enemy-life-target" type="button" aria-label="Vida adversária, alvo direto">
            <span class="life-label">VIDA</span><span class="life-value" id="enemy-life-value">${balance.startingLife}</span><span class="life-track"><i id="enemy-life-fill"></i></span>
          </button>
        </section>
        <div class="field-divider" data-zone="arena" aria-hidden="true"><div class="midline-symbol" id="mid-symbol">${sigil}</div></div>
        <section class="field-band player" data-zone="player-field" aria-label="Seu campo">
          <aside class="sigil-side player"><span class="sigil-label">SIGILOS</span><div class="secret-slots" id="player-secrets" aria-label="${balance.fieldTopology.specialSpaces[0]?.count ?? 0} sigilos do jogador"></div></aside>
          <div class="battle-grid player-grid" id="player-grid" aria-label="${boardSlotCount} espaços do jogador"></div>
          <button class="side-life player-life is-targetable" id="player-life-target" type="button" aria-label="Sua vida, alvo de cura">
            <span class="life-label">VIDA</span><span class="life-value" id="player-life-value">${balance.startingLife}</span><span class="life-track"><i id="player-life-fill"></i></span>
          </button>
        </section>
        <section class="bottom-zone" aria-label="Sua mão e deck">
          <div class="my-status"><div class="status-stack"><div class="status-title">TRINDADE</div><div class="status-sub" id="player-status">Regras experimentais · partida local</div></div><div class="metrics"><strong id="deck-count">18</strong><small>no deck</small></div></div>
          <div class="hand-dock">
            <div class="dock-header"><strong>SUA MÃO <span id="hand-count">${balance.handLimit}/${balance.handLimit}</span></strong><span class="selection-hint" id="action-hint">Toque ou arraste as cartas</span></div>
            <div class="dock-main">
              <div class="deck-column"><div class="player-cycle" role="status" aria-label="Ciclo do seu deck"><span class="enemy-cycle-icon" id="player-cycle">1</span></div>
                <button class="deck-button" type="button" id="draw-deck" title="Comprar uma carta" aria-label="Comprar carta">${renderDeckCardBack()}<span class="deck-progress" id="deck-badge" role="progressbar" aria-label="Progresso do deck" aria-valuemin="0" aria-valuemax="${balance.deckSize}" aria-valuenow="${balance.handLimit}"></span></button>
              </div>
              <div class="hand-area" id="hand-area" data-zone="hand" aria-label="Sua mão: arraste uma tropa para cá para recolhê-la"></div>
            </div>
          </div>
        </section>
        <div class="phase-banner" id="phase-banner" hidden role="status" aria-live="polite"><span class="phase-banner-label" id="phase-banner-label">PREPARAÇÃO</span><strong id="phase-countdown">15</strong><small id="phase-banner-copy">A arena será liberada em instantes</small></div>
        <div id="toast" class="toast" role="status" aria-live="polite"></div>
        <div class="overlay" id="help-overlay" aria-hidden="true"><div class="help-panel"><div class="help-tag">Experimento separado · versão jogável inicial</div><h2>Como experimentar</h2><p><b>Comprar:</b> toque no deck enquanto houver espaço na mão (máximo de ${balance.handLimit} cartas).</p><p><b>Posicionar:</b> arraste uma tropa a um espaço vazio. A linha próxima do centro protege a linha posterior na mesma coluna.</p><p><b>Mover ou recolher:</b> arraste uma tropa sua para um espaço vazio ou para a mão.</p><p><b>Feitiços:</b> Chama Errante causa ${balance.spellDamage} de dano; Pulso Rúnico restaura ${balance.spellHealing} de vida. Selecione um feitiço e toque no alvo compatível.</p><p><b>Sigilos:</b> coloque um sigilo em um dos ${balance.fieldTopology.specialSpaces[0]?.count ?? 0} espaços e toque nele para revelar sua carta. Eles são visuais nesta versão e ainda não têm gatilhos.</p><p><b>Combate:</b> tropas atacam automaticamente a cada ${balance.attackIntervalMs / 1000} segundos. Os custos são somente demonstrativos; não há mana.</p><p><b>Limite experimental:</b> ${balance.startingLife} de vida, ${balance.deckSize} cartas por deck e IA básica. Os valores não são regras finais.</p><button class="close-help" id="close-help" type="button">Entendi</button></div></div>
        <div class="overlay" id="palette-overlay" aria-hidden="true"><div class="help-panel"><div class="help-tag">Identidade visual V3</div><h2>Atmosfera da arena</h2><div class="theme-option-grid"><button type="button" class="theme-btn active" data-theme-set="mineral">Verde mineral</button><button type="button" class="theme-btn" data-theme-set="abissal">Azul abissal</button><button type="button" class="theme-btn" data-theme-set="rubro">Rubro arcano</button></div><button class="close-help" id="close-palette" type="button">Voltar à arena</button></div></div>
        <div class="overlay" id="result-overlay" aria-hidden="true"><div class="help-panel"><div class="help-tag">Fim da partida</div><h2 id="result-title">Vitória</h2><p id="result-copy"></p><button class="close-help" id="play-again" type="button">Voltar ao início</button></div></div>
      </main><div class="overlay card-preview-overlay" id="card-preview-overlay" aria-hidden="true"><div class="card-preview-wrap" id="card-preview-wrap"></div></div><div class="transition-curtain" id="transition-curtain" aria-hidden="true"></div></div>`;
    this.renderDeckLibrary();
    this.renderHome();
  }

  private bindEvents(): void {
    this.root.addEventListener('click', this.onClick);
    this.root.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerCancel);
    this.root.querySelectorAll('.overlay').forEach((overlay) => overlay.addEventListener('click', (event) => {
      if (event.target === overlay && overlay.id !== 'result-overlay') this.closeOverlay(overlay.id);
    }));
  }

  private setHomeTab(tab: 'home' | 'deck' | 'missions'): void {
    if (this.matchHasStarted) return;
    this.activeHomeTab = tab;
    this.renderHome();
    this.root.querySelector<HTMLElement>('#home-scroll')?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  private startDemoSearch(): void {
    if (this.matchHasStarted || this.matchFlow.phase !== 'idle') return;
    this.matchFlow = beginDemoMatchSearch(this.matchFlow);
    this.renderHome();
  }

  private cancelDemoSearch(): void {
    const next = cancelDemoMatchSearch(this.matchFlow);
    if (next === this.matchFlow) return;
    this.matchFlow = next;
    this.renderHome();
  }

  private mountArenaForPreparation(): void {
    if (this.matchHasStarted) return;
    const seed = new Uint32Array(1);
    crypto.getRandomValues(seed);
    this.state = beginPreparation(createGameImported(seed[0])).state;
    this.matchHasStarted = true;
    this.matchResultRecorded = false;
    this.selectedId = null;
    const home = this.root.querySelector<HTMLElement>('#home');
    const game = this.root.querySelector<HTMLElement>('#game');
    if (home) home.hidden = true;
    if (game) game.hidden = false;
    this.render();
  }

  private returnToHome(): void {
    if (this.drag?.started) this.restoreDraggedCard(this.drag, true);
    this.drag = null;
    window.clearTimeout(this.pressTimer);
    window.clearTimeout(this.toastTimer);
    const toast = this.root.querySelector<HTMLElement>('#toast');
    if (toast) { toast.textContent = ''; toast.classList.remove('visible'); }
    this.matchFlow = createMatchFlow();
    this.matchHasStarted = false;
    this.matchResultRecorded = false;
    this.selectedId = null;
    const seed = new Uint32Array(1);
    crypto.getRandomValues(seed);
    this.state = createGameImported(seed[0]);
    this.root.querySelector<HTMLElement>('#transition-curtain')?.classList.remove('active');
    this.root.querySelector<HTMLElement>('#home')?.removeAttribute('hidden');
    const game = this.root.querySelector<HTMLElement>('#game');
    if (game) { game.hidden = true; game.classList.remove('is-preparing'); }
    ['result-overlay', 'help-overlay', 'palette-overlay', 'card-preview-overlay'].forEach((id) => this.closeOverlay(id));
    this.render();
  }

  private renderHome(): void {
    this.root.querySelectorAll<HTMLElement>('[data-home-page]').forEach((page) => {
      const active = page.dataset.homePage === this.activeHomeTab;
      page.hidden = !active;
      page.setAttribute('aria-hidden', String(!active));
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-home-tab]').forEach((button) => {
      const active = button.dataset.homeTab === this.activeHomeTab;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });
    this.renderMatchStatus();
    this.renderMissions();
  }

  private renderMatchStatus(): void {
    const panel = this.root.querySelector<HTMLElement>('#match-panel');
    const start = this.root.querySelector<HTMLButtonElement>('#start-battle');
    const cancel = this.root.querySelector<HTMLButtonElement>('#cancel-search');
    const title = this.root.querySelector<HTMLElement>('#match-title');
    const detail = this.root.querySelector<HTMLElement>('#match-detail');
    const countdown = this.root.querySelector<HTMLElement>('#match-countdown');
    const active = ['searching', 'found', 'countdown', 'transition'].includes(this.matchFlow.phase);
    if (panel) panel.hidden = !active;
    if (start) { start.hidden = this.matchFlow.phase !== 'idle'; start.disabled = this.matchFlow.phase !== 'idle'; }
    if (cancel) cancel.hidden = this.matchFlow.phase !== 'searching';
    if (title) title.textContent = this.matchFlow.phase === 'searching' ? 'Buscando adversário'
      : this.matchFlow.phase === 'found' ? 'Adversário encontrado'
        : this.matchFlow.phase === 'countdown' ? 'A partida começa em'
          : this.matchFlow.phase === 'transition' ? 'Abrindo a arena' : '';
    if (detail) detail.textContent = this.matchFlow.phase === 'searching' ? 'Procurando uma partida experimental local.'
      : this.matchFlow.phase === 'found' ? 'Casa Carmesim · adversário controlado por IA local.'
        : this.matchFlow.phase === 'countdown' ? 'Partida experimental contra IA local.'
          : this.matchFlow.phase === 'transition' ? 'A IA local está preparando o campo.' : '';
    const showCountdown = this.matchFlow.phase === 'countdown';
    if (countdown) {
      countdown.hidden = !showCountdown;
      countdown.textContent = String(Math.max(1, Math.ceil((sessionConfig.preMatchCountdownMs - this.matchFlow.elapsedMs) / 1000)));
    }
  }

  private renderDeckLibrary(): void {
    const grid = this.root.querySelector<HTMLElement>('#deck-grid');
    if (!grid) return;
    grid.innerHTML = this.deckPreviewCards.map((card, index) => {
      const definition = getCardDefinition(card.definitionId);
      return `<button class="deck-card-tile" type="button" data-card-inspect="${this.escapeAttribute(card.instanceId)}" aria-label="Inspecionar ${this.escapeAttribute(definition.name)}, cópia ${index % balance.copiesPerDefinition + 1}">${renderCardFace(definition, card, 'player', 'preview')}<span class="deck-card-number">${String(index + 1).padStart(2, '0')}</span></button>`;
    }).join('');
  }

  private renderMissions(): void {
    const list = this.root.querySelector<HTMLElement>('#mission-list');
    if (!list) return;
    const missions = [
      { title: 'Primeiro encontro', objective: 'Conclua uma partida experimental.', progress: Math.min(this.matchesCompleted, 1), goal: 1, reward: 'Registro de partida · demonstrativo' },
      { title: 'Vitória da Trindade', objective: 'Vença a IA local uma vez.', progress: Math.min(this.playerWins, 1), goal: 1, reward: 'Insígnia de treino · demonstrativa' },
      { title: 'Formação inicial', objective: 'Coloque três cartas na arena.', progress: Math.min(this.cardsPlaced, 3), goal: 3, reward: 'Registro de formação · demonstrativo' },
    ];
    list.innerHTML = missions.map((mission, index) => {
      const complete = mission.progress >= mission.goal;
      return `<article class="mission-card${complete ? ' is-complete' : ''}"><span class="mission-index">0${index + 1}</span><div class="mission-content"><div class="mission-status">${complete ? 'CONCLUÍDA' : 'EM ANDAMENTO'}</div><h2>${mission.title}</h2><p>${mission.objective}</p><div class="mission-progress"><span style="width:${Math.min(100, mission.progress / mission.goal * 100)}%"></span></div><small>${mission.progress}/${mission.goal} · ${mission.reward}</small></div><span class="mission-check" aria-hidden="true">${complete ? '✓' : '◇'}</span></article>`;
    }).join('');
  }

  private renderPhaseBanner(): void {
    const banner = this.root.querySelector<HTMLElement>('#phase-banner');
    if (!banner) return;
    const inPrep = this.matchHasStarted && (this.state.phase === 'preparation' || this.state.phase === 'starting');
    banner.hidden = !inPrep;
    if (!inPrep) return;
    const isStarting = this.state.phase === 'starting';
    const remaining = isStarting
      ? Math.max(0, (this.state.startAnnouncementEndsAtMs ?? this.state.clockMs) - this.state.clockMs)
      : Math.max(0, (this.state.preparationEndsAtMs ?? this.state.clockMs) - this.state.clockMs);
    this.setText('#phase-banner-label', isStarting ? 'O COMBATE COMEÇA' : 'PREPARAÇÃO');
    this.setText('#phase-countdown', String(Math.ceil(remaining / 1000)));
    this.setText('#phase-banner-copy', isStarting ? 'As tropas entram em ação agora' : 'Forme sua estratégia antes do combate');
  }

  private syncMatchFlowWithEngine(): void {
    if (!this.matchHasStarted) return;
    const phase = this.state.phase === 'preparation' ? 'preparation'
      : this.state.phase === 'starting' ? 'starting'
        : this.state.phase === 'finished' ? 'finished' : 'battle';
    if (this.matchFlow.phase === phase || this.matchFlow.phase === 'transition' && phase === 'preparation') return;
    this.matchFlow = setMatchFlowPhase(this.matchFlow, phase);
  }

  private onClick = (event: MouseEvent): void => {
    if (event.detail > 0 && performance.now() < this.suppressClickUntil) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLElement>('button');
    if (!button) return;
    const homeTab = button.dataset.homeTab as 'home' | 'deck' | 'missions' | undefined;
    if (homeTab) { this.setHomeTab(homeTab); return; }
    if (button.id === 'start-battle') { this.startDemoSearch(); return; }
    if (button.id === 'cancel-search') { this.cancelDemoSearch(); return; }
    if (button.id === 'restart' || button.id === 'play-again') { this.returnToHome(); return; }
    const inspectId = button.dataset.cardInspect;
    if (inspectId) { this.showPreview(inspectId, 'player'); return; }
    if (button.id === 'draw-deck') { this.transition(drawCard(this.state, 'player'), 'Não há espaço na mão ou o deck acabou.'); return; }
    if (button.id === 'help') { this.openOverlay('help-overlay'); return; }
    if (button.id === 'close-help') { this.closeOverlay('help-overlay'); return; }
    if (button.id === 'themes') { this.openOverlay('palette-overlay'); return; }
    if (button.id === 'close-palette') { this.closeOverlay('palette-overlay'); return; }
    if (button.id === 'enemy-life-target') { this.tryTargetLife('enemy'); return; }
    if (button.id === 'player-life-target') { this.tryTargetLife('player'); return; }
    const theme = button.dataset.themeSet;
    if (theme) { this.theme = theme; this.root.querySelector('#game')?.setAttribute('data-theme', theme); this.root.querySelectorAll('[data-theme-set]').forEach((item) => item.classList.toggle('active', item === button)); this.closeOverlay('palette-overlay'); return; }
    const cardId = button.dataset.cardId;
    const cardSide = button.dataset.side as Side | undefined;
    if (cardId && cardSide === 'player') { this.selectCard(cardId); return; }
    const slotSide = button.dataset.slotSide as Side | undefined;
    const slot = Number(button.dataset.slot);
    if (slotSide && Number.isInteger(slot)) {
      if (button.dataset.slotKind === 'sigil') { this.activateSigil(slotSide, slot); return; }
      this.activateSlot(slotSide, slot); return;
    }
  };

  private selectCard(instanceId: string): void {
    if (this.state.phase === 'starting' || this.state.phase === 'finished') return;
    const card = this.state.players.player.hand.find((item) => item.instanceId === instanceId);
    if (!card) return;
    const definition = getCardDefinition(card.definitionId);
    if (this.state.phase === 'preparation' && !(['place', 'move', 'return', 'cast', 'reveal'] as const).some((action) => isPreparationActionAllowed(card.definitionId, action))) {
      this.toast('Esta carta não tem ações permitidas durante a preparação.');
      return;
    }
    this.selectedId = this.selectedId === instanceId ? null : instanceId;
    this.syncSelection();
    if (definition.kind === 'spell') this.toast(definition.effect === 'damage' ? 'Toque em uma tropa inimiga ou na vida adversária.' : 'Toque em uma tropa aliada ferida ou na sua vida.');
    else if (definition.kind === 'hidden') this.toast('Escolha um espaço de sigilo vazio.');
  }

  private activateSlot(side: Side, slot: number): void {
    if (this.state.phase !== 'playing' && this.state.phase !== 'preparation') return;
    if (side === 'enemy') {
      if (this.selectedId && this.isSelectedSpell('damage')) this.tryCast({ kind: 'unit', side, slot });
      return;
    }
    const selected = this.selectedId ? this.state.players.player.hand.find((card) => card.instanceId === this.selectedId) : undefined;
    if (selected) {
      const kind = getCardDefinition(selected.definitionId).kind;
      if (kind === 'spell') { if (this.isSelectedSpell('heal')) this.tryCast({ kind: 'unit', side, slot }); return; }
      if (kind === 'hidden') return;
      this.transition(placeCard(this.state, 'player', selected.instanceId, slot), 'Escolha um espaço vazio.');
      return;
    }
    const selectedBoardSlot = this.selectedId ? this.findPlayerBoardSlot(this.selectedId) : -1;
    if (selectedBoardSlot >= 0 && !this.state.players.player.slots[slot]) {
      this.transition(moveTroop(this.state, 'player', selectedBoardSlot, slot), 'O destino precisa estar vazio.');
      return;
    }
    const fieldCard = this.state.players.player.slots[slot];
    if (fieldCard && this.selectedId === fieldCard.instanceId) { this.selectedId = null; this.syncSelection(); return; }
    if (fieldCard) {
      const selectedBoard = this.selectedId ? this.findPlayerBoardSlot(this.selectedId) : -1;
      if (selectedBoard >= 0) { this.transition(moveTroop(this.state, 'player', selectedBoard, slot), 'O destino precisa estar vazio.'); return; }
      if (!this.selectedId) { this.selectedId = fieldCard.instanceId; this.syncSelection(); return; }
    }
    if (fieldCard && this.isSelectedSpell('heal')) this.tryCast({ kind: 'unit', side: 'player', slot });
  }

  private activateSigil(side: Side, slot: number): void {
    if (side === 'player') {
      const selected = this.selectedId ? this.state.players.player.hand.find((card) => card.instanceId === this.selectedId) : undefined;
      if (selected && getCardDefinition(selected.definitionId).kind === 'hidden') {
        this.transition(placeSigil(this.state, 'player', selected.instanceId, slot), 'Esse espaço de sigilo já está ocupado.');
        return;
      }
      this.transition(revealSigil(this.state, 'player', slot), this.state.phase === 'preparation' ? 'Sigilos não podem ser revelados durante a preparação.' : undefined);
    } else this.transition(revealSigil(this.state, 'enemy', slot), this.state.phase === 'preparation' ? 'Sigilos não podem ser revelados durante a preparação.' : undefined);
  }

  private findPlayerBoardSlot(instanceId: string): number {
    return this.state.players.player.slots.findIndex((card) => card?.instanceId === instanceId);
  }

  private isSelectedSpell(effect: 'damage' | 'heal'): boolean {
    if (!this.selectedId) return false;
    const card = this.state.players.player.hand.find((item) => item.instanceId === this.selectedId);
    return card ? getCardDefinition(card.definitionId).effect === effect : false;
  }

  private tryCast(target: SpellTarget): void {
    if (!this.selectedId) return;
    if (this.state.phase === 'preparation') { this.toast('Feitiços ficam inativos até o início do combate.'); return; }
    const result = castSpell(this.state, 'player', this.selectedId, target);
    if (result.events.length === 0) { this.toast('Este alvo não pode receber esse feitiço.'); return; }
    this.selectedId = null;
    this.transition(result);
  }

  private tryTargetLife(side: Side): void {
    if (!this.selectedId) return;
    const spell = this.state.players.player.hand.find((card) => card.instanceId === this.selectedId);
    if (!spell || getCardDefinition(spell.definitionId).kind !== 'spell') return;
    this.tryCast({ kind: 'life', side });
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    if (!this.matchHasStarted || this.state.phase === 'starting' || this.state.phase === 'finished') return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const directCard = target.closest<HTMLElement>('.hand-card[data-card-id], .battle-card[data-card-id]');
    const playerSlot = target.closest<HTMLElement>('.slot[data-slot-side="player"]');
    const cardEl = directCard ?? playerSlot?.querySelector<HTMLElement>('.battle-card[data-card-id]') ?? null;
    if (!cardEl) return;
    const id = cardEl.dataset.cardId;
    const side = (cardEl.dataset.side ?? 'player') as Side;
    if (!id) return;
    if (this.state.phase === 'preparation' && side === 'enemy') return;
    const rect = cardEl.getBoundingClientRect();
    this.drag = {
      id, side, origin: cardEl, parent: cardEl.parentNode!, nextSibling: cardEl.nextSibling,
      originalStyle: cardEl.getAttribute('style'), originalClassName: cardEl.className,
      pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      startX: event.clientX, startY: event.clientY,
      offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top,
      started: false, previewOpened: false,
    };
    this.pressTimer = window.setTimeout(() => {
      if (!this.drag || this.drag.pointerId !== event.pointerId || this.drag.started) return;
      this.drag.previewOpened = true;
      this.showPreview(id, side);
    }, 450);
  };

  private onPointerMove = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.x = event.clientX; drag.y = event.clientY;
    const distance = Math.hypot(drag.x - drag.startX, drag.y - drag.startY);
    if (distance > 8) {
      window.clearTimeout(this.pressTimer);
      if (drag.side !== 'player') return;
      if (!drag.started) {
        drag.started = true;
        drag.origin.classList.add('is-physical-dragging');
        drag.origin.style.position = 'fixed';
        drag.origin.style.left = `${drag.x - drag.offsetX}px`;
        drag.origin.style.top = `${drag.y - drag.offsetY}px`;
        drag.origin.style.width = `${drag.origin.getBoundingClientRect().width}px`;
        drag.origin.style.height = `${drag.origin.getBoundingClientRect().height}px`;
        drag.origin.style.maxHeight = 'none';
        drag.origin.style.margin = '0';
        drag.origin.style.transform = 'none';
        drag.origin.style.transition = 'none';
        drag.origin.style.zIndex = '250';
        drag.origin.style.pointerEvents = 'none';
        drag.origin.style.opacity = '1';
        document.body.appendChild(drag.origin);
      }
      drag.origin.style.left = `${drag.x - drag.offsetX}px`;
      drag.origin.style.top = `${drag.y - drag.offsetY}px`;
    }
  };

  private onPointerUp = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    window.clearTimeout(this.pressTimer);
    if (drag.started) {
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-slot-side], #hand-area, #enemy-life-target, #player-life-target') ?? null;
      const before = this.state;
      this.suppressClickUntil = performance.now() + 100;
      this.restoreDraggedCard(drag, false);
      this.drag = null;
      this.completePlayerDrop(drag.id, target);
      if (this.state === before) {
        this.restoreDraggedCard(drag, true);
        this.render();
      }
    } else {
      if (drag.previewOpened) this.suppressClickUntil = performance.now() + 100;
      this.drag = null;
    }
  };

  private completePlayerDrop(instanceId: string, target: HTMLElement | null): void {
    const handCard = this.state.players.player.hand.find((card) => card.instanceId === instanceId);
    if (handCard) {
      if (!target) return;
      if (target.dataset.slotSide === 'player') {
        const kind = getCardDefinition(handCard.definitionId).kind;
        if (kind === 'troop') this.transition(placeCard(this.state, 'player', instanceId, Number(target.dataset.slot)));
        else if (kind === 'hidden' && target.dataset.slotKind === 'sigil') this.transition(placeSigil(this.state, 'player', instanceId, Number(target.dataset.slot)));
        else if (kind === 'spell') {
          const targetSide = target.dataset.side as Side;
          this.selectedId = instanceId;
          const effect = getCardDefinition(handCard.definitionId).effect;
          if ((effect === 'damage' && targetSide === 'enemy') || (effect === 'heal' && targetSide === 'player')) this.tryCast({ kind: 'unit', side: targetSide, slot: Number(target.dataset.slot) });
        }
      } else if (target.id === 'enemy-life-target' || target.id === 'player-life-target') {
        if (getCardDefinition(handCard.definitionId).kind === 'spell') { this.selectedId = instanceId; this.tryCast({ kind: 'life', side: target.id === 'enemy-life-target' ? 'enemy' : 'player' }); }
      }
      return;
    }
    const from = this.findPlayerBoardSlot(instanceId);
    if (from < 0 || !target) return;
    if (target.id === 'hand-area') this.transition(returnTroop(this.state, 'player', from), 'A mão está cheia ou a carta não pode ser recolhida.');
    else if (target.dataset.slotSide === 'player') this.transition(moveTroop(this.state, 'player', from, Number(target.dataset.slot)), 'O destino precisa estar vazio.');
  }

  private onPointerCancel = (): void => {
    window.clearTimeout(this.pressTimer);
    const drag = this.drag;
    if (!drag) return;
    if (drag.started) this.restoreDraggedCard(drag, true);
    this.drag = null;
    this.render();
  };

  private restoreDraggedCard(drag: ActiveDrag, reinsert: boolean): void {
    const { origin } = drag;
    if (drag.originalStyle === null) origin.removeAttribute('style');
    else origin.setAttribute('style', drag.originalStyle);
    origin.className = drag.originalClassName;
    if (!reinsert) { origin.remove(); return; }
    if (drag.nextSibling?.parentNode === drag.parent) drag.parent.insertBefore(origin, drag.nextSibling);
    else drag.parent.appendChild(origin);
  }

  private transition(result: Transition, failureMessage?: string): void {
    if (!result.events.length && failureMessage) { this.toast(failureMessage); return; }
    this.captureDestructions(result.events);
    this.state = result.state;
    if (result.events.some((event) => event.type === 'place' || event.type === 'spell' || event.type === 'return' || event.type === 'move')) this.selectedId = null;
    this.render();
    this.playEvents(result.events);
  }

  private tick = (now: number): void => {
    const delta = this.lastFrame ? Math.min(now - this.lastFrame, 250) : 0;
    this.lastFrame = now;
    if (delta > 0) {
      const arenaWasActive = this.matchHasStarted;
      const flow = advanceMatchFlow(this.matchFlow, delta);
      this.matchFlow = flow.state;
      if (flow.events.includes('transition-start')) this.root.querySelector('#transition-curtain')?.classList.add('active');
      if (flow.events.includes('mount-arena')) this.mountArenaForPreparation();
      if (flow.events.includes('transition-complete')) this.root.querySelector('#transition-curtain')?.classList.remove('active');
      if (arenaWasActive && this.matchHasStarted && this.state.phase !== 'finished') {
        const result = advanceTime(this.state, delta);
        this.state = result.state;
        this.syncMatchFlowWithEngine();
        if (result.events.length) { this.captureDestructions(result.events); this.render(); this.playEvents(result.events); }
      }
      this.renderMatchStatus();
      this.renderPhaseBanner();
    }
    requestAnimationFrame(this.tick);
  };

  private playEvents(events: GameEvent[]): void {
    let missionsChanged = false;
    for (const event of events) {
      if (event.type === 'attack') this.animateAttack(event);
      if (event.type === 'spell') this.animateSpell(event);
      if (event.type === 'place') this.animateEntry(event.instanceId);
      if (event.type === 'place' && event.side === 'player') { this.cardsPlaced += 1; missionsChanged = true; }
      if (event.type === 'damage') this.animateImpact(event.instanceId, event.amount);
      if (event.type === 'heal') this.animateHeal(event.instanceId, event.amount);
      if (event.type === 'life-damage') this.toast(event.side === 'player' ? `Você recebeu ${event.amount} de dano direto.` : `O adversário recebeu ${event.amount} de dano direto.`);
      if (event.type === 'life-damage') this.animateLife(event.side, false);
      if (event.type === 'life-heal') this.animateLife(event.side, true);
      if (event.type === 'game-over') {
        if (!this.matchResultRecorded) { this.matchesCompleted += 1; this.playerWins += event.winner === 'player' ? 1 : 0; this.matchResultRecorded = true; missionsChanged = true; }
        const title = this.root.querySelector<HTMLElement>('#result-title');
        const copy = this.root.querySelector<HTMLElement>('#result-copy');
        if (title) title.textContent = event.winner === 'player' ? 'Vitória' : 'Derrota';
        if (copy) copy.textContent = event.winner === 'player' ? 'A Casa Carmesim ficou sem vida.' : 'Sua vida chegou a zero. Tente outra estratégia.';
        this.openOverlay('result-overlay');
      }
      if (event.type === 'game-draw') {
        if (!this.matchResultRecorded) { this.matchesCompleted += 1; this.matchResultRecorded = true; missionsChanged = true; }
        const title = this.root.querySelector<HTMLElement>('#result-title');
        const copy = this.root.querySelector<HTMLElement>('#result-copy');
        if (title) title.textContent = 'Empate';
        if (copy) copy.textContent = 'As duas Casas ficaram sem vida no mesmo instante.';
        this.openOverlay('result-overlay');
      }
    }
    if (missionsChanged) this.renderHome();
  }

  private animateAttack(event: Extract<GameEvent, { type: 'attack' }>): void {
    const attacker = this.root.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(event.attackerId)}"]`);
    const targetId = event.targetId;
    const target = (targetId ? this.root.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(targetId)}"]`) : null)
      ?? (event.targetSlot !== undefined ? this.root.querySelector<HTMLElement>(`[data-slot-side="${event.targetSide}"][data-slot="${event.targetSlot}"]`) : null)
      ?? this.root.querySelector<HTMLElement>(event.targetSide === 'player' ? '#player-life-target' : '#enemy-life-target');
    if (!attacker || !target) return;
    attacker.classList.add('is-attacking');
    window.setTimeout(() => attacker.classList.remove('is-attacking'), 460);
    const from = attacker.getBoundingClientRect(); const to = target.getBoundingClientRect();
    const projectile = document.createElement('i');
    projectile.className = `combat-projectile combat-projectile--${event.side}`;
    projectile.style.left = `${from.left + from.width / 2}px`;
    projectile.style.top = `${from.top + from.height / 2}px`;
    projectile.style.setProperty('--dx', `${to.left + to.width / 2 - from.left - from.width / 2}px`);
    projectile.style.setProperty('--dy', `${to.top + to.height / 2 - from.top - from.height / 2}px`);
    document.body.appendChild(projectile);
    window.setTimeout(() => projectile.remove(), 520);
  }

  private captureDestructions(events: GameEvent[]): void {
    for (const event of events) {
      if (event.type !== 'damage' || !event.destroyed) continue;
      const target = this.root.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(event.instanceId)}"]`);
      if (!target) continue;
      const rect = target.getBoundingClientRect();
      const ghost = target.cloneNode(true) as HTMLElement;
      ghost.classList.add('destruction-ghost');
      ghost.style.left = `${rect.left}px`; ghost.style.top = `${rect.top}px`;
      ghost.style.width = `${rect.width}px`; ghost.style.height = `${rect.height}px`;
      document.body.appendChild(ghost);
      window.setTimeout(() => ghost.remove(), 520);
    }
  }

  private animateEntry(instanceId: string): void {
    const card = this.root.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(instanceId)}"]`);
    if (!card) return;
    card.classList.add('place-pop');
    window.setTimeout(() => card.classList.remove('place-pop'), 460);
  }

  private animateLife(side: Side, healing: boolean): void {
    const target = this.root.querySelector<HTMLElement>(side === 'player' ? '#player-life-target' : '#enemy-life-target');
    if (!target) return;
    target.classList.add(healing ? 'is-healing' : 'is-hit');
    window.setTimeout(() => target.classList.remove('is-hit', 'is-healing'), 550);
  }

  private animateImpact(instanceId: string, amount: number): void {
    const target = this.root.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(instanceId)}"]`);
    if (!target) return;
    target.classList.add('is-hit');
    const number = document.createElement('span');
    number.className = 'impact-number';
    number.textContent = `−${amount}`;
    target.appendChild(number);
    window.setTimeout(() => { target.classList.remove('is-hit', 'is-healing'); number.remove(); }, 850);
  }

  private animateHeal(instanceId: string, amount: number): void {
    const target = this.root.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(instanceId)}"]`);
    if (!target) return;
    target.classList.add('is-healing');
    const number = document.createElement('span');
    number.className = 'impact-number is-healing';
    number.textContent = `+${amount}`;
    target.appendChild(number);
    window.setTimeout(() => { target.classList.remove('is-hit', 'is-healing'); number.remove(); }, 850);
  }

  private animateSpell(event: Extract<GameEvent, { type: 'spell' }>): void {
    const from = this.root.querySelector<HTMLElement>('#hand-area')?.getBoundingClientRect();
    const target = event.targetId
      ? this.root.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(event.targetId)}"]`)
      : this.root.querySelector<HTMLElement>(event.targetSide === 'player' ? '#player-life-target' : '#enemy-life-target');
    if (!from || !target) return;
    const to = target.getBoundingClientRect();
    const projectile = document.createElement('i');
    projectile.className = `combat-projectile ${event.targetSide === 'enemy' ? 'combat-projectile--enemy' : ''}`;
    projectile.style.left = `${from.left + from.width / 2}px`; projectile.style.top = `${from.top + from.height / 2}px`;
    projectile.style.setProperty('--dx', `${to.left + to.width / 2 - from.left - from.width / 2}px`);
    projectile.style.setProperty('--dy', `${to.top + to.height / 2 - from.top - from.height / 2}px`);
    document.body.appendChild(projectile);
    window.setTimeout(() => projectile.remove(), 520);
  }

  private render(): void {
    const player = this.state.players.player; const enemy = this.state.players.enemy;
    const game = this.root.querySelector<HTMLElement>('#game');
    game?.classList.toggle('is-preparing', this.state.phase === 'preparation' || this.state.phase === 'starting');
    this.renderGrid('player', player.slots);
    this.renderGrid('enemy', enemy.slots);
    this.renderSigils('player', player.sigils);
    this.renderSigils('enemy', enemy.sigils);
    this.renderHand(player.hand);
    this.setText('#hand-count', `${player.hand.length}/${balance.handLimit}`);
    this.setText('#deck-count', String(player.deck.length));
    this.setText('#player-life-value', String(player.life));
    this.setText('#enemy-life-value', String(enemy.life));
    this.setText('#player-cycle', String(player.cycle));
    this.setText('#enemy-cycle', String(enemy.cycle));
    const playerLife = this.root.querySelector<HTMLElement>('#player-life-fill');
    const enemyLife = this.root.querySelector<HTMLElement>('#enemy-life-fill');
    if (playerLife) playerLife.style.height = `${Math.max(0, player.life / balance.startingLife * 100)}%`;
    if (enemyLife) enemyLife.style.height = `${Math.max(0, enemy.life / balance.startingLife * 100)}%`;
    const deck = this.root.querySelector<HTMLButtonElement>('#draw-deck');
    if (deck) deck.disabled = player.hand.length >= balance.handLimit || player.deck.length === 0 || this.state.phase !== 'playing';
    const badge = this.root.querySelector<HTMLElement>('#deck-badge');
    if (badge) { const drawn = Math.min(balance.deckSize, player.cardsDrawn); badge.style.setProperty('--deck-progress', `${drawn / balance.deckSize * 100}%`); badge.setAttribute('aria-valuemax', String(balance.deckSize)); badge.setAttribute('aria-valuenow', String(drawn)); }
    const status = this.root.querySelector<HTMLElement>('#player-status');
    if (status) status.textContent = this.state.phase === 'finished' ? 'Partida encerrada'
      : this.state.phase === 'preparation' ? 'Preparação · combate suspenso'
        : this.state.phase === 'starting' ? 'Campo liberado · combate começando'
          : `${enemy.hand.length} cartas ocultas · sem acesso à mão adversária`;
    this.syncMatchFlowWithEngine();
    this.renderHome();
    this.renderPhaseBanner();
    this.syncSelection();
  }

  private renderHand(cards: CardInstance[]): void {
    const hand = this.root.querySelector<HTMLElement>('#hand-area');
    if (!hand) return;
    const activeDragId = this.drag?.started ? this.drag.id : null;
    const inHand = cards.filter((card) => card.instanceId !== activeDragId);
    const existing = new Map(Array.from(hand.querySelectorAll<HTMLElement>('.hand-card[data-card-id]'), (el) => [el.dataset.cardId!, el]));
    if (inHand.length === 0) {
      existing.forEach((element) => element.remove());
      if (!hand.querySelector('.hand-empty')) hand.innerHTML = '<div class="hand-empty">Sua mão está vazia.<br>Compre uma carta no deck.</div>';
      return;
    }
    hand.querySelector('.hand-empty')?.remove();
    const wanted: HTMLElement[] = [];
    inHand.forEach((card, index) => {
      const template = document.createElement('template');
      template.innerHTML = this.handMarkup(card, index, cards.length).trim();
      const desired = template.content.firstElementChild as HTMLElement;
      const element = existing.get(card.instanceId);
      if (element) {
        for (const attribute of Array.from(desired.attributes)) {
          if (element.getAttribute(attribute.name) !== attribute.value) element.setAttribute(attribute.name, attribute.value);
        }
        const existingFace = element.querySelector<HTMLElement>('.card-face');
        const desiredFace = desired.querySelector<HTMLElement>('.card-face');
        if (existingFace?.dataset.visualState !== desiredFace?.dataset.visualState && desiredFace) element.replaceChildren(desiredFace);
        wanted.push(element);
      } else wanted.push(desired);
    });
    const keep = new Set(wanted);
    Array.from(hand.querySelectorAll<HTMLElement>('.hand-card[data-card-id]')).forEach((element) => { if (!keep.has(element)) element.remove(); });
    wanted.forEach((element, index) => {
      const current = hand.children[index];
      if (current !== element) hand.insertBefore(element, current ?? null);
    });
  }

  private renderGrid(side: Side, slots: Array<CardInstance | null>): void {
    const grid = this.root.querySelector<HTMLElement>(side === 'player' ? '#player-grid' : '#enemy-grid');
    if (!grid) return;
    const front = frontRow(side);
    grid.style.gridTemplateColumns = `repeat(${topology.columns}, minmax(0, 1fr))`;
    grid.style.gridTemplateRows = `repeat(${topology.rows}, minmax(0, 1fr))`;
    slots.forEach((card, slot) => {
      const [row, col] = [Math.floor(slot / topology.columns), slot % topology.columns];
      const displayedCard = card && !this.isBeingDragged(card) ? card : null;
      const filled = displayedCard ? this.unitMarkup(displayedCard, side) : `<span class="empty-rune" aria-hidden="true">✧<small>${row === front ? 'FRENTE' : 'RETAGUARDA'}</small></span>`;
      const label = `${side === 'player' ? 'Seu' : 'Adversário'}: ${row === front ? 'linha da frente' : 'retaguarda'}, coluna ${col + 1}${displayedCard ? `, ${getCardDefinition(displayedCard.definitionId).name}` : ', vazio'}`;
      let button = grid.children[slot] as HTMLButtonElement | undefined;
      if (!button || Number(button.dataset.slot) !== slot) {
        const template = document.createElement('template');
        template.innerHTML = `<button class="slot ${side === 'enemy' ? 'enemy-slot' : 'player-slot'}" type="button" data-slot-side="${side}" data-side="${side}" data-slot="${slot}" data-row="${row}" data-column="${col}" aria-label="${this.escapeAttribute(label)}">${filled}</button>`;
        const created = template.content.firstElementChild as HTMLButtonElement;
        if (button) grid.replaceChild(created, button); else grid.appendChild(created);
        button = created;
      } else {
        button.className = `slot ${side === 'enemy' ? 'enemy-slot' : 'player-slot'}${this.selectedId === displayedCard?.instanceId ? ' is-selected' : ''}`;
        button.setAttribute('aria-label', this.escapeAttribute(label));
        const currentCard = button.querySelector<HTMLElement>('.battle-card[data-card-id]');
        const currentId = currentCard?.dataset.cardId ?? null;
        const shouldReplace = displayedCard
          ? currentId !== displayedCard.instanceId || button.children.length !== 1
          : currentId !== null || button.children.length !== 1 || !button.firstElementChild?.classList.contains('empty-rune');
        if (shouldReplace) button.innerHTML = filled;
        else if (displayedCard && currentCard) {
          const details = this.cardDetails(displayedCard);
          currentCard.setAttribute('aria-label', this.escapeAttribute(details));
          currentCard.setAttribute('title', this.escapeAttribute(details));
          const definition = getCardDefinition(displayedCard.definitionId);
          const nextFace = document.createElement('template');
          nextFace.innerHTML = renderCardFace(definition, displayedCard, side, 'field').trim();
          const currentFace = currentCard.querySelector<HTMLElement>('.card-face');
          const desiredFace = nextFace.content.firstElementChild as HTMLElement;
          if (currentFace?.dataset.visualState !== desiredFace.dataset.visualState) currentCard.replaceChildren(desiredFace);
        }
      }
      button.dataset.slotSide = side;
      button.dataset.side = side;
      button.dataset.row = String(row);
      button.dataset.column = String(col);
    });
  }

  private renderSigils(side: Side, sigils: Array<CardInstance | null>): void {
    const target = this.root.querySelector<HTMLElement>(side === 'player' ? '#player-secrets' : '#enemy-secrets');
    if (!target) return;
    sigils.forEach((card, slot) => {
      const displayedCard = card && !this.isBeingDragged(card) ? card : null;
      const content = !displayedCard ? '<span class="empty-rune" aria-hidden="true">✧</span>' : displayedCard.revealed
        ? this.unitMarkup(displayedCard, side, true)
        : renderCardBack(side);
      const label = `${side === 'player' ? 'Seu' : 'Adversário'}: sigilo ${slot + 1}${displayedCard?.revealed ? `, ${getCardDefinition(displayedCard.definitionId).name}` : displayedCard ? ', oculto' : ', vazio'}`;
      let button = target.children[slot] as HTMLButtonElement | undefined;
      if (!button) {
        const template = document.createElement('template');
        template.innerHTML = `<button class="slot secret-slot ${side === 'enemy' ? 'enemy-slot' : 'player-slot'}" type="button">${content}</button>`;
        button = template.content.firstElementChild as HTMLButtonElement;
        target.appendChild(button);
      }
      const cardId = displayedCard?.instanceId ?? '';
      const revealed = displayedCard?.revealed ? 'true' : 'false';
      const changed = button.dataset.sigilId !== cardId || button.dataset.sigilRevealed !== revealed;
      button.className = `slot secret-slot ${side === 'enemy' ? 'enemy-slot' : 'player-slot'}${this.selectedId === displayedCard?.instanceId ? ' is-selected' : ''}`;
      button.dataset.slotSide = side;
      button.dataset.slotKind = 'sigil';
      button.dataset.slot = String(slot);
      button.dataset.sigilId = cardId;
      button.dataset.sigilRevealed = revealed;
      button.setAttribute('aria-label', this.escapeAttribute(label));
      if (changed) button.innerHTML = content;
      else if (displayedCard?.revealed) {
        const unit = button.querySelector<HTMLElement>('.battle-card');
        if (unit) {
          const details = this.cardDetails(displayedCard);
          unit.setAttribute('aria-label', this.escapeAttribute(details));
          unit.setAttribute('title', this.escapeAttribute(details));
        }
      }
    });
    while (target.children.length > sigils.length) target.lastElementChild?.remove();
  }

  private isBeingDragged(card: CardInstance): boolean {
    return Boolean(this.drag?.started && this.drag.id === card.instanceId);
  }

  private syncSelection(): void {
    this.root.querySelectorAll<HTMLElement>('.hand-card[data-card-id]').forEach((element, index) => {
      const selected = element.dataset.cardId === this.selectedId;
      element.classList.toggle('is-selected', selected);
      element.style.zIndex = selected ? '40' : String(index + 3);
    });
    this.root.querySelectorAll<HTMLElement>('.slot').forEach((slot) => {
      const id = slot.querySelector<HTMLElement>('.battle-card[data-card-id]')?.dataset.cardId ?? slot.dataset.sigilId ?? null;
      slot.classList.toggle('is-selected', this.selectedId !== null && id === this.selectedId);
    });
  }

  private handMarkup(card: CardInstance, index: number, total: number): string {
    const definition = getCardDefinition(card.definitionId);
    const area = this.root.querySelector<HTMLElement>('#hand-area');
    const width = area?.clientWidth || 360;
    const spacing = Math.min(61, Math.max(14, (width - 82) / Math.max(1, total - 1)));
    const offset = (index - (total - 1) / 2) * spacing;
    const angle = (index - (total - 1) / 2) * Math.min(2.1, 11 / Math.max(1, total - 1));
    const details = this.cardDetails(card);
    return `<button class="hand-card kind-${definition.kind}${this.selectedId === card.instanceId ? ' is-selected' : ''}" type="button" data-card-id="${card.instanceId}" data-side="player" data-foundation="${definition.foundation}" style="left:calc(50% + ${offset}px);--angle:${angle}deg;z-index:${this.selectedId === card.instanceId ? 40 : index + 3}" aria-label="${this.escapeAttribute(`${details}. Selecionar ou arrastar`)}" title="${this.escapeAttribute(details)}">${renderCardFace(definition, card, 'player', 'hand')}</button>`;
  }

  private unitMarkup(card: CardInstance, side: Side, secret = false): string {
    const definition = getCardDefinition(card.definitionId);
    const details = this.cardDetails(card);
    return `<div class="battle-card${side === 'enemy' ? ' enemy-unit' : ''}${secret ? ' sigil-card' : ''}" data-card-id="${card.instanceId}" data-side="${side}" data-foundation="${definition.foundation}" title="${this.escapeAttribute(details)}">${renderCardFace(definition, card, side, 'field')}</div>`;
  }

  private showPreview(instanceId: string, side: Side): void {
    const card = [...this.deckPreviewCards, ...this.state.players[side].hand, ...this.state.players[side].deck, ...this.state.players[side].slots.filter((item): item is CardInstance => Boolean(item)), ...this.state.players[side].sigils.filter((item): item is CardInstance => Boolean(item))].find((item) => item.instanceId === instanceId);
    if (!card) return;
    const definition = getCardDefinition(card.definitionId);
    const overlay = this.root.querySelector<HTMLElement>('#card-preview-overlay');
    const wrap = this.root.querySelector<HTMLElement>('#card-preview-wrap');
    if (!overlay || !wrap) return;
    const details = this.cardDetails(card);
    wrap.innerHTML = `<div class="preview-shell ${definition.kind}" data-foundation="${definition.foundation}" title="${this.escapeAttribute(details)}">${renderCardFace(definition, card, side, 'preview')}</div>`;
    overlay.classList.add('open'); overlay.setAttribute('aria-hidden', 'false');
  }

  private cardDetails(card: CardInstance): string {
    const definition = getCardDefinition(card.definitionId);
    const kind = definition.kind === 'troop' ? 'tropa' : definition.kind === 'hidden' ? 'sigilo' : 'feitiço';
    const values = [definition.name, kind, `custo ${definition.cost}`];
    if (definition.kind === 'troop') values.push(`${definition.attack} ataque`, `${card.health} vida`);
    values.push(definition.description);
    return values.join(' · ');
  }

  private escapeAttribute(value: string): string {
    return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  }

  private setText(selector: string, value: string): void { const element = this.root.querySelector<HTMLElement>(selector); if (element) element.textContent = value; }
  private openOverlay(id: string): void { const overlay = this.root.querySelector<HTMLElement>(`#${id}`); overlay?.classList.add('open'); overlay?.setAttribute('aria-hidden', 'false'); }
  private closeOverlay(id: string): void { const overlay = this.root.querySelector<HTMLElement>(`#${id}`); overlay?.classList.remove('open'); overlay?.setAttribute('aria-hidden', 'true'); }
  private toast(message: string): void {
    const element = this.root.querySelector<HTMLElement>('#toast');
    if (!element) return;
    element.textContent = message; element.classList.add('visible'); window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => element.classList.remove('visible'), 1800);
  }
}

import { createGame as createGameImported } from '../game/engine.ts';
