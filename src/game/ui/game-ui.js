import { SIGNS, NAMES, POWER_NAMES, POWERS, MAX_HP, DAMAGE, CRIT_DAMAGE, POINTS_FOR_PRIZE, POINTS_TO_WIN, TURN_SECONDS, MAX_MISSES, randomItem, createGame, powerCount, activateAbility, chooseEnemySign, play, nextBattle, missChoice } from '../core/rules.js';
import { createTurnClock } from './turn-clock.js';
import { createGameView } from './game-view.js';
import { createGameAnimations } from './game-animations.js';

const $=id=>document.getElementById(id);
const images=Object.fromEntries(SIGNS.map(s=>[s,document.querySelector(`[data-player-sign="${s}"]`).src]));
let game=createGame(), busy=false, speechTimer=null,turnNumber=0,lastSpeechTurn=-99,hasStarted=false,isTransitioning=false;
const clock=createTurnClock({getGame:()=>game,getBusy:()=>busy,getHasStarted:()=>hasStarted,onTimeout:timeoutChoice,turnSeconds:TURN_SECONDS});
const {stopClock,startClock,expiredNow,clockUI}=clock;
const view=createGameView({getGame:()=>game,getBusy:()=>busy,getHasStarted:()=>hasStarted,getImages:()=>images,onReset:reset,onStartNextBattle:startNextBattle,clockUI,maxHp:MAX_HP,maxMisses:MAX_MISSES,pointsForPrize:POINTS_FOR_PRIZE,pointsToWin:POINTS_TO_WIN,powers:POWERS,powerNames:POWER_NAMES,powerCount});
const {controls,render,prizeToast,resetHands,showEnding}=view;
const animations=createGameAnimations({render});
const {resolveMotion}=animations;
function say(line,tone='neutral'){
  const bubble=$('enemy-speech');
  if(speechTimer) clearTimeout(speechTimer);
  $('speech-text').textContent=line;
  $('speech-tone').textContent=tone==='taunt'?'PROVOCAÇÃO':tone==='surprised'?'SURPRESO':'OBSERVANDO';
  bubble.dataset.tone=tone;
  bubble.hidden=false;
  lastSpeechTurn=turnNumber;
  speechTimer=setTimeout(()=>{bubble.hidden=true;},2600);
}
function canSpeak(minGap=3){
  return turnNumber-lastSpeechTurn>=minGap;
}
const trashTalk={
  win:['Achei sua brecha.','Você está ficando previsível.','Essa foi minha!','Consegui ler sua jogada.'],
  loss:['Boa! Mas não se acostume.','Vou guardar essa informação.','Você me pegou nessa.','Ainda não acabou.'],
  draw:['Parece que pensamos igual.','Empate... interessante.']
};
function showAIFeedback(turn){
  if(turn.battleResult){
    if(turn.battleResult.winner==='enemy') say(randomItem(['Mais um ponto para mim!','Consegui vencer esse combate.','Essa rodada foi minha.'],Math.random),'taunt');
    else say(randomItem(['Você ganhou... por enquanto.','Essa doeu. Vou me adaptar.','Tudo bem. Aprendi alguma coisa.'],Math.random),'surprised');
    return;
  }
  if(turn.enemyAbility&&canSpeak(2)&&Math.random()<.6){
    say(turn.enemyAbility.kind==='heal'?'Vou recuperar minhas forças.':turn.enemyAbility.kind==='defense'?'Agora tenho defesa.':'Essa pode ser uma jogada decisiva!','taunt');
    return;
  }
  if(!canSpeak(4)) return;
  const moves=game.playerHistory;
  const repetitive=moves.length>=3&&moves.slice(-3).every(s=>s===moves.at(-1));
  if(repetitive&&Math.random()<.65){
    say(`Três ${NAMES[moves.at(-1)].toLowerCase()} seguidas? Estou atento.`, 'taunt');
  }else if(turnNumber%5===0&&Math.random()<.4){
    say(randomItem(trashTalk[turn.result],Math.random),turn.result==='loss'?'taunt':turn.result==='win'?'surprised':'neutral');
  }
}
async function startGame(){
  if(hasStarted||isTransitioning)return;
  isTransitioning=true;
  $('start-game').disabled=true;
  const curtain=$('transition-curtain');
  const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  curtain.hidden=false;
  async function slide(from,to){
    const animation=curtain.animate([{transform:from},{transform:to}],{
      duration:570,easing:'cubic-bezier(.76,0,.24,1)',fill:'forwards'
    });
    await animation.finished;
    curtain.style.transform=to;
    animation.cancel();
  }
  try{
    // 1) Tela preta sobe de baixo até cobrir completamente o menu.
    if(!reducedMotion)await slide('translateY(100%)','translateY(0%)');
    else curtain.style.transform='translateY(0%)';
    $('menu-screen').hidden=true;
    $('game-screen').hidden=false;
    hasStarted=true;
    $('message').textContent='Escolha sua jogada antes que os 5 segundos acabem.';
    render();
    // 2) Preto continua subindo e revela o jogo por baixo.
    if(!reducedMotion)await slide('translateY(0%)','translateY(-100%)');
  }finally{
    curtain.hidden=true;
    curtain.style.transform='translateY(100%)';
    isTransitioning=false;
    $('start-game').disabled=false;
    if(!hasStarted){
      $('menu-screen').hidden=true;
      $('game-screen').hidden=false;
      hasStarted=true;
      render();
    }
    // Só ativa os 5 segundos quando a transição terminou.
    startClock();
  }
}
function reset(){
  if(busy)return;
  stopClock();game=createGame();turnNumber=0;lastSpeechTurn=-99;
  if(speechTimer)clearTimeout(speechTimer);
  $('enemy-speech').hidden=true;
  $('end-screen').hidden=true;
  resetHands();
  $('message').textContent='Escolha sua jogada antes que os 5 segundos acabem.';
  render();if(hasStarted)startClock();else clockUI(TURN_SECONDS,false);
}
function startNextBattle(){
  if(busy||!nextBattle(game))return;
  stopClock();$('end-screen').hidden=true;resetHands();
  $('message').textContent='Novo combate! Seus efeitos guardados continuam disponíveis.';
  render();startClock();
}
async function choose(sign,auto=false){
  if(!hasStarted||busy||game.phase!=='playing')return;
  if(!auto&&expiredNow())return;
  stopClock();busy=true;clockUI(0,false);controls();
  const turn=play(game,sign);
  if(!turn){busy=false;return;}
  turnNumber++;
  $('player-hand').src=images[sign];$('enemy-hand').src=images[turn.enemy];
  $('player-hand').alt=`Sua mão: ${NAMES[sign]}`;
  $('enemy-hand').alt=`Inimigo: ${NAMES[turn.enemy]}`;
  document.querySelectorAll('[data-sign]').forEach(b=>b.classList.toggle('selected',b.dataset.sign===sign));
  $('message').className='';
  $('message').textContent=`${auto?'Jogada automática · ':''}${NAMES[sign]} × ${NAMES[turn.enemy]}`;
  try{
    await Promise.all([$('player-hand').decode(),$('enemy-hand').decode()]);
    await resolveMotion(turn);
  }catch(err){render();}
  if(turn.result==='draw')$('message').textContent='Empate: ninguém sofre dano.';
  if(turn.enemyAbility){
    const eff=turn.enemyAbility;
    $('message').textContent+=eff.kind==='heal'?` Inimigo usou Cura: +${eff.restored} PV.`:` Inimigo ativou ${POWER_NAMES[eff.kind]}.`;
  }
  if(auto)$('message').textContent=`Tempo esgotado (${game.misses}/${MAX_MISSES}). Jogada automática: ${NAMES[sign]}. `+$('message').textContent;
  if(turn.battleResult?.unlocked)prizeToast(turn.battleResult.unlocked,turn.battleResult.winner);
  showAIFeedback(turn);
  busy=false;render();
  if(game.phase==='playing')startClock();else showEnding(turn.battleResult);
}
function timeoutChoice(){
  if(busy||game.phase!=='playing'||!turnDeadline)return;
  stopClock();const forfeited=missChoice(game);render();
  if(forfeited){
    $('message').className='loss';
    $('message').textContent='Você não escolheu a jogada 3 vezes. Derrota por inatividade.';
    say('Três vezes sem escolher? Vitória minha.','taunt');
    showEnding(null);return;
  }
  say('Tempo esgotado. Vou escolher por você.','taunt');
  choose(randomItem(SIGNS,Math.random),true);
}
function activatePlayer(kind){
  if(!hasStarted||busy||game.phase!=='playing'||expiredNow())return;
  const eff=activateAbility(game,'player',kind);
  if(!eff)return;
  $('message').className='win';
  $('message').textContent=kind==='heal'?`Cura: +${eff.restored} PV (sorteado ${eff.rolled}). Efeito consumido.`
    :`${POWER_NAMES[kind]} ativad${kind==='defense'?'a':'o'}! Vale só para esta jogada. Escolha sua mão!`;
  render();
}
for(const kind of POWERS)$(`use-${kind}`).addEventListener('click',()=>activatePlayer(kind));
for(const b of document.querySelectorAll('[data-sign]'))b.addEventListener('click',()=>choose(b.dataset.sign));
window.addEventListener('keydown',e=>{
  if(e.repeat||e.ctrlKey||e.metaKey||e.altKey)return;
  const k=e.key.toLowerCase();
  if(k==='h'||k==='d'||k==='c'){
    e.preventDefault();activatePlayer({h:'heal',d:'defense',c:'critical'}[k]);
  }else if(['1','2','3'].includes(k)){
    e.preventDefault();choose(SIGNS[Number(k)-1]);
  }
});
$('restart').onclick=reset;
$('again').onclick=startNextBattle;
$('start-game').onclick=startGame;
render();clockUI(TURN_SECONDS,false);
