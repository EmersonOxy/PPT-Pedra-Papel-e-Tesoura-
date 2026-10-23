import { cardDefinitions, getCardDefinition } from '../game/cards.ts';
import { assignAttackTarget, beginPreparation, castSpell, drawCard, moveTroop, placeCard, placeSigil, returnTroop, revealSigil } from '../game/engine.ts';
import { advanceTime } from '../game/simulation.ts';
import { frontRow, isAttackTargetExposed } from '../game/targeting.ts';
import { attackIntervalFor, balance, boardSlotCount, topology } from '../game/config.ts';
import type { CardInstance, GameEvent, GameState, Side, SpellTarget, Transition } from '../game/types.ts';
import { advanceMatchFlow, beginDemoMatchSearch, cancelDemoMatchSearch, createMatchFlow, isPreparationActionAllowed, sessionConfig, setMatchFlowPhase } from '../game/session-flow.ts';
import type { MatchFlowState } from '../game/session-flow.ts';
import { renderCardBack, renderCardFace, renderDeckCardBack } from './card-presentation.ts';
import { attackProfileClass, attackProjectileClass, cooldownSweepDegrees, handFanSpacing, shouldHighlightDeck } from './combat-presentation.ts';
import { deckStatsFor, synergiesFor } from './deck-card-details.ts';
import type { AttackAnimationProfile } from '../game/types.ts';

const missionRewards: Record<string, string> = { 'first-match': 'runic-pulse', 'first-win': 'amber-phoenix', 'first-formation': 'solemn-guardian' };
type ActiveDrag = {
  id: string;
  side: Side;
  origin: HTMLElement;
  parent: Node;
  nextSibling: Node | null;
  originalStyle: string | null;
  originalClassName: string;
  pointerId: number;
  source: 'hand' | 'board';
  x: number;
  y: number;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  started: boolean;
};

const sigil = '<svg viewBox="0 0 60 60" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path d="M30 4L53 45H7L30 4Z" stroke="#ddc58e" stroke-width="2"/><circle cx="30" cy="32" r="15" stroke="#78c9bc" stroke-width="2"/><path d="M30 16V47M15 32H45" stroke="#dbc58d" stroke-width="1.7"/><circle cx="30" cy="32" r="4" fill="#edcf92"/></svg>';

export class GameApp {
  private root: HTMLElement;
  private state: GameState;
  private selectedId: string | null = null;
  private theme = 'mineral';
  private drag: ActiveDrag | null = null;
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
  private longPressTimer: number | undefined;
  private cardTickets: Record<string, number> = {};
  private cardLevels: Record<string, number> = {};
  private claimedMissions = new Set<string>();
  private readonly progressionStorageKey = 'trindade.card-progression.v1';

