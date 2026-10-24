import { cardEffects } from './card-effects.ts';
import { cardDefinitions, getCardDefinition } from '../game/cards.ts';
import { activateSigil, assignAllyLink, assignDirectAttackTarget, assignAttackTarget, beginPreparation, castSpell, drawCard, moveTroop, placeCard, placeSigil, returnTroop, revealSigil } from '../game/engine.ts';
import { effectiveAttack, effectiveAttackInterval, maxHealthFor } from '../game/combat-rules.ts';
import { advanceTime } from '../game/simulation.ts';
import { frontRow, isAttackTargetExposed } from '../game/targeting.ts';
import { attackIntervalFor, balance, boardSlotCount, topology } from '../game/config.ts';
import type { AiProfileId, CardInstance, GameEvent, GameState, Side, SpellTarget, Transition } from '../game/types.ts';
import { advanceMatchFlow, beginDemoMatchSearch, cancelDemoMatchSearch, createMatchFlow, isPreparationActionAllowed, sessionConfig, setMatchFlowPhase } from '../game/session-flow.ts';
import type { MatchFlowState } from '../game/session-flow.ts';
import { renderCardBack, renderCardFace, renderDeckCardBack } from './card-presentation.ts';
import { getOpponentProfile, opponentProfiles } from '../game/opponents.ts';
import { attackProfileClass, attackProjectileClass, cooldownSweepDegrees, handFanSpacing, shouldHighlightDeck } from './combat-presentation.ts';
import { BattleEffects3D } from './effects-3d.ts';
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
  private selectedSigilSlot: number | null = null;
  private deckIds: string[] = [];
  private readonly deckStorageKey = 'trindade.battle-deck.v2';
  private theme = 'mineral';
  private aiProfileId: AiProfileId = 'carmesim';
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
  private selectedCollectionIds: string[] = [];
  private longPressTimer: number | undefined;
  private cardTickets: Record<string, number> = {};
  private cardLevels: Record<string, number> = {};
  private claimedMissions = new Set<string>();
  private readonly progressionStorageKey = 'trindade.card-progression.v1';
  private pendingSigilFlips = new Map<string, HTMLElement>();
  private pendingSigilFlipSlots = new Map<string, HTMLElement>();
  private activeRevealedSigils = new Map<string, { card: CardInstance; side: Side; slot: number; ability?: string; untilClockMs: number; untilWallMs: number }>();
  private pendingSpellOrigins = new Map<string, DOMRect>();
  private pendingSpellFaces = new Map<string, string>();
  private fireballHitIds = new Set<string>();
  private effects3d: BattleEffects3D | null = null;
  private revealResolutionPending = false;

  constructor(root: HTMLElement) {
    this.root = root;
    this.loadProgression();
    try {
      const savedProfile = localStorage.getItem('trindade.ai-profile.v1') as AiProfileId | null;
      if (savedProfile && opponentProfiles.some((profile) => profile.id === savedProfile)) this.aiProfileId = savedProfile;
    } catch { /* The default training opponent is used when storage is unavailable. */ }
    this.deckPreviewCards = cardDefinitions.flatMap((definition) => Array.from({ length: 3 }, (_, index) => ({
      instanceId: `collection-${definition.id}-${index + 1}`,
      definitionId: definition.id,
      owner: 'player' as const,
      health: definition.maxHealth,
      nextAttackAtMs: 0,
      revealed: false,
    })));
    this.loadDeck();
    const seed = new Uint32Array(1);
    crypto.getRandomValues(seed);
    this.state = createGameImported(seed[0], this.deckIds);
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
            <div class="home-hero"><div class="hero-kicker"><i></i> ARENA EXPERIMENTAL · IA LOCAL</div><div class="hero-emblem" aria-hidden="true">${sigil}</div><h1>As três forças<br>se encontram.</h1><p>Monte sua formação e escolha um adversário de treino com deck e estratégia próprios.</p><div class="hero-facts"><span><b>3 × 2</b> arena</span><span><b>${balance.deckSize}</b> cartas</span><span><b>3</b> estilos de IA</span></div><label class="opponent-picker" for="ai-profile">Adversário de treino<select id="ai-profile">${opponentProfiles.map((profile) => `<option value="${profile.id}"${profile.id === this.aiProfileId ? ' selected' : ''}>${profile.name} — ${profile.style}</option>`).join('')}</select></label><button class="battle-cta" id="start-battle" type="button"><span class="battle-cta-icon" aria-hidden="true">⚔</span><span><strong>BATALHA</strong><small>Encontrar adversário</small></span><span class="battle-cta-arrow" aria-hidden="true">→</span></button>
              <div class="match-panel" id="match-panel" hidden aria-live="polite"><div class="match-orbit" aria-hidden="true"><span>${sigil}</span></div><div class="match-copy"><strong id="match-title">Buscando adversário</strong><small id="match-detail">Partida experimental contra IA local</small></div><strong class="match-countdown" id="match-countdown" hidden></strong><button class="cancel-search" id="cancel-search" type="button">Cancelar busca</button></div>
              <div class="hero-disclaimer">Esta versão usa IA local. Ainda não existe PvP online.</div>
            </div>
            <div class="home-section-heading"><span>CAMINHO DE TREINO</span><span>SESSÃO LOCAL</span></div>
            <button class="home-shortcut" data-home-tab="missions" type="button"><span class="shortcut-glyph">✧</span><span><strong>Missões e tickets</strong><small>Conclua objetivos para melhorar cartas</small></span><span class="shortcut-arrow">→</span></button>
          </section>
          <section class="home-page" data-home-page="deck" hidden>
            <div class="page-heading"><span class="page-overline">PREPARAÇÃO</span><h1>Seu deck</h1><p>Escolha as cartas do seu deck. Todas estão disponíveis para teste.</p></div>
            <div class="deck-summary"><div><strong id="deck-builder-count">${balance.deckSize}/${balance.deckSize}</strong><span>cartas no deck de batalha</span></div><div><strong>${cardDefinitions.length * 3}</strong><span>cartas individuais na coleção</span></div></div>
            <div class="experimental-note"><b>Coleção de cartas</b><span>Selecione cada cópia física individualmente para montar um deck de ${balance.deckSize}. A escolha fica salva neste dispositivo.</span></div>
            <div class="deck-grid" id="deck-grid" aria-label="Coleção de ${cardDefinitions.length * 3} cartas individuais"></div>
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
            <div class="status-stack"><div class="status-title" id="enemy-name">Casa Carmesim</div><div class="status-sub" id="enemy-status-sub" role="status" aria-live="polite">Adversário experimental</div></div>
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
        <div class="overlay" id="help-overlay" aria-hidden="true"><div class="help-panel"><div class="help-tag">Experimento separado · versão jogável inicial</div><h2>Como experimentar</h2><p><b>Comprar:</b> toque no deck enquanto houver espaço na mão (máximo de ${balance.handLimit} cartas).</p><p><b>Posicionar:</b> arraste uma tropa a um espaço vazio. A linha próxima do centro protege a linha posterior na mesma coluna.</p><p><b>Ordens:</b> arraste suas tropas para mover ou recolher. Na frente, atacam automaticamente. Na retaguarda, selecione a tropa e toque no alvo inimigo; a Raposa mostra o aliado vinculado, e o Goblin pode escolher a vida inimiga para ataque direto e cura.</p><p><b>Necromancia:</b> o Morto Vivo volta uma vez no espaço onde foi eliminado, com 2 de vida. Enquanto permanecer viva, a Bruxa invoca um Morto Vivo (1 ataque, 2 de vida) quando qualquer tropa aliada morrer em qualquer espaço do seu campo; cada Bruxa faz isso uma vez por vida. A chamada aparece em uma faixa grande sobre a arena.</p><p><b>Feitiços:</b> a Bola de Fogo parte da carta na sua mão, cruza o campo como uma esfera flamejante e atinge a tropa selecionada e outra da coluna. Cura Equivalente recupera o último dano registrado, até 4 pontos, em uma tropa aliada.</p><p><b>Ocultas:</b> Espinhos reage automaticamente a ataques contra tropas; Raízes reage à movimentação ou pode ser direcionada por toque; Vulcão é manual e atinge tropas dos dois lados em três ondas.</p><p><b>Combate:</b> cada tropa tem sua recarga individual exibida na carta (de ${minAttackInterval.toFixed(2)} a ${maxAttackInterval.toFixed(2)} segundos). Os custos são somente demonstrativos; não há mana.</p><p><b>Adversários de treino:</b> escolha Casa Carmesim (equilibrada), Bastião Verde (defensivo) ou Matilha Rubra (agressiva). São três decks e prioridades de campo locais; os números são experimentais.</p><button class="close-help" id="close-help" type="button">Entendi</button></div></div>
        <div class="overlay" id="palette-overlay" aria-hidden="true"><div class="help-panel"><div class="help-tag">Identidade visual V3</div><h2>Atmosfera da arena</h2><div class="theme-option-grid"><button type="button" class="theme-btn active" data-theme-set="mineral">Verde mineral</button><button type="button" class="theme-btn" data-theme-set="abissal">Azul abissal</button><button type="button" class="theme-btn" data-theme-set="rubro">Rubro arcano</button></div><button class="close-help" id="close-palette" type="button">Voltar à arena</button></div></div>
        <div class="overlay" id="result-overlay" aria-hidden="true"><div class="help-panel"><div class="help-tag">Fim da partida</div><h2 id="result-title">Vitória</h2><p id="result-copy"></p><button class="close-help" id="play-again" type="button">Voltar ao início</button></div></div>
      </main><svg class="attack-aim-overlay" id="attack-aim-overlay" aria-hidden="true"><defs><marker id="attack-arrowhead" markerWidth="18" markerHeight="18" refX="15" refY="9" markerUnits="userSpaceOnUse" orient="auto"><path d="M1 2L16 9L1 16L5 9Z"></path></marker></defs><path id="attack-aim-line" d=""></path></svg><div class="overlay card-preview-overlay" id="card-preview-overlay" aria-hidden="true"><div class="card-preview-wrap" id="card-preview-wrap"></div></div><div class="transition-curtain" id="transition-curtain" aria-hidden="true"></div></div>`;
    this.renderDeckLibrary();
    this.renderHome();
    if (!this.effects3d) this.effects3d = new BattleEffects3D();
  }

  private bindEvents(): void {
    this.root.addEventListener('click', this.onClick);
    this.root.querySelector<HTMLSelectElement>('#ai-profile')?.addEventListener('change', (event) => {
      const value = (event.currentTarget as HTMLSelectElement).value as AiProfileId;
      if (!opponentProfiles.some((profile) => profile.id === value)) return;
      this.aiProfileId = value;
      try { localStorage.setItem('trindade.ai-profile.v1', value); } catch { /* Choice still applies for this session. */ }
    });
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

  private setHomeTab(tab: 'home' | 'deck' | 'missions'): void {
    if (this.matchHasStarted) return;
    this.activeHomeTab = tab;
    this.renderHome();
    this.root.querySelector<HTMLElement>('#home-scroll')?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  private startDemoSearch(): void {
    if (this.matchHasStarted || this.matchFlow.phase !== 'idle') return;
    if (this.deckIds.length !== balance.deckSize) { this.setHomeTab('deck'); this.toast(`Complete seu deck: ${this.deckIds.length}/${balance.deckSize} cartas.`); return; }
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
    this.state = beginPreparation(createGameImported(seed[0], this.deckIds, this.aiProfileId)).state;
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
    this.activeRevealedSigils.clear();
    this.effects3d?.clear();
    window.clearTimeout(this.toastTimer);
    const toast = this.root.querySelector<HTMLElement>('#toast');
    if (toast) { toast.textContent = ''; toast.classList.remove('visible'); }
    this.matchFlow = createMatchFlow();
    this.matchHasStarted = false;
    this.matchResultRecorded = false;
    this.selectedId = null;
    const seed = new Uint32Array(1);
    crypto.getRandomValues(seed);
    this.state = createGameImported(seed[0], this.deckIds, this.aiProfileId);
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
        : this.matchFlow.phase === 'found' ? `${getOpponentProfile(this.aiProfileId).name} · ${getOpponentProfile(this.aiProfileId).style}.`
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
    this.setText('#deck-builder-count', `${this.deckIds.length}/${balance.deckSize}`);
    grid.innerHTML = this.deckPreviewCards.map((card) => {
      const definition = getCardDefinition(card.definitionId);
      const selected = this.selectedCollectionIds.includes(card.instanceId);
      const copy = Number(card.instanceId.split('-').at(-1));
      const level = this.cardLevels[card.instanceId] ?? 1;
      return `<article class="deck-builder-card${selected ? ' is-in-deck' : ''}"><button class="deck-card-tile" type="button" data-card-inspect="${this.escapeAttribute(card.instanceId)}" aria-label="Ver detalhes da cópia ${copy} de ${this.escapeAttribute(definition.name)}">${renderCardFace(definition, card, 'player', 'preview')}<span class="deck-card-inspect-hint" aria-hidden="true">ⓘ Detalhes</span></button><div class="deck-copy-meta"><span>Cópia ${copy}</span><span>Nível ${level}</span></div><button class="deck-copy-toggle${selected ? ' is-selected' : ''}" type="button" data-deck-toggle="${this.escapeAttribute(card.instanceId)}" aria-pressed="${selected}" ${!selected && this.deckIds.length >= balance.deckSize ? 'disabled' : ''}>${selected ? 'No deck' : 'Adicionar ao deck'}</button></article>`;
    }).join('');
  }

  private loadDeck(): void {
    const allCollectionIds = this.deckPreviewCards.map((card) => card.instanceId);
    const defaultCollectionIds = allCollectionIds.slice(0, balance.deckSize);
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(this.deckStorageKey) ?? 'null');
      const legacy: unknown = JSON.parse(localStorage.getItem('trindade.battle-deck.v1') ?? 'null');
      const value = Array.isArray(saved) ? saved : legacy;
      if (Array.isArray(value) && value.length <= balance.deckSize && value.every(id => typeof id === 'string' && (allCollectionIds.includes(id) || cardDefinitions.some((definition) => definition.id === id)))) {
        const chosen: string[] = [];
        for (const id of value) {
          if (allCollectionIds.includes(id) && !chosen.includes(id)) chosen.push(id);
          else if (cardDefinitions.some((definition) => definition.id === id)) {
            const copy = this.deckPreviewCards.find((card) => card.definitionId === id && !chosen.includes(card.instanceId));
            if (copy) chosen.push(copy.instanceId);
          } else { chosen.length = 0; break; }
        }
        this.selectedCollectionIds = chosen;
      } else this.selectedCollectionIds = defaultCollectionIds;
    } catch { this.selectedCollectionIds = defaultCollectionIds; }
    this.deckIds = this.selectedCollectionIds.map((id) => this.deckPreviewCards.find((card) => card.instanceId === id)!.definitionId);
    try { localStorage.setItem(this.deckStorageKey, JSON.stringify(this.selectedCollectionIds)); } catch { /* Session remains playable. */ }
  }

  private toggleDeckCard(collectionId: string): void {
    const card = this.deckPreviewCards.find((item) => item.instanceId === collectionId);
    if (!card) return;
    const index = this.selectedCollectionIds.indexOf(collectionId);
    if (index >= 0) this.selectedCollectionIds.splice(index, 1);
    else if (this.selectedCollectionIds.length < balance.deckSize) this.selectedCollectionIds.push(collectionId);
    this.deckIds = this.selectedCollectionIds.map((id) => this.deckPreviewCards.find((item) => item.instanceId === id)!.definitionId);
    try { localStorage.setItem(this.deckStorageKey, JSON.stringify(this.selectedCollectionIds)); } catch { /* Session remains playable. */ }
    this.renderDeckLibrary();
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
    this.setText('#enemy-name', getOpponentProfile(this.aiProfileId).name);
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
    if (this.revealResolutionPending) { event.preventDefault(); return; }
    if (event.detail > 0 && performance.now() < this.suppressClickUntil) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLElement>('button');
    if (!button) return;
    if (button.dataset.deckToggle) { this.toggleDeckCard(button.dataset.deckToggle); return; }
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
    if (button.id === 'close-card-preview' || button.hasAttribute('data-close-card-preview')) { this.closeOverlay('card-preview-overlay'); return; }
    if (button.id === 'upgrade-card') { this.toast('Balanceamento de teste: todas as cartas usam seus atributos base.'); return; }
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
    this.selectedSigilSlot = null;
    this.selectedId = this.selectedId === instanceId ? null : instanceId;
    this.syncSelection();
    if (definition.kind === 'spell') this.toast(definition.effect === 'damage' ? 'Toque em uma tropa inimiga; a outra da coluna também recebe dano.' : 'Toque em uma tropa aliada com um último golpe registrado.');
    else if (definition.kind === 'hidden') this.toast('Escolha um espaço de sigilo vazio.');
  }

  private activateSlot(side: Side, slot: number): void {
    if (this.state.phase !== 'playing' && this.state.phase !== 'preparation') return;
    if (side === 'enemy') {
      if (this.selectedSigilSlot !== null) { const selected = this.selectedSigilSlot; this.selectedSigilSlot = null; this.transition(activateSigil(this.state, 'player', selected, slot), 'Escolha uma tropa inimiga válida.'); return; }
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
      if (selectedBoard >= 0 && getCardDefinition(this.state.players.player.slots[selectedBoard]!.definitionId).ability === 'mystic-link') { this.transition(assignAllyLink(this.state, 'player', selectedBoard, slot), 'Para vincular, deixe a Raposa na retaguarda e toque em outra tropa aliada. Para mover, escolha um espaço vazio.'); return; }
      if (selectedBoard >= 0) { this.toast('Para reposicionar, escolha um espaço vazio. Para vincular um aliado, selecione a Raposa Mística na retaguarda.'); return; }
      if (!this.selectedId) {
        this.selectedId = fieldCard.instanceId; this.syncSelection();
        if (getCardDefinition(fieldCard.definitionId).ability === 'mystic-link') this.toast('Raposa selecionada: toque em outra tropa aliada para vincular, ou arraste para um espaço vazio para reposicionar.');
        return;
      }
    }
    if (fieldCard && this.isSelectedSpell('heal')) this.tryCast({ kind: 'unit', side: 'player', slot });
  }

  private activateSigil(side: Side, slot: number): void {
    if (side === 'player') {
      const activeKey = `player:${slot}`;
      const activeEntry = this.activeRevealedSigils.get(activeKey);
      if (activeEntry && this.getSigilRemainingMs(activeKey, activeEntry.card.instanceId) > 0) {
        this.toast('Aguarde o efeito deste sigilo terminar.');
        return;
      }
      const selected = this.selectedId ? this.state.players.player.hand.find((card) => card.instanceId === this.selectedId) : undefined;
      if (selected && getCardDefinition(selected.definitionId).kind === 'hidden') {
        this.transition(placeSigil(this.state, 'player', selected.instanceId, slot), 'Esse espaço de sigilo já está ocupado.');
        return;
      }
      const card = this.state.players.player.sigils[slot];
      if (!card) return;
      if (card.definitionId === 'sleeping-thorns') { this.toast('Espinhos: ativação automática ao atacarem uma tropa aliada.'); return; }
      if (card.definitionId === 'vesper-blade') { this.selectedId = null; this.selectedSigilSlot = slot; this.toast('Raízes: toque em uma tropa inimiga.'); return; }
      this.selectedSigilSlot = null;
      this.transition(revealSigil(this.state, 'player', slot), 'Aguarde o início do combate. O Vulcão atinge ambos os lados!');
    }
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
    const source = this.root.querySelector<HTMLElement>(`#hand-area [data-card-id="${CSS.escape(this.selectedId)}"]`);
    if (source) {
      this.pendingSpellOrigins.set(this.selectedId, source.getBoundingClientRect());
      const face = source.querySelector<HTMLElement>('.card-face');
      if (face) this.pendingSpellFaces.set(this.selectedId, face.outerHTML);
    }
    this.selectedId = null;
    this.transition(result);
  }

  private tryTargetLife(side: Side): void {
    if (!this.selectedId) return;
    const boardSlot = this.findPlayerBoardSlot(this.selectedId);
    if (side === 'enemy' && boardSlot >= 0) { this.transition(assignDirectAttackTarget(this.state, 'player', boardSlot), 'Somente o Goblin da retaguarda pode escolher ataque direto.'); return; }
    const spell = this.state.players.player.hand.find((card) => card.instanceId === this.selectedId);
    if (!spell || getCardDefinition(spell.definitionId).kind !== 'spell') return;
    this.tryCast({ kind: 'life', side });
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (this.revealResolutionPending) { event.preventDefault(); return; }
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
      if (drag.source === 'hand') {
        const handCard = this.state.players.player.hand.find((card) => card.instanceId === drag.id);
        if (handCard && getCardDefinition(handCard.definitionId).kind === 'spell') {
          this.pendingSpellOrigins.set(drag.id, drag.origin.getBoundingClientRect());
          const face = drag.origin.querySelector<HTMLElement>('.card-face');
          if (face) this.pendingSpellFaces.set(drag.id, face.outerHTML);
        }
        this.restoreDraggedCard(drag, false);
      } else this.hideAttackAim(drag);
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
      const kind = getCardDefinition(handCard.definitionId).kind;
      if (kind === 'spell' && target.dataset.slotSide && target.dataset.slotKind !== 'sigil') {
        const targetSide = target.dataset.slotSide as Side;
        this.selectedId = instanceId;
        const effect = getCardDefinition(handCard.definitionId).effect;
        if ((effect === 'damage' && targetSide === 'enemy') || (effect === 'heal' && targetSide === 'player')) {
          this.tryCast({ kind: 'unit', side: targetSide, slot: Number(target.dataset.slot) });
        }
        return;
      }
      if (target.dataset.slotSide === 'player') {
        if (kind === 'troop') this.transition(placeCard(this.state, 'player', instanceId, Number(target.dataset.slot)));
        else if (kind === 'hidden' && target.dataset.slotKind === 'sigil') {
          const slot = Number(target.dataset.slot);
          const activeKey = `player:${slot}`;
          const activeEntry = this.activeRevealedSigils.get(activeKey);
          if (activeEntry && this.getSigilRemainingMs(activeKey, activeEntry.card.instanceId) > 0) {
            this.toast('Aguarde o efeito deste sigilo terminar.');
            return;
          }
          this.transition(placeSigil(this.state, 'player', instanceId, slot));
        }
      } else if (target.id === 'enemy-life-target' || target.id === 'player-life-target') {
        if (kind === 'spell') { this.selectedId = instanceId; this.tryCast({ kind: 'life', side: target.id === 'enemy-life-target' ? 'enemy' : 'player' }); }
      }
      return;
    }
    const from = this.findPlayerBoardSlot(instanceId);
    if (from < 0 || !target) return;
    if (target.id === 'hand-area') this.transition(returnTroop(this.state, 'player', from), 'A mão está cheia ou a carta não pode ser recolhida.');
    else if (target.dataset.slotSide === 'player') {
      const destination = Number(target.dataset.slot);
      const source = this.state.players.player.slots[from];
      const occupant = this.state.players.player.slots[destination];
      if (occupant && source && getCardDefinition(source.definitionId).ability === 'mystic-link') {
        this.transition(assignAllyLink(this.state, 'player', from, destination), 'A Raposa precisa estar na retaguarda e o alvo deve ser outra tropa aliada.');
      } else if (occupant) this.toast('Destino ocupado. Solte em um espaço vazio para reposicionar.');
      else this.transition(moveTroop(this.state, 'player', from, destination), 'Não foi possível reposicionar essa tropa.');
    }
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
    if (result.events.some((event) => event.type === 'reveal' || event.type === 'spell')) {
      const attackProfiles = this.captureAttackProfiles(result.events, this.state);
      this.captureSigilFlips(result.events, this.state);
      this.revealResolutionPending = true;
      void this.resolveAfterSigilReveal(result, attackProfiles);
      return;
    }
    const origins = this.captureTransferOrigins(result.events);
    const attackProfiles = this.captureAttackProfiles(result.events, this.state);
    this.captureSigilFlips(result.events, this.state);
    this.captureDestructions(result.events);
    this.state = result.state;
    this.syncMatchFlowWithEngine();
    if (result.events.some((event) => event.type === 'place' || event.type === 'spell' || event.type === 'return' || event.type === 'move' || event.type === 'target')) this.selectedId = null;
    this.render();
    this.animateCardTransfers(origins);
    void this.playEvents(result.events, attackProfiles);
  }

  private async resolveAfterSigilReveal(result: Transition, attackProfiles: Map<string, AttackAnimationProfile | undefined>): Promise<void> {
    const reveals = result.events.filter((event): event is Extract<GameEvent, { type: 'reveal' }> => event.type === 'reveal');
    const spells = result.events.filter((event): event is Extract<GameEvent, { type: 'spell' }> => event.type === 'spell');
    if (spells.length) {
      this.selectedId = null;
      this.syncSelection();
      for (const spell of spells) {
        const handEl = this.root.querySelector<HTMLElement>(`#hand-area [data-card-id="${CSS.escape(spell.instanceId)}"]`);
        if (handEl) handEl.style.visibility = 'hidden';
      }
      for (const spell of spells) {
        await this.animateSpell(spell);
        if (spell.definitionId === 'wandering-flame') {
          for (const event of result.events) {
            if (event.type === 'damage') this.fireballHitIds.add(event.instanceId);
          }
        }
      }
    }
    for (const reveal of reveals) await this.animateSigilReveal(reveal);
    this.captureDestructions(result.events);
    this.state = result.state;
    this.syncMatchFlowWithEngine();
    if (result.events.some((event) => event.type === 'place' || event.type === 'spell' || event.type === 'return' || event.type === 'move' || event.type === 'target')) this.selectedId = null;
    this.render();
    for (const reveal of reveals) {
      this.pendingSigilFlipSlots.get(reveal.instanceId)?.classList.remove('is-revealing');
      this.pendingSigilFlipSlots.delete(reveal.instanceId);
    }
    void this.playEvents(result.events, attackProfiles, true);
    this.revealResolutionPending = false;
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

  private captureTransferOrigins(events: GameEvent[]): Map<string, DOMRect> {
    const origins = new Map<string, DOMRect>();
    for (const event of events) {
      if (event.type !== 'draw' && event.type !== 'move' && event.type !== 'place' && event.type !== 'return') continue;
      const source = event.type === 'draw'
        ? this.root.querySelector<HTMLElement>(event.side === 'player' ? '#draw-deck' : '.enemy-deck-display')
        : this.root.querySelector<HTMLElement>(`#game [data-card-id="${CSS.escape(event.instanceId)}"]`);
      if (source) origins.set(event.instanceId, source.getBoundingClientRect());
    }
    return origins;
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
      if (arenaWasActive && this.matchHasStarted && this.state.phase !== 'finished' && !this.revealResolutionPending) {
        const priorState = this.state;
        const result = advanceTime(this.state, delta);
        const transferOrigins = this.captureTransferOrigins(result.events);
        const attackProfiles = this.captureAttackProfiles(result.events, priorState);
        if (result.events.some((event) => event.type === 'reveal' || event.type === 'spell')) {
          this.captureSigilFlips(result.events, priorState);
          this.revealResolutionPending = true;
          void this.resolveAfterSigilReveal(result, attackProfiles);
        } else {
          this.state = result.state;
          this.syncMatchFlowWithEngine();
          if (result.events.length) { this.captureDestructions(result.events); this.render(); this.animateCardTransfers(transferOrigins); void this.playEvents(result.events, attackProfiles); }
        }
      }
      this.pruneExpiredActiveSigils();
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

  private async playEvents(events: GameEvent[], attackProfiles = new Map<string, AttackAnimationProfile | undefined>(), revealsAlreadyShown = false): Promise<void> {
    let missionsChanged = false;
    for (const event of events) {
      if (event.type === 'attack') this.animateAttack(event, attackProfiles.get(event.attackerId));
      if (event.type === 'spell' && !revealsAlreadyShown) await this.animateSpell(event);
      if (event.type === 'place') this.animateEntry(event.instanceId);
      if (event.type === 'place' && event.side === 'player') { this.cardsPlaced += 1; missionsChanged = true; }
      if (event.type === 'damage') this.animateImpact(event.instanceId, event.amount);
      if (event.type === 'heal') this.animateHeal(event.instanceId, event.amount);
      if (event.type === 'resurrect') this.animateAbilityCard(event.instanceId, 'resurrect-pop', 'Morto Vivo ressuscitou com 2 de vida.');
      if (event.type === 'summon') this.animateSummon(event);
      if (event.type === 'root') this.animateRoots(event.instanceId);
      if (event.type === 'link') this.animateLink(event.instanceId, event.targetId);
      if (event.type === 'reveal' && !revealsAlreadyShown) await this.animateSigilReveal(event);
      if (event.type === 'volcano-wave') this.animateVolcanoWave(event.side, event.wave);
      if (event.type === 'life-damage') this.animateLife(event.side, false);
      if (event.type === 'life-heal') this.animateLife(event.side, true);
      if (event.type === 'game-over') {
        if (!this.matchResultRecorded) { this.matchesCompleted += 1; this.playerWins += event.winner === 'player' ? 1 : 0; this.matchResultRecorded = true; missionsChanged = true; }
        const title = this.root.querySelector<HTMLElement>('#result-title');
        const copy = this.root.querySelector<HTMLElement>('#result-copy');
        if (title) title.textContent = event.winner === 'player' ? 'Vitória' : 'Derrota';
        if (copy) copy.textContent = event.winner === 'player' ? `${getOpponentProfile(this.aiProfileId).name} ficou sem vida.` : 'Sua vida chegou a zero. Tente outra estratégia.';
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
      ?? (event.targetSlot !== undefined ? this.root.querySelector<HTMLElement>(`#${event.targetSide}-grid [data-slot="${event.targetSlot}"]`) : null)
      ?? this.root.querySelector<HTMLElement>(event.targetSide === 'player' ? '#player-life-target' : '#enemy-life-target');
    if (!attacker || !target) return;
    const from = attacker.getBoundingClientRect(); const to = target.getBoundingClientRect();
    const dx = to.left + to.width / 2 - from.left - from.width / 2;
    const dy = to.top + to.height / 2 - from.top - from.height / 2;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const lungeDist = Math.min(72, Math.max(28, distance * 0.38));
    const profileClass = attackProfileClass(profile);
    attacker.classList.remove('is-attacking', profileClass);
    attacker.style.setProperty('--attack-x', `${dx / distance * lungeDist}px`);
    attacker.style.setProperty('--attack-y', `${dy / distance * lungeDist}px`);
    attacker.style.setProperty('--attack-tilt-x', `${(-dy / distance * 14).toFixed(1)}deg`);
    attacker.style.setProperty('--attack-tilt-y', `${(dx / distance * 14).toFixed(1)}deg`);
    attacker.classList.add('is-attacking', profileClass);
    const finishAttack = (animation: AnimationEvent) => {
      if (animation.target !== attacker) return;
      attacker.classList.remove('is-attacking', profileClass);
      attacker.style.removeProperty('--attack-x'); attacker.style.removeProperty('--attack-y');
      attacker.style.removeProperty('--attack-tilt-x'); attacker.style.removeProperty('--attack-tilt-y');
      attacker.removeEventListener('animationend', finishAttack);
    };
    attacker.addEventListener('animationend', finishAttack);
    const trail = attacker.dataset.trail ?? 'orb';
    const color = attacker.style.getPropertyValue('--effect-color');
    this.effects3d?.attackStrike(from, to, trail, color);
    const projectile = document.createElement('i');
    projectile.className = attackProjectileClass(event.side, profile);
    projectile.dataset.trail = trail;
    projectile.style.setProperty('--effect-color', color);
    projectile.style.setProperty('--flight-angle', `${Math.atan2(dy, dx) * 180 / Math.PI}deg`);
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

  private animateAbilityCard(instanceId: string, className: string, message?: string): void {
    const card = this.root.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(instanceId)}"]`);
    if (!card) return;
    card.classList.remove(className);
    void card.offsetWidth;
    card.classList.add(className);
    if (className !== 'is-rooted') window.setTimeout(() => card.classList.remove(className), 900);
    if (message) this.showAbilityLabel(card, message, className === 'resurrect-pop' ? 'green' : 'gold');
  }

  private showAbilityLabel(anchor: HTMLElement, message: string, tone: 'green' | 'gold' | 'red'): void {
    const label = document.createElement('span');
    label.className = `ability-pop-label is-${tone}`;
    label.textContent = message;
    const rect = (this.root.querySelector<HTMLElement>('.arena-stage') ?? anchor).getBoundingClientRect();
    label.style.setProperty('--ability-x', `${rect.left + rect.width / 2}px`);
    label.style.setProperty('--ability-y', `${Math.max(10, rect.top + 8)}px`);
    document.body.append(label);
    window.setTimeout(() => label.remove(), 2100);
  }

  private animateSummon(event: Extract<GameEvent, { type: 'summon' }>): void {
    const witch = this.root.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(event.sourceId)}"]`);
    const target = this.root.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(event.instanceId)}"]`);
    if (!witch || !target) return;
    witch.classList.add('summon-caster');
    this.showAbilityLabel(witch, 'Bruxa Necromante: invocou um Morto Vivo · 1 ataque · 2 vida.', 'green');
    const from = witch.getBoundingClientRect(); const to = target.getBoundingClientRect();
    const face = target.querySelector<HTMLElement>('.card-face');
    if (face && from.width && to.width) {
      const ghost = document.createElement('div');
      ghost.className = 'summon-transfer-ghost';
      ghost.setAttribute('aria-hidden', 'true');
      Object.assign(ghost.style, { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px` });
      ghost.append(face.cloneNode(true));
      document.body.append(ghost);
      const previousVisibility = target.style.visibility;
      target.style.visibility = 'hidden';
      const flight = ghost.animate([
        { transform: `translate(${from.left - to.left}px,${from.top - to.top}px) scale(.62) rotateY(-28deg)`, opacity: .2 },
        { transform: 'translate(0,-12px) scale(1.08) rotateY(180deg)', opacity: 1, offset: .72 },
        { transform: 'none', opacity: 1 },
      ], { duration: 760, easing: 'cubic-bezier(.18,.75,.25,1)' });
      const finish = () => { ghost.remove(); target.style.visibility = previousVisibility; target.classList.add('summon-pop'); window.setTimeout(() => target.classList.remove('summon-pop'), 800); };
      flight.onfinish = finish; flight.oncancel = finish;
    } else this.animateAbilityCard(event.instanceId, 'summon-pop');
    window.setTimeout(() => witch.classList.remove('summon-caster'), 1100);
  }

  private animateRoots(instanceId: string): void {
    const target = this.root.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(instanceId)}"]`);
    if (!target) return;
    target.classList.add('is-rooted', 'roots-binding');
    const expiresAt = performance.now() + 4000;
    this.effects3d?.roots(
      instanceId,
      () => this.root.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(instanceId)}"]`),
      () => {
        const unit = [...this.state.players.player.slots, ...this.state.players.enemy.slots].find(
          (card) => card?.instanceId === instanceId,
        );
        if (!unit) return 0;
        const engineRemaining = (unit.rootedUntilMs ?? 0) - this.state.clockMs;
        return Math.min(engineRemaining, expiresAt - performance.now());
      },
    );
    window.setTimeout(() => target.classList.remove('roots-binding'), 4900);
    this.showAbilityLabel(target, 'RAÍZES PRENDERAM · 4s', 'green');
  }

  private animateLink(sourceId: string, targetId?: string): void {
    const source = this.root.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(sourceId)}"]`);
    source?.classList.toggle('is-link-source', Boolean(targetId));
    if (!targetId) return;
    const target = this.root.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(targetId)}"]`);
    target?.classList.add('is-link-target');
    if (source && target) {
      source.classList.add('is-performing-effect');
      target.classList.add('is-performing-effect');
      this.effects3d?.attackStrike(source.getBoundingClientRect(), target.getBoundingClientRect(), 'orb', '#68dcff');
    }
    window.setTimeout(() => {
      source?.classList.remove('is-link-source', 'is-performing-effect');
      target?.classList.remove('is-link-target', 'is-performing-effect');
    }, 820);
  }

  private captureSigilFlips(events: GameEvent[], before: GameState): void {
    for (const event of events) {
      if (event.type !== 'reveal') continue;
      const card = before.players[event.side].sigils[event.slot];
      const slot = this.root.querySelector<HTMLElement>(`#game [data-slot-side="${event.side}"][data-slot-kind="sigil"][data-slot="${event.slot}"]`)
        ?? this.root.querySelector<HTMLElement>(`#game [data-slot-side="${event.side}"][data-slot="${event.slot}"]`);
      if (!card || !slot || this.pendingSigilFlips.has(event.instanceId)) continue;
      const definition = getCardDefinition(card.definitionId);
      const durationMs = definition.ability === 'volcano' ? 9600 : definition.ability === 'roots' ? 4600 : 2500;
      const key = `${event.side}:${event.slot}`;
      this.activeRevealedSigils.set(key, {
        card: { ...card, revealed: true },
        side: event.side,
        slot: event.slot,
        ability: definition.ability,
        untilClockMs: before.clockMs + durationMs,
        untilWallMs: performance.now() + durationMs + 900,
      });
      if (definition.ability === 'volcano') {
        this.effects3d?.volcano(
          card.instanceId,
          () => this.root.querySelector<HTMLElement>(`#game [data-slot-side="${event.side}"][data-slot-kind="sigil"][data-slot="${event.slot}"]`),
          () => this.getSigilRemainingMs(key, card.instanceId),
        );
      } else if (definition.ability === 'thorns') {
        const attackEvent = events.find((e): e is Extract<GameEvent, { type: 'attack' }> => e.type === 'attack');
        const damageEvent = events.find((e): e is Extract<GameEvent, { type: 'damage' }> => e.type === 'damage');
        const attackerId = attackEvent?.attackerId ?? damageEvent?.instanceId;
        if (attackerId) {
          this.effects3d?.thorns(
            () => this.root.querySelector<HTMLElement>(`#game [data-slot-side="${event.side}"][data-slot-kind="sigil"][data-slot="${event.slot}"]`),
            () => this.root.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(attackerId)}"]`),
          );
        }
      }
      const rect = slot.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      slot.classList.add('is-revealing');
      this.pendingSigilFlipSlots.set(event.instanceId, slot);
      const ghost = document.createElement('div');
      ghost.className = 'sigil-reveal-ghost';
      ghost.setAttribute('aria-hidden', 'true');
      Object.assign(ghost.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
      ghost.innerHTML = `<div class="sigil-reveal-flipper"><div class="sigil-reveal-back">${renderCardBack(event.side)}</div><div class="sigil-reveal-front">${renderCardFace(definition, card, event.side, 'field')}</div></div>`;
      document.body.appendChild(ghost);
      this.pendingSigilFlips.set(event.instanceId, ghost);
    }
  }

  private getSigilRemainingMs(key: string, instanceId: string): number {
    const entry = this.activeRevealedSigils.get(key);
    if (!entry || entry.card.instanceId !== instanceId) return 0;
    const occupant = this.state.players[entry.side].sigils[entry.slot];
    if (occupant && occupant.instanceId !== instanceId) return 0;
    if (entry.ability === 'volcano') {
      const eruptionActive = (this.state.eruptions ?? []).some((e) => e.instanceId === instanceId);
      if (eruptionActive || this.revealResolutionPending) return Math.max(1500, entry.untilWallMs - performance.now());
    }
    return Math.max(entry.untilClockMs - this.state.clockMs, entry.untilWallMs - performance.now());
  }

  private pruneExpiredActiveSigils(): void {
    let changed = false;
    for (const [key, entry] of this.activeRevealedSigils) {
      if (this.getSigilRemainingMs(key, entry.card.instanceId) <= 0) {
        this.activeRevealedSigils.delete(key);
        changed = true;
      }
    }
    if (changed) {
      this.renderSigils('player', this.state.players.player.sigils);
      this.renderSigils('enemy', this.state.players.enemy.sigils);
    }
  }

  private animateSigilReveal(event: Extract<GameEvent, { type: 'reveal' }>): Promise<void> {
    const ghost = this.pendingSigilFlips.get(event.instanceId);
    if (!ghost) return Promise.resolve();
    this.pendingSigilFlips.delete(event.instanceId);
    ghost.classList.add('is-flipping');
    return new Promise((resolve) => window.setTimeout(() => {
      ghost.classList.add('is-revealed');
      window.setTimeout(() => { ghost.remove(); resolve(); }, 320);
    }, 460));
  }

  private animateVolcanoWave(side: Side, wave: number): void {
    const board = this.root.querySelector<HTMLElement>('.arena-board');
    if (!board) return;
    board.dataset.volcanoOwner = side;
    board.dataset.volcanoWave = String(wave);
    board.classList.remove('is-volcano-erupting');
    void board.offsetWidth;
    board.classList.add('is-volcano-erupting');
    window.setTimeout(() => board.classList.remove('is-volcano-erupting'), 900);

    // Find the active Vulcão sigil slot on the owner's side and pulse the card
    let volcanoSlotEl: HTMLElement | null = null;
    for (const [, entry] of this.activeRevealedSigils) {
      if (entry.side === side && entry.card.definitionId === 'eclipse-seal') {
        if (wave >= 3) {
          entry.untilClockMs = this.state.clockMs + 1400;
          entry.untilWallMs = performance.now() + 1400;
        }
        volcanoSlotEl = this.root.querySelector<HTMLElement>(`#game [data-slot-side="${side}"][data-slot-kind="sigil"][data-slot="${entry.slot}"]`);
        break;
      }
    }
    if (!volcanoSlotEl) {
      volcanoSlotEl = this.root.querySelector<HTMLElement>(`#game [data-slot-side="${side}"][data-slot-kind="sigil"] .battle-card[data-card-id]`)?.closest<HTMLElement>('.secret-slot') ?? null;
    }
    const volcanoCardEl = volcanoSlotEl?.querySelector<HTMLElement>('.battle-card');
    if (volcanoCardEl) {
      volcanoCardEl.classList.remove('is-performing-effect');
      void volcanoCardEl.offsetWidth;
      volcanoCardEl.classList.add('is-performing-effect');
      window.setTimeout(() => volcanoCardEl.classList.remove('is-performing-effect'), 820);
      this.showAbilityLabel(volcanoCardEl, `VULCÃO · ONDA ${wave}/3`, 'red');
    }

    // Launch 3D molten lava bombs from the 3D volcano on the card's slot to all active troops
    for (const event of ['enemy', 'player'] as const) {
      this.state.players[event].slots.forEach((unit) => {
        if (unit) this.fireballHitIds.add(unit.instanceId);
      });
    }
    this.effects3d?.volcanoWave(
      () => volcanoSlotEl ?? board,
      () => Array.from(this.root.querySelectorAll<HTMLElement>('#player-grid .battle-card[data-card-id], #enemy-grid .battle-card[data-card-id]')),
      wave,
    );
  }

  private animateLife(side: Side, healing: boolean): void {
    const target = this.root.querySelector<HTMLElement>(side === 'player' ? '#player-life-target' : '#enemy-life-target');
    if (!target) return;
    target.classList.add(healing ? 'is-healing' : 'is-hit');
    window.setTimeout(() => target.classList.remove('is-hit', 'is-healing'), 550);
  }

  private animateImpact(instanceId: string, amount: number): void {
    const isFireballHit = this.fireballHitIds.delete(instanceId);
    const target = this.root.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(instanceId)}"]`);
    if (!target) return;
    target.classList.remove('is-hit', 'is-fireball-hop');
    void target.offsetWidth;
    target.classList.add('is-hit');
    if (isFireballHit) target.classList.add('is-fireball-hop');
    const board = this.root.querySelector<HTMLElement>('.arena-board');
    if (board?.classList.contains('is-volcano-erupting')) {
      const sideClass = target.dataset.side === board.dataset.volcanoOwner ? 'volcano-ally-hit' : 'volcano-enemy-hit';
      target.classList.add(sideClass);
      window.setTimeout(() => target.classList.remove(sideClass), 900);
    }
    const number = document.createElement('span');
    number.className = 'impact-number';
    number.textContent = `−${amount}`;
    target.appendChild(number);
    const finishImpact = (animation: AnimationEvent) => {
      if (animation.target !== target) return;
      target.classList.remove('is-hit', 'is-healing', 'is-fireball-hop'); number.remove();
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

  private animateSpell(event: Extract<GameEvent, { type: 'spell' }>): Promise<void> {
    const fallbackOrigin = event.side === 'player'
      ? this.root.querySelector<HTMLElement>('#hand-area')?.getBoundingClientRect()
      : this.root.querySelector<HTMLElement>('.enemy-deck-display')?.getBoundingClientRect();
    const from = this.pendingSpellOrigins.get(event.instanceId) ?? fallbackOrigin;
    const definition = getCardDefinition(event.definitionId);
    const faceMarkup = this.pendingSpellFaces.get(event.instanceId)
      ?? renderCardFace(definition, { instanceId: event.instanceId, definitionId: event.definitionId, owner: event.side, health: 0, nextAttackAtMs: 0, revealed: true }, event.side, 'hand');
    this.pendingSpellOrigins.delete(event.instanceId);
    this.pendingSpellFaces.delete(event.instanceId);
    const target = event.targetId
      ? this.root.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(event.targetId)}"]`)
      : null;
    const targetElement = target
      ?? (event.targetSlot !== undefined ? this.root.querySelector<HTMLElement>(`#${event.targetSide}-grid [data-slot="${event.targetSlot}"]`) : null)
      ?? this.root.querySelector<HTMLElement>(event.targetSide === 'player' ? '#player-life-target' : '#enemy-life-target');
    if (!from || !targetElement) return Promise.resolve();

    // Keep the spell card visible and raised in a 3D channeling pose until the spell effect finishes
    let originGhost: HTMLElement | null = null;
    if (faceMarkup && from.width && from.height) {
      originGhost = document.createElement('div');
      originGhost.className = 'spell-origin-ghost';
      originGhost.setAttribute('aria-hidden', 'true');
      Object.assign(originGhost.style, {
        left: `${from.left}px`,
        top: `${from.top}px`,
        width: `${from.width}px`,
        height: `${from.height}px`,
      });
      originGhost.innerHTML = faceMarkup;
      document.body.append(originGhost);
    }
    const dismissOriginGhost = (delayMs = 420) => {
      if (!originGhost) return;
      const ghost = originGhost;
      originGhost = null;
      window.setTimeout(() => {
        ghost.classList.add('is-finishing');
        window.setTimeout(() => ghost.remove(), 240);
      }, delayMs);
    };

    const resolveTarget = () =>
      (event.targetId ? this.root.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(event.targetId)}"]`) : null)
      ?? targetElement;

    const isFireball = event.definitionId === 'wandering-flame';
    if (isFireball && this.effects3d) {
      return this.effects3d.fireball(from, resolveTarget).then(() => {
        const board = this.root.querySelector<HTMLElement>('.arena-board');
        board?.classList.remove('is-fireball-impact');
        void board?.offsetWidth;
        board?.classList.add('is-fireball-impact');
        window.setTimeout(() => board?.classList.remove('is-fireball-impact'), 360);
        dismissOriginGhost();
      });
    }
    if (this.effects3d) {
      return this.effects3d.healSpell(from, resolveTarget).then(() => {
        dismissOriginGhost();
      });
    }
    dismissOriginGhost();
    return Promise.resolve();
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
    const discardCount = player.discard?.length ?? 0;
    const availableToDraw = player.deck.length + discardCount;
    const canDraw = player.hand.length < balance.handLimit && availableToDraw > 0 && this.state.phase === 'playing';
    const needsDraw = shouldHighlightDeck({
      phase: this.state.phase, handCount: player.hand.length, handLimit: balance.handLimit,
      deckCount: availableToDraw, hasTroopInHand: player.hand.some((card) => getCardDefinition(card.definitionId).kind === 'troop'),
    });
    if (deck) {
      const drawStatus = this.state.phase === 'finished' ? 'Partida encerrada'
          : this.state.phase !== 'playing' ? 'Aguarde o combate'
            : player.hand.length >= balance.handLimit ? 'Mão cheia'
              : player.deck.length === 0 && discardCount > 0 ? `${discardCount} cartas · Reciclar e comprar`
                : player.deck.length === 0 ? 'Deck esgotado'
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
          if (currentFace?.dataset.visualState !== desiredFace.dataset.visualState) {
            if (currentFace) currentFace.replaceWith(desiredFace); else currentCard.prepend(desiredFace);
          }
        }
      }
      if (displayedCard) {
        const unit = button.querySelector<HTMLElement>('.battle-card[data-card-id]');
        if (unit) { this.syncAttackTargetStatus(unit, displayedCard, side); this.syncAbilityClasses(unit, displayedCard, side); }
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
      const key = `${side}:${slot}`;
      const activeEntry = !card ? this.activeRevealedSigils.get(key) : undefined;
      const activeRevealed = activeEntry && this.getSigilRemainingMs(key, activeEntry.card.instanceId) > 0 ? activeEntry.card : null;
      const displayedCard = card && !this.isBeingDragged(card) ? card : activeRevealed;
      const isEffectActive = Boolean(activeRevealed);
      const content = !displayedCard ? '<span class="empty-rune" aria-hidden="true">✧</span>' : displayedCard.revealed
        ? this.unitMarkup(displayedCard, side, true)
        : renderCardBack(side);
      const armedThorns = Boolean(displayedCard && side === 'player' && !displayedCard.revealed && getCardDefinition(displayedCard.definitionId).ability === 'thorns');
      const label = armedThorns ? `Seu sigilo ${slot + 1}, armadilha de Espinhos armada; ativa quando uma tropa inimiga atacar uma tropa sua.`
        : `${side === 'player' ? 'Seu' : 'Adversário'}: sigilo ${slot + 1}${displayedCard?.revealed ? `, ${getCardDefinition(displayedCard.definitionId).name}` : displayedCard ? ', oculto' : ', vazio'}`;
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
      button.className = `slot secret-slot ${side === 'enemy' ? 'enemy-slot' : 'player-slot'}${this.selectedId === displayedCard?.instanceId ? ' is-selected' : ''}${armedThorns ? ' is-thorns-armed' : ''}${isEffectActive ? ' is-sigil-effect-active' : ''}`;
      button.dataset.slotSide = side;
      button.dataset.slotKind = 'sigil';
      button.dataset.slot = String(slot);
      button.dataset.sigilId = cardId;
      button.dataset.sigilRevealed = revealed;
      button.setAttribute('aria-label', this.escapeAttribute(label));
      if (changed || button.dataset.thornsArmed !== String(armedThorns)) button.innerHTML = content + (armedThorns ? '<span class="sigil-armed-badge" aria-hidden="true">ARMADA</span>' : '');
      else if (displayedCard?.revealed) {
        const unit = button.querySelector<HTMLElement>('.battle-card');
        if (unit) {
          const details = this.cardDetails(displayedCard);
          unit.setAttribute('aria-label', this.escapeAttribute(details));
          unit.setAttribute('title', this.escapeAttribute(details));
        }
      }
      button.dataset.thornsArmed = String(armedThorns);
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
    const visual = cardEffects[definition.id];
    return `<div class="battle-card${side === 'enemy' ? ' enemy-unit' : ''}${secret ? ' sigil-card' : ''}" data-card-id="${card.instanceId}" data-side="${side}" data-foundation="${definition.foundation}" data-trail="${visual.trail}" data-hit="${visual.hit}" data-death="${visual.death}" style="--effect-color:${visual.color}" aria-label="${this.escapeAttribute(details)}" title="${this.escapeAttribute(details)}"><span class="damage-aura" aria-hidden="true"></span>${renderCardFace(definition, card, side, 'field')}${definition.kind === 'troop' && !secret ? '<span class="attack-cooldown-shade" data-cooldown-shade aria-hidden="true"></span>' : ''}${cooldown}<span class="ability-state-badge" data-ability-state></span></div>`;
  }

  private attackTargetStatus(card: CardInstance, side: Side): string {
    if (card.directAttackTarget) return 'ALVO DIRETO: JOGADOR · CURA +1';
    if (!card.attackTargetId) return '';
    const targetSide = side === 'player' ? 'enemy' : 'player';
    const targets = this.state.players[targetSide].slots;
    const slot = targets.findIndex((target) => target?.instanceId === card.attackTargetId);
    if (slot < 0) return 'ALVO SAIU · AUTOMÁTICO';
    const target = targets[slot];
    if (!target || !isAttackTargetExposed(this.state, targetSide, slot)) return 'ALVO PROTEGIDO · AUTOMÁTICO';
    return `ALVO: ${getCardDefinition(target.definitionId).name}`;
  }

  private syncAttackTargetStatus(element: HTMLElement, card: CardInstance, side: Side): void {
    const status = this.attackTargetStatus(card, side);
    const details = this.cardDetails(card);
    element.setAttribute('aria-label', status ? `${details}. ${status}` : details);
    element.title = status ? `${details}. ${status}` : details;
  }

  private syncAbilityClasses(element: HTMLElement, card: CardInstance, side: Side): void {
    const linkedTarget = this.state.players[side].slots.some((source) => source?.linkedAllyId === card.instanceId);
    element.classList.toggle('is-rooted', (card.rootedUntilMs ?? 0) > this.state.clockMs);
    element.classList.toggle('is-link-source', Boolean(card.linkedAllyId));
    element.classList.toggle('is-link-target', linkedTarget);
    element.classList.toggle('is-furious', getCardDefinition(card.definitionId).ability === 'fury' && card.health <= (getCardDefinition(card.definitionId).abilityConfig?.furyThreshold ?? 3));
    this.syncAbilityStatus(element, card, side);
  }

  private syncAbilityStatus(element: HTMLElement, card: CardInstance, side: Side): void {
    const definition = getCardDefinition(card.definitionId);
    const badge = element.querySelector<HTMLElement>('[data-ability-state]');
    if (!badge || definition.kind !== 'troop') return;
    const linkedBy = this.state.players[side].slots.find((source) => source?.linkedAllyId === card.instanceId);
    let text = '';
    let className = '';
    let icon = '';
    if (card.derived && card.summonedById) { text = 'Invocado pela Bruxa Necromante · 1 ataque, 2 de vida, sem ressurreição.'; icon = '✦'; className = 'is-green'; }
    else if (definition.ability === 'resurrection') { text = card.resurrectionUsed ? 'Ressurreição usada; a próxima eliminação destrói a tropa.' : 'Ressuscita uma vez no mesmo espaço com 2 de vida.'; icon = card.resurrectionUsed ? '✓' : '↻'; className = card.resurrectionUsed ? 'is-muted' : 'is-green'; }
    else if (definition.ability === 'necromancy') { text = card.summonUsed ? 'Necromancia usada nesta vida.' : 'Uma vez nesta vida: qualquer tropa aliada eliminada em qualquer espaço gera um Morto Vivo com 1 ataque e 2 de vida.'; icon = card.summonUsed ? '✓' : '☽'; className = card.summonUsed ? 'is-muted' : 'is-green'; }
    else if (definition.ability === 'mystic-link') { text = card.linkedAllyId ? `Vínculo ativo com ${getCardDefinition(this.state.players[side].slots.find((unit) => unit?.instanceId === card.linkedAllyId)?.definitionId ?? definition.id).name}; ataques recarregam 1 segundo mais rápido.` : 'Na retaguarda: toque na Raposa e depois em um aliado para vinculá-lo.'; icon = card.linkedAllyId ? '∞' : '↔'; className = card.linkedAllyId ? 'is-green' : ''; }
    else if (linkedBy) { text = 'Vínculo ativo: ataques recarregam 1 segundo mais rápido.'; icon = '∞'; className = 'is-green'; }
    else if (definition.ability === 'plunder') { text = card.directAttackTarget ? 'Alvo direto ordenado; ao acertar o jogador inimigo, recupera 1 de vida.' : Math.floor(this.state.players[side].slots.findIndex((unit) => unit?.instanceId === card.instanceId) / topology.columns) === topology.frontRow[side] ? 'Linha da frente: ataque automático.' : 'Na retaguarda, pode receber ordem para atacar diretamente o jogador inimigo.'; icon = card.directAttackTarget ? '↗' : '☞'; className = card.directAttackTarget ? 'is-gold' : ''; }
    badge.textContent = '';
    badge.dataset.icon = icon;
    badge.className = `ability-state-badge${icon ? ' is-visible' : ''}${className ? ` ${className}` : ''}`;
    badge.setAttribute('aria-label', text || '');
    badge.title = text;
  }

  private updateAttackCooldowns(): void {
    for (const side of ['player', 'enemy'] as const) {
      this.state.players[side].slots.forEach((card) => {
        if (!card) return;
        const element = this.root.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(card.instanceId)}"]`);
        if (element) this.syncAbilityClasses(element, card, side);
      });
    }
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
      const interval = effectiveAttackInterval(this.state, card);
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
        ? `<span><b>Ataque</b> ${effectiveAttack(card)}</span><span><b>Vida</b> ${card.health}/${maxHealthFor(card)}</span>`
        : definition.kind === 'spell'
          ? `<span><b>Custo</b> ${definition.cost}</span><span><b>Efeito</b> ${definition.effect === 'damage' ? `${balance.spellDamage} de dano` : `${balance.spellHealing} de cura`}</span>`
          : `<span><b>Custo</b> ${definition.cost}</span><span><b>Efeito</b> Sigilo oculto</span>`;
      const behavior = card.derived ? 'Invocado pela Bruxa Necromante. Esta unidade derivada tem 1 de ataque e 2 de vida; não ressuscita e não cria outras tropas.' : definition.kind === 'troop'
        ? definition.ability === 'resurrection' ? 'Ao receber dano letal pela primeira vez, retorna neste espaço com 2 de vida. Na próxima eliminação, é destruído.'
          : definition.ability === 'necromancy' ? 'Uma vez enquanto esta Bruxa estiver viva, quando qualquer tropa aliada for eliminada em qualquer espaço do seu campo, invoca no espaço vazio um Morto Vivo com 1 de ataque e 2 de vida. A carta aparece saindo da Bruxa e ocupa o espaço livre.'
            : definition.ability === 'crush' ? 'Se eliminar uma tropa da frente, o dano excedente atinge a tropa de trás na mesma coluna.'
              : definition.ability === 'mystic-link' ? 'Na retaguarda, selecione esta carta e toque em uma tropa aliada para reduzir em 1 segundo o intervalo de ataque dela. Para mover, arraste-a a um espaço vazio.'
                : definition.ability === 'plunder' ? 'Na retaguarda, selecione o Goblin e toque na barra de vida inimiga. Ele passa a atacar diretamente o jogador e recupera 1 de vida quando acerta. Esta exceção vale só para ele.'
                  : definition.ability === 'fury' ? 'Quando fica com 3 ou menos de vida, recebe +1 de ataque. O bônus termina se recuperar mais de 3 de vida.'
                    : 'Na frente, ataca automaticamente. Na retaguarda, selecione esta tropa e depois o alvo inimigo.'
        : description;
      wrap.innerHTML = `<div class="quick-card-preview"><div class="preview-shell ${definition.kind}" data-foundation="${definition.foundation}">${renderCardFace(definition, card, side, 'preview')}</div><section class="card-preview-details"><div class="card-preview-heading"><strong>${this.escapeAttribute(card.derived ? 'Morto Vivo · Invocado' : definition.name)}</strong><span>${kind}</span></div><div class="card-preview-facts">${facts}</div><p>${this.escapeAttribute(card.derived ? behavior : description)}</p><p class="card-preview-how">${this.escapeAttribute(behavior)}</p><button class="card-preview-close" id="close-card-preview" type="button">Fechar</button></section></div>`;
      overlay.classList.add('open'); overlay.setAttribute('aria-hidden', 'false');
      return;
    }
    const kind = definition.kind === 'troop' ? 'Tropa' : definition.kind === 'spell' ? 'Feitiço' : 'Carta oculta';
    const foundation = definition.foundation[0].toUpperCase() + definition.foundation.slice(1);
    const intervalMs = attackIntervalFor(definition.id, balance.attackIntervalMs);
    const facts = definition.kind === 'troop'
      ? `<span class="detail-stat"><b>Ataque</b><strong>${effectiveAttack(card)}</strong></span><span class="detail-stat"><b>Vida</b><strong>${card.health}/${maxHealthFor(card)}</strong></span><span class="detail-stat"><b>Intervalo</b><strong>${(intervalMs / 1000).toLocaleString('pt-BR')} s</strong></span>`
      : definition.kind === 'spell'
        ? `<span class="detail-stat"><b>Tipo</b><strong>Instantâneo</strong></span><span class="detail-stat"><b>Alvo</b><strong>${definition.effect === 'damage' ? 'Inimigo' : 'Aliado'}</strong></span>`
        : `<span class="detail-stat"><b>Tipo</b><strong>Oculta</strong></span><span class="detail-stat"><b>Ativação</b><strong>${definition.ability === 'thorns' ? 'Automática' : definition.ability === 'roots' || definition.ability === 'volcano' ? 'Manual e automática' : 'Manual'}</strong></span>`;
    const effectCopy = this.cardEffectExplanation(definition);
    const useCopy = definition.kind === 'troop'
      ? definition.ability === 'mystic-link' ? 'Coloque na retaguarda e toque nela para escolher uma tropa aliada; o vínculo acelera os ataques do alvo.'
        : definition.ability === 'plunder' ? 'Mesmo na retaguarda, pode receber uma ordem para atacar diretamente o jogador inimigo.'
          : 'Na linha frontal, ataca automaticamente. Na retaguarda, escolha um alvo válido tocando na tropa e depois no alvo.'
      : definition.kind === 'spell' ? definition.ability === 'equivalent-heal' ? 'Toque na carta e selecione uma tropa aliada que tenha recebido dano recentemente.' : 'Toque na carta e selecione uma tropa inimiga; outra tropa na mesma coluna também será atingida.'
        : definition.ability === 'thorns' ? 'Deixe preparada no espaço de carta oculta. Ela se revela quando uma tropa inimiga declara ataque contra uma tropa sua.'
          : definition.ability === 'roots' ? 'Deixe preparada para interromper uma tentativa de reposicionamento ou toque nela e escolha uma tropa inimiga.'
            : 'Toque na carta oculta para iniciar a erupção. Ela atinge todas as tropas dos dois lados em três ondas.';
    const abilityTitles = {
      resurrection: 'Ressurreição', necromancy: 'Necromancia', crush: 'Esmagamento', 'mystic-link': 'Vínculo Místico',
      plunder: 'Saque', fury: 'Fúria Desesperada', 'equivalent-heal': 'Cura Equivalente', fireball: 'Bola de Fogo',
      thorns: 'Contra-ataque Espinhoso', roots: 'Aprisionamento Natural', volcano: 'Erupção Descontrolada',
    } as const;
    const abilityTitle = definition.ability ? abilityTitles[definition.ability] : 'Efeito';
    wrap.innerHTML = `<article class="card-detail-sheet" aria-label="Detalhes de ${this.escapeAttribute(definition.name)}"><header class="card-detail-header"><div><span class="card-detail-kicker">${this.escapeAttribute(foundation)} · ${kind}</span><h2>${this.escapeAttribute(definition.name)}</h2></div><button class="card-detail-x" id="close-card-preview" type="button" aria-label="Fechar">×</button></header><div class="card-detail-layout"><div class="card-detail-art preview-shell ${definition.kind}" data-foundation="${definition.foundation}">${renderCardFace(definition, card, side, 'preview')}</div><div class="card-detail-body"><div class="card-detail-stats">${facts}</div><section class="card-detail-section"><span class="card-detail-kicker">HABILIDADE · ${this.escapeAttribute(abilityTitle)}</span><p>${this.escapeAttribute(effectCopy)}</p></section><section class="card-detail-section card-detail-how"><span class="card-detail-kicker">COMO USAR</span><p>${this.escapeAttribute(useCopy)}</p></section></div></div><footer class="card-detail-footer"><span>Atributos atuais da carta</span><button class="card-preview-close" data-close-card-preview type="button">Fechar ficha</button></footer></article>`;
    overlay.classList.add('open'); overlay.setAttribute('aria-hidden', 'false');
  }

  private cardEffectExplanation(definition: ReturnType<typeof getCardDefinition>): string {
    const config = definition.abilityConfig ?? {};
    switch (definition.ability) {
      case 'resurrection': return `Quando receber dano letal pela primeira vez, volta ao campo na mesma posição com ${config.resurrectionHealth ?? 2} de vida. Isso só acontece uma vez; na próxima eliminação, é destruído.`;
      case 'necromancy': return `Uma vez enquanto esta Bruxa permanecer viva, quando outra tropa aliada da mesma coluna for eliminada definitivamente, invoca um Morto Vivo com ${config.summonHealth ?? 2} de vida no espaço que ficou livre. A invocação não consome uma carta do deck; a unidade derivada não ressuscita e não invoca outra tropa.`;
      case 'crush': return 'Se eliminar uma tropa da linha frontal, o dano que exceder a vida dela atinge a tropa da retaguarda na mesma coluna. O excedente não atinge o jogador.';
      case 'mystic-link': return `Na retaguarda, vincula-se a uma tropa aliada escolhida. Enquanto ambas permanecerem em campo, o intervalo de ataque do aliado diminui em ${(config.intervalReductionMs ?? 1000) / 1000} segundo. Se o vínculo acabar, o bônus também acaba.`;
      case 'plunder': return `Pode atacar diretamente a vida do adversário mesmo estando na retaguarda. Ao acertar, recupera ${config.healOnDirect ?? 1} de vida, sem ultrapassar o máximo.`;
      case 'fury': return `Quando sua vida chega a ${config.furyThreshold ?? 3} ou menos, recebe +${config.furyBonus ?? 1} de ataque. Se for curado acima desse limite, perde o bônus.`;
      case 'equivalent-heal': return `Recupera vida igual ao dano do último golpe recebido pelo alvo, até ${config.healCap ?? 4} pontos e sem ultrapassar a vida máxima. Sem um golpe registrado, não pode ser usada nesse alvo. A carta é consumida.`;
      case 'fireball': return `Causa ${config.damage ?? definition.spellAmount ?? 3} de dano à tropa escolhida e ${config.splashDamage ?? 1} de dano a outra tropa inimiga na mesma coluna, se houver. A carta é consumida.`;
      case 'thorns': return `Quando uma tropa inimiga declara ataque contra uma tropa aliada, revela-se antes do dano: causa ${config.damage ?? 2} de dano ao atacante e acrescenta ${(config.delayMs ?? 2000) / 1000} s à preparação do próximo ataque. Se eliminar o atacante, cancela o golpe. É consumida ao ativar.`;
      case 'roots': return `Ao tentar se reposicionar, a tropa inimiga é presa por ${(config.rootDurationMs ?? 4000) / 1000} s e seu próximo ataque atrasa ${(config.delayMs ?? 2000) / 1000} s. Também pode ser ativada manualmente contra um inimigo. Durante a prisão, ainda pode atacar.`;
      case 'volcano': return `Cria ${config.waveCount ?? 3} ondas: a primeira é imediata e as seguintes ocorrem a cada ${(config.waveIntervalMs ?? 4000) / 1000} s. Cada onda causa ${config.enemyDamage ?? 2} de dano a cada tropa inimiga e ${config.allyDamage ?? 1} às suas próprias tropas. Não atinge a vida dos jogadores.`;
      default: return definition.description;
    }
  }

  private cardDetails(card: CardInstance): string {
    const definition = getCardDefinition(card.definitionId);
    const kind = definition.kind === 'troop' ? 'tropa' : definition.kind === 'hidden' ? 'sigilo' : 'feitiço';
    const values = [definition.name, kind];
    if (definition.kind === 'troop') values.push(`${effectiveAttack(card)} ataque`, `${card.health}/${maxHealthFor(card)} vida`, `intervalo de ${attackIntervalFor(definition.id, balance.attackIntervalMs) / 1000} segundos`);
    else if (definition.kind === 'spell') values.push('efeito instantâneo');
    else values.push('carta oculta com efeito funcional');
    values.push(card.derived ? 'Invocado pela Bruxa Necromante; 1 de ataque, 2 de vida, sem ressurreição.' : this.descriptionFor(definition));
    return values.join(' · ');
  }

  private descriptionFor(definition: ReturnType<typeof getCardDefinition>): string {
    return definition.description;
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