  constructor(root: HTMLElement) {
    this.root = root;
    this.loadProgression();
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
    const troopIntervals = cardDefinitions.filter((definition) => definition.kind === 'troop').map((definition) => attackIntervalFor(definition.id));
    const minAttackInterval = Math.min(...troopIntervals) / 1000;
    const maxAttackInterval = Math.max(...troopIntervals) / 1000;
    this.root.innerHTML = `
      <div class="app-frame">
      <main class="home-shell" id="home" aria-label="Menu principal do Trindade">
        <header class="home-header"><div class="home-brand"><span class="home-brand-mark" aria-hidden="true">${sigil}</span><span><strong>TRINDADE</strong><small>CARD BATTLES · EXPERIMENTO</small></span></div><div class="home-profile"><span class="home-avatar" aria-hidden="true">T</span><span><strong>JOGADOR</strong><small>LOCAL</small></span></div></header>
        <div class="home-scroll" id="home-scroll">
          <section class="home-page home-page--start" data-home-page="home">
            <div class="home-hero"><div class="hero-kicker"><i></i> ARENA EXPERIMENTAL · IA LOCAL</div><div class="hero-emblem" aria-hidden="true">${sigil}</div><h1>As três forças<br>se encontram.</h1><p>Monte sua formação e enfrente a Casa Carmesim em uma partida local de demonstração.</p><div class="hero-facts"><span><b>3 × 2</b> arena</span><span><b>${balance.deckSize}</b> cartas</span><span><b>IA</b> local</span></div><button class="battle-cta" id="start-battle" type="button"><span class="battle-cta-icon" aria-hidden="true">⚔</span><span><strong>BATALHA</strong><small>Encontrar adversário</small></span><span class="battle-cta-arrow" aria-hidden="true">→</span></button>
              <div class="match-panel" id="match-panel" hidden aria-live="polite"><div class="match-orbit" aria-hidden="true"><span>${sigil}</span></div><div class="match-copy"><strong id="match-title">Buscando adversário</strong><small id="match-detail">Partida experimental contra IA local</small></div><strong class="match-countdown" id="match-countdown" hidden></strong><button class="cancel-search" id="cancel-search" type="button">Cancelar busca</button></div>
              <div class="hero-disclaimer">Esta versão usa IA local. Ainda não existe PvP online.</div>
            </div>
            <div class="home-section-heading"><span>CAMINHO DE TREINO</span><span>SESSÃO LOCAL</span></div>
            <button class="home-shortcut" data-home-tab="missions" type="button"><span class="shortcut-glyph">✧</span><span><strong>Missões e tickets</strong><small>Conclua objetivos para melhorar cartas</small></span><span class="shortcut-arrow">→</span></button>
          </section>
          <section class="home-page" data-home-page="deck" hidden>
            <div class="page-heading"><span class="page-overline">PREPARAÇÃO</span><h1>Seu deck</h1><p>Catálogo atual conectado ao jogo.</p></div>
            <div class="deck-summary"><div><strong>${balance.deckSize}</strong><span>cartas no deck experimental</span></div><div><strong>${cardDefinitions.length}</strong><span>modelos disponíveis</span></div></div>
            <div class="experimental-note"><b>Deck experimental</b><span>Visualização e inspeção disponíveis. Edição e salvamento do deck ainda não estão implementados.</span></div>
            <div class="deck-grid" id="deck-grid" aria-label="As ${balance.deckSize} cartas do deck"></div>
          </section>
          <section class="home-page" data-home-page="missions" hidden>
            <div class="page-heading"><span class="page-overline">OBJETIVOS DE TREINO</span><h1>Missões</h1><p>Conclua objetivos e resgate tickets exclusivos das cartas indicadas.</p></div>
            <div class="mission-list" id="mission-list"></div>
            <p class="mission-footnote">Tickets ficam salvos neste dispositivo e só podem melhorar a carta correspondente.</p>
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
            <div class="status-stack"><div class="status-title">Casa Carmesim</div><div class="status-sub" id="enemy-status-sub" role="status" aria-live="polite">Adversário experimental</div></div>
            <div class="enemy-cycle" role="status" aria-label="Ciclo do deck adversário"><span class="enemy-cycle-icon" id="enemy-cycle">1</span><span class="enemy-cycle-label">CICLO</span></div>
            <div class="top-actions"><button class="top-btn" id="themes" type="button" aria-label="Escolher tema">◒</button><button class="top-btn" id="help" type="button" aria-label="Como jogar">?</button><button class="top-btn" id="restart" type="button" aria-label="Voltar ao menu" title="Voltar ao menu">⌂</button></div>
          </div>
        </section>
        <div class="arena-stage"><div class="arena-board">
        <section class="field-band enemy" data-zone="enemy-field" aria-label="Campo adversário">
            <div class="battle-grid enemy-grid" id="enemy-grid" aria-label="${boardSlotCount} espaços do adversário"></div>
          <aside class="sigil-side enemy"><span class="sigil-label">SIGILOS</span><div class="secret-slots" id="enemy-secrets" aria-label="${balance.fieldTopology.specialSpaces[0]?.count ?? 0} sigilos adversários"></div></aside>
          <button class="side-life enemy-life is-targetable" id="enemy-life-target" type="button" aria-label="Vida adversária, alvo direto">
            <span class="life-label">VIDA</span><span class="life-value" id="enemy-life-value">${balance.startingLife}</span><span class="life-track"><i id="enemy-life-fill"></i></span>
          </button>
        </section>
        <section class="field-band player" data-zone="player-field" aria-label="Seu campo">
          <aside class="sigil-side player"><span class="sigil-label">SIGILOS</span><div class="secret-slots" id="player-secrets" aria-label="${balance.fieldTopology.specialSpaces[0]?.count ?? 0} sigilos do jogador"></div></aside>
          <div class="battle-grid player-grid" id="player-grid" aria-label="${boardSlotCount} espaços do jogador"></div>
          <button class="side-life player-life is-targetable" id="player-life-target" type="button" aria-label="Sua vida, alvo de cura">
            <span class="life-label">VIDA</span><span class="life-value" id="player-life-value">${balance.startingLife}</span><span class="life-track"><i id="player-life-fill"></i></span>
          </button>
        </section>
        <div class="deck-column"><div class="player-cycle" role="status" aria-label="Ciclo do seu deck"><span class="enemy-cycle-icon" id="player-cycle">1</span></div><button class="deck-button" type="button" id="draw-deck" title="Comprar uma carta" aria-label="Comprar carta">${renderDeckCardBack()}<span class="deck-progress" id="deck-badge" role="progressbar" aria-label="Progresso do deck" aria-valuemin="0" aria-valuemax="${balance.deckSize}" aria-valuenow="${balance.handLimit}"></span></button></div>
        <div class="enemy-deck-display" role="img" aria-label="Deck do adversário">${renderDeckCardBack()}<div class="player-cycle" role="status" aria-label="Ciclo do deck adversário"><span class="enemy-cycle-icon" id="enemy-deck-cycle">1</span></div></div>
        </div></div>
        <section class="bottom-zone" aria-label="Sua mão e deck">
          <div class="my-status"><div class="status-stack"><div class="status-title">TRINDADE</div><div class="status-sub" id="player-status">Regras experimentais · partida local</div></div><div class="metrics"><strong id="deck-count">18</strong><small>no deck</small></div></div>
          <div class="hand-dock">
            <div class="dock-header"><strong>SUA MÃO <span id="hand-count">${balance.handLimit}/${balance.handLimit}</span></strong><span class="selection-hint" id="action-hint">Toque ou arraste as cartas</span></div>
            <div class="dock-main">

              <div class="hand-area" id="hand-area" data-zone="hand" aria-label="Sua mão: arraste uma tropa para cá para recolhê-la"></div>
            </div>
          </div>
        </section>
        <div id="toast" class="toast" role="status" aria-live="polite"></div>
        <div class="overlay" id="help-overlay" aria-hidden="true"><div class="help-panel"><div class="help-tag">Experimento separado · versão jogável inicial</div><h2>Como experimentar</h2><p><b>Comprar:</b> toque no deck enquanto houver espaço na mão (máximo de ${balance.handLimit} cartas).</p><p><b>Posicionar:</b> arraste uma tropa a um espaço vazio. A linha próxima do centro protege a linha posterior na mesma coluna.</p><p><b>Mover ou recolher:</b> arraste uma tropa sua para um espaço vazio ou para a mão. Para definir seu alvo, arraste ou selecione a tropa e toque em qualquer tropa inimiga exposta; a coluna da atacante não limita o alvo. A carta atacante mostra quem está priorizando. Se o alvo sair do campo ou ficar protegido, ela informa que retomou o alvo automático.</p><p><b>Feitiços:</b> Bola de Fogo causa ${balance.spellDamage} de dano; Cura Equivalente restaura ${balance.spellHealing} de vida. Selecione um feitiço e toque no alvo compatível.</p><p><b>Sigilos:</b> coloque um sigilo em um dos ${balance.fieldTopology.specialSpaces[0]?.count ?? 0} espaços e toque nele para revelar sua carta. Eles são visuais nesta versão e ainda não têm gatilhos.</p><p><b>Combate:</b> cada tropa tem sua recarga individual exibida na carta (de ${minAttackInterval.toFixed(2)} a ${maxAttackInterval.toFixed(2)} segundos). O valor varia por carta e é experimental. Os custos são somente demonstrativos; não há mana.</p><p><b>Limite experimental:</b> ${balance.startingLife} de vida, ${balance.deckSize} cartas por deck e IA básica. Os valores não são regras finais.</p><button class="close-help" id="close-help" type="button">Entendi</button></div></div>
        <div class="overlay" id="palette-overlay" aria-hidden="true"><div class="help-panel"><div class="help-tag">Identidade visual V3</div><h2>Atmosfera da arena</h2><div class="theme-option-grid"><button type="button" class="theme-btn active" data-theme-set="mineral">Verde mineral</button><button type="button" class="theme-btn" data-theme-set="abissal">Azul abissal</button><button type="button" class="theme-btn" data-theme-set="rubro">Rubro arcano</button></div><button class="close-help" id="close-palette" type="button">Voltar à arena</button></div></div>
        <div class="overlay" id="result-overlay" aria-hidden="true"><div class="help-panel"><div class="help-tag">Fim da partida</div><h2 id="result-title">Vitória</h2><p id="result-copy"></p><button class="close-help" id="play-again" type="button">Voltar ao início</button></div></div>
      </main><svg class="attack-aim-overlay" id="attack-aim-overlay" aria-hidden="true"><defs><marker id="attack-arrowhead" markerWidth="18" markerHeight="18" refX="15" refY="9" markerUnits="userSpaceOnUse" orient="auto"><path d="M1 2L16 9L1 16L5 9Z"></path></marker></defs><path id="attack-aim-line" d=""></path></svg><div class="overlay card-preview-overlay" id="card-preview-overlay" aria-hidden="true"><div class="card-preview-wrap" id="card-preview-wrap"></div></div><div class="transition-curtain" id="transition-curtain" aria-hidden="true"></div></div>`;
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

  private loadProgression(): void {
    try {
      const stored = localStorage.getItem(this.progressionStorageKey);
      if (!stored) return;
      const data = JSON.parse(stored) as { tickets?: unknown; levels?: unknown; claimed?: unknown; stats?: unknown };
      if (data.tickets && typeof data.tickets === 'object') this.cardTickets = data.tickets as Record<string, number>;
      if (data.levels && typeof data.levels === 'object') this.cardLevels = data.levels as Record<string, number>;
      if (Array.isArray(data.claimed)) this.claimedMissions = new Set(data.claimed.filter((id): id is string => typeof id === 'string'));
      if (data.stats && typeof data.stats === 'object') {
        const stats = data.stats as Record<string, unknown>;
        this.matchesCompleted = Math.max(0, Number(stats.matchesCompleted) || 0);
        this.playerWins = Math.max(0, Number(stats.playerWins) || 0);
        this.cardsPlaced = Math.max(0, Number(stats.cardsPlaced) || 0);
      }
      for (const definition of cardDefinitions) {
        const level = Math.max(0, Math.min(10, Number(this.cardLevels[definition.id]) || 0));
        this.cardLevels[definition.id] = level;
        if (definition.kind === 'troop') {
          definition.attack += level;
          definition.maxHealth += level;
        } else if (definition.kind === 'spell') {
          definition.spellAmount = (definition.spellAmount ?? (definition.effect === 'damage' ? balance.spellDamage : balance.spellHealing)) + level;
        }
      }
    } catch {
      this.cardTickets = {};
      this.cardLevels = {};
      this.claimedMissions.clear();
    }
  }

  private saveProgression(): void {
    try {
      localStorage.setItem(this.progressionStorageKey, JSON.stringify({ tickets: this.cardTickets, levels: this.cardLevels, claimed: [...this.claimedMissions], stats: { matchesCompleted: this.matchesCompleted, playerWins: this.playerWins, cardsPlaced: this.cardsPlaced } }));
    } catch { /* Progress remains usable for this session if storage is unavailable. */ }
  }

  private claimMission(missionId: string, definitionId: string): void {
    definitionId = missionRewards[missionId] ?? '';
    if (this.claimedMissions.has(missionId)) return;
    const available = new Set([
      ...(this.matchesCompleted > 0 ? ['first-match'] : []),
      ...(this.playerWins > 0 ? ['first-win'] : []),
      ...(this.cardsPlaced >= 3 ? ['first-formation'] : []),
    ]);
    if (!available.has(missionId) || !cardDefinitions.some((definition) => definition.id === definitionId && definition.kind !== 'hidden')) return;
    this.cardTickets[definitionId] = (this.cardTickets[definitionId] ?? 0) + 5;
    this.claimedMissions.add(missionId);
    this.saveProgression();
    this.renderHome();
    this.toast(`5 tickets de ${getCardDefinition(definitionId).name} adicionados.`);
  }

  private upgradeCard(definitionId: string): void {
    const definition = getCardDefinition(definitionId);
    const ticketCost = 5;
    if (definition.kind === 'hidden') return;
    const level = this.cardLevels[definitionId] ?? 0;
    if ((this.cardTickets[definitionId] ?? 0) < ticketCost) { this.toast(`Faltam ${ticketCost - (this.cardTickets[definitionId] ?? 0)} tickets desta carta.`); return; }
    if (level >= 10) { this.toast('Esta carta já atingiu o limite experimental.'); return; }
    this.cardTickets[definitionId] -= ticketCost;
    this.cardLevels[definitionId] = level + 1;
    if (definition.kind === 'troop') {
      definition.attack += 1;
      definition.maxHealth += 1;
    } else {
      definition.spellAmount = (definition.spellAmount ?? (definition.effect === 'damage' ? balance.spellDamage : balance.spellHealing)) + 1;
    }
    this.deckPreviewCards.filter((card) => card.definitionId === definitionId).forEach((card) => { card.health = definition.maxHealth; });
    this.saveProgression();
    this.renderDeckLibrary();
    this.showPreview(this.deckPreviewCards.find((card) => card.definitionId === definitionId)!.instanceId, 'player');
    this.toast(`${definition.name} melhorada para o nível ${level + 2}.`);
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
    if (this.drag?.started && this.drag.source === 'hand') this.restoreDraggedCard(this.drag, true);
    if (this.drag?.started && this.drag.source === 'board') this.hideAttackAim(this.drag);
    this.drag = null;
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
      return `<button class="deck-card-tile" type="button" data-card-inspect="${this.escapeAttribute(card.instanceId)}" aria-label="Ver detalhes de ${this.escapeAttribute(definition.name)}, cópia ${index % balance.copiesPerDefinition + 1}">${renderCardFace(definition, card, 'player', 'preview')}<span class="deck-card-number">${String(index + 1).padStart(2, '0')}</span><span class="deck-card-inspect-hint" aria-hidden="true">ⓘ Detalhes</span></button>`;
    }).join('');
  }

  private renderMissions(): void {
    const list = this.root.querySelector<HTMLElement>('#mission-list');
    if (!list) return;
    const missions = [
      { id: 'first-match', title: 'Primeiro encontro', objective: 'Conclua uma partida experimental.', progress: Math.min(this.matchesCompleted, 1), goal: 1 },
      { id: 'first-win', title: 'Vitória da Trindade', objective: 'Vença a IA local uma vez.', progress: Math.min(this.playerWins, 1), goal: 1 },
      { id: 'first-formation', title: 'Formação inicial', objective: 'Coloque três cartas na arena.', progress: Math.min(this.cardsPlaced, 3), goal: 3 },
    ];
    list.innerHTML = missions.map((mission) => {
      const complete = mission.progress >= mission.goal;
      const claimed = this.claimedMissions.has(mission.id);
      const definition = getCardDefinition(missionRewards[mission.id]);
      const rewardCard = this.deckPreviewCards.find(card => card.definitionId === definition.id)!;
      const reward = `5 tickets de ${definition.name}`;
      return `<article class="mission-card${complete ? ' is-complete' : ''}"><div class="mission-reward-preview">${renderCardFace(definition, rewardCard, 'player', 'preview')}</div><div class="mission-content"><div class="mission-status">${claimed ? 'RECOMPENSA RESGATADA' : complete ? 'CONCLUÍDA' : 'EM ANDAMENTO'}</div><h2>${mission.title}</h2><p>${mission.objective}</p><div class="mission-progress"><span style="width:${Math.min(100, mission.progress / mission.goal * 100)}%"></span></div><small>${mission.progress}/${mission.goal} · Recompensa: ${reward}</small>${complete && !claimed ? `<button class="mission-claim" type="button" data-claim-mission="${mission.id}">Resgatar tickets</button>` : ''}</div><span class="mission-check" aria-hidden="true">${claimed ? '✓' : complete ? '✧' : '◇'}</span></article>`;
    }).join('');
  }

  private renderPhaseStatus(): void {
    const subtitle = this.root.querySelector<HTMLElement>('#enemy-status-sub');
    if (!subtitle) return;
    if (this.state.phase === 'preparation') {
      const remaining = Math.max(0, (this.state.preparationEndsAtMs ?? this.state.clockMs) - this.state.clockMs);
      subtitle.textContent = `Preparação · ${Math.ceil(remaining / 1000)}s`;
    } else if (this.state.phase === 'starting') {
      const remaining = Math.max(0, (this.state.startAnnouncementEndsAtMs ?? this.state.clockMs) - this.state.clockMs);
      subtitle.textContent = `Combate em ${Math.ceil(remaining / 1000)}s`;
    } else subtitle.textContent = 'Adversário experimental';
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
    const claimMission = button.dataset.claimMission;
    if (claimMission) {
      const selectedCard = this.root.querySelector<HTMLSelectElement>(`[data-mission-card="${CSS.escape(claimMission)}"]`);
      this.claimMission(claimMission, selectedCard?.value ?? '');
      return;
    }
    const homeTab = button.dataset.homeTab as 'home' | 'deck' | 'missions' | undefined;
    if (homeTab) { this.setHomeTab(homeTab); return; }
    if (button.id === 'start-battle') { this.startDemoSearch(); return; }
    if (button.id === 'cancel-search') { this.cancelDemoSearch(); return; }
    if (button.id === 'restart' || button.id === 'play-again') { this.returnToHome(); return; }
    if (button.id === 'close-card-preview') { this.closeOverlay('card-preview-overlay'); return; }
    if (button.id === 'upgrade-card') { this.upgradeCard(button.dataset.definitionId ?? ''); return; }
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
      const selectedBoardSlot = this.selectedId ? this.findPlayerBoardSlot(this.selectedId) : -1;
      if (selectedBoardSlot >= 0) { this.setAttackTarget(selectedBoardSlot, slot); return; }
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
    const playerSlot = target.closest<HTMLElement>('.slot[data-slot-side]');
    const cardEl = directCard ?? playerSlot?.querySelector<HTMLElement>('.battle-card[data-card-id]') ?? null;
    if (!cardEl) return;
    const id = cardEl.dataset.cardId;
    const side = (cardEl.dataset.side ?? 'player') as Side;
    if (!id) return;
    const source = cardEl.classList.contains('hand-card') ? 'hand' : 'board';
    const boardCard = source === 'board' ? this.state.players[side].slots.find((card) => card?.instanceId === id) : undefined;
    if (source === 'board' && side === 'player' && (cardEl.closest('.secret-slot') || !boardCard || getCardDefinition(boardCard.definitionId).kind !== 'troop')) return;
    const rect = cardEl.getBoundingClientRect();
    this.drag = {
      id, side, origin: cardEl, parent: cardEl.parentNode!, nextSibling: cardEl.nextSibling,
      originalStyle: cardEl.getAttribute('style'), originalClassName: cardEl.className,
      pointerId: event.pointerId, source, x: event.clientX, y: event.clientY,
      startX: event.clientX, startY: event.clientY,
      offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top,
      started: false,
    };
    window.clearTimeout(this.longPressTimer);
    this.longPressTimer = window.setTimeout(() => {
      const current = this.drag;
      if (!current || current.pointerId !== event.pointerId || current.started) return;
      this.drag = null;
      this.suppressClickUntil = performance.now() + 900;
      this.showPreview(id, side, 'quick');
    }, 430);
  };

  private onPointerMove = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.x = event.clientX; drag.y = event.clientY;
    const distance = Math.hypot(drag.x - drag.startX, drag.y - drag.startY);
    if (distance > 8) {
      window.clearTimeout(this.longPressTimer);
      if (drag.side !== 'player') return;
      if (!drag.started) {
        drag.started = true;
        if (drag.source === 'board') {
          drag.origin.classList.add('is-aiming');
          this.updateAttackAim(drag, event.clientX, event.clientY);
          return;
        }
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
      if (drag.source === 'board') {
        this.updateAttackAim(drag, event.clientX, event.clientY);
        return;
      }
      drag.origin.style.left = `${drag.x - drag.offsetX}px`;
      drag.origin.style.top = `${drag.y - drag.offsetY}px`;
    }
  };

  private onPointerUp = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    window.clearTimeout(this.longPressTimer);
    if (drag.started) {
      const selector = drag.source === 'board' ? '[data-slot-side], #hand-area' : '[data-slot-side], #hand-area, #enemy-life-target, #player-life-target';
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>(selector) ?? null;
      const before = this.state;
      this.suppressClickUntil = performance.now() + 100;
      if (drag.source === 'hand') this.restoreDraggedCard(drag, false);
      else this.hideAttackAim(drag);
      this.drag = null;
      this.completePlayerDrop(drag.id, target);
      if (drag.source === 'hand' && this.state === before) {
        this.restoreDraggedCard(drag, true);
        this.render();
      }
    } else {
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
    else if (target.dataset.slotSide === 'enemy') this.setAttackTarget(from, Number(target.dataset.slot));
  }

  private setAttackTarget(attackerSlot: number, targetSlot: number): void {
    if (this.state.phase !== 'playing') { this.toast('A designação de alvos fica disponível quando o combate começar.'); return; }
    const target = this.state.players.enemy.slots[targetSlot];
    if (!target || getCardDefinition(target.definitionId).kind !== 'troop') { this.toast('Escolha uma tropa inimiga.'); return; }
    if (!isAttackTargetExposed(this.state, 'enemy', targetSlot)) { this.toast('Alvo protegido: uma tropa na frente bloqueia a retaguarda da mesma coluna.'); return; }
    const result = assignAttackTarget(this.state, 'player', attackerSlot, targetSlot);
    if (!result.events.length) { this.toast('Essa tropa já está priorizando esse alvo.'); return; }
    this.selectedId = null;
    this.transition(result);
  }

  private onPointerCancel = (): void => {
    window.clearTimeout(this.longPressTimer);
    const drag = this.drag;
    if (!drag) return;
    if (drag.started && drag.source === 'hand') this.restoreDraggedCard(drag, true);
    if (drag.started && drag.source === 'board') this.hideAttackAim(drag);
    this.drag = null;
    if (drag.source === 'hand') this.render();
  };

  private updateAttackAim(drag: ActiveDrag, x: number, y: number): void {
    const svg = this.root.querySelector<SVGSVGElement>('#attack-aim-overlay');
    const path = this.root.querySelector<SVGPathElement>('#attack-aim-line');
    if (!svg || !path) return;
    const rect = drag.origin.getBoundingClientRect();
    const x1 = rect.left + rect.width / 2;
    const y1 = rect.top + rect.height / 2;
    const dx = x - x1;
    const dy = y - y1;
    const length = Math.max(1, Math.hypot(dx, dy));
    const bend = Math.min(46, length * .12);
    const cx = (x1 + x) / 2 - (dy / length) * bend;
    const cy = (y1 + y) / 2 + (dx / length) * bend;
    svg.setAttribute('viewBox', `0 0 ${window.innerWidth} ${window.innerHeight}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    path.setAttribute('d', `M ${x1} ${y1} Q ${cx} ${cy} ${x} ${y}`);
    svg.classList.add('is-visible');
    this.root.querySelectorAll('.slot.is-target-candidate, .slot.is-target-blocked').forEach((slot) => slot.classList.remove('is-target-candidate', 'is-target-blocked'));
    const targetSlot = document.elementFromPoint(x, y)?.closest<HTMLElement>('.slot[data-slot-side]');
    const candidate = targetSlot?.classList.contains('enemy-slot') ? targetSlot : null;
    svg.classList.toggle('is-enemy-aim', targetSlot?.dataset.slotSide === 'enemy');
    svg.classList.toggle('is-player-aim', targetSlot?.dataset.slotSide !== 'enemy');
    const candidateSlot = Number(candidate?.dataset.slot);
    if (candidate && Number.isInteger(candidateSlot) && this.state.players.enemy.slots[candidateSlot]) {
      candidate.classList.add(isAttackTargetExposed(this.state, 'enemy', candidateSlot) ? 'is-target-candidate' : 'is-target-blocked');
    }
  }

  private hideAttackAim(drag: ActiveDrag): void {
    drag.origin.classList.remove('is-aiming');
    this.root.querySelector('#attack-aim-overlay')?.classList.remove('is-visible', 'is-player-aim', 'is-enemy-aim');
    this.root.querySelectorAll('.slot.is-target-candidate, .slot.is-target-blocked').forEach((slot) => slot.classList.remove('is-target-candidate', 'is-target-blocked'));
  }

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
    const origins = new Map<string, DOMRect>();
    for (const event of result.events) {
      if (event.type !== 'draw' && event.type !== 'move' && event.type !== 'place' && event.type !== 'return') continue;
      const source = event.type === 'draw'
        ? this.root.querySelector<HTMLElement>(event.side === 'player' ? '#draw-deck' : '.enemy-deck-display')
        : this.root.querySelector<HTMLElement>(`#game [data-card-id="${CSS.escape(event.instanceId)}"]`);
      if (source) origins.set(event.instanceId, source.getBoundingClientRect());
    }
    const attackProfiles = this.captureAttackProfiles(result.events, this.state);
    this.captureDestructions(result.events);
    this.state = result.state;
    if (result.events.some((event) => event.type === 'place' || event.type === 'spell' || event.type === 'return' || event.type === 'move' || event.type === 'target')) this.selectedId = null;
    this.render();
    this.animateCardTransfers(origins);
    this.playEvents(result.events, attackProfiles);
  }

  private animateCardTransfers(origins: Map<string, DOMRect>): void {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (const [id, from] of origins) {
      const target = this.root.querySelector<HTMLElement>(`#game [data-card-id="${CSS.escape(id)}"]`);
      if (!target) continue;
      const to = target.getBoundingClientRect();
      if (!from.width || !from.height || !to.width || !to.height) continue;
      const dx = from.x + from.width / 2 - to.x - to.width / 2;
      const dy = from.y + from.height / 2 - to.y - to.height / 2;
      const face = target.querySelector<HTMLElement>('.card-face');
      if (!face) continue;
      const ghost = document.createElement('div');
      ghost.className = 'card-transfer-ghost';
      ghost.setAttribute('aria-hidden', 'true');
      Object.assign(ghost.style, { left: `${to.x}px`, top: `${to.y}px`, width: `${to.width}px`, height: `${to.height}px` });
      ghost.append(face.cloneNode(true));
      document.body.append(ghost);
      const previousVisibility = target.style.visibility;
      target.style.visibility = 'hidden';
      const flight = ghost.animate([
        { transform: `translate(${dx}px,${dy}px) scale(${from.width / to.width},${from.height / to.height}) rotateY(-12deg)`, opacity: .85 },
        { transform: 'translate(0,-8px) scale(1.04) rotateY(5deg)', opacity: 1, offset: .78 },
        { transform: 'none', opacity: 1 },
      ], { duration: 560, easing: 'cubic-bezier(.2,.75,.25,1)' });
      const finish = () => { ghost.remove(); target.style.visibility = previousVisibility; };
      flight.onfinish = finish;
      flight.oncancel = finish;
    }
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
        const priorState = this.state;
        const result = advanceTime(this.state, delta);
        const attackProfiles = this.captureAttackProfiles(result.events, priorState);
        this.state = result.state;
        this.syncMatchFlowWithEngine();
        if (result.events.length) { this.captureDestructions(result.events); this.render(); this.playEvents(result.events, attackProfiles); }
      }
      this.renderMatchStatus();
      this.renderPhaseStatus();
      this.updateAttackCooldowns();
    }
    requestAnimationFrame(this.tick);
  };

  private captureAttackProfiles(events: GameEvent[], state: GameState): Map<string, AttackAnimationProfile | undefined> {
    const profiles = new Map<string, AttackAnimationProfile | undefined>();
    for (const event of events) {
      if (event.type !== 'attack') continue;
      const card = [...state.players.player.slots, ...state.players.enemy.slots].find((unit) => unit?.instanceId === event.attackerId);
      profiles.set(event.attackerId, card ? getCardDefinition(card.definitionId).attackAnimationProfile : undefined);
    }
    return profiles;
  }

  private playEvents(events: GameEvent[], attackProfiles = new Map<string, AttackAnimationProfile | undefined>()): void {
    let missionsChanged = false;
    for (const event of events) {
      if (event.type === 'attack') this.animateAttack(event, attackProfiles.get(event.attackerId));
      if (event.type === 'spell') this.animateSpell(event);
      if (event.type === 'place') this.animateEntry(event.instanceId);
      if (event.type === 'place' && event.side === 'player') { this.cardsPlaced += 1; missionsChanged = true; }
      if (event.type === 'damage') this.animateImpact(event.instanceId, event.amount);
      if (event.type === 'heal') this.animateHeal(event.instanceId, event.amount);
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
    if (missionsChanged) { this.saveProgression(); this.renderHome(); }
  }

  private animateAttack(event: Extract<GameEvent, { type: 'attack' }>, profile?: AttackAnimationProfile): void {
    const attacker = this.root.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(event.attackerId)}"]`);
    const targetId = event.targetId;
    const target = (targetId ? this.root.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(targetId)}"]`) : null)
      ?? (event.targetSlot !== undefined ? this.root.querySelector<HTMLElement>(`[data-slot-side="${event.targetSide}"][data-slot="${event.targetSlot}"]`) : null)
      ?? this.root.querySelector<HTMLElement>(event.targetSide === 'player' ? '#player-life-target' : '#enemy-life-target');
    if (!attacker || !target) return;
    const from = attacker.getBoundingClientRect(); const to = target.getBoundingClientRect();
    const dx = to.left + to.width / 2 - from.left - from.width / 2;
    const dy = to.top + to.height / 2 - from.top - from.height / 2;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const profileClass = attackProfileClass(profile);
    attacker.classList.remove('is-attacking', profileClass);
    attacker.style.setProperty('--attack-x', `${dx / distance * 16}px`);
    attacker.style.setProperty('--attack-y', `${dy / distance * 16}px`);
    attacker.classList.add('is-attacking', profileClass);
    const finishAttack = (animation: AnimationEvent) => {
      if (animation.target !== attacker) return;
      attacker.classList.remove('is-attacking', profileClass);
      attacker.style.removeProperty('--attack-x'); attacker.style.removeProperty('--attack-y');
      attacker.removeEventListener('animationend', finishAttack);
    };
    attacker.addEventListener('animationend', finishAttack);
    const projectile = document.createElement('i');
    projectile.className = attackProjectileClass(event.side, profile);
    projectile.style.left = `${from.left + from.width / 2}px`;
    projectile.style.top = `${from.top + from.height / 2}px`;
    projectile.style.setProperty('--dx', `${dx}px`);
    projectile.style.setProperty('--dy', `${dy}px`);
    document.body.appendChild(projectile);
    projectile.addEventListener('animationend', () => projectile.remove(), { once: true });
  }

  private captureDestructions(events: GameEvent[]): void {
    for (const event of events) {
      if (event.type !== 'damage' || !event.destroyed) continue;
      const target = this.root.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(event.instanceId)}"]`);
      if (!target) continue;
      const rect = target.getBoundingClientRect();
      const ghost = target.cloneNode(true) as HTMLElement;
      ghost.classList.add('destruction-ghost', 'is-destroyed', 'is-hit');
      const damage = document.createElement('span');
      damage.className = 'impact-number'; damage.textContent = `−${event.amount}`;
      ghost.appendChild(damage);
      ghost.style.left = `${rect.left}px`; ghost.style.top = `${rect.top}px`;
      ghost.style.width = `${rect.width}px`; ghost.style.height = `${rect.height}px`;
      document.body.appendChild(ghost);
      ghost.addEventListener('animationend', (animation) => { if (animation.target === ghost) ghost.remove(); });
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
    target.classList.remove('is-hit');
    void target.offsetWidth;
    target.classList.add('is-hit');
    const number = document.createElement('span');
    number.className = 'impact-number';
    number.textContent = `−${amount}`;
    target.appendChild(number);
    const finishImpact = (animation: AnimationEvent) => {
      if (animation.target !== target) return;
      target.classList.remove('is-hit', 'is-healing'); number.remove();
      target.removeEventListener('animationend', finishImpact);
    };
    target.addEventListener('animationend', finishImpact);
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
    const activeAim = this.drag;
    if (activeAim?.started && activeAim.source === 'board' && !player.slots.some((card) => card?.instanceId === activeAim.id)) {
      // A destroyed/moved attacker must not leave a live aim line behind.
      this.hideAttackAim(activeAim);
      this.drag = null;
    }
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
    this.setText('#enemy-deck-cycle', String(enemy.cycle));
    const playerLife = this.root.querySelector<HTMLElement>('#player-life-fill');
    const enemyLife = this.root.querySelector<HTMLElement>('#enemy-life-fill');
    if (playerLife) playerLife.style.height = `${Math.max(0, player.life / balance.startingLife * 100)}%`;
    if (enemyLife) enemyLife.style.height = `${Math.max(0, enemy.life / balance.startingLife * 100)}%`;
    const deck = this.root.querySelector<HTMLButtonElement>('#draw-deck');
    const canDraw = player.hand.length < balance.handLimit && player.deck.length > 0 && this.state.phase === 'playing';
    const needsDraw = shouldHighlightDeck({
      phase: this.state.phase, handCount: player.hand.length, handLimit: balance.handLimit,
      deckCount: player.deck.length, hasTroopInHand: player.hand.some((card) => getCardDefinition(card.definitionId).kind === 'troop'),
    });
    if (deck) {
      const drawStatus = player.deck.length === 0 ? 'Deck esgotado'
        : this.state.phase === 'finished' ? 'Partida encerrada'
          : this.state.phase !== 'playing' ? 'Aguarde o combate'
            : player.hand.length >= balance.handLimit ? 'Mão cheia'
              : `${player.deck.length} cartas · Comprar`;
      deck.parentElement?.setAttribute('data-draw-status', drawStatus);
      deck.title = drawStatus;
      deck.disabled = !canDraw;
      deck.classList.toggle('is-draw-suggested', needsDraw);
      deck.setAttribute('aria-label', `${drawStatus}${needsDraw ? '; sua mão não tem tropas' : ''}`);
    }
    const badge = this.root.querySelector<HTMLElement>('#deck-badge');
    if (badge) { const drawn = Math.min(balance.deckSize, player.cardsDrawn); badge.style.setProperty('--deck-progress', `${drawn / balance.deckSize * 100}%`); badge.setAttribute('aria-valuemax', String(balance.deckSize)); badge.setAttribute('aria-valuenow', String(drawn)); }
    const status = this.root.querySelector<HTMLElement>('#player-status');
    if (status) status.textContent = this.state.phase === 'finished' ? 'Partida encerrada'
      : this.state.phase === 'preparation' ? 'Preparação · combate suspenso'
        : this.state.phase === 'starting' ? 'Campo liberado · combate começando'
          : `${enemy.hand.length} cartas ocultas · sem acesso à mão adversária`;
    this.syncMatchFlowWithEngine();
    this.renderHome();
    this.renderPhaseStatus();
    this.syncSelection();
    this.updateAttackCooldowns();
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
      // A board drag only aims at a target; keep its troop mounted in the slot.
      // Removing it during a simulation render detaches the pointer anchor and
      // makes getBoundingClientRect() report (0, 0), drawing the aim arrow from
      // the top-left corner of the screen.
      const aimingCard = this.drag?.source === 'board' && this.drag.id === card?.instanceId;
      const displayedCard = card && (!this.isBeingDragged(card) || aimingCard) ? card : null;
      const isAttackTarget = side === 'enemy' && Boolean(displayedCard && this.state.players.player.slots.some((unit) => unit?.attackTargetId === displayedCard.instanceId) && isAttackTargetExposed(this.state, 'enemy', slot));
      const targetClass = isAttackTarget ? ' is-attack-target' : '';
      const filled = displayedCard ? this.unitMarkup(displayedCard, side) : `<span class="empty-rune" aria-hidden="true">✧<small>${row === front ? 'FRENTE' : 'RETAGUARDA'}</small></span>`;
      const label = `${side === 'player' ? 'Seu' : 'Adversário'}: ${row === front ? 'linha da frente' : 'retaguarda'}, coluna ${col + 1}${displayedCard ? `, ${getCardDefinition(displayedCard.definitionId).name}` : ', vazio'}`;
      let button = grid.children[slot] as HTMLButtonElement | undefined;
      if (!button || Number(button.dataset.slot) !== slot) {
        const template = document.createElement('template');
        template.innerHTML = `<button class="slot ${side === 'enemy' ? 'enemy-slot' : 'player-slot'}${targetClass}" type="button" data-slot-side="${side}" data-side="${side}" data-slot="${slot}" data-row="${row}" data-column="${col}" aria-label="${this.escapeAttribute(label)}">${filled}</button>`;
        const created = template.content.firstElementChild as HTMLButtonElement;
        if (button) grid.replaceChild(created, button); else grid.appendChild(created);
        button = created;
      } else {
        button.className = `slot ${side === 'enemy' ? 'enemy-slot' : 'player-slot'}${this.selectedId === displayedCard?.instanceId ? ' is-selected' : ''}${targetClass}`;
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
      if (displayedCard) {
        const unit = button.querySelector<HTMLElement>('.battle-card[data-card-id]');
        if (unit) this.syncAttackTargetStatus(unit, displayedCard, side);
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
      element.style.zIndex = selected ? '40' : String(20 - index);
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
    const measuredCardWidth = area?.querySelector<HTMLElement>('.hand-card')?.getBoundingClientRect().width;
    const cardWidth = measuredCardWidth && Number.isFinite(measuredCardWidth) ? measuredCardWidth : Math.min(95, Math.max(60, width * 0.31));
    const spacing = handFanSpacing(width, total, cardWidth);
    const offset = (index - (total - 1) / 2) * spacing;
    const angle = (index - (total - 1) / 2) * Math.min(2.1, 11 / Math.max(1, total - 1));
    const details = this.cardDetails(card);
    return `<button class="hand-card kind-${definition.kind}${this.selectedId === card.instanceId ? ' is-selected' : ''}" type="button" data-card-id="${card.instanceId}" data-side="player" data-foundation="${definition.foundation}" style="left:calc(50% + ${offset}px);--angle:${angle}deg;z-index:${this.selectedId === card.instanceId ? 40 : 20 - index}" aria-label="${this.escapeAttribute(`${details}. Selecionar ou arrastar`)}" title="${this.escapeAttribute(details)}">${renderCardFace(definition, card, 'player', 'hand')}</button>`;
  }

  private unitMarkup(card: CardInstance, side: Side, secret = false): string {
    const definition = getCardDefinition(card.definitionId);
    const details = this.cardDetails(card);
    const cooldown = definition.kind === 'troop' && !secret ? `<span class="attack-cooldown" data-cooldown-id="${card.instanceId}" aria-hidden="true"><i></i><small></small></span>` : '';
    const targetStatus = this.attackTargetStatus(card, side);
    const targetStatusMarkup = targetStatus ? `<span class="attack-target-status" data-attack-target-status role="status">${this.escapeAttribute(targetStatus)}</span>` : '';
    return `<div class="battle-card${side === 'enemy' ? ' enemy-unit' : ''}${secret ? ' sigil-card' : ''}" data-card-id="${card.instanceId}" data-side="${side}" data-foundation="${definition.foundation}" title="${this.escapeAttribute(details)}"><span class="damage-aura" aria-hidden="true"></span>${renderCardFace(definition, card, side, 'field')}${definition.kind === 'troop' && !secret ? '<span class="attack-cooldown-shade" data-cooldown-shade aria-hidden="true"></span>' : ''}${cooldown}${targetStatusMarkup}</div>`;
  }

  private attackTargetStatus(card: CardInstance, side: Side): string {
    if (side !== 'player' || !card.attackTargetId) return '';
    const targets = this.state.players.enemy.slots;
    const slot = targets.findIndex((target) => target?.instanceId === card.attackTargetId);
    if (slot < 0) return 'ALVO SAIU · AUTOMÁTICO';
    const target = targets[slot];
    if (!target || !isAttackTargetExposed(this.state, 'enemy', slot)) return 'ALVO PROTEGIDO · AUTOMÁTICO';
    return `ALVO: ${getCardDefinition(target.definitionId).name}`;
  }

  private syncAttackTargetStatus(element: HTMLElement, card: CardInstance, side: Side): void {
    const status = this.attackTargetStatus(card, side);
    let badge = element.querySelector<HTMLElement>('[data-attack-target-status]');
    if (!status) { badge?.remove(); return; }
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'attack-target-status';
      badge.dataset.attackTargetStatus = '';
      badge.setAttribute('role', 'status');
      element.append(badge);
    }
    badge.textContent = status;
    badge.classList.toggle('is-target-fallback', status.includes('AUTOMÁTICO'));
    badge.setAttribute('aria-label', status.includes('AUTOMÁTICO')
      ? `${status}. A unidade retomou o alvo automático porque o alvo escolhido não está disponível.`
      : `Esta tropa prioriza ${status.slice('ALVO: '.length)}.`);
  }

  private updateAttackCooldowns(): void {
    this.root.querySelectorAll<HTMLElement>('.attack-cooldown[data-cooldown-id]').forEach((indicator) => {
      const cardId = indicator.dataset.cooldownId;
      const card = cardId ? [...this.state.players.player.slots, ...this.state.players.enemy.slots].find((unit) => unit?.instanceId === cardId) : undefined;
      const fill = indicator.querySelector<HTMLElement>('i');
      const label = indicator.querySelector<HTMLElement>('small');
      const shade = indicator.closest<HTMLElement>('.battle-card')?.querySelector<HTMLElement>('[data-cooldown-shade]');
      if (!card || !fill || !label) return;
      if (this.state.phase !== 'playing') {
        label.textContent = this.state.phase === 'preparation' ? 'PREP' : this.state.phase === 'starting' ? '...' : '';
        fill.style.transform = 'scaleX(0)';
        shade?.classList.remove('is-cooling');
        return;
      }
      const remaining = Math.max(0, card.nextAttackAtMs - this.state.clockMs);
      const interval = attackIntervalFor(card.definitionId, this.state.attackIntervalMs);
      const progress = remaining === 0 ? 1 : 1 - Math.min(1, remaining / interval);
      fill.style.transform = `scaleX(${progress})`;
      label.textContent = remaining === 0 ? 'PRONTO' : `ATAQUE ${Math.ceil(remaining / 1000)}s`;
      if (shade) {
        shade.style.setProperty('--cooldown-angle', `${cooldownSweepDegrees(remaining, interval)}deg`);
        shade.classList.toggle('is-cooling', remaining > 0);
      }
    });
  }

  private showPreview(instanceId: string, side: Side, mode: 'deck' | 'quick' = 'deck'): void {
    const card = [...this.deckPreviewCards, ...this.state.players[side].hand, ...this.state.players[side].deck, ...this.state.players[side].slots.filter((item): item is CardInstance => Boolean(item)), ...this.state.players[side].sigils.filter((item): item is CardInstance => Boolean(item))].find((item) => item.instanceId === instanceId);
    if (!card) return;
    const definition = getCardDefinition(card.definitionId);
    const overlay = this.root.querySelector<HTMLElement>('#card-preview-overlay');
    const wrap = this.root.querySelector<HTMLElement>('#card-preview-wrap');
    if (!overlay || !wrap) return;
    if (mode === 'quick') {
      const kind = definition.kind === 'troop' ? 'Tropa' : definition.kind === 'spell' ? 'Feitiço' : 'Sigilo';
      const description = this.descriptionFor(definition);
      const facts = definition.kind === 'troop'
        ? `<span><b>Ataque</b> ${definition.attack}</span><span><b>Vida</b> ${card.health}/${definition.maxHealth}</span>`
        : definition.kind === 'spell'
          ? `<span><b>Custo</b> ${definition.cost}</span><span><b>Efeito</b> ${definition.effect === 'damage' ? `${balance.spellDamage} de dano` : `${balance.spellHealing} de cura`}</span>`
          : `<span><b>Custo</b> ${definition.cost}</span><span><b>Efeito</b> Sigilo oculto</span>`;
      const behavior = definition.kind === 'troop'
        ? 'Ataca automaticamente após a recarga. Um alvo escolhido pode ser bloqueado por uma tropa à frente na mesma coluna.'
        : description;
      wrap.innerHTML = `<div class="quick-card-preview"><div class="preview-shell ${definition.kind}" data-foundation="${definition.foundation}">${renderCardFace(definition, card, side, 'preview')}</div><section class="card-preview-details"><div class="card-preview-heading"><strong>${this.escapeAttribute(definition.name)}</strong><span>${kind}</span></div><div class="card-preview-facts">${facts}</div><p>${this.escapeAttribute(description)}</p><p class="card-preview-how">${this.escapeAttribute(behavior)}</p><button class="card-preview-close" id="close-card-preview" type="button">Fechar</button></section></div>`;
      overlay.classList.add('open'); overlay.setAttribute('aria-hidden', 'false');
      return;
    }
    const typeName = definition.kind === 'troop' ? 'Tropa' : definition.kind === 'spell' ? 'Feitiço' : 'Sigilo';
    const description = this.descriptionFor(definition);
    const stats = deckStatsFor(definition);
    const chart = stats.length
      ? `<div class="deck-stat-chart" aria-label="Status atuais e valores após a próxima melhoria">${stats.map((stat) => {
          const max = Math.max(1, stat.nextLevel);
          const currentWidth = Math.max(8, stat.current / max * 100);
          return `<div class="deck-stat-row"><div><b>${stat.label}</b><span><strong>${stat.current}</strong><i> → </i><strong>${stat.nextLevel}</strong></span></div><div class="deck-stat-track" aria-hidden="true"><i class="deck-stat-next" style="width:100%"></i><i class="deck-stat-current" style="width:${currentWidth}%"></i></div></div>`;
        }).join('')}</div>`
      : `<p class="deck-stat-empty">${definition.kind === 'hidden' ? 'Status e efeito ainda não definidos para este sigilo.' : `Custo: ${definition.cost}.`}</p>`;
    const suggestions = synergiesFor(definition.id);
    const synergyMarkup = suggestions.length
      ? suggestions.map(({ definition: suggestion, reason }) => `<article class="deck-synergy-item"><div class="deck-synergy-card" data-foundation="${suggestion.foundation}">${renderCardFace(suggestion, { ...card, instanceId: `suggestion-${suggestion.id}`, definitionId: suggestion.id, health: suggestion.maxHealth }, side, 'preview')}</div><div><b>${this.escapeAttribute(suggestion.name)}</b><p>${this.escapeAttribute(reason)}</p></div></article>`).join('')
      : '<p class="deck-stat-empty">Ainda não há sugestões para esta carta.</p>';
    const level = (this.cardLevels[definition.id] ?? 0) + 1;
    const tickets = this.cardTickets[definition.id] ?? 0;
    const progression = definition.kind === 'hidden'
      ? 'A progressão e os atributos deste sigilo ainda não foram definidos.'
      : `Nível ${level}; ${tickets} ticket${tickets === 1 ? '' : 's'} desta carta disponíveis.`;
    const facts = definition.kind === 'troop'
      ? `<span><b>Ataque</b> ${definition.attack}</span><span><b>Vida</b> ${card.health}/${definition.maxHealth}</span>`
      : definition.kind === 'spell'
        ? `<span><b>Custo</b> ${definition.cost}</span><span><b>${definition.effect === 'damage' ? 'Dano' : 'Cura'}</b> ${definition.spellAmount ?? (definition.effect === 'damage' ? balance.spellDamage : balance.spellHealing)}</span>`
        : `<span><b>Custo</b> ${definition.cost}</span><span><b>Efeito</b> A definir</span>`;
    const howItWorks = definition.kind === 'troop'
      ? 'Ataca automaticamente quando sua recarga termina. Você pode escolher uma tropa inimiga exposta para priorizar; uma tropa na frente protege a retaguarda da mesma coluna.'
      : definition.kind === 'spell'
        ? definition.effect === 'damage' ? 'Selecione a carta e escolha uma tropa inimiga ou a vida adversária para aplicar o dano indicado.' : 'Selecione a carta e escolha uma tropa aliada ferida ou sua vida para aplicar a cura indicada.'
        : 'Pode ser colocada em um espaço de sigilo e revelada durante a partida. O efeito de ativação ainda não foi definido nesta versão.';
    wrap.innerHTML = `<div class="card-preview-content"><section class="deck-inspect-panel deck-inspect-progression" aria-label="Status e evolução da carta"><div class="deck-inspect-kicker">STATUS DA CARTA</div><h2>Progressão</h2><div class="deck-level-row"><strong>NÍVEL ${level}</strong><span>${definition.kind === 'hidden' ? 'EM DEFINIÇÃO' : `${tickets} tickets`}</span></div><div class="deck-level-track" aria-hidden="true"><i style="width:${Math.min(100, tickets / 5 * 100)}%"></i></div><small class="deck-preview-note">Cada melhoria consome 5 tickets exclusivos desta carta.</small><h3>Atributos <span>atual <i>·</i> próxima melhoria</span></h3>${chart}${definition.kind !== 'hidden' ? `<button class="card-preview-close card-upgrade" id="upgrade-card" data-definition-id="${definition.id}" type="button" ${tickets < 5 || level >= 11 ? 'disabled' : ''}>Melhorar · 5 tickets</button>` : ''}</section><div class="deck-inspect-main"><div class="deck-inspect-card-row"><div class="preview-shell ${definition.kind}" data-foundation="${definition.foundation}" aria-label="${this.escapeAttribute(this.cardDetails(card))}">${renderCardFace(definition, card, 'player', 'preview')}</div><section class="card-preview-details" aria-label="Ficha resumida de ${this.escapeAttribute(definition.name)}"><div class="card-preview-heading"><strong>${this.escapeAttribute(definition.name)}</strong><span>${typeName} · CUSTO ${definition.cost}</span></div><div class="card-preview-facts">${facts}</div></section></div><section class="deck-inspect-copy" aria-label="Informações de ${this.escapeAttribute(definition.name)}"><p>${this.escapeAttribute(description)}</p><p class="card-preview-how"><b>Como funciona:</b> ${this.escapeAttribute(howItWorks)}</p><small class="deck-progression-caption">${this.escapeAttribute(progression)}</small><button class="card-preview-close" id="close-card-preview" type="button">Fechar ficha</button></section></div><section class="deck-inspect-panel deck-inspect-synergy" aria-label="Sugestões de sinergia"><div class="deck-inspect-kicker">COMPOSIÇÃO DO DECK</div><h2>Sinergias</h2><div class="deck-synergy-list">${synergyMarkup}</div><small class="deck-preview-note">Sugestões demonstrativas, sem bônus ou efeitos no combate.</small></section></div>`;
    overlay.classList.add('open'); overlay.setAttribute('aria-hidden', 'false');
  }

  private cardDetails(card: CardInstance): string {
    const definition = getCardDefinition(card.definitionId);
    const kind = definition.kind === 'troop' ? 'tropa' : definition.kind === 'hidden' ? 'sigilo' : 'feitiço';
    const values = [definition.name, kind, `custo ${definition.cost}`];
    if (definition.kind === 'troop') values.push(`${definition.attack} ataque`, `${card.health} vida`);
    else if (definition.kind === 'spell') values.push(`${definition.spellAmount ?? (definition.effect === 'damage' ? balance.spellDamage : balance.spellHealing)} ${definition.effect === 'damage' ? 'dano' : 'cura'}`);
    else values.push('efeito ainda não definido nesta versão');
    values.push(this.descriptionFor(definition));
    return values.join(' · ');
  }

  private descriptionFor(definition: ReturnType<typeof getCardDefinition>): string {
    if (definition.kind !== 'spell') return definition.description;
    const amount = definition.spellAmount ?? (definition.effect === 'damage' ? balance.spellDamage : balance.spellHealing);
    return definition.description.replace(/\d+/, String(amount));
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
